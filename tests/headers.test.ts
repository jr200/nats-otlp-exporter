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

function getOpts(mockNc: ReturnType<typeof createMockConnection>): {
  headers?: { get(k: string): string; has(k: string): boolean }
} {
  return mockNc.publish.mock.calls[0]![2] as never
}

describe('headers', () => {
  it('default includes Content-Type: application/x-protobuf', () => {
    const mockNc = createMockConnection()
    const e = new NatsSpanExporter({ connection: () => asNatsConnection(mockNc), subject: 's' })
    e.export([makeSpan()], () => {})
    const opts = getOpts(mockNc)
    expect(opts.headers?.get('Content-Type')).toBe('application/x-protobuf')
  })

  it('custom static headers override default', () => {
    const mockNc = createMockConnection()
    const e = new NatsSpanExporter({
      connection: () => asNatsConnection(mockNc),
      subject: 's',
      headers: { 'X-Tenant': 'acme', foo: 'bar' },
    })
    e.export([makeSpan()], () => {})
    const opts = getOpts(mockNc)
    expect(opts.headers?.get('X-Tenant')).toBe('acme')
    expect(opts.headers?.get('foo')).toBe('bar')
    expect(opts.headers?.has('Content-Type')).toBe(false)
  })

  it('function headers get subject + resource attributes', () => {
    const mockNc = createMockConnection()
    const e = new NatsSpanExporter({
      connection: () => asNatsConnection(mockNc),
      subject: 'my.subj',
      headers: ({ subject }) => ({ 'X-Subject': subject }),
    })
    e.export([makeSpan()], () => {})
    const opts = getOpts(mockNc)
    expect(opts.headers?.get('X-Subject')).toBe('my.subj')
  })

  it('headers=false disables headers entirely', () => {
    const mockNc = createMockConnection()
    const e = new NatsSpanExporter({
      connection: () => asNatsConnection(mockNc),
      subject: 's',
      headers: false,
    })
    e.export([makeSpan()], () => {})
    // third arg should be undefined (or have no headers)
    const third = mockNc.publish.mock.calls[0]![2]
    expect(third).toBeUndefined()
  })
})
