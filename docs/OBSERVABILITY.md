# Observability — distributed tracing with OpenTelemetry → ClickHouse

World of Claudecraft is manually instrumented with OpenTelemetry. A player
action produces a single distributed trace that starts in the **browser**,
continues on the **game server**, and ends at **Postgres** — exported over
OTLP/HTTP to an **OpenTelemetry Collector**, which writes spans to **ClickHouse**.

```
browser (woc-client)            server (woc-server)             store
─────────────────────           ─────────────────────           ─────
POST /api/login
  span: POST /api/login ─tp─▶ span: POST /api/login
                              ├─ span: db SELECT accounts   ──▶  Postgres
                              └─ span: db INSERT auth_tokens ──▶  Postgres
open WebSocket
  span: ws.connect  ──tp──▶  span: ws.authenticate
                              ├─ span: db SELECT characters ──▶  Postgres
                              └─ (world join)

            all spans ──OTLP/HTTP──▶ OpenTelemetry Collector ──▶ ClickHouse (otel.otel_traces)
```

It's **manual** instrumentation by design: the server is bundled with esbuild,
which defeats OpenTelemetry's auto-instrumentation (it monkeypatches `require`),
so key events open spans explicitly instead.

## What's instrumented

**Server** (`server/telemetry.ts` + call sites):

| Span | Where | Notes |
|------|-------|-------|
| `GET/POST/... /api/...` | `server/main.ts` `traceHttp` | one SERVER span per REST request; route is de-cardinalised (`/api/characters/:id`) |
| `ws.authenticate` | `server/main.ts` | token + moderation + character lookup + world join |
| `ws.leave` | `server/game.ts` `leave` | save-on-leave + presence |
| `game.saveAll` | `server/game.ts` | periodic autosave / shutdown flush |
| `db <OP> <table>` | `server/db.ts` (wraps the shared `pool.query`) | every Postgres query, as a CLIENT span — nests under whichever span is active |

The high-frequency WebSocket traffic — the 20 Hz movement `input` frames,
per-command (`cmd`) messages, and per-tick snapshot broadcasts — is
**deliberately not traced** — it would bury every real event under
steady-state noise. (It's better served by metrics; see "Not covered".)

**Browser** (`src/telemetry/otel.ts` + `src/net/online.ts`):

| Span | Where |
|------|-------|
| `ws.connect` | on WebSocket open; injects `traceparent` into the auth message |
| `GET/POST/... <path>` | `Api` REST helpers via `tracedFetch`; injects the `traceparent` header |

Context crosses the wire as a standard **W3C `traceparent`** — in the HTTP
header for REST, and in a `tp` field on the JSON `auth` message that opens a
WebSocket.

## Run it locally

```bash
cp .env.example .env            # set POSTGRES_PASSWORD (+ CLICKHOUSE_PASSWORD if you like)
docker compose -f docker-compose.yml -f docker-compose.otel.yml up -d --build
```

That starts Postgres, the game server (with `OTEL_EXPORTER_OTLP_ENDPOINT`
pointing at the collector), the **collector**, and **ClickHouse**. Play at
http://localhost:8787 and the server's traces flow to ClickHouse.

To also emit **browser** traces, build the client with the endpoint baked in
(it's a build-time Vite var — the browser bundle has no server env):

```bash
VITE_OTEL_ENDPOINT=http://localhost:4318 npm run build
```

The collector's OTLP/HTTP receiver already answers CORS for `localhost:5173`
and `localhost:8787` (see `deploy/otel/collector.yaml`).

### Without Docker

Point the server at any collector and run it:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 npm run server
```

Or just smoke-test the spans on stdout, no collector needed:

```bash
OTEL_ENABLED=1 OTEL_TRACES_CONSOLE=1 npm run server
```

## Query traces in ClickHouse

```bash
docker exec -it eastbrook-clickhouse clickhouse-client --password "$CLICKHOUSE_PASSWORD"
```

```sql
-- slowest spans in the last 15 minutes
SELECT Timestamp, ServiceName, SpanName, Duration/1e6 AS ms, StatusCode
FROM otel.otel_traces
WHERE Timestamp > now() - INTERVAL 15 MINUTE
ORDER BY Duration DESC
LIMIT 20;

-- reassemble one end-to-end trace (browser → server → postgres)
SELECT Timestamp, ServiceName, SpanName, Duration/1e6 AS ms, ParentSpanId, SpanId
FROM otel.otel_traces
WHERE TraceId = '<trace-id>'
ORDER BY Timestamp;
```

Point Grafana (ClickHouse data source) or any ClickHouse UI at
`localhost:8123` for flame graphs and dashboards.

## Configuration

All standard OpenTelemetry env vars are honoured (read by the OTLP exporter).
See the OpenTelemetry block in `.env.example`. The most important:

| Var | Default | Meaning |
|-----|---------|---------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | _(unset → tracing off)_ | collector OTLP/HTTP base URL |
| `OTEL_ENABLED` | `0` | force-on without an endpoint (exports to `localhost:4318`) |
| `OTEL_SERVICE_NAME` | `woc-server` | `service.name` on every server span |
| `OTEL_TRACES_CONSOLE` | `0` | also print spans to stdout |
| `OTEL_SDK_DISABLED` | `false` | hard-off |
| `VITE_OTEL_ENDPOINT` | _(unset → client tracing off)_ | **build-time** collector URL for the browser |

When tracing is disabled the OpenTelemetry API hands back no-op tracers and the
propagators become no-ops, so the instrumented call sites stay effectively
zero-cost — no `if (enabled)` guards needed at the call sites.

## Not covered (possible follow-ups)

- **Metrics** (tick duration, players online, snapshot bytes) — these already
  exist as numbers in `adminStats()`; exporting them as OTEL metrics would suit
  the high-frequency tick/snapshot loop better than spans.
- **Per-command (`cmd`) spans** — discrete player actions (cast, loot, chat,
  trade, …) are not individually traced. Their DB writes still appear as `db …`
  spans, but as their own roots rather than nested under the originating
  command. Tracing them would need sampling to avoid burying real events.
