import { describe, it, expect } from 'vitest'
import {
  MeterProvider,
  PeriodicExportingMetricReader,
  AggregationTemporality,
} from '@opentelemetry/sdk-metrics'
import { NatsMetricExporter } from '../../src/NatsMetricExporter.js'
import { createMockConnection, asNatsConnection } from '../helpers.js'

describe('NatsMetricExporter e2e with MeterProvider', () => {
  it('publishes a batch when the reader flushes', async () => {
    const mockNc = createMockConnection()
    const exporter = new NatsMetricExporter({
      connection: () => asNatsConnection(mockNc),
      subject: 'e2e.metrics',
    })
    const reader = new PeriodicExportingMetricReader({
      exporter,
      exportIntervalMillis: 60_000,
    })
    const provider = new MeterProvider({ readers: [reader] })
    const meter = provider.getMeter('e2e')
    const counter = meter.createCounter('requests')
    counter.add(1, { route: '/a' })
    counter.add(2, { route: '/b' })

    await reader.forceFlush()

    expect(mockNc.publish).toHaveBeenCalledTimes(1)
    const [subject, payload] = mockNc.publish.mock.calls[0]!
    expect(subject).toBe('e2e.metrics')
    expect(payload).toBeInstanceOf(Uint8Array)
    expect((payload as Uint8Array).length).toBeGreaterThan(0)

    await provider.shutdown()
  })

  it('honours DELTA temporality end-to-end', async () => {
    const mockNc = createMockConnection()
    const exporter = new NatsMetricExporter({
      connection: () => asNatsConnection(mockNc),
      subject: 'e2e.metrics',
      temporality: AggregationTemporality.DELTA,
    })
    expect(exporter.selectAggregationTemporality()).toBe(AggregationTemporality.DELTA)

    const reader = new PeriodicExportingMetricReader({
      exporter,
      exportIntervalMillis: 60_000,
    })
    const provider = new MeterProvider({ readers: [reader] })
    const meter = provider.getMeter('e2e')
    const counter = meter.createCounter('events')
    counter.add(1)

    await reader.forceFlush()
    expect(mockNc.publish).toHaveBeenCalledTimes(1)

    await provider.shutdown()
  })
})
