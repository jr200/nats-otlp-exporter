import type { NatsConnection } from '@nats-io/nats-core'
import { AggregationTemporality } from '@opentelemetry/sdk-metrics'
import { NatsSpanExporter } from './NatsSpanExporter.js'
import { NatsMetricExporter } from './NatsMetricExporter.js'
import { NatsLogRecordExporter } from './NatsLogRecordExporter.js'
import type {
  BufferOptions,
  ExporterHooks,
  HeadersOption,
  PublishFn,
  SubjectResolver,
} from './common.js'

export interface NatsOtlpFactoryOptions {
  connection: () => NatsConnection | null
  /** Per-signal subjects; omitting a key disables that exporter. */
  subjects: {
    traces?: SubjectResolver
    metrics?: SubjectResolver
    logs?: SubjectResolver
  }
  /** Shared buffer/retry/payload options applied to every exporter. */
  buffer?: BufferOptions
  /** Shared publish override (e.g. JetStream). */
  publish?: PublishFn
  /** Shared headers. */
  headers?: HeadersOption | false
  /** Shared hooks. */
  hooks?: ExporterHooks
  /** Metric-only: aggregation temporality. */
  temporality?: AggregationTemporality
}

export interface NatsOtlpExporters {
  traceExporter?: NatsSpanExporter
  metricExporter?: NatsMetricExporter
  logRecordExporter?: NatsLogRecordExporter
}

/**
 * Build a matching set of NATS OTLP exporters sharing the same NATS
 * connection, hooks, buffer config, etc. Only the signals whose subject is
 * specified are created.
 */
export function createNatsOtlpExporters(opts: NatsOtlpFactoryOptions): NatsOtlpExporters {
  const { connection, subjects, buffer, publish, headers, hooks, temporality } = opts
  const common = {
    connection,
    publish,
    headers,
    hooks,
    ...buffer,
  } as const
  const out: NatsOtlpExporters = {}
  if (subjects.traces !== undefined) {
    out.traceExporter = new NatsSpanExporter({ ...common, subject: subjects.traces })
  }
  if (subjects.metrics !== undefined) {
    out.metricExporter = new NatsMetricExporter({
      ...common,
      subject: subjects.metrics,
      ...(temporality !== undefined ? { temporality } : {}),
    })
  }
  if (subjects.logs !== undefined) {
    out.logRecordExporter = new NatsLogRecordExporter({ ...common, subject: subjects.logs })
  }
  return out
}
