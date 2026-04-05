import { bench, describe } from 'vitest'
import { RingBuffer } from '../src/ringBuffer.js'
import type { PreparedBatch } from '../src/common.js'

const T = { time: 1500 }

const makeBatch = (size: number): PreparedBatch => ({
  subject: 's',
  data: new Uint8Array(size),
})

describe('RingBuffer.push (no eviction)', () => {
  const samples = [makeBatch(100), makeBatch(200), makeBatch(150)]

  bench(
    'maxItems=1000, 1000 pushes',
    () => {
      const r = new RingBuffer({ maxItems: 1000, maxBytes: 0 })
      for (let i = 0; i < 1000; i++) r.push(samples[i % 3]!)
    },
    T,
  )

  bench(
    'maxBytes=1MB, 1000 pushes',
    () => {
      const r = new RingBuffer({ maxItems: 0, maxBytes: 1_000_000 })
      for (let i = 0; i < 1000; i++) r.push(samples[i % 3]!)
    },
    T,
  )
})

describe('RingBuffer.push (with eviction)', () => {
  const sample = makeBatch(1000)

  bench(
    'maxItems=100, 10k pushes (99% eviction)',
    () => {
      const r = new RingBuffer({ maxItems: 100, maxBytes: 0 })
      for (let i = 0; i < 10_000; i++) r.push(sample)
    },
    T,
  )

  bench(
    'maxBytes=100KB, 10k pushes (eviction by bytes)',
    () => {
      const r = new RingBuffer({ maxItems: 0, maxBytes: 100_000 })
      for (let i = 0; i < 10_000; i++) r.push(sample)
    },
    T,
  )
})

describe('RingBuffer.drain', () => {
  bench(
    '100 items drain',
    () => {
      const r = new RingBuffer({ maxItems: 100, maxBytes: 0 })
      for (let i = 0; i < 100; i++) r.push(makeBatch(100))
      r.drain()
    },
    T,
  )

  bench(
    '10k items drain',
    () => {
      const r = new RingBuffer({ maxItems: 10_000, maxBytes: 0 })
      for (let i = 0; i < 10_000; i++) r.push(makeBatch(100))
      r.drain()
    },
    T,
  )
})
