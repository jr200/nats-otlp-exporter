import type { PreparedBatch } from './common.js'

export type DropReason = 'itemLimit' | 'byteLimit' | 'tooLarge' | 'permanentError'

export interface RingBufferLimits {
  /** Max number of batches retained. 0 = no item limit. */
  maxItems: number
  /** Max total bytes retained. 0 = no byte limit. */
  maxBytes: number
  onDrop?: (reason: DropReason, droppedBytes: number) => void
}

/**
 * FIFO ring buffer of {@link PreparedBatch} with drop-oldest eviction.
 *
 * Uses an amortised-O(1) head-pointer deque: `push`/`popHead` are O(1),
 * `drain` is O(n) once, `unshiftAll` is O(n+k).
 *
 * Batches larger than `maxBytes` are rejected at push-time rather than
 * displacing every other entry.
 */
export class RingBuffer {
  private items: PreparedBatch[] = []
  private head = 0
  private bytesTotal = 0
  private readonly maxItems: number
  private readonly maxBytes: number
  private readonly onDrop?: (reason: DropReason, droppedBytes: number) => void

  constructor(limits: RingBufferLimits) {
    this.maxItems = Math.max(0, limits.maxItems)
    this.maxBytes = Math.max(0, limits.maxBytes)
    this.onDrop = limits.onDrop
  }

  private get disabled(): boolean {
    return this.maxItems === 0 && this.maxBytes === 0
  }

  push(item: PreparedBatch): void {
    if (this.disabled) return
    if (this.maxBytes > 0 && item.data.length > this.maxBytes) {
      this.onDrop?.('tooLarge', item.data.length)
      return
    }
    this.items.push(item)
    this.bytesTotal += item.data.length
    this.evict()
  }

  drain(): PreparedBatch[] {
    if (this.size === 0) return []
    const out = this.head === 0 ? this.items : this.items.slice(this.head)
    this.items = []
    this.head = 0
    this.bytesTotal = 0
    return out
  }

  unshiftAll(items: PreparedBatch[]): void {
    if (this.disabled || items.length === 0) return
    const remaining = this.head === 0 ? this.items : this.items.slice(this.head)
    this.items = items.concat(remaining)
    this.head = 0
    this.bytesTotal = this.items.reduce((n, it) => n + it.data.length, 0)
    this.evict()
  }

  get size(): number {
    return this.items.length - this.head
  }

  get byteSize(): number {
    return this.bytesTotal
  }

  private popHead(): PreparedBatch | undefined {
    if (this.head >= this.items.length) return undefined
    const x = this.items[this.head]!
    this.items[this.head] = undefined as unknown as PreparedBatch
    this.head++
    this.bytesTotal -= x.data.length
    // amortised compaction: when the "dead" prefix is more than half the
    // underlying array, splice it out to keep memory bounded.
    if (this.head > 32 && this.head * 2 > this.items.length) {
      this.items = this.items.slice(this.head)
      this.head = 0
    }
    return x
  }

  private evict(): void {
    while (this.maxItems > 0 && this.size > this.maxItems) {
      const d = this.popHead()
      if (!d) break
      this.onDrop?.('itemLimit', d.data.length)
    }
    while (this.maxBytes > 0 && this.bytesTotal > this.maxBytes) {
      const d = this.popHead()
      if (!d) break
      this.onDrop?.('byteLimit', d.data.length)
    }
  }
}
