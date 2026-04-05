import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BasicTracerProvider, InMemorySpanExporter } from '@opentelemetry/sdk-trace-base'
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'
import { NatsSpanExporter } from '../src/NatsSpanExporter.js'
import { createMockConnection, asNatsConnection } from './helpers.js'

function makeSpan(): ReadableSpan {
  const mem = new InMemorySpanExporter()
  const p = new BasicTracerProvider()
  const s = p.getTracer('t').startSpan('s')
  s.end()
  mem.export([s as unknown as ReadableSpan], () => {})
  return mem.getFinishedSpans()[0]!
}

describe('retry timer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('drains buffer on timer tick after connection becomes available', async () => {
    const mockNc = createMockConnection()
    let ready = false
    const e = new NatsSpanExporter({
      connection: () => (ready ? asNatsConnection(mockNc) : null),
      subject: 's',
      bufferItemCount: 10,
      retryIntervalMs: 100,
    })

    e.export([makeSpan()], () => {})
    e.export([makeSpan()], () => {})
    expect(e.bufferedCount).toBe(2)

    // Timer tick while still disconnected — nothing drains.
    await vi.advanceTimersByTimeAsync(150)
    expect(mockNc.publish).not.toHaveBeenCalled()
    expect(e.bufferedCount).toBe(2)

    // Connection becomes available; next tick should drain.
    ready = true
    await vi.advanceTimersByTimeAsync(150)
    expect(mockNc.publish).toHaveBeenCalledTimes(2)
    expect(e.bufferedCount).toBe(0)

    await e.shutdown()
  })
})
