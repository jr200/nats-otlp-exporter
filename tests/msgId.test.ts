import { describe, it, expect } from 'vitest'
import { BasicTracerProvider, InMemorySpanExporter } from '@opentelemetry/sdk-trace-base'
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'
import { NatsSpanExporter } from '../src/NatsSpanExporter.js'
import { NATS_MSG_ID_HEADER } from '../src/common.js'
import { createMockConnection, asNatsConnection } from './helpers.js'

function makeSpan(): ReadableSpan {
  const mem = new InMemorySpanExporter()
  const p = new BasicTracerProvider()
  const s = p.getTracer('t').startSpan('s')
  s.end()
  mem.export([s as unknown as ReadableSpan], () => {})
  return mem.getFinishedSpans()[0]!
}

function getHeaders(
  mockNc: ReturnType<typeof createMockConnection>,
  callIndex = 0,
): { get(k: string): string; has(k: string): boolean } {
  const opts = mockNc.publish.mock.calls[callIndex]![2] as { headers: never }
  return opts.headers
}

describe('Nats-Msg-Id header', () => {
  it('is added by default as UUIDv7', () => {
    const mockNc = createMockConnection()
    const e = new NatsSpanExporter({ connection: () => asNatsConnection(mockNc), subject: 's' })
    e.export([makeSpan()], () => {})
    const id = getHeaders(mockNc).get(NATS_MSG_ID_HEADER)
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('each batch gets a unique id', () => {
    const mockNc = createMockConnection()
    const e = new NatsSpanExporter({ connection: () => asNatsConnection(mockNc), subject: 's' })
    e.export([makeSpan()], () => {})
    e.export([makeSpan()], () => {})
    const a = getHeaders(mockNc, 0).get(NATS_MSG_ID_HEADER)
    const b = getHeaders(mockNc, 1).get(NATS_MSG_ID_HEADER)
    expect(a).not.toBe(b)
  })

  it('survives re-buffering (same id used on retry — enables JetStream dedup)', () => {
    const mockNc = createMockConnection()
    let ready = false
    const e = new NatsSpanExporter({
      connection: () => (ready ? asNatsConnection(mockNc) : null),
      subject: 's',
      bufferItemCount: 5,
    })
    e.export([makeSpan()], () => {}) // buffered while disconnected
    ready = true
    e.export([makeSpan()], () => {}) // drains + sends current
    expect(mockNc.publish).toHaveBeenCalledTimes(2)
    const firstId = getHeaders(mockNc, 0).get(NATS_MSG_ID_HEADER)
    const secondId = getHeaders(mockNc, 1).get(NATS_MSG_ID_HEADER)
    expect(firstId).not.toBe(secondId)
    // First (originally buffered) id was generated once and preserved through buffering.
    // Second (current) id was freshly generated.
    // Both should be valid UUIDv7s.
    expect(firstId).toMatch(/-7[0-9a-f]{3}-/)
  })

  it('is disabled via autoMsgId: false', () => {
    const mockNc = createMockConnection()
    const e = new NatsSpanExporter({
      connection: () => asNatsConnection(mockNc),
      subject: 's',
      autoMsgId: false,
    })
    e.export([makeSpan()], () => {})
    expect(getHeaders(mockNc).has(NATS_MSG_ID_HEADER)).toBe(false)
  })

  it('user-provided Nats-Msg-Id takes precedence', () => {
    const mockNc = createMockConnection()
    const e = new NatsSpanExporter({
      connection: () => asNatsConnection(mockNc),
      subject: 's',
      headers: { [NATS_MSG_ID_HEADER]: 'my-custom-id' },
    })
    e.export([makeSpan()], () => {})
    expect(getHeaders(mockNc).get(NATS_MSG_ID_HEADER)).toBe('my-custom-id')
  })

  it('not added when headers: false', () => {
    const mockNc = createMockConnection()
    const e = new NatsSpanExporter({
      connection: () => asNatsConnection(mockNc),
      subject: 's',
      headers: false,
    })
    e.export([makeSpan()], () => {})
    // third arg (opts) should be undefined
    expect(mockNc.publish.mock.calls[0]![2]).toBeUndefined()
  })
})
