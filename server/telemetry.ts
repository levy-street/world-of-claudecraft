// OpenTelemetry bootstrap + manual-instrumentation helpers for the game server.
//
// Traces flow: browser client -> (W3C traceparent over REST headers / WS msg)
// -> this server -> Postgres, then out over OTLP/HTTP to an OpenTelemetry
// Collector, whose ClickHouse exporter lands them in ClickHouse.
//
// This is *manual* instrumentation: we never rely on the auto-instrumentation
// monkeypatching of `require`, which the esbuild bundle would defeat anyway.
// Key events open spans explicitly via the helpers below.
//
// Configuration is the standard OTEL environment (read by the OTLP exporter):
//   OTEL_EXPORTER_OTLP_ENDPOINT        e.g. http://otel-collector:4318
//   OTEL_EXPORTER_OTLP_TRACES_ENDPOINT (overrides, full /v1/traces path)
//   OTEL_EXPORTER_OTLP_HEADERS         e.g. authorization=Bearer xxx
//   OTEL_SERVICE_NAME                  default "woc-server"
//   OTEL_SDK_DISABLED=true             hard off
//   OTEL_ENABLED=1                     turn on even without an endpoint (-> localhost:4318)
//   OTEL_TRACES_CONSOLE=1              also print spans to stdout (debugging)

import {
  trace, context, propagation, SpanStatusCode, SpanKind,
  type Span, type Context, type Tracer, type Attributes,
} from '@opentelemetry/api';
import { Resource } from '@opentelemetry/resources';
import {
  NodeTracerProvider, BatchSpanProcessor, ConsoleSpanExporter, SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { REALM } from './realm';

export { SpanStatusCode, SpanKind };
export type { Span, Context };

const SERVICE_NAME = process.env.OTEL_SERVICE_NAME || 'woc-server';
const TRACER_NAME = 'world-of-claudecraft/server';

function telemetryEnabled(): boolean {
  if (process.env.OTEL_SDK_DISABLED === 'true') return false;
  return Boolean(
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ||
    process.env.OTEL_ENABLED === '1',
  );
}

let provider: NodeTracerProvider | null = null;
let started = false;

// Idempotent. Call once, as early as possible in process startup, so the global
// tracer + W3C propagator are installed before any span is created. When
// telemetry is disabled this is a no-op: the OTEL API hands back a no-op tracer
// and propagation.inject/extract become no-ops, so the instrumented call sites
// stay zero-cost and need no `if (enabled)` guards of their own.
export function initTelemetry(): void {
  if (started) return;
  started = true;
  if (!telemetryEnabled()) {
    console.log('telemetry: disabled (set OTEL_EXPORTER_OTLP_ENDPOINT or OTEL_ENABLED=1 to enable)');
    return;
  }

  const resource = new Resource({
    'service.name': SERVICE_NAME,
    'service.namespace': 'world-of-claudecraft',
    'service.version': process.env.npm_package_version || '0.0.0',
    'deployment.environment': process.env.NODE_ENV || 'development',
    'woc.realm': REALM,
  });

  const processors = [new BatchSpanProcessor(new OTLPTraceExporter())];
  if (process.env.OTEL_TRACES_CONSOLE === '1') {
    processors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()) as unknown as BatchSpanProcessor);
  }

  provider = new NodeTracerProvider({ resource, spanProcessors: processors });
  // register() installs the global tracer provider, an AsyncLocalStorage-based
  // context manager (so spans nest across awaits) and the W3C trace-context +
  // baggage propagators used to read/write traceparent on the wire.
  provider.register();
  const endpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
    || `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318'}/v1/traces`;
  console.log(`telemetry: exporting traces as "${SERVICE_NAME}" -> ${endpoint}`);
}

export async function shutdownTelemetry(): Promise<void> {
  if (!provider) return;
  try {
    await provider.forceFlush();
    await provider.shutdown();
  } catch (err) {
    console.error('telemetry shutdown failed:', err);
  }
}

export function tracer(): Tracer {
  return trace.getTracer(TRACER_NAME);
}

// Build a Context whose parent span is read from an inbound carrier — HTTP
// request headers, or a `{ traceparent }` object lifted off a WS message. This
// is what stitches a server span onto the browser's client span.
export function extractContext(carrier: Record<string, string | string[] | undefined>): Context {
  return propagation.extract(context.active(), carrier);
}

// Run `fn` inside a new span. The span is the active span for the duration of
// `fn`, so any span opened underneath (e.g. a Postgres query) nests beneath it
// automatically. Works for sync and async `fn`; records exceptions and sets
// ERROR status on throw, then re-throws.
export function withSpan<T>(
  name: string,
  fn: (span: Span) => T,
  opts: { kind?: SpanKind; attributes?: Attributes; parent?: Context } = {},
): T {
  const parent = opts.parent ?? context.active();
  return tracer().startActiveSpan(
    name,
    { kind: opts.kind ?? SpanKind.INTERNAL, attributes: opts.attributes },
    parent,
    (span) => {
      let result: T;
      try {
        result = fn(span);
      } catch (err) {
        endWithError(span, err);
        throw err;
      }
      if (result instanceof Promise) {
        return result.then(
          (v) => { span.end(); return v; },
          (err) => { endWithError(span, err); throw err; },
        ) as unknown as T;
      }
      span.end();
      return result;
    },
  );
}

export function endWithError(span: Span, err: unknown): void {
  span.recordException(err as Error);
  span.setStatus({ code: SpanStatusCode.ERROR, message: err instanceof Error ? err.message : String(err) });
  span.end();
}
