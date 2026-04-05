import { bench, describe } from 'vitest'
import { uuidv7 } from '../src/uuid.js'

const T = { time: 1500 }

describe('uuidv7', () => {
  bench(
    'generate',
    () => {
      uuidv7()
    },
    T,
  )

  bench(
    'generate + Set.has (dedup scenario)',
    () => {
      const set = new Set<string>()
      for (let i = 0; i < 100; i++) set.add(uuidv7())
    },
    T,
  )
})
