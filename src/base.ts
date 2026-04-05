import type { Attributes } from '@opentelemetry/api'
import { diag } from '@opentelemetry/api'
import { ExportResultCode, type ExportResult } from '@opentelemetry/core'
import type { NatsConnection } from '@nats-io/nats-core'
import { RingBuffer } from './ringBuffer.js'
import {
  buildMsgHdrs,
  defaultPublish,
  resolveHeaders,
  resolveSubject,
  validateSubject,
  NATS_MSG_ID_HEADER,
  type BaseExporterOptions,
  type ExporterHooks,
  type PreparedBatch,
  type PublishFn,
  type SubjectResolver,
  type HeadersOption,
} from './common.js'
import { uuidv7 } from './uuid.js'

/** One logical group of telemetry sharing a single resource. */
export interface SerializedGroup {
  attrs: Attributes
  bytes: Uint8Array
}

/**
 * Shared implementation for all NATS OTLP exporters. Subclasses only provide
 * {@link prepareGroups}; everything else lives here: per-group subject +
 * headers + Msg-Id, ring buffering, retry timer, reconnect watcher,
 * forceFlush, shutdown drain, max-payload check, hooks.
 *
 * ## Concurrency
 * `export()` runs its publish inline. For synchronous `publishFn` (core NATS
 * publish) this is strictly serial. For async `publishFn` (e.g. JetStream),
 * concurrent calls to `export()` may interleave — the final publish ordering
 * of re-buffered items under failure is non-deterministic. This is harmless
 * for OTLP: each batch carries its own timestamps, and the auto-added
 * `Nats-Msg-Id` (UUIDv7) header lets JetStream dedup retries idempotently.
 */
export abstract class NatsOtlpExporterBase<TInput> {
  private readonly ring: RingBuffer
  private readonly publishFn: PublishFn
  private readonly hooks: ExporterHooks
  private readonly subjectResolver: SubjectResolver
  private readonly headersOpt: HeadersOption | false | undefined
  private readonly autoMsgId: boolean
  private readonly maxPayloadBytes: number
  private readonly retryIntervalMs: number
  private readonly shouldRetry: (err: Error) => boolean
  private readonly watchReconnect: boolean
  private retryTimer: ReturnType<typeof setInterval> | undefined
  private shuttingDown = false
  private readonly connectionFn: () => NatsConnection | null
  private watchedConnection: NatsConnection | null = null
  private watcherAbort: { aborted: boolean } | undefined

  constructor(opts: BaseExporterOptions) {
    this.connectionFn = opts.connection
    this.subjectResolver = opts.subject
    if (typeof opts.subject === 'string') validateSubject(opts.subject)
    this.publishFn = opts.publish ?? defaultPublish
    this.hooks = opts.hooks ?? {}
    this.headersOpt = opts.headers
    this.autoMsgId = opts.autoMsgId !== false
    this.maxPayloadBytes = opts.maxPayloadBytes ?? 0
    this.retryIntervalMs = opts.retryIntervalMs ?? 0
    this.shouldRetry = opts.shouldRetry ?? (() => true)
    this.watchReconnect = opts.watchReconnect ?? false
    this.ring = new RingBuffer({
      maxItems: opts.bufferItemCount ?? 0,
      maxBytes: opts.bufferMaxBytes ?? 0,
      onDrop: (reason, bytes) => this.hooks.onDrop?.(reason, bytes),
    })
    if (this.retryIntervalMs > 0) this.startRetryTimer()
  }

  get bufferedCount(): number {
    return this.ring.size
  }

  get bufferedBytes(): number {
    return this.ring.byteSize
  }

  /**
   * Serialize the input into one or more groups, one per resource. Metric
   * batches always produce a single group; span/log batches may produce
   * multiple groups when the batch mixes resources.
   */
  protected abstract prepareGroups(input: TInput): SerializedGroup[]

  protected exportInput(input: TInput, cb: (r: ExportResult) => void): void {
    if (this.shuttingDown) {
      cb({ code: ExportResultCode.FAILED, error: new Error('Exporter is shut down') })
      return
    }

    let groups: SerializedGroup[]
    try {
      groups = this.prepareGroups(input)
    } catch (err) {
      cb({ code: ExportResultCode.FAILED, error: err as Error })
      return
    }

    const prepared: PreparedBatch[] = []
    for (const g of groups) {
      if (this.maxPayloadBytes > 0 && g.bytes.length > this.maxPayloadBytes) {
        diag.warn(
          `NatsOtlpExporter: batch of ${g.bytes.length} bytes exceeds maxPayloadBytes=${this.maxPayloadBytes}`,
        )
        this.hooks.onPayloadTooLarge?.(g.bytes.length)
        cb({
          code: ExportResultCode.FAILED,
          error: new Error(
            `batch exceeds maxPayloadBytes (${g.bytes.length} > ${this.maxPayloadBytes})`,
          ),
        })
        return
      }
      prepared.push(this.prepareBatch(g))
    }

    const nc = this.connectionFn()
    if (!nc) {
      for (const b of prepared) this.ring.push(b)
      cb({ code: ExportResultCode.FAILED })
      return
    }
    this.maybeWatchStatus(nc)

    const pending = this.ring.drain()
    for (const b of prepared) pending.push(b)
    if (pending.length === 0) {
      cb({ code: ExportResultCode.SUCCESS })
      return
    }

    void this.publishBatches(nc, pending, cb)
  }

  private prepareBatch(group: SerializedGroup): PreparedBatch {
    const subject = resolveSubject(this.subjectResolver, group.attrs)
    if (typeof this.subjectResolver === 'function') validateSubject(subject)
    let headers: Record<string, string> | undefined
    if (this.headersOpt !== false) {
      headers = resolveHeaders(this.headersOpt, { subject, resourceAttributes: group.attrs })
      if (this.autoMsgId && headers && !(NATS_MSG_ID_HEADER in headers)) {
        headers[NATS_MSG_ID_HEADER] = uuidv7()
      }
    }
    return { subject, data: group.bytes, headers }
  }

  private async publishBatches(
    nc: NatsConnection,
    pending: PreparedBatch[],
    cb: (r: ExportResult) => void,
  ): Promise<void> {
    let i = 0
    const totalBytes = pending.reduce((n, b) => n + b.data.length, 0)
    try {
      for (i = 0; i < pending.length; i++) {
        const p = pending[i]!
        const hdrs = buildMsgHdrs(p.headers)
        const r = this.publishFn(nc, p.subject, p.data, hdrs)
        if (r && typeof (r as Promise<unknown>).then === 'function') await r
      }
      this.hooks.onFlush?.(pending.length, totalBytes)
      cb({ code: ExportResultCode.SUCCESS })
    } catch (err) {
      const e = err as Error
      diag.debug(`NatsOtlpExporter: publish failed: ${e.message}`)
      this.hooks.onPublishError?.(e)
      const remaining = pending.slice(i)
      if (this.shouldRetry(e)) {
        this.ring.unshiftAll(remaining)
      } else {
        // Drop remaining batches (don't re-buffer) and surface via onDrop.
        for (const b of remaining) this.hooks.onDrop?.('permanentError', b.data.length)
      }
      cb({ code: ExportResultCode.FAILED, error: e })
    }
  }

  private startRetryTimer(): void {
    if (this.retryTimer) return
    const timer = setInterval(() => {
      void this.tryRetry()
    }, this.retryIntervalMs)
    ;(timer as unknown as { unref?: () => void }).unref?.()
    this.retryTimer = timer
  }

  private async tryRetry(): Promise<void> {
    if (this.shuttingDown || this.ring.size === 0) return
    const nc = this.connectionFn()
    if (!nc) return
    this.maybeWatchStatus(nc)
    const pending = this.ring.drain()
    if (pending.length === 0) return
    await this.publishBatches(nc, pending, () => {})
  }

  /** Subscribe to nc.status() for immediate reconnect drains. */
  private maybeWatchStatus(nc: NatsConnection): void {
    if (!this.watchReconnect) return
    if (this.watchedConnection === nc) return
    // Different (or first) connection — (re)start watcher.
    if (this.watcherAbort) this.watcherAbort.aborted = true
    const token = { aborted: false }
    this.watcherAbort = token
    this.watchedConnection = nc
    void this.watchStatus(nc, token)
  }

  private async watchStatus(nc: NatsConnection, token: { aborted: boolean }): Promise<void> {
    try {
      for await (const ev of nc.status()) {
        if (token.aborted || this.shuttingDown) return
        const type = (ev as { type?: string }).type
        if (type === 'reconnect') {
          diag.debug('NatsOtlpExporter: reconnect event, draining buffer')
          void this.drainAndPublish()
        }
      }
    } catch (err) {
      diag.debug(`NatsOtlpExporter: status watcher ended: ${(err as Error).message}`)
    } finally {
      if (this.watchedConnection === nc) this.watchedConnection = null
    }
  }

  /** Drain the buffer now (used by forceFlush + shutdown + reconnect). */
  protected async drainAndPublish(): Promise<void> {
    if (this.ring.size === 0) return
    const nc = this.connectionFn()
    if (!nc) return
    const pending = this.ring.drain()
    if (pending.length === 0) return
    await this.publishBatches(nc, pending, () => {})
  }

  protected forceFlushBase(): Promise<void> {
    return this.drainAndPublish()
  }

  protected async shutdownBase(timeoutMs = 5000): Promise<void> {
    this.shuttingDown = true
    if (this.retryTimer) {
      clearInterval(this.retryTimer)
      this.retryTimer = undefined
    }
    if (this.watcherAbort) {
      this.watcherAbort.aborted = true
      this.watcherAbort = undefined
    }
    await Promise.race([
      this.drainAndPublish(),
      new Promise<void>((resolve) => {
        const t = setTimeout(resolve, timeoutMs)
        ;(t as unknown as { unref?: () => void }).unref?.()
      }),
    ])
  }
}
