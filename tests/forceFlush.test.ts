import { describe, it, expect } from 'vitest'
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

describe('forceFlush', () => {
  it('drains the ring buffer', async () => {
    const mockNc = createMockConnection()
    let ready = false
    const e = new NatsSpanExporter({
      connection: () => (ready ? asNatsConnection(mockNc) : null),
      subject: 's',
      bufferItemCount: 10,
    })
    e.export([makeSpan()], () => {})
    e.export([makeSpan()], () => {})
    expect(e.bufferedCount).toBe(2)

    ready = true
    await e.forceFlush()
    expect(mockNc.publish).toHaveBeenCalledTimes(2)
    expect(e.bufferedCount).toBe(0)
  })

  it('is a no-op when buffer is empty or connection unavailable', async () => {
    const e = new NatsSpanExporter({ connection: () => null, subject: 's' })
    await expect(e.forceFlush()).resolves.toBeUndefined()
  })
})
