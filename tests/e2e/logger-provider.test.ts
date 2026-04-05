import { describe, it, expect } from 'vitest'
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs'
import { NatsLogRecordExporter } from '../../src/NatsLogRecordExporter.js'
import { createMockConnection, asNatsConnection } from '../helpers.js'

describe('NatsLogRecordExporter e2e with LoggerProvider', () => {
  it('publishes a batch when the processor flushes', async () => {
    const mockNc = createMockConnection()
    const exporter = new NatsLogRecordExporter({
      connection: () => asNatsConnection(mockNc),
      subject: 'e2e.logs',
    })
    const provider = new LoggerProvider({
      processors: [new BatchLogRecordProcessor(exporter)],
    })
    const logger = provider.getLogger('e2e')

    logger.emit({ severityNumber: 9, severityText: 'INFO', body: 'hi', attributes: { k: 'v' } })
    logger.emit({ severityNumber: 17, severityText: 'ERROR', body: 'boom' })

    await provider.forceFlush()

    expect(mockNc.publish).toHaveBeenCalledTimes(1)
    const [subject, payload] = mockNc.publish.mock.calls[0]!
    expect(subject).toBe('e2e.logs')
    expect(payload).toBeInstanceOf(Uint8Array)
    expect((payload as Uint8Array).length).toBeGreaterThan(0)

    await provider.shutdown()
  })
})
