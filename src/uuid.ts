/**
 * Generate a UUIDv7 — 128-bit identifier with a 48-bit Unix-ms timestamp
 * prefix, so IDs naturally sort by creation time. Useful for:
 *   - NATS JetStream dedup (via `Nats-Msg-Id` header)
 *   - Consumer-side ordering / replay
 *   - Correlation IDs
 *
 * Format (RFC 9562 §5.7):
 *   0-47   : unix_ts_ms (big-endian)
 *   48-51  : version (0111)
 *   52-63  : rand_a (12 random bits)
 *   64-65  : variant (10)
 *   66-127 : rand_b (62 random bits)
 *
 * Uses the Web Crypto API (`globalThis.crypto.getRandomValues`) so the
 * library runs in browsers, Deno, Bun, and Node.js 18+ without any
 * Node-specific imports.
 */
export function uuidv7(): string {
  const bytes = new Uint8Array(16)
  getRandomValues(bytes)
  const ms = Date.now()
  bytes[0] = (ms / 2 ** 40) & 0xff
  bytes[1] = (ms / 2 ** 32) & 0xff
  bytes[2] = (ms >>> 24) & 0xff
  bytes[3] = (ms >>> 16) & 0xff
  bytes[4] = (ms >>> 8) & 0xff
  bytes[5] = ms & 0xff
  // version 7
  bytes[6] = (bytes[6]! & 0x0f) | 0x70
  // variant 10xx
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  return (
    hex(bytes, 0, 4) +
    '-' +
    hex(bytes, 4, 6) +
    '-' +
    hex(bytes, 6, 8) +
    '-' +
    hex(bytes, 8, 10) +
    '-' +
    hex(bytes, 10, 16)
  )
}

function getRandomValues(bytes: Uint8Array): void {
  const g = globalThis as { crypto?: { getRandomValues?: (b: Uint8Array) => Uint8Array } }
  if (!g.crypto?.getRandomValues) {
    throw new Error('Web Crypto API not available (need Node 18+, or a modern browser)')
  }
  g.crypto.getRandomValues(bytes)
}

const HEX = '0123456789abcdef'
function hex(bytes: Uint8Array, start: number, end: number): string {
  let out = ''
  for (let i = start; i < end; i++) {
    const b = bytes[i]!
    out += HEX[b >>> 4]! + HEX[b & 0x0f]!
  }
  return out
}
