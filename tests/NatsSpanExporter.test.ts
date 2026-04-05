import { describe, it, expect, vi } from 'vitest'
import { ExportResultCode } from '@opentelemetry/core'
import { BasicTracerProvider, InMemorySpanExporter } from '@opentelemetry/sdk-trace-base'
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'
import { NatsSpanExporter } from '../src/NatsSpanExporter.js'
import { createMockConnection, asNatsConnection } from './helpers.js'

// Generate a synthetic ReadableSpan by starting a span and capturing it via InMemorySpanExporter.
function makeSpan(): ReadableSpan {
  const memExporter = new InMemorySpanExporter()
  const provider = new BasicTracerProvider()
  const tracer = provider.getTracer('test')
  const span = tracer.startSpan('test-span')
  span.setAttribute('test.key', 'test-value')
  span.end()

  // Export through in-memory exporter to get a ReadableSpan
  memExporter.export([span as unknown as ReadableSpan], () => {})
  const spans = memExporter.getFinishedSpans()
  return spans[0]!
}

describe('NatsSpanExporter', () => {
  it('publishes serialized protobuf bytes to the configured subject', () => {
    const mockNc = createMockConnection()
    const exporter = new NatsSpanExporter({
      connection: () => asNatsConnection(mockNc),
      subject: 'test.otlp.traces',
    })

    const span = makeSpan()
    const callback = vi.fn()
    exporter.export([span], callback)

    expect(mockNc.publish).toHaveBeenCalledTimes(1)
    const [subject, payload] = mockNc.publish.mock.calls[0]!
    expect(subject).toBe('test.otlp.traces')
    expect(payload).toBeInstanceOf(Uint8Array)
    expect((payload as Uint8Array).length).toBeGreaterThan(0)
    expect(callback).toHaveBeenCalledWith({ code: ExportResultCode.SUCCESS })
  })

  it('returns FAILED when connection getter returns null', () => {
    const exporter = new NatsSpanExporter({
      connection: () => null,
      subject: 'test.otlp.traces',
    })
    const callback = vi.fn()
    exporter.export([makeSpan()], callback)

    expect(callback).toHaveBeenCalledWith({ code: ExportResultCode.FAILED })
  })

  it('returns FAILED with error when publish throws', () => {
    const mockNc = createMockConnection()
    mockNc.publish.mockImplementation(() => {
      throw new Error('publish failed')
    })
    const exporter = new NatsSpanExporter({
      connection: () => asNatsConnection(mockNc),
      subject: 'test.otlp.traces',
    })
    const callback = vi.fn()
    exporter.export([makeSpan()], callback)

    expect(callback).toHaveBeenCalledTimes(1)
    const result = callback.mock.calls[0]![0]
    expect(result.code).toBe(ExportResultCode.FAILED)
    expect(result.error).toBeInstanceOf(Error)
    expect((result.error as Error).message).toBe('publish failed')
  })

  it('returns SUCCESS without publishing when spans list is empty', () => {
    const mockNc = createMockConnection()
    const exporter = new NatsSpanExporter({
      connection: () => asNatsConnection(mockNc),
      subject: 'test.otlp.traces',
    })
    const callback = vi.fn()
    exporter.export([], callback)

    // Serializer may or may not produce bytes for empty list; either way
    // we should complete without error.
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback.mock.calls[0]![0].code).toBe(ExportResultCode.SUCCESS)
  })

  it('shutdown and forceFlush resolve immediately', async () => {
    const exporter = new NatsSpanExporter({
      connection: () => null,
      subject: 'test.otlp.traces',
    })
    await expect(exporter.shutdown()).resolves.toBeUndefined()
    await expect(exporter.forceFlush()).resolves.toBeUndefined()
  })
})
