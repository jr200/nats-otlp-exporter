import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['bench/**/*.bench.ts'],
    environment: 'node',
    // Single fork, serial execution — reduces JIT / worker warm-up variability.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
  },
})
