import { describe, it, expect, vi } from 'vitest'
import { BasicTracerProvider, InMemorySpanExporter } from '@opentelemetry/sdk-trace-base'
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'
import { NatsSpanExporter } from '../src/NatsSpanExporter.js'
import { createMockConnection, asNatsConnection } from './helpers.js'

function makeSpan(): ReadableSpan {
  const mem = new InMemorySpanExporter()
  const provider = new BasicTracerProvider()
  const s = provider.getTracer('t').startSpan('s')
  s.end()
  mem.export([s as unknown as ReadableSpan], () => {})
  return mem.getFinishedSpans()[0]!
}

describe('hooks', () => {
  it('onDrop fires when buffer exceeds itemCount', () => {
    const onDrop = vi.fn()
    const e = new NatsSpanExporter({
      connection: () => null,
      subject: 's',
      bufferItemCount: 2,
      hooks: { onDrop },
    })
    e.export([makeSpan()], () => {})
    e.export([makeSpan()], () => {})
    e.export([makeSpan()], () => {}) // evicts one
    expect(onDrop).toHaveBeenCalledTimes(1)
    expect(onDrop).toHaveBeenCalledWith('itemLimit', expect.any(Number))
  })

  it('onDrop fires with byteLimit reason', () => {
    const onDrop = vi.fn()
    const e = new NatsSpanExporter({
      connection: () => null,
      subject: 's',
      bufferMaxBytes: 500,
      hooks: { onDrop },
    })
    for (let i = 0; i < 10; i++) e.export([makeSpan()], () => {})
    expect(onDrop).toHaveBeenCalled()
    expect(onDrop.mock.calls.some((c) => c[0] === 'byteLimit')).toBe(true)
  })

  it('onFlush fires after successful drain', () => {
    const onFlush = vi.fn()
    const mockNc = createMockConnection()
    let ready = false
    const e = new NatsSpanExporter({
      connection: () => (ready ? asNatsConnection(mockNc) : null),
      subject: 's',
      bufferItemCount: 10,
      hooks: { onFlush },
    })
    e.export([makeSpan()], () => {})
    e.export([makeSpan()], () => {})
    expect(onFlush).not.toHaveBeenCalled()

    ready = true
    e.export([makeSpan()], () => {})
    expect(onFlush).toHaveBeenCalledTimes(1)
    expect(onFlush).toHaveBeenCalledWith(3, expect.any(Number))
  })

  it('onPublishError fires when publish throws', () => {
    const onPublishError = vi.fn()
    const mockNc = createMockConnection()
    mockNc.publish.mockImplementation(() => {
      throw new Error('boom')
    })
    const e = new NatsSpanExporter({
      connection: () => asNatsConnection(mockNc),
      subject: 's',
      hooks: { onPublishError },
    })
    e.export([makeSpan()], () => {})
    expect(onPublishError).toHaveBeenCalledTimes(1)
    expect(onPublishError.mock.calls[0]![0].message).toBe('boom')
  })

  it('onPayloadTooLarge fires and returns FAILED when over limit', () => {
    const onPayloadTooLarge = vi.fn()
    const mockNc = createMockConnection()
    const e = new NatsSpanExporter({
      connection: () => asNatsConnection(mockNc),
      subject: 's',
      maxPayloadBytes: 1, // effectively forces every batch over limit
      hooks: { onPayloadTooLarge },
    })
    const cb = vi.fn()
    e.export([makeSpan()], cb)
    expect(onPayloadTooLarge).toHaveBeenCalledTimes(1)
    expect(mockNc.publish).not.toHaveBeenCalled()
    expect(cb.mock.calls[0]![0].code).toBe(1) // FAILED = 1
  })
})
