import type { Attributes } from '@opentelemetry/api'
import { headers as natsHeaders, type MsgHdrs, type NatsConnection } from '@nats-io/nats-core'
import type { DropReason } from './ringBuffer.js'

/** Serialised batch ready to be published. */
export interface PreparedBatch {
  subject: string
  data: Uint8Array
  /** Final header record; includes Nats-Msg-Id if enabled. */
  headers?: Record<string, string>
}

/**
 * Pluggable publish function. Defaults to a synchronous `nc.publish()`, but
 * callers can substitute a JetStream publisher, a retrying wrapper, etc.
 *
 * May return a Promise; the exporter awaits it before moving to the next
 * batch. Thrown/rejected values cause the remaining batches to be re-buffered.
 */
export type PublishFn = (
  nc: NatsConnection,
  subject: string,
  data: Uint8Array,
  headers: MsgHdrs | undefined,
) => void | Promise<unknown>

/**
 * Resolves the NATS subject for a given batch. Static string or a function
 * of the batch's resource attributes (grouped-by-resource when dynamic).
 */
export type SubjectResolver = string | ((resourceAttributes: Attributes) => string)

/** Headers attached to every published message. */
export type HeadersOption =
  | Record<string, string>
  | ((ctx: { subject: string; resourceAttributes: Attributes }) => Record<string, string>)

export interface ExporterHooks {
  onDrop?: (reason: DropReason, droppedBytes: number) => void
  onFlush?: (drainedCount: number, drainedBytes: number) => void
  onPublishError?: (err: Error) => void
  onPayloadTooLarge?: (bytes: number) => void
}

export interface BufferOptions {
  /** Max queued batches. 0 = no item limit. Default 0. */
  bufferItemCount?: number
  /** Max queued bytes. 0 = no byte limit. Default 0. */
  bufferMaxBytes?: number
  /** Drain timer interval (ms). Default: disabled. */
  retryIntervalMs?: number
  /** Drop batches larger than this (NATS `max_payload` awareness). Default: no check. */
  maxPayloadBytes?: number
}

export interface BaseExporterOptions extends BufferOptions {
  connection: () => NatsConnection | null
  subject: SubjectResolver
  publish?: PublishFn
  /**
   * Headers attached to every message. Default:
   * `{ 'Content-Type': 'application/x-protobuf' }`. Set `false` to disable
   * all headers (including Nats-Msg-Id). A function is called once per
   * prepared batch.
   */
  headers?: HeadersOption | false
  /**
   * If true (default), a `Nats-Msg-Id` UUIDv7 header is added to every
   * batch, enabling JetStream deduplication and consumer-side dedup/ordering.
   * Set false to disable. Ignored when `headers: false`.
   */
  autoMsgId?: boolean
  /**
   * Classify a publish error as transient (retry = return true, default)
   * or permanent (return false → drop batch + fire onDrop with reason
   * 'permanentError'). Use to avoid infinite re-buffering of batches that
   * will never succeed (bad subject, missing JetStream stream, auth
   * failure, etc.).
   */
  shouldRetry?: (err: Error) => boolean
  /**
   * If true, subscribe to `nc.status()` and trigger an immediate drain on
   * `reconnect` events — responding faster than `retryIntervalMs` alone.
   * Requires the NATS client to actually emit status events. Default false.
   */
  watchReconnect?: boolean
  hooks?: ExporterHooks
}

export const DEFAULT_CONTENT_TYPE_HEADERS: Record<string, string> = {
  'Content-Type': 'application/x-protobuf',
}

export const NATS_MSG_ID_HEADER = 'Nats-Msg-Id'

/** Convert a plain record to a NATS MsgHdrs, or undefined if empty. */
export function buildMsgHdrs(record: Record<string, string> | undefined): MsgHdrs | undefined {
  if (!record) return undefined
  const keys = Object.keys(record)
  if (keys.length === 0) return undefined
  const h = natsHeaders()
  for (const k of keys) h.set(k, record[k]!)
  return h
}

/** Default publish: synchronous `nc.publish()` with optional headers. */
export const defaultPublish: PublishFn = (nc, subject, data, hdrs) => {
  nc.publish(subject, data, hdrs ? { headers: hdrs } : undefined)
}

export function resolveSubject(resolver: SubjectResolver, attrs: Attributes): string {
  return typeof resolver === 'function' ? resolver(attrs) : resolver
}

export function resolveHeaders(
  opt: HeadersOption | false | undefined,
  ctx: { subject: string; resourceAttributes: Attributes },
): Record<string, string> | undefined {
  if (opt === false) return undefined
  if (opt === undefined) return { ...DEFAULT_CONTENT_TYPE_HEADERS }
  if (typeof opt === 'function') return { ...opt(ctx) }
  return { ...opt }
}

/**
 * Validate a NATS subject. Throws if the subject is invalid per NATS rules:
 * non-empty, no whitespace, no leading/trailing/consecutive dots, no `*`/`>`
 * as publish targets (valid only in subscriptions).
 */
export function validateSubject(subject: string): void {
  if (!subject || typeof subject !== 'string') {
    throw new Error(`invalid NATS subject: empty or non-string`)
  }
  if (/\s/.test(subject)) {
    throw new Error(`invalid NATS subject: "${subject}" contains whitespace`)
  }
  if (subject.startsWith('.') || subject.endsWith('.')) {
    throw new Error(`invalid NATS subject: "${subject}" has leading/trailing dot`)
  }
  if (subject.includes('..')) {
    throw new Error(`invalid NATS subject: "${subject}" has empty token`)
  }
  const tokens = subject.split('.')
  for (const token of tokens) {
    if (token === '*' || token === '>') {
      throw new Error(
        `invalid NATS subject: "${subject}" uses wildcard "${token}" (allowed only in subscriptions)`,
      )
    }
  }
}
