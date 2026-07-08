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
`handleApi` ladder, which is RETAINED behind a flag this release (see the flag model below).

## Modules
| Module | Role |
|---|---|
| `types.ts` | The frozen, TYPE-ONLY contracts: `RouteDef`, `RouteMeta`, `Ctx`, `Surface`, `EnvelopeKind`, `Method`, `Middleware`/`Next`, `RateLimitStore`. Emits zero runtime JS; never add a value export here. |
| `router.ts` (+ `path_pattern.ts`) | Pure `(method, path) -> MatchResult` over a static-map + dynamic table. Writes nothing: it decides matched / 404 / 405+Allow / synthesized OPTIONS, serves HEAD as GET (`head: true`), and normalizes trailing slashes. `path_pattern.ts` is its no-regex compiler (private, not in the barrel). |
| `compose.ts` | The onion runner. `runOnion` is the OUTERMOST wrapper that guarantees exactly one idempotent response on both the resolve and the throw path. |
| `context.ts` | `buildContext(req, res, match)` builds the frozen `Ctx` handlers read instead of touching req/res; also the `reqId` AsyncLocalStorage carrier (`runWithReqId`/`newReqId`). |
| `schema.ts` | Zero-dep typed body/params/query validator (Standard-Schema-v1-shaped): `object`/`str`/`num`/`bool`/`enum`/`optional` combinators, handler input via `Infer<typeof S>`, collects every field issue as stable CODES (never English). |
| `errors.ts` + `error_codes.ts` | The error model: `HttpError` (status + stable code + params/headers), `toAppError` (exhaustive throw normalizer), and the per-surface serializers (`mapError`). `error_codes.ts` is the append-only code catalog (see below). |
| `registry.ts` | Imports each domain module's `routes`, spreads them into `apiRoutes`, sorts most-specific-first, runs `assertNoOwnedRouteShadowing`, and exposes `resolve(method, path)`. |
| `dispatch.ts` | `createApiDispatcher` (the dispatcher-in-front) + `selectApiEntry` (the flag switch). |
| `config.ts` | `loadConfig` validates env into the boot `Config` once at boot; owns `DispatchMode` and the `API_DISPATCH` flag. |
| `index.ts` | The public barrel: re-exports router / compose / context / schema / errors / error_codes / registry / dispatch + the type contracts. Excludes the seam-reached internals (`path_pattern`, `config`, the individual `middleware/*`). |
| `middleware/*` | The onion frames: `body`/`raw_body`, `content_type`, `origin_check`, `require_account`/`require_admin`/`require_internal_secret`, `require_owned`, `bearer_active_guard`, `turnstile`, `rate_limit`, `request_id`, `cors`, `metric_sink`, `security_headers`, `with_errors`. |
| `metrics`/`attack_signals`/`health`/`perf_gate`/`server_timeouts`/`logger`/`access_log`/`redact`/`client_error` | Observability + hardening support the dispatcher and boot wire in. `metrics.ts` owns all six request-layer RED series (the request counter/histogram plus the four attack-signal counters); `attack_signals.ts` is the process-wide slot their scattered emission sites (rate_limit, ratelimit.ts auth failures, require_owned, the tier-2 pg store) emit through, installed by main.ts at boot. Labels are bounded (policy / kind / key_kind / route TEMPLATE); never label with an ip, account, token, or concrete id. |

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

## Error codes and their i18n mapping
`error_codes.ts` is an **APPEND-ONLY** (AIP-193) `deepFreeze` catalog keyed `'<domain>.<reason>'`
with `{ params: [...] }` values. Codes are permanent: never renumber, rename, or remove one; only
ADD. `tests/server/http/error_codes.test.ts` snapshot-guards it. The server emits the stable CODE,
NEVER English. The client localizes code-first: `userFacingApiError` in `src/ui/api_error_i18n.ts`
maps a code VERBATIM to the `t()` key `apiError.<domain>.<reason>` (table `API_ERROR_KEYS`); English
source lives in `src/ui/i18n.catalog/api_error.ts`. `tests/api_error_code_parity.test.ts` fails a
server code that has no client key. Adding a new code means: append it here, add the English catalog
entry, add the `API_ERROR_KEYS` client mapping, in the same change.

## The dispatch flag and the catch-all delegate
The env var `API_DISPATCH` -> `Config.dispatch` via `config.ts` `loadConfig`, read once at boot in
`server/main.ts`. The default is **`'new'`**; **`API_DISPATCH=legacy`** is the one-flag rollback that
runs the old ladder directly. `main.ts` `routeHttpRequest` is a prefix ladder that routes `/internal/`,
`/admin/api/`, `/api/`, `/oauth/` to four flag-gated entries, each built by `selectApiEntry(mode,
newDispatcher, legacyDelegate)`; `setApiDispatchMode` recomputes all four. Under `'new'`,
`createApiDispatcher` resolves the registry: a matched `RouteDef` runs the onion (`withErrors`,
`withMetrics`, `withOriginCheck`, `withContentType`, the route middleware, then the handler); an
UNMATCHED path (and HEAD) falls through to the per-path catch-all delegate, the old ladder handler
for that prefix. Registered domains today: leaderboard, auth, characters, account, wallet, reports,
discord, github, desktop-login, daily-rewards, maps, user-assets, admin, oauth, internal.

## Dual-edit maintenance (until the ladder is deleted)
A migrated route lives in BOTH the `RouteDef` table (here) and the legacy ladder (`main.ts`). Until
the ladder is removed, any behavior edit to one twin MUST land in the other in the same change (the
dual-edit rule). This obligation expires with the ladder-deletion follow-up PR. That deletion is
gated by exit criteria the release records in `docs/api-pipeline/state.md` under
`## Old-ladder deletion exit criteria (next release)`; do not delete the ladder before they are met.

## Testing seam notes
- Endpoint unit tests drive handlers through `routes` + a `configure<Domain>Runtime` injection + the
  `fakeCtx`/`FakeDb` helpers in `tests/server/helpers/`, not a pg `sql.includes()` mock. The full
  recipe (rungs + exemplar) lives in `server/CLAUDE.md` (Adding an endpoint / Endpoint tests).
