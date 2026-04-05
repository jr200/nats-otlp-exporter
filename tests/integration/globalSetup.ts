import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'

let container: StartedTestContainer | undefined

export async function setup(): Promise<void> {
  container = await new GenericContainer('nats:2.10-alpine')
    .withExposedPorts(4222)
    .withWaitStrategy(Wait.forLogMessage(/Server is ready/))
    .start()
  const host = container.getHost()
  const port = container.getMappedPort(4222)
  process.env.NATS_URL = `nats://${host}:${port}`
}

export async function teardown(): Promise<void> {
  await container?.stop()
}
