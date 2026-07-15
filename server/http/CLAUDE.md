<!-- server/http/: the REST request pipeline spine. Local conventions only.
     Root CLAUDE.md (architecture, invariants) and server/CLAUDE.md (the game
     server, the "Adding an endpoint" recipe) load alongside this; don't repeat
     them. This directory is the in-house pipeline built to replace the legacy
     main.ts handler ladder. -->

# server/http/: the REST request pipeline spine

The in-house request pipeline for every REST surface (`/api`, `/oauth`, `/admin/api`,
`/internal`). A domain module (`server/<domain>.ts`) exports `export const routes:
RouteDef[]`; the registry assembles those tables into one lookup and the dispatcher runs
each matched route through a Koa-style middleware onion. It replaces the old inline
`handleApi` ladder, which stays live as the flag-off legacy arm until the ladder-deletion
PR (see the flag model and Dual-edit below).

## Where new code lands (module-first)
- **New endpoint**: a `RouteDef` in a domain module (`server/<domain>.ts` `export const
  routes`) registered in `registry.ts`, never an inline handler in `main.ts`. Scaffold with
  `npm run new:endpoint` (RouteDef module typed via `Infer`, paired error code + English
  `apiError.*` entry + `API_ERROR_KEYS` mapping, `FakeDb` test, registry registration); it
  inserts at the two `new:endpoint ... above this line` anchor comments in `registry.ts`,
  keep those intact. Test: `tests/server/<domain>.test.ts`; full rung recipe in
  `server/CLAUDE.md` (Adding an endpoint). Then add the characterization-spine rows by
  hand (see Testing seam notes): the scaffold does not emit them.
- **New cross-cutting behavior**: a new `middleware/*.ts` frame plus a same-named test in
  `tests/server/http/`, mounted route-local in a RouteDef or as a global frame in
  `dispatch.ts`; never inline logic in `dispatch.ts` (`onion_order.test.ts` pins the
  global frame order).
- **New /metrics series**: follow the Observability rules below; never a bespoke registry.
- **Bug fixes are test-first**: reproduce with a failing test in `tests/server/http/`
  (extract the unit into its own module first if it is buried), then the smallest change
  that turns it green.

## Modules
| Module | Role |
|---|---|
| `types.ts` | The frozen, TYPE-ONLY contracts: `RouteDef`, `RouteMeta`, `Ctx`, `Surface`, `EnvelopeKind`, `Method`, `Middleware`/`Next`, `RateLimitStore`. Emits zero runtime JS; never add a value export here. |
| `router.ts` (+ `path_pattern.ts`) | Pure `(method, path) -> MatchResult` over a static-map + dynamic table. Writes nothing: it decides matched / 404 / 405+Allow / synthesized OPTIONS, serves HEAD as GET (`head: true`), and normalizes trailing slashes. `path_pattern.ts` is its no-regex compiler (private, not in the barrel). |
| `compose.ts` | The onion runner. `runOnion` is the OUTERMOST wrapper that guarantees exactly one idempotent response on both the resolve and the throw path. |
| `context.ts` | `buildContext(req, res, match)` builds the frozen `Ctx` handlers read instead of touching req/res; also the `reqId` AsyncLocalStorage carrier (`runWithReqId`/`newReqId`). |
| `schema.ts` | Zero-dep typed body/params/query validator (Standard-Schema-v1-shaped): `object`/`str`/`num`/`bool`/`enum_`/`optional` combinators, handler input via `Infer<typeof S>`, collects every field issue as stable CODES (never English). |
| `errors.ts` + `error_codes.ts` | The error model: `HttpError` (status + stable code + params/headers), `toAppError` (exhaustive throw normalizer), and the per-surface serializers (`mapError`). `error_codes.ts` is the append-only code catalog (see below). |
| `registry.ts` | Imports each domain module's `routes` (the import block at the top IS the list of registered domains), spreads them into `apiRoutes`, sorts most-specific-first, runs `assertNoOwnedRouteShadowing`, and exposes `resolve(method, path)`. |
| `dispatch.ts` | `createApiDispatcher` (the dispatcher-in-front) + `selectApiEntry` (the flag switch). |
| `config.ts` | `loadConfig` validates env into the boot `Config` once at boot; owns `DispatchMode` and the `API_DISPATCH` flag. |
| `health.ts` | the ops probes: `/livez` answers 200 while the world loop is completing passes and 503 once the last completed tick is older than `LIVEZ_STALE_MS` (a wedged loop, what the compose healthcheck and `deploy/game_watchdog.sh` act on), with two deliberate carve-outs: DRAINING always reads live (a graceful shutdown must never be misread as a wedge and restarted mid-save) and a cold boot reads from loop start until the first tick lands. `/readyz` is the drain signal (503 while shutting down). `registerLivenessSource` wires the game loop in at boot (pinned by `tests/server/game_boot_order.test.ts`); `/metrics` stays `METRICS_TOKEN`-gated. All three are 404ed at the public edge by Caddy (see DEPLOY.md); never expose `/livez` publicly, a wedge oracle invites kick-them-while-down timing. |
| `index.ts` | The public barrel: re-exports router / compose / context / schema / errors / error_codes / registry / dispatch + the type contracts. Excludes the seam-reached internals (`path_pattern`, `config`, the individual `middleware/*`). |
| `middleware/*` | The onion frames (`ls server/http/middleware/` for the live set). GLOBAL, mounted by `dispatch.ts` on every matched route: `with_errors`, `metric_sink`, `origin_check`, `content_type`; `security_headers` runs even earlier, in `main.ts`'s top-level `routeHttpRequest` wrapper so both arms carry it. Everything else (`body`/`raw_body`, the `require_*` guards, `bearer_active_guard`, `turnstile`, `rate_limit`) is ROUTE-LOCAL, composed as each RouteDef declares. Two are built but INTENTIONALLY UNMOUNTED: `cors` (CORS stays in `main.ts`'s single top-level wrapper, shared with the legacy ladder, so it is identical on both arms) and `request_id` (the X-Request-Id echo is deferred to the ladder deletion; mounting it now would break the parity harness, see the note in `dispatch.ts`). Do not double-mount either. |

## Observability (the /metrics exporter)
Every series registers on the ONE prom-client `Registry` built by `metrics.ts`; `main.ts`
wires each active exporter at boot. Three source patterns:
- **Request-layer RED** (`metrics.ts`): the request counter/histogram fed by the
  `metric_sink` frame, plus the attack-signal counters. Their scattered emission sites
  (rate_limit, ratelimit.ts auth failures, require_owned, the tier-2 pg store) emit
  through the process-wide slot in `attack_signals.ts`, installed by `main.ts` at boot.
- **Game-state** (`game_metrics.ts`): gauges (players online, tick rate) read live at
  scrape time from a captured `GameStateSource`; throughput counters emit through the
  `game_signals.ts` slot (same pattern as attack_signals; an unwired slot no-ops).
- **DB-backed aggregates** (`business_metrics.ts`): a
  Postgres-backed value MUST go through a `PeriodicCollector` (`periodic_collector.ts`)
  that runs one batched query on an interval and caches it; gauges publish the cached
  snapshot at scrape time. A scrape NEVER queries Postgres (a scrape storm must never
  become a query storm). SQL lives in the owning query module
  (`player_metrics_db.ts`), never in a metrics module.
Labels are bounded everywhere (policy / kind / key_kind / route TEMPLATE); never label with
an ip, account, token, or concrete id. `mismatch_warn_throttle.ts` caps the two log-only
mismatch sinks (content_type, origin_check), keyed on route template + method.

## The RouteDef contract
A `RouteDef` (`types.ts`) is `{ method, path, surface, middleware?, schema?, params?, query?,
handler, meta? }`. The handler is req/res-free: `(ctx: Ctx) => Awaitable<unknown>`, writing via
the `json(ctx.res, status, body)` helper; `middleware` is a Koa-style onion `(ctx, next)`.
`schema`/`params`/`query` are the validator slots. `meta` (`RouteMeta`) carries:
- **`requireOwned: { kind, ownerScope }`** marks a `:id` route whose resource must be loaded and
  ownership-authorized before the handler. `ownerScope: 'account'` is player-owned (denial is 404,
  anti-enumeration) and MUST carry a `require_owned` loader; `'operator'` is admin-scoped (denial
  is 403). The `assertNoOwnedRouteShadowing` build-time guard in `registry.ts` fails the build if
  an account-owned `:id` route is interceptable, in the final match order, by an EARLIER non-owned
  dynamic catch-all that would skip its loader.
- **`publicRead: true`** marks a `:id` route that is intentionally public, so the ownership-coverage
  helper does not flag it for a missing loader.
- **`envelope`** overrides the surface default response envelope for one route (`'problem+json'` /
  `'oauth'` / `'admin'` / `'html'` / `'redirect'` / `'binary'` / `'legacy405'`).
- **`requestBody: 'json' | 'binary'`** declares the REQUEST-body media type the Content-Type gate
  reads; absent means the `/api` default (`application/json`), `'binary'` exempts a raw-bytes upload
  (the card PNG) from the JSON 415 gate.

## Per-surface envelopes
Each `Surface` maps to a default response envelope; errors serialize through it. `'api'` errors are
RFC 9457 `application/problem+json` with a stable `code`; `'admin'` keeps the frozen admin envelope
(`{ success, data, error }`); `'oauth'` keeps RFC 6749 error bodies (`{ error, error_description }`);
`'internal'` is the secret-gated ops surface. A single route may override its envelope via
`meta.envelope` (a binary card inside `'api'`, an HTML unsubscribe page, a redirect callback).

## Error codes
`error_codes.ts` is an **APPEND-ONLY** (AIP-193) `deepFreeze` catalog keyed `'<domain>.<reason>'`
with `{ params: [...] }` values. Codes are permanent: never renumber, rename, or remove one; only
ADD. `tests/server/http/error_codes.test.ts` snapshot-guards it. The server emits the stable CODE,
NEVER English. The client-side mapping recipe (the `t()` key, `API_ERROR_KEYS`, the parity guard,
the three-part same-change rule) lives in `server/CLAUDE.md` (Error localization); follow it there.

## The dispatch flag and the catch-all delegate
The env var `API_DISPATCH` -> `Config.dispatch` via `config.ts` `loadConfig`, read once at boot in
`server/main.ts`. The default is **`'new'`**; **`API_DISPATCH=legacy`** is the one-flag rollback that
runs the old ladder (`handleApi` and friends, still live in `main.ts` as the legacy arm) directly.
`main.ts` `routeHttpRequest` is a prefix ladder that routes `/internal/`, `/admin/api/`, `/api/`,
`/oauth/` to four flag-gated entries, each built by `selectApiEntry(mode, newDispatcher,
legacyDelegate)`; `setApiDispatchMode` recomputes all four. Under `'new'`, `createApiDispatcher`
resolves the registry: a matched `RouteDef` runs the onion (`withErrors`, `withMetrics`,
`withOriginCheck`, `withContentType`, the route middleware, then the handler); an UNMATCHED path
(and HEAD) falls through to the per-path catch-all delegate, the old ladder handler for that prefix.

## Dual-edit maintenance (until the ladder is deleted)
A migrated route lives in BOTH the `RouteDef` table (here) and the legacy ladder (`main.ts`). Until
the ladder is removed, any behavior edit to one twin MUST land in the other in the same change (the
dual-edit rule). An INTENTIONAL divergence between the arms is not a dual-edit: it must land as a
labeled entry in `tests/server/http/known_deviations.ts` (the parity harness filters exactly the
ledgered deviations; any residual old-vs-new diff is a failure). The dual-edit obligation expires
with the ladder-deletion follow-up PR. That deletion is gated by exit criteria the release records
in `docs/api-pipeline/state.md` under `## Old-ladder deletion exit criteria (next release)`; do not
delete the ladder before they are met.

## Testing seam notes
- Endpoint unit tests drive handlers through `routes` + a `configure<Domain>Runtime` injection + the
  `fakeCtx`/`FakeDb` helpers in `tests/server/helpers/`, not a pg `sql.includes()` mock. The full
  recipe (rungs + exemplar) lives in `server/CLAUDE.md` (Adding an endpoint / Endpoint tests).
- Every spine module has a same-named test in `tests/server/http/` (one module, one test).
- The characterization spine is a hard CI gate on ANY route add or remove:
  - `tests/server/http/surface_inventory.ts` is the (method, path) ledger; rows anchor on symbols
    and route strings, never line numbers. `surface_inventory.test.ts` equality-gates it against
    BOTH the `main.ts` source scan and the registry's `apiRoutes`, and requires every `/api` path
    classified exactly once in `API_CONTENT_TYPE`. `npm run new:endpoint` does NOT emit these rows.
  - `completeness.test.ts` hard-fails a path served by neither arm (a dropped route is a
    production 404).
  - `parity.test.ts` replays the corpus under both `API_DISPATCH` modes and diffs status +
    normalized body + contracted headers; intentional diffs must be ledgered (see Dual-edit).
