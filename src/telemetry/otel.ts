// Browser OpenTelemetry bootstrap + helpers for the game client.
//
// This is the head of the distributed trace: a player action here (a REST call
// or a WebSocket command) opens a short CLIENT span and ships its W3C
// traceparent to the server, which continues the same trace through the sim and
// down into Postgres. Spans are exported over OTLP/HTTP straight to the
// OpenTelemetry Collector (whose ClickHouse exporter persists them).
//
// Enabled only when VITE_OTEL_ENDPOINT is set at build time; otherwise every
// helper is a cheap no-op so offline / un-instrumented builds are unaffected.
//   VITE_OTEL_ENDPOINT      collector base, e.g. http://localhost:4318
//   VITE_OTEL_SERVICE_NAME  default "woc-client"

import {
  trace, context, propagation, SpanStatusCode, SpanKind,
  type Span, type Attributes,
} from '@opentelemetry/api';
import { Resource } from '@opentelemetry/resources';
import { WebTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-web';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const TRACER_NAME = 'world-of-claudecraft/client';

function endpoint(): string | undefined {
  const e = import.meta.env?.VITE_OTEL_ENDPOINT;
  return typeof e === 'string' && e.length > 0 ? e.replace(/\/$/, '') : undefined;
}

let started = false;

// Call once at app startup. Safe to call when disabled (does nothing).
export function initClientTelemetry(): void {
  if (started) return;
  started = true;
  const base = endpoint();
  if (!base) return;

  const provider = new WebTracerProvider({
    resource: new Resource({
      'service.name': import.meta.env?.VITE_OTEL_SERVICE_NAME || 'woc-client',
      'service.namespace': 'world-of-claudecraft',
    }),
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url: `${base}/v1/traces` }))],
  });
  // W3C trace-context only — the server reads the same `traceparent` we inject.
  provider.register({ propagator: new W3CTraceContextPropagator() });
}

function tracer() {
  return trace.getTracer(TRACER_NAME);
}

// Inject the active trace context into a carrier (HTTP headers or a WS message),
// producing a `traceparent` the server extracts. No-op when disabled.
function inject(carrier: Record<string, string>): void {
  propagation.inject(context.active(), carrier);
}

// Wrap a fetch in a CLIENT span and inject traceparent into its headers, so the
// server's request span (and its DB spans) hang off this one. Used for the REST
// auth/character/report calls.
export async function tracedFetch(spanName: string, url: string, init: RequestInit = {}): Promise<Response> {
  const span = tracer().startSpan(spanName, {
    kind: SpanKind.CLIENT,
    attributes: { 'http.request.method': init.method ?? 'GET', 'url.full': url },
  });
  const headers = new Headers(init.headers);
  const carrier: Record<string, string> = {};
  context.with(trace.setSpan(context.active(), span), () => inject(carrier));
  for (const [k, v] of Object.entries(carrier)) headers.set(k, v);
  try {
    const res = await fetch(url, { ...init, headers });
    span.setAttribute('http.response.status_code', res.status);
    if (res.status >= 400) span.setStatus({ code: SpanStatusCode.ERROR });
    span.end();
    return res;
  } catch (err) {
    span.recordException(err as Error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
    span.end();
    throw err;
  }
}

// For fire-and-forget WebSocket sends: open a short CLIENT span, hand back the
// traceparent to ship in the message, and a finisher to close the span. The
// real work happens server-side; this span just marks the player's action and
// roots the server-side spans. Returns an empty traceparent when disabled, in
// which case the caller simply omits the field.
export function startClientSpan(name: string, attributes?: Attributes): { traceparent: string; span: Span } {
  const span = tracer().startSpan(name, { kind: SpanKind.CLIENT, attributes });
  const carrier: Record<string, string> = {};
  context.with(trace.setSpan(context.active(), span), () => inject(carrier));
  return { traceparent: carrier.traceparent ?? '', span };
}
