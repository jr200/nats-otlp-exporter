import type { PushMetricExporter, ResourceMetrics } from '@opentelemetry/sdk-metrics'
import { AggregationTemporality } from '@opentelemetry/sdk-metrics'
import type { ExportResult } from '@opentelemetry/core'
import { ProtobufMetricsSerializer } from '@opentelemetry/otlp-transformer'
import { NatsOtlpExporterBase, type SerializedGroup } from './base.js'
import type { BaseExporterOptions } from './common.js'

export interface NatsMetricExporterOptions extends BaseExporterOptions {
  temporality?: AggregationTemporality
}

export class NatsMetricExporter
  extends NatsOtlpExporterBase<ResourceMetrics>
  implements PushMetricExporter
{
  private readonly temporality: AggregationTemporality

  constructor(opts: NatsMetricExporterOptions) {
    super(opts)
    this.temporality = opts.temporality ?? AggregationTemporality.CUMULATIVE
  }

  protected prepareGroups(metrics: ResourceMetrics): SerializedGroup[] {
    const bytes = ProtobufMetricsSerializer.serializeRequest(metrics)
    if (!bytes || bytes.length === 0) return []
    return [{ attrs: metrics.resource?.attributes ?? {}, bytes }]
  }

  export(metrics: ResourceMetrics, resultCallback: (result: ExportResult) => void): void {
    this.exportInput(metrics, resultCallback)
  }

  selectAggregationTemporality(): AggregationTemporality {
    return this.temporality
  }

  forceFlush(): Promise<void> {
    return this.forceFlushBase()
  }

  shutdown(): Promise<void> {
    return this.shutdownBase()
  }
}
