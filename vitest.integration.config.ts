import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['tests/integration/globalSetup.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
})
