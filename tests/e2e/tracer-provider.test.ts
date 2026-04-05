import { describe, it, expect } from 'vitest'
import { BasicTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { NatsSpanExporter } from '../../src/NatsSpanExporter.js'
import { createMockConnection, asNatsConnection } from '../helpers.js'

describe('NatsSpanExporter e2e with BasicTracerProvider', () => {
  it('publishes a batch when the processor flushes', async () => {
    const mockNc = createMockConnection()
    const exporter = new NatsSpanExporter({
      connection: () => asNatsConnection(mockNc),
      subject: 'e2e.traces',
    })
    const provider = new BasicTracerProvider({
      spanProcessors: [new BatchSpanProcessor(exporter)],
    })
    const tracer = provider.getTracer('e2e')

    const span = tracer.startSpan('work')
    span.setAttribute('key', 'value')
    span.end()

    await provider.forceFlush()

    expect(mockNc.publish).toHaveBeenCalledTimes(1)
    const [subject, payload] = mockNc.publish.mock.calls[0]!
    expect(subject).toBe('e2e.traces')
    expect(payload).toBeInstanceOf(Uint8Array)
    expect((payload as Uint8Array).length).toBeGreaterThan(0)

    await provider.shutdown()
  })

  it('publishes larger payload when more spans are buffered', async () => {
    const mockNc = createMockConnection()
    const exporter = new NatsSpanExporter({
      connection: () => asNatsConnection(mockNc),
      subject: 'e2e.traces',
    })
    const provider = new BasicTracerProvider({
      spanProcessors: [new BatchSpanProcessor(exporter)],
    })
    const tracer = provider.getTracer('e2e')

    for (let i = 0; i < 10; i++) {
      const s = tracer.startSpan(`work-${i}`)
      s.setAttribute('i', i)
      s.end()
    }

    await provider.forceFlush()
    expect(mockNc.publish).toHaveBeenCalledTimes(1)
    const [, bigPayload] = mockNc.publish.mock.calls[0]!

    // Second flush with only one span -> smaller payload
    mockNc.publish.mockClear()
    const small = tracer.startSpan('solo')
    small.end()
    await provider.forceFlush()
    const [, smallPayload] = mockNc.publish.mock.calls[0]!

    expect((bigPayload as Uint8Array).length).toBeGreaterThan((smallPayload as Uint8Array).length)

    await provider.shutdown()
  })

  it('does not publish when the connection getter returns null', async () => {
    const mockNc = createMockConnection()
    let ready = false
    const exporter = new NatsSpanExporter({
      connection: () => (ready ? asNatsConnection(mockNc) : null),
      subject: 'e2e.traces',
    })
    const provider = new BasicTracerProvider({
      spanProcessors: [new BatchSpanProcessor(exporter)],
    })
    const tracer = provider.getTracer('e2e')

    const s = tracer.startSpan('pre-connect')
    s.end()
    // forceFlush rejects when the exporter returns FAILED; that's the
    // behaviour we're verifying — the batch is not published.
    await provider.forceFlush().catch(() => {})
    expect(mockNc.publish).not.toHaveBeenCalled()

    ready = true
    const s2 = tracer.startSpan('post-connect')
    s2.end()
    await provider.forceFlush()
    expect(mockNc.publish).toHaveBeenCalledTimes(1)

    await provider.shutdown()
  })
})
