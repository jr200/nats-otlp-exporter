import { describe, it, expect, vi } from 'vitest'
import { ExportResultCode } from '@opentelemetry/core'
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

describe('shutdown', () => {
  it('drains buffer on shutdown when connection available', async () => {
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
    await e.shutdown()
    expect(mockNc.publish).toHaveBeenCalledTimes(2)
    expect(e.bufferedCount).toBe(0)
  })

  it('export after shutdown returns FAILED', async () => {
    const mockNc = createMockConnection()
    const e = new NatsSpanExporter({
      connection: () => asNatsConnection(mockNc),
      subject: 's',
    })
    await e.shutdown()
    const cb = vi.fn()
    e.export([makeSpan()], cb)
    expect(cb).toHaveBeenCalledWith({
      code: ExportResultCode.FAILED,
      error: expect.any(Error),
    })
    expect(mockNc.publish).not.toHaveBeenCalled()
  })

  it('shutdown is idempotent', async () => {
    const e = new NatsSpanExporter({ connection: () => null, subject: 's' })
    await e.shutdown()
    await expect(e.shutdown()).resolves.toBeUndefined()
  })
})
