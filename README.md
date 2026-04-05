# @jr200/nats-otlp-exporter

OpenTelemetry SDK exporters that publish OTLP protobuf over a NATS connection.

## What it does

Three `SpanExporter` / `LogRecordExporter` / `PushMetricExporter` implementations that serialise OTel telemetry as OTLP protobuf bytes and publish them to a NATS subject via a caller-provided connection getter.

## Quick start

```ts
import { NatsSpanExporter } from '@jr200/nats-otlp-exporter'
import { BatchSpanProcessor, BasicTracerProvider } from '@opentelemetry/sdk-trace-base'

// Getter is called on every export, so connection changes are picked up automatically.
const getNatsConnection = () => myApp.getConnection()

const spanExporter = new NatsSpanExporter({
  connection: getNatsConnection,
  subject: 'otlp.traces',
})

const provider = new BasicTracerProvider({
  spanProcessors: [new BatchSpanProcessor(spanExporter)],
})
```

## Convenience factory

Create a matched set of exporters sharing configuration:

```ts
import { createNatsOtlpExporters } from '@jr200/nats-otlp-exporter'

const { traceExporter, metricExporter, logRecordExporter } = createNatsOtlpExporters({
  connection: () => nc,
  subjects: {
    traces: 'otlp.traces',
    metrics: 'otlp.metrics',
    logs: 'otlp.logs',
  },
  buffer: { bufferItemCount: 200, retryIntervalMs: 1000 },
  hooks: {
    onDrop: (reason, bytes) => console.warn(`telemetry dropped: ${reason} (${bytes}B)`),
    onPublishError: (err) => console.warn('publish failed:', err.message),
  },
})
```

## Options

All three exporters share the same base options:

```ts
interface BaseExporterOptions {
  connection: () => NatsConnection | null
  subject: string | ((resourceAttributes: Attributes) => string)

  // --- buffering (disabled by default) ---
  bufferItemCount?: number // max queued batches (0 = no item limit)
  bufferMaxBytes?: number // max queued bytes (0 = no byte limit)
  retryIntervalMs?: number // internal drain timer
  maxPayloadBytes?: number // drop batches larger than this
  shouldRetry?: (err) => boolean // classify errors; return false to drop
  watchReconnect?: boolean // drain immediately on nc.status() reconnect

  // --- transport ---
  publish?: PublishFn // override nc.publish (e.g. for JetStream)
  headers?:
    | Record<string, string> // default: { 'Content-Type': 'application/x-protobuf' }
    | ((ctx) => Record<string, string>)
    | false // disable headers entirely
  autoMsgId?: boolean // add Nats-Msg-Id UUIDv7 header (default: true)

  // --- observability ---
  hooks?: {
    onDrop?: (
      reason: 'itemLimit' | 'byteLimit' | 'tooLarge' | 'permanentError',
      droppedBytes: number,
    ) => void
    onFlush?: (drainedCount: number, drainedBytes: number) => void
    onPublishError?: (err: Error) => void
    onPayloadTooLarge?: (bytes: number) => void
  }
}
```

`NatsMetricExporter` additionally accepts `temporality?: AggregationTemporality` (defaults to `CUMULATIVE`).

## Reliability

### Buffering failed batches

By default, if NATS isn't connected when a batch flushes, that batch is lost (matching `BatchSpanProcessor` semantics — the SDK does not retry `FAILED` batches). To survive disconnects, enable the in-memory ring buffer:

```ts
new NatsSpanExporter({
  connection: () => nc,
  subject: 'otlp.traces',
  bufferItemCount: 100, // keep up to 100 failed batches
  bufferMaxBytes: 10_000_000, // ... but no more than 10 MB total
  retryIntervalMs: 1000, // drain on reconnect, don't wait for next SDK flush
})
```

- When buffer limits are exceeded, the **oldest** batch is dropped.
- Single batches larger than `bufferMaxBytes` are rejected outright.
- On reconnect, the buffer is drained oldest-first, then the current batch is published.
- `retryIntervalMs` sets a small background timer that attempts to drain the buffer as soon as the connection returns — without this, drain only happens on the next `BatchSpanProcessor` flush (default 5s).
- `shutdown()` does a best-effort drain with a 5s timeout.

Expose buffer state via `exporter.bufferedCount` / `exporter.bufferedBytes`.

Call `exporter.forceFlush()` (or `provider.forceFlush()`) before a deploy/restart to drain queued batches immediately. `shutdown()` does the same with a 5s timeout.

### Permanent-error handling

By default, every publish failure re-buffers the batch. If the error is permanent (bad subject, missing JetStream stream, auth failure), that causes runaway re-buffering. Use `shouldRetry` to classify:

```ts
new NatsSpanExporter({
  connection: () => nc,
  subject: 'otlp.traces',
  bufferItemCount: 100,
  shouldRetry: (err) => {
    // JetStream-specific: don't retry missing-stream or auth errors
    if (/stream not found|unauthorized/i.test(err.message)) return false
    return true
  },
  hooks: { onDrop: (reason) => reason === 'permanentError' && alert() },
})
```

When `shouldRetry` returns `false`, remaining batches are dropped (not re-buffered) and `onDrop` fires with reason `'permanentError'`.

### Event-driven reconnect drain

Combine with a long-interval safety net or use alone. When enabled, the exporter subscribes to `nc.status()` and drains the buffer immediately on `reconnect` events — no waiting for `retryIntervalMs`:

```ts
new NatsSpanExporter({
  connection: () => nc,
  subject: 'otlp.traces',
  bufferItemCount: 100,
  watchReconnect: true,
  retryIntervalMs: 10_000, // polling fallback
})
```

### Observability hooks

```ts
new NatsSpanExporter({
  connection: () => nc,
  subject: 'otlp.traces',
  bufferItemCount: 100,
  hooks: {
    onDrop: (reason, bytes) => metrics.droppedCounter.add(1, { reason }),
    onFlush: (count, bytes) => metrics.flushCounter.add(count),
    onPublishError: (err) => logger.warn({ err }, 'otlp publish failed'),
    onPayloadTooLarge: (bytes) => logger.warn({ bytes }, 'oversized batch'),
  },
})
```

### Payload size limit

NATS has a default `max_payload` of 1 MB. Oversized publishes silently fail. Set `maxPayloadBytes` to detect + drop them up front:

```ts
new NatsSpanExporter({
  connection: () => nc,
  subject: 'otlp.traces',
  maxPayloadBytes: 900_000, // leaves headroom under default 1 MB
  hooks: { onPayloadTooLarge: (b) => logger.warn(`dropped batch of ${b} bytes`) },
})
```

### Idempotent publishes (`Nats-Msg-Id`)

Every published batch gets a **UUIDv7 `Nats-Msg-Id` header** by default, which:

- enables **JetStream deduplication** (retried publishes after a disconnect won't double-write),
- gives consumers a stable id for correlation/replay,
- is **time-ordered** — the first 48 bits are a Unix-ms timestamp, so ids sort by creation time.

The id is generated once per batch at prep time and preserved through ring-buffer re-buffering, so retries use the same id. Set `autoMsgId: false` to disable, or supply your own id via `headers: { 'Nats-Msg-Id': ... }`.

## Subject templating

Route per-service / per-tenant by deriving the subject from resource attributes:

```ts
new NatsSpanExporter({
  connection: () => nc,
  subject: (attrs) => `otlp.traces.${attrs['service.name'] ?? 'unknown'}`,
})
```

When the subject is a function and a batch contains spans/logs from **multiple resources**, the batch is split per resource and published as separate messages — each to its own resource-templated subject. Single-resource batches (the common case) publish as one message. Subscribers can use NATS subject wildcards (`otlp.traces.*`, `otlp.traces.my-service`, etc.).

Static subjects are validated at construction time; dynamic (templated) subjects are validated on each batch. Invalid subjects (whitespace, wildcards, leading/trailing dots) throw early.

## JetStream (at-least-once)

Core NATS `publish()` is at-most-once. For server-side persistence, acknowledgement and replay, wire in JetStream via the `publish` option — no extra dependency on this package required:

```ts
import { jetstream } from '@nats-io/jetstream'

const js = jetstream(nc)

new NatsSpanExporter({
  connection: () => nc,
  subject: 'OTLP.traces',
  publish: (_nc, subject, data, headers) => js.publish(subject, data, { headers }),
  bufferItemCount: 100,
  hooks: { onPublishError: (e) => logger.warn(e, 'jetstream publish failed') },
})
```

If JetStream returns a rejected `Promise` (e.g. stream full, timeout), the batch is re-buffered just like a sync failure. Ensure a matching stream is configured on the broker.

With `autoMsgId: true` (default), the `Nats-Msg-Id` UUIDv7 header is forwarded to JetStream, enabling its built-in deduplication window — so retries after a disconnect don't create duplicates server-side.

## Custom headers

```ts
// static
new NatsSpanExporter({
  connection: () => nc,
  subject: 'otlp.traces',
  headers: { 'Content-Type': 'application/x-protobuf', 'X-Tenant': 'acme' },
})

// dynamic
new NatsSpanExporter({
  connection: () => nc,
  subject: (a) => `otlp.traces.${a['service.name']}`,
  headers: ({ resourceAttributes }) => ({
    'Content-Type': 'application/x-protobuf',
    'X-Service': String(resourceAttributes['service.name'] ?? 'unknown'),
  }),
})

// disabled
new NatsSpanExporter({ connection: () => nc, subject: 's', headers: false })
```

## Runtime support

Works in **Node.js 18+**, **Deno**, **Bun**, and **modern browsers** (via `nats.ws`). Uses the Web Crypto API (`crypto.getRandomValues`) — no Node-specific imports in `src/`.

## Peer dependencies

- `@nats-io/nats-core` (>= 3.0.0)
- `@opentelemetry/api` (>= 1.9.0)
- `@opentelemetry/core` (>= 2.0.0)
- `@opentelemetry/otlp-transformer` (>= 0.200.0)
- `@opentelemetry/sdk-trace-base` (>= 2.0.0, optional — required for `NatsSpanExporter`)
- `@opentelemetry/sdk-logs` (>= 0.200.0, optional — required for `NatsLogRecordExporter`)
- `@opentelemetry/sdk-metrics` (>= 2.0.0, optional — required for `NatsMetricExporter`)

## Development

```sh
pnpm install
pnpm test                # unit + e2e + golden tests
pnpm test:integration    # real NATS via Testcontainers (needs Docker)
pnpm lint
pnpm build
pnpm bench               # performance benchmarks (see bench/README.md)
```

CI runs benchmark regression checks against the committed `bench/baseline.json`:

- ≥10% slower → ⚠️ warn
- ≥50% slower → ❌ fail

To update the baseline after an intentional perf change, run `pnpm bench:update` (ideally via CI, since absolute numbers are environment-dependent). See [`bench/README.md`](bench/README.md).

## License

MIT
