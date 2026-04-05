import { describe, it, expect } from 'vitest'
import { validateSubject } from '../src/common.js'
import { NatsSpanExporter } from '../src/NatsSpanExporter.js'

describe('validateSubject', () => {
  it('accepts valid subjects', () => {
    for (const s of ['foo', 'foo.bar', 'otlp.traces.svc-a', 'a.b.c.d']) {
      expect(() => validateSubject(s)).not.toThrow()
    }
  })

  it('rejects empty / non-string', () => {
    expect(() => validateSubject('')).toThrow(/empty/)
    expect(() => validateSubject(null as unknown as string)).toThrow(/empty/)
  })

  it('rejects whitespace', () => {
    expect(() => validateSubject('foo bar')).toThrow(/whitespace/)
    expect(() => validateSubject('foo\tbar')).toThrow(/whitespace/)
  })

  it('rejects leading/trailing dots', () => {
    expect(() => validateSubject('.foo')).toThrow(/leading\/trailing/)
    expect(() => validateSubject('foo.')).toThrow(/leading\/trailing/)
  })

  it('rejects empty tokens', () => {
    expect(() => validateSubject('foo..bar')).toThrow(/empty token/)
  })

  it('rejects wildcards in publish subjects', () => {
    expect(() => validateSubject('foo.*')).toThrow(/wildcard/)
    expect(() => validateSubject('foo.>')).toThrow(/wildcard/)
  })

  it('NatsSpanExporter constructor validates static subjects', () => {
    expect(() => new NatsSpanExporter({ connection: () => null, subject: 'foo bar' })).toThrow(
      /whitespace/,
    )
  })
})
