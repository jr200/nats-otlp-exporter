import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { SpanKind, SpanStatusCode, ValueType } from '@opentelemetry/api'
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'
import type { ReadableLogRecord } from '@opentelemetry/sdk-logs'
import type { ResourceMetrics } from '@opentelemetry/sdk-metrics'
import { AggregationTemporality, DataPointType, InstrumentType } from '@opentelemetry/sdk-metrics'
import { NatsSpanExporter } from '../../src/NatsSpanExporter.js'
import { NatsMetricExporter } from '../../src/NatsMetricExporter.js'
import { NatsLogRecordExporter } from '../../src/NatsLogRecordExporter.js'
import { createMockConnection, asNatsConnection } from '../helpers.js'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const UPDATE = process.env.UPDATE_GOLDEN === '1'

function assertGolden(name: string, bytes: Uint8Array) {
  const path = join(FIXTURES, name)
  if (UPDATE || !existsSync(path)) {
    writeFileSync(path, bytes)
    return
  }
  const expected = new Uint8Array(readFileSync(path))
  expect(
    Buffer.from(bytes).equals(Buffer.from(expected)),
    `Golden fixture ${name} mismatch — if intentional (e.g. dep upgrade), re-run with UPDATE_GOLDEN=1.`,
  ).toBe(true)
}

const FIXED_RESOURCE = {
  attributes: { 'service.name': 'golden-test' },
  schemaUrl: undefined,
} as const
const FIXED_SCOPE = { name: 'golden', version: '1.0.0', schemaUrl: '' }

function makeSpan(): ReadableSpan {
  return {
    name: 'golden-span',
    kind: SpanKind.INTERNAL,
    spanContext: () => ({
      traceId: '00112233445566778899aabbccddeeff',
      spanId: '0123456789abcdef',
      traceFlags: 1,
    }),
    parentSpanContext: undefined,
    startTime: [1700000000, 0],
    endTime: [1700000001, 500_000_000],
    duration: [1, 500_000_000],
    status: { code: SpanStatusCode.OK },
    attributes: { 'golden.key': 'golden.value', 'golden.int': 42 },
    links: [],
    events: [],
    ended: true,
    resource: FIXED_RESOURCE,
    instrumentationScope: FIXED_SCOPE,
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  } as unknown as ReadableSpan
}

function makeLog(): ReadableLogRecord {
  return {
    hrTime: [1700000000, 0],
    hrTimeObserved: [1700000000, 0],
    severityNumber: 9,
    severityText: 'INFO',
    body: 'golden log body',
    resource: FIXED_RESOURCE,
    instrumentationScope: FIXED_SCOPE,
    attributes: { 'golden.key': 'golden.value' },
    droppedAttributesCount: 0,
  } as unknown as ReadableLogRecord
}

function makeMetrics(): ResourceMetrics {
  return {
    resource: FIXED_RESOURCE,
    scopeMetrics: [
      {
        scope: FIXED_SCOPE,
        metrics: [
          {
            descriptor: {
              name: 'golden_counter',
              description: 'a deterministic counter',
              unit: '1',
              valueType: ValueType.INT,
              type: InstrumentType.COUNTER,
            },
            aggregationTemporality: AggregationTemporality.CUMULATIVE,
            dataPointType: DataPointType.SUM,
            isMonotonic: true,
            dataPoints: [
              {
                startTime: [1700000000, 0],
                endTime: [1700000001, 0],
                attributes: { route: '/golden' },
                value: 7,
              },
            ],
          },
        ],
      },
    ],
  } as unknown as ResourceMetrics
}

describe('protobuf golden fixtures', () => {
  it('span serialisation is byte-stable', () => {
    const mockNc = createMockConnection()
    const exporter = new NatsSpanExporter({
      connection: () => asNatsConnection(mockNc),
      subject: 'golden.traces',
    })
    exporter.export([makeSpan()], () => {})
    const payload = mockNc.publish.mock.calls[0]![1] as Uint8Array
    assertGolden('span.bin', payload)
  })

  it('metric serialisation is byte-stable', () => {
    const mockNc = createMockConnection()
    const exporter = new NatsMetricExporter({
      connection: () => asNatsConnection(mockNc),
      subject: 'golden.metrics',
    })
    exporter.export(makeMetrics(), () => {})
    const payload = mockNc.publish.mock.calls[0]![1] as Uint8Array
    assertGolden('metric.bin', payload)
  })

  it('log serialisation is byte-stable', () => {
    const mockNc = createMockConnection()
    const exporter = new NatsLogRecordExporter({
      connection: () => asNatsConnection(mockNc),
      subject: 'golden.logs',
    })
    exporter.export([makeLog()], () => {})
    const payload = mockNc.publish.mock.calls[0]![1] as Uint8Array
    assertGolden('log.bin', payload)
  })
})
