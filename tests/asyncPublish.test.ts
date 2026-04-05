import { describe, it, expect, vi } from 'vitest'
import { ExportResultCode } from '@opentelemetry/core'
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

describe('async publish (JetStream-style)', () => {
  it('awaits async publish Promise and reports SUCCESS on resolve', async () => {
    const mockNc = createMockConnection()
    const publishCalls: Array<[string, Uint8Array]> = []
    const e = new NatsSpanExporter({
      connection: () => asNatsConnection(mockNc),
      subject: 's',
      publish: async (_nc, subject, data) => {
        publishCalls.push([subject, data])
        await new Promise((r) => setTimeout(r, 5))
        return { ack: true }
      },
    })
    await new Promise<void>((resolve, reject) => {
      e.export([makeSpan()], (r) => {
        if (r.code === ExportResultCode.SUCCESS) resolve()
        else reject(r.error)
      })
    })
    expect(publishCalls.length).toBe(1)
    expect(publishCalls[0]![0]).toBe('s')
    // default mock publish is not called when custom publish is provided
    expect(mockNc.publish).not.toHaveBeenCalled()
  })

  it('re-buffers on async publish rejection', async () => {
    const mockNc = createMockConnection()
    const e = new NatsSpanExporter({
      connection: () => asNatsConnection(mockNc),
      subject: 's',
      bufferItemCount: 10,
      publish: async () => {
        throw new Error('nak')
      },
    })
    const cb = vi.fn()
    await new Promise<void>((resolve) => {
      e.export([makeSpan()], (r) => {
        cb(r)
        resolve()
      })
    })
    expect(cb.mock.calls[0]![0].code).toBe(ExportResultCode.FAILED)
    expect(e.bufferedCount).toBe(1)
  })
})
