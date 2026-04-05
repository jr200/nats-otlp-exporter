import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { NatsConnection } from '@nats-io/transport-node'
import { SpanKind, SpanStatusCode } from '@opentelemetry/api'
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'
import { NatsSpanExporter } from '../../src/NatsSpanExporter.js'
import { NATS_MSG_ID_HEADER } from '../../src/common.js'
import { connectTestNats, uniqueSubject } from './natsClient.js'

// Resource objects must share reference to be grouped together.
const resources: Record<string, { attributes: Record<string, string> }> = {}
function resourceFor(serviceName: string) {
  return (resources[serviceName] ??= { attributes: { 'service.name': serviceName } })
}

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
    resource: resourceFor(serviceName),
    instrumentationScope: { name: 't' },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  } as unknown as ReadableSpan
}

async function waitUntil(pred: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (pred()) return
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error('waitUntil timed out')
}

describe('new features — real NATS broker', () => {
  let nc: NatsConnection
  beforeAll(async () => {
    nc = await connectTestNats()
  })
  afterAll(async () => {
    await nc?.drain()
  })

  describe('autoMsgId header', () => {
    it('subscriber receives a UUIDv7 Nats-Msg-Id header by default', async () => {
      const subject = uniqueSubject('itest.msgid')
      const sub = nc.subscribe(subject)
      const ids: string[] = []
      ;(async () => {
        for await (const msg of sub) {
          const id = msg.headers?.get(NATS_MSG_ID_HEADER)
          if (id) ids.push(id)
        }
      })()

      const e = new NatsSpanExporter({ connection: () => nc, subject })
      e.export([fakeSpan('svc')], () => {})
      e.export([fakeSpan('svc')], () => {})
      await nc.flush()
      await waitUntil(() => ids.length >= 2)

      expect(ids.length).toBe(2)
      expect(ids[0]).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      )
      expect(ids[0]).not.toBe(ids[1])
      expect(ids[0]! < ids[1]!).toBe(true) // time-ordered

      await sub.unsubscribe()
      await e.shutdown()
    })

    it('Content-Type header is present by default', async () => {
      const subject = uniqueSubject('itest.ctype')
      const sub = nc.subscribe(subject)
      const contentTypes: string[] = []
      ;(async () => {
        for await (const msg of sub) {
          const ct = msg.headers?.get('Content-Type')
          if (ct) contentTypes.push(ct)
        }
      })()

      const e = new NatsSpanExporter({ connection: () => nc, subject })
      e.export([fakeSpan('svc')], () => {})
      await nc.flush()
      await waitUntil(() => contentTypes.length >= 1)

      expect(contentTypes[0]).toBe('application/x-protobuf')
      await sub.unsubscribe()
      await e.shutdown()
    })
  })

  describe('multi-resource grouping', () => {
    it('function subject routes to per-resource subjects', async () => {
      const root = uniqueSubject('itest.multi')
      const sub = nc.subscribe(`${root}.>`)
      const received: string[] = []
      ;(async () => {
        for await (const msg of sub) received.push(msg.subject)
      })()

      const e = new NatsSpanExporter({
        connection: () => nc,
        subject: (attrs) => `${root}.${attrs['service.name']}`,
      })
      e.export([fakeSpan('svc-a'), fakeSpan('svc-b'), fakeSpan('svc-a')], () => {})
      await nc.flush()
      await waitUntil(() => received.length >= 2)

      expect(received.sort()).toEqual([`${root}.svc-a`, `${root}.svc-b`])
      await sub.unsubscribe()
      await e.shutdown()
    })
  })

  describe('shouldRetry', () => {
    it('permanent errors drop batches and do not fill buffer', async () => {
      const subject = uniqueSubject('itest.retry')
      const e = new NatsSpanExporter({
        connection: () => nc,
        subject,
        bufferItemCount: 100,
        shouldRetry: () => false,
        // Force a failure via a custom publish callback.
        publish: () => {
          throw new Error('simulated permanent')
        },
      })
      for (let i = 0; i < 10; i++) e.export([fakeSpan('svc')], () => {})
      expect(e.bufferedCount).toBe(0)
      await e.shutdown()
    })
  })

  describe('async publish (JetStream-style)', () => {
    it('awaits publish promise and publishes to real NATS', async () => {
      const subject = uniqueSubject('itest.async')
      const sub = nc.subscribe(subject)
      const received: Uint8Array[] = []
      ;(async () => {
        for await (const msg of sub) received.push(msg.data)
      })()

      const e = new NatsSpanExporter({
        connection: () => nc,
        subject,
        publish: async (nc2, subj, data, headers) => {
          await new Promise((r) => setTimeout(r, 5))
          nc2.publish(subj, data, headers ? { headers } : undefined)
          return { ack: true }
        },
      })
      await new Promise<void>((resolve) => e.export([fakeSpan('svc')], () => resolve()))
      await nc.flush()
      await waitUntil(() => received.length >= 1)

      expect(received.length).toBe(1)
      expect(received[0]!.length).toBeGreaterThan(0)
      await sub.unsubscribe()
      await e.shutdown()
    })
  })

  describe('forceFlush + reconnect buffer', () => {
    it('drains buffer on forceFlush after reconnect', async () => {
      const subject = uniqueSubject('itest.flush')
      const sub = nc.subscribe(subject)
      const received: Uint8Array[] = []
      ;(async () => {
        for await (const msg of sub) received.push(msg.data)
      })()

      let ready = false
      const e = new NatsSpanExporter({
        connection: () => (ready ? nc : null),
        subject,
        bufferItemCount: 50,
      })
      for (let i = 0; i < 5; i++) e.export([fakeSpan('svc')], () => {})
      expect(e.bufferedCount).toBe(5)

      ready = true
      await e.forceFlush()
      await nc.flush()
      await waitUntil(() => received.length >= 5)

      expect(received.length).toBe(5)
      expect(e.bufferedCount).toBe(0)
      await sub.unsubscribe()
      await e.shutdown()
    })
  })
})
