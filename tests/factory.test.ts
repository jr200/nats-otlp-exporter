import { describe, it, expect } from 'vitest'
import { createNatsOtlpExporters } from '../src/factory.js'
import { NatsSpanExporter } from '../src/NatsSpanExporter.js'
import { NatsMetricExporter } from '../src/NatsMetricExporter.js'
import { NatsLogRecordExporter } from '../src/NatsLogRecordExporter.js'
import { AggregationTemporality } from '@opentelemetry/sdk-metrics'
import { createMockConnection, asNatsConnection } from './helpers.js'

describe('createNatsOtlpExporters', () => {
  it('creates only the exporters whose subject is set', () => {
    const mockNc = createMockConnection()
    const out = createNatsOtlpExporters({
      connection: () => asNatsConnection(mockNc),
      subjects: { traces: 'traces', logs: 'logs' },
    })
    expect(out.traceExporter).toBeInstanceOf(NatsSpanExporter)
    expect(out.logRecordExporter).toBeInstanceOf(NatsLogRecordExporter)
    expect(out.metricExporter).toBeUndefined()
  })

  it('passes shared buffer + hooks + headers to every exporter', () => {
    const mockNc = createMockConnection()
    const out = createNatsOtlpExporters({
      connection: () => asNatsConnection(mockNc),
      subjects: { traces: 't', metrics: 'm', logs: 'l' },
      buffer: { bufferItemCount: 5 },
      temporality: AggregationTemporality.DELTA,
    })
    expect(out.traceExporter).toBeInstanceOf(NatsSpanExporter)
    expect(out.metricExporter).toBeInstanceOf(NatsMetricExporter)
    expect(out.logRecordExporter).toBeInstanceOf(NatsLogRecordExporter)
    expect(out.metricExporter!.selectAggregationTemporality()).toBe(AggregationTemporality.DELTA)
  })
})
