import type { SpanExporter, ReadableSpan } from '@opentelemetry/sdk-trace-base'
import type { Attributes } from '@opentelemetry/api'
import type { ExportResult } from '@opentelemetry/core'
import { ProtobufTraceSerializer } from '@opentelemetry/otlp-transformer'
import { NatsOtlpExporterBase, type SerializedGroup } from './base.js'
import type { BaseExporterOptions } from './common.js'

export type NatsSpanExporterOptions = BaseExporterOptions

export class NatsSpanExporter extends NatsOtlpExporterBase<ReadableSpan[]> implements SpanExporter {
  constructor(opts: NatsSpanExporterOptions) {
    super(opts)
  }

  protected prepareGroups(spans: ReadableSpan[]): SerializedGroup[] {
    if (spans.length === 0) return []
    // Fast path: one resource (common case)
    const firstResource = spans[0]!.resource
    let allSame = true
    for (let i = 1; i < spans.length; i++) {
      if (spans[i]!.resource !== firstResource) {
        allSame = false
        break
      }
    }
    if (allSame) {
      const bytes = ProtobufTraceSerializer.serializeRequest(spans)
      if (!bytes || bytes.length === 0) return []
      return [{ attrs: firstResource?.attributes ?? {}, bytes }]
    }
    // Multi-resource path: group then serialize each group.
    const groups = new Map<object, ReadableSpan[]>()
    for (const span of spans) {
      const key = span.resource as unknown as object
      let bucket = groups.get(key)
      if (!bucket) {
        bucket = []
        groups.set(key, bucket)
      }
      bucket.push(span)
    }
    const out: SerializedGroup[] = []
    for (const [resource, subset] of groups) {
      const bytes = ProtobufTraceSerializer.serializeRequest(subset)
      if (bytes && bytes.length > 0) {
        out.push({
          attrs: ((resource as { attributes?: Attributes }).attributes ?? {}) as Attributes,
          bytes,
        })
      }
    }
    return out
  }

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    this.exportInput(spans, resultCallback)
  }

  shutdown(): Promise<void> {
    return this.shutdownBase()
  }

  forceFlush(): Promise<void> {
    return this.forceFlushBase()
  }
}
