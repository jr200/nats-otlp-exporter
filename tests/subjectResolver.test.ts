import { describe, it, expect } from 'vitest'
import { SpanKind, SpanStatusCode } from '@opentelemetry/api'
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'
import { NatsSpanExporter } from '../src/NatsSpanExporter.js'
import { createMockConnection, asNatsConnection } from './helpers.js'

function fakeSpan(serviceName: string): ReadableSpan {
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
    resource: { attributes: { 'service.name': serviceName } },
    instrumentationScope: { name: 't' },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  } as unknown as ReadableSpan
}

describe('subject templating', () => {
  it('static string is used verbatim', () => {
    const mockNc = createMockConnection()
    const e = new NatsSpanExporter({
      connection: () => asNatsConnection(mockNc),
      subject: 'otlp.traces',
    })
    e.export([fakeSpan('svc-a')], () => {})
    expect(mockNc.publish.mock.calls[0]![0]).toBe('otlp.traces')
  })

  it('function receives resource attributes', () => {
    const mockNc = createMockConnection()
    const e = new NatsSpanExporter({
      connection: () => asNatsConnection(mockNc),
      subject: (attrs) => `otlp.traces.${attrs['service.name'] ?? 'unknown'}`,
    })
    e.export([fakeSpan('svc-a')], () => {})
    e.export([fakeSpan('svc-b')], () => {})
    expect(mockNc.publish.mock.calls[0]![0]).toBe('otlp.traces.svc-a')
    expect(mockNc.publish.mock.calls[1]![0]).toBe('otlp.traces.svc-b')
  })
})
