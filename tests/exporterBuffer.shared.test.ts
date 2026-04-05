import { describe, it, expect, vi } from 'vitest'
import { ExportResultCode, type ExportResult } from '@opentelemetry/core'
import { BasicTracerProvider, InMemorySpanExporter } from '@opentelemetry/sdk-trace-base'
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics'
import type { ResourceMetrics } from '@opentelemetry/sdk-metrics'
import {
  InMemoryLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
} from '@opentelemetry/sdk-logs'
import type { ReadableLogRecord } from '@opentelemetry/sdk-logs'
import type { NatsConnection } from '@nats-io/nats-core'
import { NatsSpanExporter } from '../src/NatsSpanExporter.js'
import { NatsMetricExporter } from '../src/NatsMetricExporter.js'
import { NatsLogRecordExporter } from '../src/NatsLogRecordExporter.js'
import { createMockConnection, asNatsConnection, type MockNatsConnection } from './helpers.js'

// --- Sample producers ------------------------------------------------------

function makeSpan(): ReadableSpan {
  const mem = new InMemorySpanExporter()
  const provider = new BasicTracerProvider()
  const span = provider.getTracer('t').startSpan('s')
  span.end()
  mem.export([span as unknown as ReadableSpan], () => {})
  return mem.getFinishedSpans()[0]!
}

async function makeMetrics(): Promise<ResourceMetrics> {
  const mem = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE)
  const reader = new PeriodicExportingMetricReader({ exporter: mem, exportIntervalMillis: 60_000 })
  const provider = new MeterProvider({ readers: [reader] })
  provider.getMeter('t').createCounter('c').add(1)
  await reader.forceFlush()
  const snap = mem.getMetrics()[0]!
  await provider.shutdown()
  return snap
}

function makeLog(): ReadableLogRecord {
  const mem = new InMemoryLogRecordExporter()
  const provider = new LoggerProvider({ processors: [new SimpleLogRecordProcessor(mem)] })
  provider.getLogger('t').emit({ severityNumber: 9, body: 'x' })
  return mem.getFinishedLogRecords()[0]!
}

// --- Scenario adapter ------------------------------------------------------

interface TestedExporter {
  readonly bufferedCount: number
  readonly bufferedBytes: number
  export(data: unknown, cb: (r: ExportResult) => void): void
}

interface CreateOpts {
  connection: () => NatsConnection | null
  subject: string
  bufferItemCount?: number
  bufferMaxBytes?: number
}

interface Scenario {
  name: string
  create: (opts: CreateOpts) => TestedExporter
  exportSample: (e: TestedExporter, cb: (r: ExportResult) => void) => void
}

const spanSample = makeSpan()
const logSample = makeLog()
const metricSample = await makeMetrics()

const scenarios: Scenario[] = [
  {
    name: 'NatsSpanExporter',
    create: (opts) => new NatsSpanExporter(opts) as unknown as TestedExporter,
    exportSample: (e, cb) => e.export([spanSample], cb),
  },
  {
    name: 'NatsMetricExporter',
    create: (opts) => new NatsMetricExporter(opts) as unknown as TestedExporter,
    exportSample: (e, cb) => e.export(metricSample, cb),
  },
  {
    name: 'NatsLogRecordExporter',
    create: (opts) => new NatsLogRecordExporter(opts) as unknown as TestedExporter,
    exportSample: (e, cb) => e.export([logSample], cb),
  },
]

// --- Shared buffer behaviour ----------------------------------------------

describe.each(scenarios)('$name — ring buffer', ({ create, exportSample }) => {
  function mkExporter(
    mockNc: MockNatsConnection,
    ready: { v: boolean },
    opts: Omit<CreateOpts, 'connection' | 'subject'>,
  ): TestedExporter {
    return create({
      connection: () => (ready.v ? asNatsConnection(mockNc) : null),
      subject: 'x',
      ...opts,
    })
  }

  it('buffers when disconnected, drains on reconnect', () => {
    const mockNc = createMockConnection()
    const ready = { v: false }
    const e = mkExporter(mockNc, ready, { bufferItemCount: 10 })

    for (let i = 0; i < 3; i++) {
      const cb = vi.fn()
      exportSample(e, cb)
      expect(cb).toHaveBeenCalledWith({ code: ExportResultCode.FAILED })
    }
    expect(mockNc.publish).not.toHaveBeenCalled()
    expect(e.bufferedCount).toBe(3)
    expect(e.bufferedBytes).toBeGreaterThan(0)

    ready.v = true
    const cb = vi.fn()
    exportSample(e, cb)
    expect(cb).toHaveBeenCalledWith({ code: ExportResultCode.SUCCESS })
    expect(mockNc.publish).toHaveBeenCalledTimes(4)
    expect(e.bufferedCount).toBe(0)
    expect(e.bufferedBytes).toBe(0)
  })

  it('enforces bufferItemCount by dropping oldest', () => {
    const mockNc = createMockConnection()
    const ready = { v: false }
    const e = mkExporter(mockNc, ready, { bufferItemCount: 2 })

    for (let i = 0; i < 4; i++) exportSample(e, () => {})
    expect(e.bufferedCount).toBe(2)

    ready.v = true
    exportSample(e, () => {})
    expect(mockNc.publish).toHaveBeenCalledTimes(3)
  })

  it('enforces bufferMaxBytes by dropping oldest', () => {
    const mockNc = createMockConnection()
    const ready = { v: false }
    const e = mkExporter(mockNc, ready, { bufferMaxBytes: 2000 })
    for (let i = 0; i < 50; i++) exportSample(e, () => {})
    expect(e.bufferedBytes).toBeLessThanOrEqual(2000)
    expect(e.bufferedCount).toBeGreaterThan(0)
  })

  it('disabled by default — failed batches are lost', () => {
    const mockNc = createMockConnection()
    const ready = { v: false }
    const e = mkExporter(mockNc, ready, {})
    exportSample(e, () => {})
    exportSample(e, () => {})
    expect(e.bufferedCount).toBe(0)

    ready.v = true
    exportSample(e, () => {})
    expect(mockNc.publish).toHaveBeenCalledTimes(1)
  })

  it('re-buffers un-sent bytes when publish throws mid-drain', () => {
    const mockNc = createMockConnection()
    let calls = 0
    mockNc.publish.mockImplementation(() => {
      calls++
      if (calls >= 2) throw new Error('boom')
    })

    const ready = { v: false }
    const e = mkExporter(mockNc, ready, { bufferItemCount: 10 })
    exportSample(e, () => {})
    exportSample(e, () => {})
    exportSample(e, () => {})
    expect(e.bufferedCount).toBe(3)

    ready.v = true
    const cb = vi.fn()
    exportSample(e, cb)
    expect(cb).toHaveBeenCalledWith({
      code: ExportResultCode.FAILED,
      error: expect.any(Error),
    })
    // 1st publish ok, 2nd throws -> 3 of 4 re-buffered
    expect(mockNc.publish).toHaveBeenCalledTimes(2)
    expect(e.bufferedCount).toBe(3)
  })
})
