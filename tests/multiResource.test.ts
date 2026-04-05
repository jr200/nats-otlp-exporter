import { describe, it, expect } from 'vitest'
import { SpanKind, SpanStatusCode } from '@opentelemetry/api'
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'
import { NatsSpanExporter } from '../src/NatsSpanExporter.js'
import { createMockConnection, asNatsConnection } from './helpers.js'

function fakeSpan(resource: { attributes: Record<string, unknown> }): ReadableSpan {
  return {
    name: 'op',
    kind: SpanKind.INTERNAL,
    spanContext: () => ({
      traceId: '00112233445566778899aabbccddeeff',
      spanId: '0123456789abcdef',
      traceFlags: 1,
    }),
    startTime: [0, 0],
    endTime: [0, 1],
    duration: [0, 1],
    status: { code: SpanStatusCode.OK },
    attributes: {},
    links: [],
    events: [],
    ended: true,
    resource,
    instrumentationScope: { name: 't' },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  } as unknown as ReadableSpan
}

describe('multi-resource grouping', () => {
  it('single-resource batch produces one publish (fast path)', () => {
    const mockNc = createMockConnection()
    const r = { attributes: { 'service.name': 'svc-a' } }
    const e = new NatsSpanExporter({
      connection: () => asNatsConnection(mockNc),
      subject: 'otlp.traces',
    })
    e.export([fakeSpan(r), fakeSpan(r), fakeSpan(r)], () => {})
    expect(mockNc.publish).toHaveBeenCalledTimes(1)
  })

  it('multi-resource batch with function subject splits per resource', () => {
    const mockNc = createMockConnection()
    const rA = { attributes: { 'service.name': 'svc-a' } }
    const rB = { attributes: { 'service.name': 'svc-b' } }
    const e = new NatsSpanExporter({
      connection: () => asNatsConnection(mockNc),
      subject: (attrs) => `otlp.traces.${attrs['service.name']}`,
    })
    e.export([fakeSpan(rA), fakeSpan(rB), fakeSpan(rA)], () => {})
    expect(mockNc.publish).toHaveBeenCalledTimes(2)
    const subjects = mockNc.publish.mock.calls.map((c) => c[0]).sort()
    expect(subjects).toEqual(['otlp.traces.svc-a', 'otlp.traces.svc-b'])
  })

  it('multi-resource batch with static subject splits into N messages to same subject', () => {
    const mockNc = createMockConnection()
    const rA = { attributes: { 'service.name': 'svc-a' } }
    const rB = { attributes: { 'service.name': 'svc-b' } }
    const e = new NatsSpanExporter({
      connection: () => asNatsConnection(mockNc),
      subject: 'otlp.traces',
    })
    e.export([fakeSpan(rA), fakeSpan(rB)], () => {})
    expect(mockNc.publish).toHaveBeenCalledTimes(2)
    const subjects = mockNc.publish.mock.calls.map((c) => c[0])
    expect(subjects).toEqual(['otlp.traces', 'otlp.traces'])
  })
})
