import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { NatsConnection } from '@nats-io/transport-node'
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs'
import { NatsLogRecordExporter } from '../../src/NatsLogRecordExporter.js'
import { connectTestNats, uniqueSubject } from './natsClient.js'

describe('NatsLogRecordExporter — real NATS broker', () => {
  let nc: NatsConnection
  beforeAll(async () => {
    nc = await connectTestNats()
  })
  afterAll(async () => {
    await nc?.drain()
  })

  it('subscriber receives published log batch', async () => {
    const subject = uniqueSubject('itest.logs')
    const sub = nc.subscribe(subject)
    const received: Uint8Array[] = []
    ;(async () => {
      for await (const msg of sub) received.push(msg.data)
    })()

    const exporter = new NatsLogRecordExporter({ connection: () => nc, subject })
    const provider = new LoggerProvider({
      processors: [new BatchLogRecordProcessor(exporter)],
    })
    const logger = provider.getLogger('itest')
    logger.emit({ severityNumber: 9, severityText: 'INFO', body: 'real log' })
    await provider.forceFlush()
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
