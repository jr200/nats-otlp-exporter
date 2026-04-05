import { describe, it, expect, vi } from 'vitest'
import { ExportResultCode } from '@opentelemetry/core'
import {
  AggregationTemporality,
  MeterProvider,
  PeriodicExportingMetricReader,
  InMemoryMetricExporter,
} from '@opentelemetry/sdk-metrics'
import type { ResourceMetrics } from '@opentelemetry/sdk-metrics'
import { NatsMetricExporter } from '../src/NatsMetricExporter.js'
import { createMockConnection, asNatsConnection } from './helpers.js'

// Produce a ResourceMetrics snapshot using the SDK's InMemoryMetricExporter.
async function collectMetrics(): Promise<ResourceMetrics> {
  const memExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE)
  const reader = new PeriodicExportingMetricReader({
    exporter: memExporter,
    exportIntervalMillis: 10_000,
  })
  const provider = new MeterProvider({ readers: [reader] })
  const meter = provider.getMeter('test')
  const counter = meter.createCounter('test_counter')
  counter.add(1, { key: 'value' })
  await reader.forceFlush()
  const snapshots = memExporter.getMetrics()
  await provider.shutdown()
  return snapshots[0]!
}

describe('NatsMetricExporter', () => {
  it('publishes serialized protobuf bytes to the configured subject', async () => {
    const mockNc = createMockConnection()
    const exporter = new NatsMetricExporter({
      connection: () => asNatsConnection(mockNc),
      subject: 'test.otlp.metrics',
    })
    const metrics = await collectMetrics()

    const callback = vi.fn()
    exporter.export(metrics, callback)

    expect(mockNc.publish).toHaveBeenCalledTimes(1)
    const [subject, payload] = mockNc.publish.mock.calls[0]!
    expect(subject).toBe('test.otlp.metrics')
    expect(payload).toBeInstanceOf(Uint8Array)
    expect((payload as Uint8Array).length).toBeGreaterThan(0)
    expect(callback).toHaveBeenCalledWith({ code: ExportResultCode.SUCCESS })
  })

  it('returns FAILED when connection getter returns null', async () => {
    const exporter = new NatsMetricExporter({
      connection: () => null,
      subject: 'test.otlp.metrics',
    })
    const metrics = await collectMetrics()
    const callback = vi.fn()
    exporter.export(metrics, callback)
    expect(callback).toHaveBeenCalledWith({ code: ExportResultCode.FAILED })
  })

  it('defaults temporality to CUMULATIVE', () => {
    const exporter = new NatsMetricExporter({
      connection: () => null,
      subject: 'test.otlp.metrics',
    })
    expect(exporter.selectAggregationTemporality()).toBe(AggregationTemporality.CUMULATIVE)
  })

  it('respects custom temporality', () => {
    const exporter = new NatsMetricExporter({
      connection: () => null,
      subject: 'test.otlp.metrics',
      temporality: AggregationTemporality.DELTA,
    })
    expect(exporter.selectAggregationTemporality()).toBe(AggregationTemporality.DELTA)
  })
})
