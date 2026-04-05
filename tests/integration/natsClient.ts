import { connect, type NatsConnection } from '@nats-io/transport-node'

export async function connectTestNats(): Promise<NatsConnection> {
  const url = process.env.NATS_URL
  if (!url) throw new Error('NATS_URL not set — globalSetup did not run')
  return connect({ servers: url })
}

export function uniqueSubject(prefix: string): string {
  return `${prefix}.${Math.random().toString(36).slice(2, 10)}`
}
