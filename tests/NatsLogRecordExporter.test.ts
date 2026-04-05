import { describe, it, expect, vi } from 'vitest'
import { ExportResultCode } from '@opentelemetry/core'
import {
  LoggerProvider,
  InMemoryLogRecordExporter,
  SimpleLogRecordProcessor,
} from '@opentelemetry/sdk-logs'
import type { ReadableLogRecord } from '@opentelemetry/sdk-logs'
import { NatsLogRecordExporter } from '../src/NatsLogRecordExporter.js'
import { createMockConnection, asNatsConnection } from './helpers.js'

function makeLogRecord(): ReadableLogRecord {
  const memExporter = new InMemoryLogRecordExporter()
  const provider = new LoggerProvider({
    processors: [new SimpleLogRecordProcessor(memExporter)],
  })
  const logger = provider.getLogger('test')
  logger.emit({
    severityNumber: 9,
    severityText: 'INFO',
    body: 'hello world',
    attributes: { 'test.key': 'test-value' },
  })
  const records = memExporter.getFinishedLogRecords()
  return records[0]!
}

describe('NatsLogRecordExporter', () => {
  it('publishes serialized protobuf bytes to the configured subject', () => {
    const mockNc = createMockConnection()
    const exporter = new NatsLogRecordExporter({
      connection: () => asNatsConnection(mockNc),
      subject: 'test.otlp.logs',
    })

    const callback = vi.fn()
    exporter.export([makeLogRecord()], callback)

    expect(mockNc.publish).toHaveBeenCalledTimes(1)
    const [subject, payload] = mockNc.publish.mock.calls[0]!
    expect(subject).toBe('test.otlp.logs')
    expect(payload).toBeInstanceOf(Uint8Array)
    expect((payload as Uint8Array).length).toBeGreaterThan(0)
    expect(callback).toHaveBeenCalledWith({ code: ExportResultCode.SUCCESS })
  })

  it('returns FAILED when connection getter returns null', () => {
    const exporter = new NatsLogRecordExporter({
      connection: () => null,
      subject: 'test.otlp.logs',
    })
    const callback = vi.fn()
    exporter.export([makeLogRecord()], callback)
    expect(callback).toHaveBeenCalledWith({ code: ExportResultCode.FAILED })
  })

  it('returns FAILED with error when publish throws', () => {
    const mockNc = createMockConnection()
    mockNc.publish.mockImplementation(() => {
      throw new Error('boom')
    })
    const exporter = new NatsLogRecordExporter({
      connection: () => asNatsConnection(mockNc),
      subject: 'test.otlp.logs',
    })
    const callback = vi.fn()
    exporter.export([makeLogRecord()], callback)

    const result = callback.mock.calls[0]![0]
    expect(result.code).toBe(ExportResultCode.FAILED)
    expect((result.error as Error).message).toBe('boom')
  })
})
