import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { NatsConnection } from '@nats-io/transport-node'
import { BasicTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { NatsSpanExporter } from '../../src/NatsSpanExporter.js'
import { connectTestNats, uniqueSubject } from './natsClient.js'

describe('NatsSpanExporter — real NATS broker', () => {
  let nc: NatsConnection

  beforeAll(async () => {
    nc = await connectTestNats()
  })

  afterAll(async () => {
    await nc?.drain()
  })

  it('subscriber receives published span batch', async () => {
    const subject = uniqueSubject('itest.traces')
    const sub = nc.subscribe(subject)
    const received: Uint8Array[] = []
    ;(async () => {
      for await (const msg of sub) received.push(msg.data)
    })()

    const exporter = new NatsSpanExporter({ connection: () => nc, subject })
    const provider = new BasicTracerProvider({
      spanProcessors: [new BatchSpanProcessor(exporter)],
    })
    const tracer = provider.getTracer('itest')
    const span = tracer.startSpan('real-span')
    span.setAttribute('k', 'v')
    span.end()
    await provider.forceFlush()
    await nc.flush()

    // Allow subscriber iterator to advance
    await waitUntil(() => received.length >= 1)

    expect(received.length).toBeGreaterThanOrEqual(1)
    expect(received[0]!.length).toBeGreaterThan(0)

    await sub.unsubscribe()
    await provider.shutdown()
  })

  it('survives the pre-connect → connected transition', async () => {
    const subject = uniqueSubject('itest.traces')
    const sub = nc.subscribe(subject)
    const received: Uint8Array[] = []
    ;(async () => {
      for await (const msg of sub) received.push(msg.data)
    })()

    let ready = false
    const exporter = new NatsSpanExporter({
      connection: () => (ready ? nc : null),
      subject,
    })

    const provider = new BasicTracerProvider({
      spanProcessors: [new BatchSpanProcessor(exporter)],
    })
    const tracer = provider.getTracer('itest')
    const s1 = tracer.startSpan('pre')
    s1.end()
    // forceFlush rejects when exporter reports FAILED; that's expected here.
    await provider.forceFlush().catch(() => {})
    expect(received.length).toBe(0)

    ready = true
    const s2 = tracer.startSpan('post')
    s2.end()
    await provider.forceFlush()
    await nc.flush()
    await waitUntil(() => received.length >= 1)
    expect(received.length).toBeGreaterThanOrEqual(1)

    await sub.unsubscribe()
    await provider.shutdown()
  })

  it('ring buffer flushes queued batches after reconnect', async () => {
    const subject = uniqueSubject('itest.traces')
    const sub = nc.subscribe(subject)
    const received: Uint8Array[] = []
    ;(async () => {
      for await (const msg of sub) received.push(msg.data)
    })()

    let ready = false
    const exporter = new NatsSpanExporter({
      connection: () => (ready ? nc : null),
      subject,
      bufferItemCount: 8,
    })
    const provider = new BasicTracerProvider({
      spanProcessors: [new BatchSpanProcessor(exporter)],
    })
    const tracer = provider.getTracer('itest')

    // 3 flushes while disconnected -> buffered
    for (let i = 0; i < 3; i++) {
      const s = tracer.startSpan(`pre-${i}`)
      s.end()
      await provider.forceFlush().catch(() => {})
    }
    expect(received.length).toBe(0)
    expect(exporter.bufferedCount).toBe(3)

    ready = true
    const s = tracer.startSpan('post')
    s.end()
    await provider.forceFlush()
    await nc.flush()
    await waitUntil(() => received.length >= 4)

    expect(received.length).toBeGreaterThanOrEqual(4) // 3 buffered + 1 current
    expect(exporter.bufferedCount).toBe(0)

    await sub.unsubscribe()
    await provider.shutdown()
  })
})

async function waitUntil(pred: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (pred()) return
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error('waitUntil timed out')
}
