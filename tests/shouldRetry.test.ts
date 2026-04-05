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

describe('shouldRetry', () => {
  it('defaults to re-buffering on failure (shouldRetry undefined)', () => {
    const mockNc = createMockConnection()
    mockNc.publish.mockImplementation(() => {
      throw new Error('transient')
    })
    const e = new NatsSpanExporter({
      connection: () => asNatsConnection(mockNc),
      subject: 's',
      bufferItemCount: 10,
    })
    e.export([makeSpan()], () => {})
    expect(e.bufferedCount).toBe(1)
  })

  it('dropping batches when shouldRetry returns false + fires onDrop(permanentError)', () => {
    const mockNc = createMockConnection()
    mockNc.publish.mockImplementation(() => {
      throw new Error('permanent: stream not found')
    })
    const onDrop = vi.fn()
    const cb = vi.fn()
    const e = new NatsSpanExporter({
      connection: () => asNatsConnection(mockNc),
      subject: 's',
      bufferItemCount: 10,
      shouldRetry: (err) => !err.message.startsWith('permanent'),
      hooks: { onDrop },
    })
    e.export([makeSpan()], cb)
    expect(e.bufferedCount).toBe(0)
    expect(onDrop).toHaveBeenCalledWith('permanentError', expect.any(Number))
    expect(cb.mock.calls[0]![0].code).toBe(ExportResultCode.FAILED)
  })

  it('re-buffers when shouldRetry returns true (explicit)', () => {
    const mockNc = createMockConnection()
    mockNc.publish.mockImplementation(() => {
      throw new Error('retryable')
    })
    const e = new NatsSpanExporter({
      connection: () => asNatsConnection(mockNc),
      subject: 's',
      bufferItemCount: 10,
      shouldRetry: () => true,
    })
    e.export([makeSpan()], () => {})
    expect(e.bufferedCount).toBe(1)
  })

  it('prevents buffer fill-up with permanently-failing publish', () => {
    const mockNc = createMockConnection()
    mockNc.publish.mockImplementation(() => {
      throw new Error('bad subject')
    })
    const e = new NatsSpanExporter({
      connection: () => asNatsConnection(mockNc),
      subject: 's',
      bufferItemCount: 100,
      shouldRetry: () => false,
    })
    for (let i = 0; i < 20; i++) e.export([makeSpan()], () => {})
    expect(e.bufferedCount).toBe(0)
  })
})
