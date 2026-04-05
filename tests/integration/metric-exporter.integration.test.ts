import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { NatsConnection } from '@nats-io/transport-node'
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { NatsMetricExporter } from '../../src/NatsMetricExporter.js'
import { connectTestNats, uniqueSubject } from './natsClient.js'

describe('NatsMetricExporter — real NATS broker', () => {
  let nc: NatsConnection
  beforeAll(async () => {
    nc = await connectTestNats()
  })
  afterAll(async () => {
    await nc?.drain()
  })

  it('subscriber receives published metric batch', async () => {
    const subject = uniqueSubject('itest.metrics')
    const sub = nc.subscribe(subject)
    const received: Uint8Array[] = []
    ;(async () => {
      for await (const msg of sub) received.push(msg.data)
    })()

    const exporter = new NatsMetricExporter({ connection: () => nc, subject })
    const reader = new PeriodicExportingMetricReader({
      exporter,
      exportIntervalMillis: 60_000,
    })
    const provider = new MeterProvider({ readers: [reader] })
    const meter = provider.getMeter('itest')
    const counter = meter.createCounter('requests')
    counter.add(5, { route: '/a' })

    await reader.forceFlush()
    await nc.flush()
    await waitUntil(() => received.length >= 1)

    expect(received.length).toBeGreaterThanOrEqual(1)
    expect(received[0]!.length).toBeGreaterThan(0)

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
