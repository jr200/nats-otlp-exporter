import { describe, it, expect } from 'vitest'
import { RingBuffer } from '../src/ringBuffer.js'
import type { PreparedBatch } from '../src/common.js'

const b = (...bytes: number[]): PreparedBatch => ({
  subject: 's',
  data: new Uint8Array(bytes),
})

describe('RingBuffer', () => {
  it('push/drain FIFO order', () => {
    const r = new RingBuffer({ maxItems: 5, maxBytes: 0 })
    r.push(b(1))
    r.push(b(2, 2))
    r.push(b(3))
    expect(r.size).toBe(3)
    expect(r.byteSize).toBe(4)
    const out = r.drain()
    expect(out.map((x) => x.data.length)).toEqual([1, 2, 1])
    expect(r.size).toBe(0)
    expect(r.byteSize).toBe(0)
  })

  it('drops oldest when maxItems reached', () => {
    const r = new RingBuffer({ maxItems: 3, maxBytes: 0 })
    for (let i = 1; i <= 5; i++) r.push(b(i))
    expect(r.size).toBe(3)
    expect(r.drain().map((x) => x.data[0])).toEqual([3, 4, 5])
  })

  it('drops oldest when maxBytes exceeded', () => {
    const r = new RingBuffer({ maxItems: 0, maxBytes: 6 })
    r.push(b(1, 1, 1)) // 3 bytes
    r.push(b(2, 2)) // 5 total
    r.push(b(3, 3, 3)) // 8 -> evict first -> 5
    expect(r.byteSize).toBe(5)
    expect(r.drain().map((x) => x.data[0])).toEqual([2, 3])
  })

  it('enforces both limits simultaneously', () => {
    const r = new RingBuffer({ maxItems: 10, maxBytes: 4 })
    r.push(b(1, 1))
    r.push(b(2, 2))
    r.push(b(3, 3))
    expect(r.byteSize).toBe(4)
    expect(r.size).toBe(2)
    expect(r.drain().map((x) => x.data[0])).toEqual([2, 3])
  })

  it('rejects single item larger than maxBytes', () => {
    const r = new RingBuffer({ maxItems: 0, maxBytes: 4 })
    r.push(b(1, 1, 1, 1, 1)) // 5 bytes > 4 -> rejected
    expect(r.size).toBe(0)
  })

  it('both limits 0 disables buffering', () => {
    const r = new RingBuffer({ maxItems: 0, maxBytes: 0 })
    r.push(b(1))
    r.push(b(2))
    expect(r.size).toBe(0)
    expect(r.drain()).toEqual([])
  })

  it('unshiftAll preserves order and evicts oldest when oversize', () => {
    const r = new RingBuffer({ maxItems: 3, maxBytes: 0 })
    r.push(b(4))
    r.push(b(5))
    r.unshiftAll([b(1), b(2), b(3)])
    // merged [1,2,3,4,5] -> trimmed to last 3
    expect(r.drain().map((x) => x.data[0])).toEqual([3, 4, 5])
  })

  it('unshiftAll no-op at disabled', () => {
    const r = new RingBuffer({ maxItems: 0, maxBytes: 0 })
    r.unshiftAll([b(1), b(2)])
    expect(r.size).toBe(0)
  })

  it('amortised O(1) popHead keeps memory bounded', () => {
    const r = new RingBuffer({ maxItems: 5, maxBytes: 0 })
    // push > eviction, enough to force compaction
    for (let i = 0; i < 200; i++) r.push(b(i & 0xff))
    expect(r.size).toBe(5)
    // After many pushes-then-evictions, the underlying array should be compacted.
    const lastFive = r.drain().map((x) => x.data[0])
    expect(lastFive.length).toBe(5)
  })
})
