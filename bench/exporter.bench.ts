import { bench, describe } from 'vitest'
import { SpanKind, SpanStatusCode } from '@opentelemetry/api'
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'
import { NatsSpanExporter } from '../src/NatsSpanExporter.js'
import { createMockConnection, asNatsConnection } from '../tests/helpers.js'

// Longer time = lower RME = more stable CI comparisons.
const T = { time: 1500 }

// Shared resource so single-resource fast path is exercised.
const resource = { attributes: { 'service.name': 'bench' } }
function fakeSpan(name: string): ReadableSpan {
  return {
    name,
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
    attributes: { k1: 'v1', k2: 42 },
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

const span = fakeSpan('op')
const span10 = Array.from({ length: 10 }, (_, i) => fakeSpan(`op-${i}`))
const span100 = Array.from({ length: 100 }, (_, i) => fakeSpan(`op-${i}`))

describe('NatsSpanExporter.export (sync publish, mock)', () => {
  const mockNc = createMockConnection()
  const nc = asNatsConnection(mockNc)
  const exporterStatic = new NatsSpanExporter({
    connection: () => nc,
    subject: 'otlp.traces',
    autoMsgId: false,
  })

  bench(
    '1 span, static subject',
    () => {
      exporterStatic.export([span], () => {})
    },
    T,
  )

  bench(
    '10 spans, static subject',
    () => {
      exporterStatic.export(span10, () => {})
    },
    T,
  )

  bench(
    '100 spans, static subject',
    () => {
      exporterStatic.export(span100, () => {})
    },
    T,
  )
})

describe('NatsSpanExporter.export — Msg-Id + headers overhead', () => {
  const mockNc = createMockConnection()
  const nc = asNatsConnection(mockNc)
  const withMsgId = new NatsSpanExporter({ connection: () => nc, subject: 'x' })
  const noMsgId = new NatsSpanExporter({ connection: () => nc, subject: 'x', autoMsgId: false })
  const noHeaders = new NatsSpanExporter({ connection: () => nc, subject: 'x', headers: false })

  bench(
    'with auto Msg-Id (default)',
    () => {
      withMsgId.export([span], () => {})
    },
    T,
  )

  bench(
    'no Msg-Id',
    () => {
      noMsgId.export([span], () => {})
    },
    T,
  )

  bench(
    'no headers at all',
    () => {
      noHeaders.export([span], () => {})
    },
    T,
  )
})

describe('NatsSpanExporter.export — dynamic subject', () => {
  const mockNc = createMockConnection()
  const nc = asNatsConnection(mockNc)
  const exporter = new NatsSpanExporter({
    connection: () => nc,
    subject: (attrs) => `otlp.traces.${attrs['service.name'] ?? 'unknown'}`,
  })

  bench(
    '1 span, dynamic subject',
    () => {
      exporter.export([span], () => {})
    },
    T,
  )

  bench(
    '100 spans, dynamic subject (single resource)',
    () => {
      exporter.export(span100, () => {})
    },
    T,
  )
})

describe('NatsSpanExporter.export — buffered (connection null)', () => {
  const exporter = new NatsSpanExporter({
    connection: () => null,
    subject: 'x',
    bufferItemCount: 10_000,
  })

  bench(
    'push to ring buffer (disconnected)',
    () => {
      exporter.export([span], () => {})
    },
    T,
  )
})
