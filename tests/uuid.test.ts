import { describe, it, expect } from 'vitest'
import { uuidv7 } from '../src/uuid.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('uuidv7', () => {
  it('matches the RFC 9562 UUIDv7 format', () => {
    for (let i = 0; i < 50; i++) {
      expect(uuidv7()).toMatch(UUID_RE)
    }
  })

  it('is time-ordered: later calls produce lexicographically >= earlier', () => {
    const a = uuidv7()
    // Force the timestamp ms to tick over
    const start = Date.now()
    while (Date.now() === start) {
      /* spin */
    }
    const b = uuidv7()
    expect(a < b).toBe(true)
  })

  it('first 48 bits decode to a plausible unix ms timestamp', () => {
    const id = uuidv7()
    const hex = id.replace(/-/g, '').slice(0, 12) // 48 bits
    const ms = parseInt(hex, 16)
    const now = Date.now()
    expect(ms).toBeGreaterThan(now - 1000)
    expect(ms).toBeLessThanOrEqual(now)
  })

  it('produces distinct values within the same ms', () => {
    const set = new Set<string>()
    for (let i = 0; i < 1000; i++) set.add(uuidv7())
    expect(set.size).toBe(1000)
  })
})
