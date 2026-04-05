import { describe, it, expect, vi } from 'vitest'
import { BasicTracerProvider, InMemorySpanExporter } from '@opentelemetry/sdk-trace-base'
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'
import type { NatsConnection } from '@nats-io/nats-core'
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

// Manually-controlled async iterable for status events
function makeStatusStream(): {
  iterable: AsyncIterable<unknown>
  emit: (ev: unknown) => void
  end: () => void
} {
  const queue: unknown[] = []
  const waiters: Array<(result: IteratorResult<unknown>) => void> = []
  let done = false

  return {
    emit(ev) {
      if (done) return
      const w = waiters.shift()
      if (w) w({ value: ev, done: false })
      else queue.push(ev)
    },
    end() {
      done = true
      while (waiters.length > 0) waiters.shift()!({ value: undefined, done: true })
    },
    iterable: {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<unknown>> {
            if (queue.length > 0) return Promise.resolve({ value: queue.shift()!, done: false })
            if (done) return Promise.resolve({ value: undefined, done: true })
            return new Promise((resolve) => waiters.push(resolve))
          },
        }
      },
    },
  }
}

describe('watchReconnect', () => {
  it('drains buffer on reconnect event', async () => {
    const mockNc = createMockConnection()
    const statusStream = makeStatusStream()
    const ncWithStatus = {
      ...mockNc,
      status: () => statusStream.iterable,
    }

    let ready = false
    const e = new NatsSpanExporter({
      connection: () => (ready ? (ncWithStatus as unknown as NatsConnection) : null),
      subject: 's',
      bufferItemCount: 10,
      watchReconnect: true,
    })

    // Buffer some spans while disconnected
    e.export([makeSpan()], () => {})
    e.export([makeSpan()], () => {})
    expect(e.bufferedCount).toBe(2)
    expect(mockNc.publish).not.toHaveBeenCalled()

    // First export with nc present kicks off the status watcher + drains normally
    ready = true
    e.export([makeSpan()], () => {})
    expect(mockNc.publish).toHaveBeenCalledTimes(3) // 2 buffered + 1 current
    expect(e.bufferedCount).toBe(0)

    // Now simulate: disconnect -> buffer more -> emit reconnect event
    ready = false
    e.export([makeSpan()], () => {})
    e.export([makeSpan()], () => {})
    expect(e.bufferedCount).toBe(2)

    ready = true
    statusStream.emit({ type: 'reconnect', server: 'nats://x' })
    await vi.waitFor(() => expect(e.bufferedCount).toBe(0), { timeout: 500 })
    expect(mockNc.publish).toHaveBeenCalledTimes(5)

    statusStream.end()
    await e.shutdown()
  })

  it('ignored non-reconnect status events', async () => {
    const mockNc = createMockConnection()
    const statusStream = makeStatusStream()
    const ncWithStatus = {
      ...mockNc,
      status: () => statusStream.iterable,
    }

    const e = new NatsSpanExporter({
      connection: () => ncWithStatus as unknown as NatsConnection,
      subject: 's',
      bufferItemCount: 10,
      watchReconnect: true,
    })
    // Prime the watcher
    e.export([makeSpan()], () => {})
    mockNc.publish.mockClear()

    // Emit events that should NOT trigger drain
    statusStream.emit({ type: 'disconnect', server: 'x' })
    statusStream.emit({ type: 'reconnecting' })
    statusStream.emit({ type: 'update', added: ['a'] })

    await new Promise((r) => setTimeout(r, 20))
    expect(mockNc.publish).not.toHaveBeenCalled()

    statusStream.end()
    await e.shutdown()
  })
})
