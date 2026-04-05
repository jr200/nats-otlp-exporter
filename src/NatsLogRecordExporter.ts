import type { LogRecordExporter, ReadableLogRecord } from '@opentelemetry/sdk-logs'
import type { Attributes } from '@opentelemetry/api'
import type { ExportResult } from '@opentelemetry/core'
import { ProtobufLogsSerializer } from '@opentelemetry/otlp-transformer'
import { NatsOtlpExporterBase, type SerializedGroup } from './base.js'
import type { BaseExporterOptions } from './common.js'

export type NatsLogRecordExporterOptions = BaseExporterOptions

export class NatsLogRecordExporter
  extends NatsOtlpExporterBase<ReadableLogRecord[]>
  implements LogRecordExporter
{
  constructor(opts: NatsLogRecordExporterOptions) {
    super(opts)
  }

  protected prepareGroups(logs: ReadableLogRecord[]): SerializedGroup[] {
    if (logs.length === 0) return []
    const firstResource = logs[0]!.resource
    let allSame = true
    for (let i = 1; i < logs.length; i++) {
      if (logs[i]!.resource !== firstResource) {
        allSame = false
        break
      }
    }
    if (allSame) {
      const bytes = ProtobufLogsSerializer.serializeRequest(logs)
      if (!bytes || bytes.length === 0) return []
      return [{ attrs: firstResource?.attributes ?? {}, bytes }]
    }
    const groups = new Map<object, ReadableLogRecord[]>()
    for (const log of logs) {
      const key = log.resource as unknown as object
      let bucket = groups.get(key)
      if (!bucket) {
        bucket = []
        groups.set(key, bucket)
      }
      bucket.push(log)
    }
    const out: SerializedGroup[] = []
    for (const [resource, subset] of groups) {
      const bytes = ProtobufLogsSerializer.serializeRequest(subset)
      if (bytes && bytes.length > 0) {
        out.push({
          attrs: ((resource as { attributes?: Attributes }).attributes ?? {}) as Attributes,
          bytes,
        })
      }
    }
    return out
  }

  export(logs: ReadableLogRecord[], resultCallback: (result: ExportResult) => void): void {
    this.exportInput(logs, resultCallback)
  }

  shutdown(): Promise<void> {
    return this.shutdownBase()
  }

  forceFlush(): Promise<void> {
    return this.forceFlushBase()
  }
}
