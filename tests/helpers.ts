import { vi } from 'vitest'
import type { NatsConnection } from '@nats-io/nats-core'

export interface MockNatsConnection {
  publish: ReturnType<typeof vi.fn>
}

export function createMockConnection(): MockNatsConnection {
  return {
    publish: vi.fn(),
  }
}

export function asNatsConnection(mock: MockNatsConnection): NatsConnection {
  return mock as unknown as NatsConnection
}
