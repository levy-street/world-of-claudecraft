# Server API pipeline: implementation specification

Status: SPEC. All decisions locked 2026-06-29; no code written yet.
Scope: every JSON endpoint on the authoritative game server (`server/`). The realtime world
loop and gameplay are explicitly out of scope (see section 1).

Summary of locked decisions: API-only scope (this is a maintainability, security, testability,
and observability effort, not a concurrency-scalability fix); one PR with the old dispatcher kept
behind a surviving env flag (rollback is a flag flip, not a revert); validation maps to 422 for a
well-formed-but-invalid body and 400 for malformed JSON; conventions A/D/F/G (v1 aliasing, OpenAPI
generation, ETag, Deprecation/Sunset) deferred to a consumer-driven follow-up; the pg-backed auth
limiter and the World Market realm-scope fix are in this PR because multi-realm is imminent; no
magic values anywhere (section 9); compression deferred to the Cloudflare edge (section 11.C).

This specifies a test-first re-architecture of every JSON endpoint behind one request pipeline.
Nothing here changes gameplay: all gameplay stays inside the deterministic `Sim`.

---

## 1. Goal and scope

Make the JSON request API of the backend cleaner, safer, and better architected
(maintainability, security, testability, observability), specifically:

1. Easy to add a rate limit to any endpoint (one declaration, not copy-pasted `if` blocks).
2. Easy to add middleware where needed (auth, body parsing, CORS, security headers, errors).
3. The other things a production backend should have (observability, health checks,
   graceful shutdown, consistent error handling, real tests on the request layer).

This effort is scoped to the request API only. It changes how requests are routed, validated,
rate-limited, authorized, and observed. It does NOT change gameplay (all combat, loot, XP, quest,
and economy resolution stays in the deterministic `Sim`, guarded by `tests/architecture.test.ts`),
and it is NOT a scalability fix for concurrent players. The actual per-realm scalability ceiling of
a browser MMO is the single-threaded 20 Hz world loop (`broadcastSnapshots`, O(players x
visible-entities)), unbounded WS egress, and the autosave CPU burst, none of which the REST
endpoints touch. Those realtime-reliability items are server infrastructure (neither gameplay nor
the request API) and are a separately tracked workstream (see Non-goals and section 12).

The driver is `handleApi` in `server/main.ts`: one ~700-line `if (method && url === ...)` ladder
(46 path branches, ~55 method+path combinations) where every cross-cutting concern is hand-inlined
per route. Adding a limiter to a new endpoint is one forgotten line away from shipping unprotected,
and the most security-sensitive glue cannot be imported by a test today (`main.ts` self-invokes at
module load).

### Non-goals

- No change to gameplay resolution. Combat, loot, XP, quests, economy stay in `src/sim/`.
- No change to the WebSocket wire protocol (that is a separate workstream, #4).
- No change to realtime scalability or reliability. The 20 Hz world loop, WS egress backpressure,
  the tick-loop error boundary, and autosave are server infrastructure (not the request API and not
  gameplay); they are a separately tracked workstream (section 12), not part of this PR. Do not
  describe this effort as a scalability fix for concurrent players.
- No new heavy framework. The tiny-dependency invariant holds: the router, middleware, and schema
  layer are all in-house (the "middleware onion" is a pattern, not a package).
- Delivered as one PR (decision 6), built test-first. The old and new dispatchers coexist during
  development; the PR ships both, with the old if-ladders behind an env flag (deleted in the next
  release, not this PR).

---

## 2. Decisions locked

| Decision | Choice | Implication |
|---|---|---|
| Migration stance | Harden while migrating | Bake the known-safe improvements (Retry-After, 413/400 status codes, missing rate limits, security headers) into each port. The characterization tests encode the INTENDED behavior, so an expected diff is not a regression. |
| Architecture depth | Level 2: router + middleware + per-domain modules + typed request schemas | Each endpoint declares a typed schema that validates and types `ctx.body` and standardizes error shapes. Zero new dependencies. |
| Delivery | One PR, old dispatcher kept behind a surviving env flag | The seam, all four sub-dispatchers, the tests, and the doc updates ship together (suite green at every commit). The old if-ladders are NOT deleted in this PR: they stay behind an env flag (default the new path) and are deleted in the NEXT release once metrics are clean. Rollback = flip the flag, not a revert. If review stalls, the seam splits into stacked PRs with no rework. |
| Rate limiter | Two-tier, pg backstop in this PR | Tier-1 in-memory IP gate rejects floods before any DB work; tier-2 is a global-keyed Postgres backstop (`ratelimit_db.ts`) so auth limits survive restart and do not multiply across realm processes. Promoted into this PR because multi-realm is imminent. |
| Error localization | Stable codes, client renders the language | Every API error returns a stable machine-readable `code` (plus optional params); the client localizes it to the user's selected language via the i18n catalog. Server messages and logs stay English. See 4.7. |
| API conventions | A/D/F/G deferred | Versioning (`/api/v1` aliasing), ETag, Deprecation/Sunset, and generated OpenAPI are deferred to a consumer-driven follow-up; pagination (B), trailing-slash normalization (H), and drain-aware health (I) ship in this PR. See section 11. |
| No magic values | All tunables are named constants | Rate limits and windows, byte caps, page sizes, timeouts, TTLs, pool sizes, `maxPayload`, and the drain window are named constants with a single source of truth; env values read once through a validated config module. See section 9. |
| Documentation | Updated in the same PR | server/CLAUDE.md, root CLAUDE.md, new local CLAUDE.md files, and the i18n docs are updated as part of this change. |

---

## 3. Current-state assessment

### What is already good (do not break)

- Clean IO/pure split already practiced: `SocialService`/`SocialDb`, `chat_filter`/
  `chat_filter_db`, `wallet`/`wallet_link`. SQL is confined to `db.ts` and `*_db.ts`.
- Server-authoritative gameplay; careful `X-Forwarded-For` resolution in `ratelimit.ts`.
- A DB-backed rate limiter already exists for bug reports (`bug_report_db.ts`), the proven
  cross-process pattern to copy for the tier-2 limiter.
- Already-extracted handlers (`account.ts`, `wallet.ts`, `oauth.ts`, `admin.ts`, companion-token,
  `internal.ts`) have real pg-mocked tests. A big part of the net exists.

### The core gap

There is no request-pipeline seam. Concrete findings, current against the code:

- `handleApi` is one function, lines ~593 to ~1304 in `server/main.ts`, 46 path branches plus 6
  inline path-param regexes, matched positionally with ordering pinned only by comments.
- No 405 handling on the main API: a known path with a wrong method falls through to a generic 404,
  on some routes AFTER doing authenticated DB work (`/api/characters` authenticates at `main.ts:740`
  before the method branch, so a wrong-method-unauthenticated request returns 401 today and an
  authenticated wrong-method returns 404). `perf_report.ts:256` is the one route that already
  returns 405; preserve it.
- The bearer regex `/^Bearer ([a-f0-9]{64})$/` is retyped 6 times; the auth gate
  `bearerActiveAccount(...)` boilerplate repeats ~26 times; `readBody` is called ad hoc in ~10
  branches at different caps.
- The single outer catch collapses everything to 500, so an oversized or malformed JSON body
  returns 500 (not 413/400) on every JSON route except bug-reports.
- Rate limiting is ~20 hand-written `if (xRateLimited(req)) return json(res,429,...)` call sites
  across FIVE files (`account.ts` x8, `main.ts` x8, `admin.ts`, `profile_page.ts`, `wallet.ts` x2)
  with 7 limiter variants and 5 distinct messages; no 429 sets a `Retry-After` header; several
  authenticated routes (character create/rename/delete/takeover, `POST /api/reports`) have no per-IP
  or per-account limit at all.
- No security response headers anywhere (zero HSTS, CSP, X-Content-Type-Options, X-Frame-Options,
  Referrer-Policy, Permissions-Policy). `/oauth/authorize` is framable.
- All logging is raw `console.*` (~70 calls), no structure, no correlation id, no access log.
- No `/livez` / `/readyz` / `/metrics`; `/api/status` leaks the full online name list
  unauthenticated and reports healthy while draining.
- The spine is untestable: `main.ts` self-invokes `main()` at load, so `handleApi`, the WS auth
  path, CORS, and `serveStatic` cannot be imported.

Two real bugs found alongside, both fixed in this work:

- The World Market `world_state` key is not realm-scoped (the literal `'market'`), last-writer-wins
  across realms sharing one `DATABASE_URL`. See section 8 for the two write sites and the backfill.
- Player-facing rate-limit strings contain em dashes (a hard invariant violation): the strings at
  `server/main.ts:617/623/707` ("too many attempts", then a literal em dash U+2014, then "wait a
  minute and try again") and at `:691` ("too many failed attempts", same em dash). They are inlined
  in `main.ts`, not `ratelimit.ts` (whose dashes are all in code comments), and they are matched
  client-side by `userFacingApiError` in `src/main.ts:255-339` via a `startsWith` prefix, so
  swapping the em dash for a comma is safe (the matched prefix is unchanged). The same string also
  lives in `src/admin/i18n.locales/en_CA.ts` (operator-facing, in scope; the admin source at
  `admin.ts:113` already uses the comma form).

---

## 4. Target architecture

One request pipeline: an in-house table router dispatches to a composed middleware onion that
builds a `Ctx`, and each route is a small typed handler in a per-domain module.

### Module layout

Keep the existing COMPONENT-FIRST layout (`server/<domain>.ts`); do NOT introduce a cross-cutting
routes/controllers/services split. Each domain module owns its handlers and exports a route table;
a thin shared spine under `server/http/` assembles those tables and runs the pipeline. This keeps
every change and merge conflict scoped to one domain (the same reason `server/` is already
one-file-per-domain).

```
server/
  http/                       # the shared spine (domain-agnostic)
    router.ts                 # static Map (`${METHOD} ${path}`) + ordered list for :param routes; 404 vs 405 + Allow
    compose.ts                # middleware onion (~15 lines: compose, Mw, Next, double-next guard)
    context.ts                # Ctx type + buildContext
    schema.ts                 # in-house decoders implementing the Standard Schema v1 shape + Infer
    errors.ts                 # AppError + mapError + the problem+json envelope
    error_codes.ts            # the `as const` code catalog (single source of truth)
    middleware/               # with-errors, request-id, cors/headers, rate-limit, with-body, require-account
    registry.ts               # spreads every domain's route table into one lookup
    index.ts                  # barrel: the public seam surface
  account.ts                  # existing domain module, now also exports `routes: RouteDef[]`
  wallet.ts  social.ts  oauth.ts  admin.ts  ...   # same: each exports its route table
  characters.ts  leaderboard.ts  reports.ts        # NEW domain modules for the currently-inline main.ts clusters
```

`RouteDef = { method, path, middleware?: Middleware[], schema?, params?, query?, handler, deprecated?, sunset? }`
(one declaration covers body/params/query validation, middleware, and deprecation headers).
`registry.ts` does `[...account.routes, ...characters.routes, ...]`; `main.ts` builds the lookup
once at startup instead of branching. Handlers stay thin (validate, call a plain domain function,
serialize); the domain function does NOT take `req`/`res`, so the SAME core serves both the REST
path and the WS path and is unit-testable with no HTTP mock (the server's own "one core, two
hosts").

### 4.1 The request context

```ts
// server/http/context.ts
interface Ctx {
  req: http.IncomingMessage
  res: http.ServerResponse
  url: URL
  query: URLSearchParams
  params: Record<string, string>   // captured by the router from :segments
  ip: string                        // resolved once via requestIp()
  reqId: string                     // correlation id, carried into logs
  body?: unknown                    // populated by withBody, typed by the route schema
  account?: { id: number; scope: TokenScope }  // populated by requireAccount
}
```

### 4.2 The table router (node:http only, zero deps)

- `Map<method, { static: Map<path, Route>, dynamic: Route[] }>`.
- Static paths match O(1); dynamic routes capture `:param` segments (no per-request regex).
- Known path, wrong method -> 405 with an `Allow` header, BEFORE auth or handler runs. (Exception:
  keep the deliberate anti-enumeration 404 on auth routes; decided per route, on the `knownDeviation`
  list with a characterization test where it differs from today's 401/404.)
- find-my-way (the standalone radix router inside Fastify) is a documented fallback ONLY if the
  dynamic-route count later explodes. Today ~46 routes do not need it.

### 4.3 The middleware onion (Koa-style, in-house)

```ts
type Next = () => Promise<void>
type Mw   = (ctx: Ctx, next: Next) => Promise<void>
function compose(mw: Mw[]): (ctx: Ctx) => Promise<void>   // recursive dispatch
```

Starter middleware:

- `withErrors` (outermost): try/await/catch -> `mapError`.
- `withSecurityHeaders`: nosniff, Referrer-Policy, Permissions-Policy (deny-all), HSTS (prod,
  `max-age=63072000; includeSubDomains`), `COOP: same-origin`, `CORP: same-origin`,
  `X-Frame-Options`/`frame-ancestors` on the OAuth pages, the free non-script CSP directives
  (`frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`),
  `Cache-Control: no-store` on auth/token responses, and stripping `Server`/`X-Powered-By`. Do NOT
  set `COEP: require-corp`: the Three.js client loads cross-origin GLB/HDRI assets and it would
  break them. A full CSP is a SEPARATE Report-Only effort (a naive `default-src 'self'` would break
  the live shell, which loads Cloudflare Turnstile, Google Analytics, and inline scripts; do not
  enforce without allowlisting). These headers are applied via an explicit TOP-LEVEL wrapper on the
  `createServer` prefix ladder, not only the per-route onion: `serveStatic`, the `/c/` SSR
  (`handleProfilePage`), `/p/` card PNGs, `/avatar`, the sitemap, and the OAuth GET pages dispatch
  in that top-level ladder (`main.ts:1383-1408`) and never enter the route table, yet served HTML
  and OAuth pages are where these headers matter most.
- `withCors(class)`: the existing publicCors vs maybeCors choice, made declarative per route. CORS
  headers are set synchronously before any downstream throw so 4xx/5xx error bodies stay readable
  cross-origin.
- `withBody(maxBytes)`: parse once into `ctx.body`, map overflow to 413, bad JSON to 400. Preserve
  the card route's pre-auth `Content-Length` 413 + `Connection: close` short-circuit (today at
  `main.ts:1275-1280`, BEFORE auth), so a large-body flood is rejected before the DB token lookup.
- `requireAccount({ scope })`: one bearer resolver, applies the ban/moderation + scope gate
  uniformly (closes the bare-`bearerAccount` authz gap structurally).
- `rateLimit(policy)`: declarative, see 4.5.
- `requireOwned*`: account-scoped resource loader for `:id` routes, see 4.8.

Order (outermost first), cheap-reject-first: `withErrors` -> request-id/log -> security headers +
CORS -> IP-keyed `rateLimit` -> `withBody` (size cap) -> `requireAccount` -> account-keyed
`rateLimit` -> handler. IP-keyed limits run BEFORE body parse and the DB-backed token lookup so
floods are rejected cheaply; an account-keyed limit necessarily runs AFTER `requireAccount` (its key
is the account id). Turnstile is NOT a prologue step: `passesTurnstile` (`main.ts:457-463`) reads
`body.turnstileToken`/`body.nativeAttestation` and applies only to `/api/register` + `/api/login`,
so it is a per-route POST-body middleware ordered after `withBody`, not a global pre-body gate. The
error layer is registered first so it is outermost and catches every downstream throw; `compose`
guards against a double `next()`.

### 4.4 Typed per-endpoint schemas (the level-2 piece)

A tiny in-house validator (~150 lines, no zod/valibot). A schema describes the expected body; the
pipeline validates and types `ctx.body`, collecting ALL field issues in one pass (not first-fail),
and a failure produces one standardized error via `AppError`. Each schema implements the Standard
Schema v1 type shape (the `~standard` property, kept as a type-only conformance point) so any single
endpoint can later swap to Valibot with zero call-site churn, and the handler input type is DERIVED
from the schema (`Infer<typeof S>`, single source of truth, never a parallel interface). A
well-formed body that fails a field constraint maps to 422; malformed JSON maps to 400.

```ts
// server/http/schema.ts
const RenameBody = object({ name: str({ min: 1, max: 24 }) })
type RenameBody = Infer<typeof RenameBody>

// route declaration
api.post('/api/characters/:id/rename', renameCharacter, {
  schema: RenameBody,
  mw: [requireAccount({ scope: 'full' }), requireOwnedCharacter, rateLimit('character.rename')],
})
```

```ts
// server/http/errors.ts
class HttpError extends Error { constructor(public status: number, public code: string, msg: string) {} }
// one mapError: HttpError -> status, isUniqueViolation -> 409, 'body too large' -> 413,
// 'bad json' -> 400, validation fail -> 422 with field detail, else logged 500.
```

### 4.5 Declarative rate-limit policy

Two-tier: a cheap in-memory IP gate plus a Postgres backstop, both in this PR (the backstop because
multi-realm is imminent). The limits and windows below are illustrative; the real values DERIVE from
the existing named constants per limiter (no magic numbers, see section 9).

```ts
// server/ratelimit_policy.ts
const POLICIES = {
  // auth-class: tier-1 in-memory IP gate runs BEFORE the DB token lookup so floods stay off
  // Postgres (4.3). tier-2 pg is a durability backstop, keyed GLOBALLY (auth is cross-realm).
  'auth.login':         { limit: 20, windowMs: 60_000, keyBy: 'ip',         tier1: 'memory', tier2: 'pg' },
  'auth.register':      { limit: 20, windowMs: 60_000, keyBy: 'ip',         tier1: 'memory', tier2: 'pg' },
  'admin.login':        { limit: 10, windowMs: 60_000, keyBy: 'ip',         tier1: 'memory', tier2: 'pg' },
  'character.create':   { limit: 10, windowMs: 60_000, keyBy: 'account',    store: 'memory' }, // NEW (missing today)
  'character.rename':   { limit: 10, windowMs: 60_000, keyBy: 'account',    store: 'memory' }, // NEW
  'character.delete':   { limit: 10, windowMs: 60_000, keyBy: 'account',    store: 'memory' }, // NEW
  'character.takeover': { limit: 10, windowMs: 60_000, keyBy: 'account',    store: 'memory' }, // NEW
  'reports.create':     { limit: 10, windowMs: 60_000, keyBy: 'account',    store: 'memory' }, // NEW (POST /api/reports)
  'public.read':        { limit: 60, windowMs: 60_000, keyBy: 'ip',         store: 'memory' }, // PUBLIC_READ_MAX_PER_MINUTE; sheet AND /c/ SSR
  'woc.balance':        { limit: 20, windowMs: 60_000, keyBy: 'ip',         store: 'memory' }, // WOC_BALANCE_MAX_PER_MINUTE
  'wallet.link':        { limit: 10, windowMs: 60_000, keyBy: 'ip+account', store: 'memory' }, // WALLET_LINK_MAX_PER_MINUTE
  'card.upload':        { limit: 10, windowMs: 60_000, keyBy: 'ip+account', store: 'memory' }, // CARD_UPLOAD_MAX_PER_MINUTE
} as const
// Kept as HANDLER-level checks (not expressible as a pre-handler rateLimit(name)):
//   authThrottled  (per-USERNAME, counts only FAILED logins, CLEARS on success, 15m/10-fail)
//   rateLimitedPerfReport  (returns 200 not 429 by design, to avoid signalling)
```

- Two-tier, never pg on the flood path. Tier-1 is the existing in-memory IP-keyed `rateLimited()`,
  the cheap pre-DB gate that rejects credential-stuffing floods without touching Postgres. Tier-2 is
  a durability backstop, a single-statement atomic UPSERT keyed GLOBALLY via a new `ratelimit_db.ts`
  (SQL in a `*_db.ts`, idempotent DDL under the advisory lock). Tier-1 runs FIRST so a flood never
  reaches pg.
- `rateLimit(name)` resolves the key (ip / account / both) and on breach calls one
  `respond429(res, retryAfterSeconds, code)`. Prerequisite: the limiters return only a boolean today
  (`rateLimited`, `recordSlidingWindowAttempt`), so an accurate `Retry-After`/reset needs them
  reworked to return `{ remaining, resetSeconds }` first (this touches every limiter). Emit the
  current draft-11 (RFC 9651 structured-field) form `RateLimit-Policy: "auth";q=20;w=60` +
  `RateLimit: "auth";r=3;t=42` plus `Retry-After` derived from the same bucket reset, not the legacy
  `RateLimit-Limit/-Remaining/-Reset` trio. Algorithm is per-policy: sliding-window for auth-class,
  token-bucket for high-volume.
- `keyBy: 'ip+account'` (card.upload, wallet.link) is NOT a cheap pre-flood gate: the account id is
  known only AFTER the DB token lookup, so the IP component runs after auth. The pre-auth byte-cap
  short-circuit on the card route (4.3) is what protects that path from large-body floods.
- `STRICTEST_RATE_LIMIT` exists today only to guard the SHARED `attempts` map (game login 20 + admin
  login 10 share one map). Per-policy named stores eliminate that shared-map hazard, so the invariant
  disappears rather than needing a test.

### 4.6 Before and after (one route)

Before (anonymous branch in the ladder):

```ts
if (req.method === 'POST' && renameMatch) {
  const accountId = await bearerActiveAccount(req, res)
  if (accountId === null) return
  // body parse, validation, rate limit (missing), handler logic, all inline
}
```

After (declaration + a testable handler in a domain module):

```ts
// server/characters.ts
export const renameCharacter: Handler<RenameBody> = async (ctx) => {
  const id = Number(ctx.params.id)
  const { name } = ctx.body            // already validated + typed
  // pure handler logic; throws HttpError(409, 'name_taken', ...) on conflict
}
```

### 4.7 Error model and client localization (a hard requirement)

The server supports 20+ languages, so every API error must reach the user in their selected
language. The server stays language-agnostic (English at source, logs included); the CLIENT renders
the localized text. The mechanism is stable error CODES, not server-side strings.

Envelope: align to RFC 9457 (Problem Details for HTTP APIs, `application/problem+json`), but the
load-bearing field is a stable machine `code`. Adopt the SHAPE and deliberately DECLINE RFC 9457's
`Accept-Language` content negotiation (the client owns all locales, so the server never localizes):

```ts
// HTTP status carries the class; the body carries the localizable detail.
{
  type: 'about:blank',                  // or a stable URI per problem class
  code: 'account.password_too_short',   // stable, machine-readable, never localized or renamed
  status: 422,
  params: { min: 8 },                   // structured values for client interpolation (never pre-formatted)
  detail: 'password must be at least 8 chars',  // English, dev/log/curl aid only
  instance: 'req_01J...',               // request/trace id for log correlation; never leak internals
}
```

Field-level validation failures use an `errors[]` array, collected in one pass:
`errors: [{ pointer: '/name', code: 'too_long', params: { max: 24 } }]`.

Per-surface envelopes: `mapError` chooses the serializer by surface, it does NOT blanket-flip
everything to problem+json. `/api/*` uses problem+json (as above); `/oauth/*` MUST keep RFC 6749
`{ error, error_description }` (third-party OAuth clients parse `error`, at `oauth.ts:165`);
`/admin/api/*` MUST keep `{ success, data, error }` (the Svelte admin client consumes it, at
`admin.ts:67/71`). A contract test per surface freezes each shape.

There are THREE client localization seams, and the work targets the right one per surface:

1. WS-channel events go through `src/ui/server_i18n.ts` (`localizeServerText`, S3-guarded).
2. The live `/api` REST errors go through `userFacingApiError` in `src/main.ts:255-339` (a
   `startsWith`/exact/regex matcher), which is UNGUARDED today (the S3 guard scans only `game.ts`).
   When the server starts emitting codes, `userFacingApiError` must change in lockstep, and the
   migration must add coverage for the ~30 existing REST strings, not just future codes.
3. The admin dashboard has its OWN Svelte catalog (`src/admin/i18n.ts`); the code-parity test
   asserts per-surface against the correct catalog.

Code taxonomy: REUSE the existing key vocabulary. `src/ui/server_i18n.ts` already enumerates
`friends.*` / `guild.*` keys with `{name}` interpolation. Have the server emit those same dotted
`domain.reason` keys as `code`, and have the client look the `code` up directly in its catalog
instead of reverse-matching English prose, retiring the fragile English-prose matcher over time. The
parametric cases (the `'suspended until {date}'` regex at `src/main.ts:257`, the `{seconds}`
rate-limit families) port to `{ code, params }`, not flat codes, or they lose interpolation. The
`'rate limited'` responses at `main.ts:1266/1285` and `wallet.ts:39/62` have no client matcher today
(they render raw English) and get codes as well.

Catalog + guard: the stable code set lives in one `as const` catalog (`server/http/error_codes.ts`).
Because the server may not import `src/ui`, the client keeps its own keyed catalog and a Vitest
enforces parity between the two per surface (every emitted code resolves to a client entry in every
locale), the same lockstep pattern as the wire-snapshot and command-schema guards, plus the
release-tier i18n gate. Per Google AIP-193, freeze the (domain, reason) PAIR and the param KEYS
append-only (keys may be added, never removed; a value may be empty): a rename silently breaks the
user-facing message in every language at once.

Status mapping, encoded ONCE in the onion: malformed JSON -> 400; a well-formed body that fails a
field constraint -> 422; missing/invalid token -> 401 (+ `WWW-Authenticate`); valid token lacking
entitlement -> 403; over the byte cap -> 413; rate limited -> 429 (+ `Retry-After` + `RateLimit`);
state/version/duplicate clash -> 409. Unknown throws -> a generic 500 with no stack/SQL/table text in
the body (the English cause logs server-side; intersects the privacy-security-review gate).

Params are formatted client-side via `formatNumber` / `formatDuration` / `Intl` in the user's
locale, never baked into the English `detail`.

WS scope: WS error frames stay English STRINGS (`{ t: 'error', error: ... }` at `main.ts:1434`,
`game.ts:1233`), localized client-side by `server_i18n`. The `{ code, params }` model is scoped to
the REST surface only, because switching WS frames to codes is a wire change `online.ts`/`ClientWorld`
must decode, which the no-WS-wire-change non-goal forbids here. If WS frames later adopt
`{ code, params }`, it is an explicit WS wire change (#4) with the `online.ts` decoder and a parity
test.

Hard rule: an endpoint that can fail introduces its error codes AND their catalog entries in the
same change. No raw English error string is ever shown to a user.

### 4.8 Additional hardening and conventions

These belong IN the restructure, because the seam makes them structural and cheap:

- Object-level authorization (BOLA, OWASP API1) gets the SAME structural treatment as rate limits
  and auth: a `requireOwned*` resource-loader middleware (e.g. populate `ctx.character` via the
  account-scoped query) plus a deny-by-default coverage test asserting every `:id` route resolves
  through an account-scoped loader. Today ownership is ad hoc per handler, the exact copy-paste class
  this work retires, and it is higher-severity than a missing rate limit.
- Typed `params` AND `query`, not just `body`: extend `RouteDef` with optional `params`/`query`
  schemas using the same decoders, so a `:id` cannot reach a DB call as `NaN` and `?page`/`pageSize`
  are coerced and bounded once (today hand-parsed, e.g. `Number(params.get('pageSize'))` at
  `main.ts:1114` and `parsePageParams` in `admin.ts`; note admin uses `page`/`limit`, a frozen
  internal contract left as-is).
- Server-level timeouts and size limits set in `startServer()`: `requestTimeout`, `headersTimeout`,
  `keepAliveTimeout`, `maxHeaderSize` (slow-loris / slow-body hardening; the body byte cap alone does
  not cover these). Mind the WS upgrade and the 1 MB card upload when choosing values. All are named
  constants (section 9).
- Per-route metric + access-log hook in the onion NOW, behind an injectable sink: count + duration +
  status keyed by the registry route name, plus one structured access line with the reqId. Back the
  reqId with `AsyncLocalStorage` (not just a `Ctx` field) so it reaches `db.ts` / domain functions /
  the loop with zero threading. Guarantee the structured access line + `X-Request-Id` echo in THIS
  PR (today the outer catch collapses to one un-attributed `'api error:'` 500 at `main.ts:1302`,
  impossible to tie to a bug report). Make the in-house logger a pino-shaped facade (level methods,
  `child(bindings)`) so a future swap is drop-in. The `/metrics` endpoint can follow, but the
  collection point must not, adding it later re-touches every route. Pre-name the metrics to RED +
  Prometheus conventions; the full catalog, labels, and alert thresholds are in 4.9.
- A minimal validated, fail-fast config module read once at boot for the env vars the new spine
  branches on (HSTS-in-prod, `REQUIRE_WEB_LOGIN`, realm/native-app origins, the limiter DSN); a
  pipeline that gates security on env is exactly where a missing var silently disables a control.
- Echo `X-Request-Id` on every response (including 2xx) so a player's in-game bug report ties to the
  server logs.
- The router answers HEAD for any GET, synthesizes preflight OPTIONS per route from the real
  allowed-method set (the same set the 405 `Allow` header uses), and sets `Vary: Origin` since CORS
  moves from a global pre-routing step into the per-route onion. Pin the current behavior in the
  parity harness: today `maybeCors`/`publicCors` answer OPTIONS 204 for any `/api` or `/admin/api`
  path BEFORE routing (`main.ts:1390-1397`), the class chosen by `isPublicCorsPath(path)` independent
  of whether the route exists; moving CORS per-route flips OPTIONS on an unknown path from 204 to
  404/405 and couples preflight to route registration.
- Bearer-only is an explicit invariant: there are NO cookies anywhere, so classic CSRF is
  structurally absent. Keep it that way, enforce `Content-Type: application/json` on `/api` JSON
  bodies (reject other content types with 415), and add a cheap Origin / Sec-Fetch-Site check on
  mutating endpoints. Confirm the Capacitor native client sends `application/json` on its auth POSTs
  before enforcing globally.

### 4.9 Observability: metrics to emit and alerts

The per-route metric + access-log hook (4.8) is the collection point; this is the catalog it emits,
to RED (request and realtime layers) and USE (resources) conventions. Metrics are scraped from a
Prometheus `/metrics` exporter and dashboarded in Grafana; structured access logs go to Loki keyed
by `reqId`. The minimum to light up Grafana is the exporter plus the access log, and the collection
point lands in this PR, so pull the exporter forward from the deferred observability workstream now
that Grafana is provisioned (decision 11.I). Metrics tagged [realtime] land with the realtime
workstream (section 12), not this PR.

Label discipline (bounded cardinality): every metric carries `realm`. Request metrics label by the
REGISTRY ROUTE NAME (the `:param` template, e.g. `/api/characters/:id/rename`), never the concrete
path, so a `:id` cannot explode label cardinality. Other labels (`method`, `status`, `policy`,
`surface`, `state`, `op`) each come from a small fixed set.

Request layer (RED), this PR:

| Metric | Type | Labels | Measures |
|---|---|---|---|
| `http_requests_total` | counter | route, method, status | request rate + error rate (5xx, and 401/403/413/422/429) |
| `http_request_duration_seconds` | histogram | route, method | latency p50/p95/p99 |
| `rate_limit_hits_total` | counter | policy, key_kind | 429s by policy (auth.* spikes signal an attack) |
| `auth_failures_total` | counter | kind | bad-password + `authThrottled` lockouts (brute force) |
| `bola_denied_total` | counter | route | `requireOwned*` 403s (resource enumeration) |
| `pg_limiter_writes_total` | counter | policy | tier-2 hits (nonzero means floods reach pg, tier-1 failing) |

Realtime layer [realtime] (section 12):

| Metric | Type | Labels | Measures |
|---|---|---|---|
| `game_tick_duration_seconds` | histogram | realm | loop time vs the `DT` (50 ms) budget |
| `game_tick_errors_total` | counter | realm | tick try/catch sink (nonzero means shared `Sim` corruption) |
| `game_tick_catchup_total` | counter | realm | sim ticks per broadcast above 1 (loop falling behind) |
| `ws_connections` | gauge | realm | live players (capacity denominator) |
| `ws_buffered_bytes` | gauge | realm | per-connection `bufferedAmount` p99/max (backpressure, OOM vector) |
| `ws_snapshots_dropped_total` | counter | realm | bounded-egress drops and coalesces |
| `ws_snapshot_bytes` | histogram | realm | fan-out size (grows O(players x visible entities)) |
| `ws_ingress_dropped_total` | counter | realm | per-connection ingress-bucket drops |
| `nodejs_eventloop_lag_seconds` | gauge | realm | `monitorEventLoopDelay` p99/max (single-thread saturation) |

Persistence (USE), this PR exporter + persistence workstream:

| Metric | Type | Labels | Measures |
|---|---|---|---|
| `pg_pool_connections` | gauge | state (active/idle/waiting) | pool saturation vs `max` |
| `pg_pool_acquire_wait_seconds` | histogram | realm | acquisition wait (exhaustion hangs requests/saves) |
| `pg_query_duration_seconds` | histogram | op | slow queries (leaderboard JSONB sort, autosave write) |
| `autosave_duration_seconds` | histogram | realm | `serializeCharacter` burst (correlate with tick spikes) |
| `leaderboard_cache_hit_ratio` | gauge | realm | the `main.ts` leaderboard cache effectiveness |

Process and lifecycle (USE), exporter:

| Metric | Type | Measures |
|---|---|---|
| `process_resident_memory_bytes`, `nodejs_heap_size_used_bytes` | gauge | memory (leak + backpressure OOM watch) |
| `process_cpu_seconds_total` | counter | CPU (single-core saturation is the ceiling) |
| `nodejs_gc_duration_seconds` | histogram | GC pauses (track tick jitter) |
| `up`, `process_start_time_seconds` | gauge | restarts, uptime, crashloop |
| `readyz_draining` | gauge | 1 while draining on SIGTERM |
| `shutdown_drain_duration_seconds` | histogram | drain time vs the grace window |

Alerts (thresholds are named constants per section 9, expressed relative to `DT`, `AUTOSAVE_SECONDS`,
the pool `max`, and the container memory limit, never magic numbers):

- Page: `game_tick_errors_total` increasing; `game_tick_duration_seconds` p95 at or above `DT`
  sustained; `pg_pool_connections{state="waiting"}` above 0 sustained or acquire timeouts; the
  `http_requests_total` 5xx ratio above threshold; `process_resident_memory_bytes` near the
  container limit; `up == 0` or crashloop.
- Warn: tick duration p95 above 0.8 x `DT`; `nodejs_eventloop_lag_seconds` p99 high;
  `ws_buffered_bytes` p99 climbing; `rate_limit_hits_total{policy=~"auth.*"}` spike;
  `shutdown_drain_duration_seconds` above the grace window; `leaderboard_cache_hit_ratio` drop.

Logs (Loki): one structured access line per request carrying `reqId` (echoed as `X-Request-Id`), so
a player's in-game bug report ties to the server logs. Traces (Tempo) are optional later, correlated
via the same `AsyncLocalStorage` `reqId`.

---

## 5. Endpoint inventory

About 90 to 100 method+path endpoints across four sub-dispatchers. Paths ship UNVERSIONED
(versioning deferred, decision 11.A); a future breaking change introduces `/api/v1` then.

| Surface | Where | Approx count | State today |
|---|---|---|---|
| Main API | `handleApi` (`main.ts`) | 46 paths / ~55 combos | inline in the if-ladder, UNTESTED |
| Admin API | `handleAdminApi` (`admin.ts`) | ~19 branches / ~30 combos | own sub-router, already tested |
| OAuth (JSON) | `handleOAuth` (`oauth.ts`) | 5 JSON (token, revoke, device_authorization, authorize POST, device POST) | own sub-router, already tested |
| Internal | `handleInternalApi` (`internal.ts`) | ~2 secret-gated | own module, tested |

Out of scope (not JSON): `serveStatic`, the `/ws` upgrade, and the HTML/binary render routes
(`GET /oauth/authorize` and `/oauth/device` pages, `/p/` card PNGs, `/avatar/`, `/c/` profile pages,
the sitemap). These keep bespoke handling but still get the thin middleware subset (the top-level
security-header wrapper and access logging).

### Migration batches (internal commits within the one PR)

All four sub-dispatchers (main, admin, oauth, internal) are in the FIRST wave (decision 3). Public
reads go first (decision 2). These are commit-sized batches on one branch, not separate PRs:

1. Public reads: `/api/leaderboard`, `/api/arena/leaderboard`, `/api/releases`,
   `/api/project-stats`, `/api/status` (trim the name leak here), `/api/search`, `/api/realms`,
   `/api/public/characters/:id/sheet`.
2. Character ownership: `/api/me/characters`, `/api/characters` (GET/POST), `/api/characters/:id`
   (DELETE), `/rename`, `/takeover`, `/standing`, `/sheet`.
3. Account portal: the `/api/account/*` family (already extracted handlers, adapt signature). The
   em-dash rate-limit strings get fixed here (section 8), with the `userFacingApiError` matcher
   updated in the same change.
4. Wallet + cards + misc: `/api/wallet*`, `/api/woc/balance`, `/api/card`, `/api/referrals`,
   `/api/reports`, `/api/bug-reports`, `/api/perf-report`, `/api/site-presence`,
   `/api/native-attestation/challenge`, `/api/email/unsubscribe`.
5. Admin API (`admin.ts`) onto the shared seam.
6. OAuth JSON + internal onto the shared seam.

The World Market realm-scope fix is a persistence change (two write sites in `db.ts` plus a
realm-partitioned backfill, see section 8), not a JSON route; it rides the economy/persistence batch
(decision 5).

---

## 6. Test-first strategy (the net that makes this safe)

The whole approach rests on having a regression net BEFORE any route moves.

1. Make the spine importable: export `startServer()` and guard the auto-run so the module can be
   imported without booting (today `main.ts` self-invokes). Lift the WS-auth nested closures
   (`authenticateWebSocket`, `onConnection`, the upgrade wiring) out of `main()` into an importable
   module, the way `account.ts` was extracted, not a one-line export.
2. Characterization tests for the inline `main.ts` routes and the dispatch glue, using the existing
   pg-mock + fake req/res idiom (`tests/account_server.test.ts` is the template). Assert:
   auth/moderation gating per route, CORS class, 405-with-Allow vs the deliberate 404, body caps,
   route precedence, the per-IP WS hard limit.
3. Because we harden while migrating, the characterization tests encode the INTENDED behavior. Where
   a port changes a response on purpose (500 -> 413, add Retry-After, add a missing limiter, the
   405-before-auth change), the test asserts the new behavior and the change is called out on the
   `knownDeviation` list in the PR.
4. Unit tests for each new seam module (router matching + 405, compose ordering, schema validation,
   mapError mapping, respond429 headers, security headers) before wiring.
5. Golden-master snapshots: for each endpoint, snapshot `(status, body, contracted headers)` from
   the CURRENT `handleApi`, normalizing dynamic fields (timestamps, generated ids, tokens) to fixed
   placeholders. Treat golden-master as scaffolding that locks in current bugs: sample input VARIETY
   per endpoint, error and auth-failure paths weighted heaviest, automate it with no manual approve
   step, and replace it with intentful tests post-migration. No characterization coverage on an
   endpoint means no migration of it.
6. A route-table parity/coverage test is the load-bearing net: raw node:http has no framework
   routing safety net, so a missed endpoint is a silent prod 404, not a boot error. Assert
   `(method, path) -> handler + extracted params` for every route, and run a parity harness that
   feeds each fixture through BOTH the old if-ladder and the new router and diffs the response
   (weighting error paths and 404-vs-405 heaviest). The harness must cover the REAL request entry,
   the top-level `createServer` callback (`main.ts:1383-1408`): an ordered PREFIX dispatch
   (`/internal` -> `/admin/api` -> `/api` -> `/oauth` -> `/p/` -> `/avatar` -> `/c/` -> sitemap ->
   serveStatic), each invoked fire-and-forget with `void`. The new router reproduces this prefix
   order and non-awaited semantics exactly. Pin the existing behaviors the harness must NOT change
   silently: `perf_report.ts:256` returns 405, and `/api/characters` returns 401 on a
   wrong-method-unauthenticated request (auth runs before the method branch at `main.ts:740`); the
   planned 405-before-auth is a documented `knownDeviation`. Add a no-regex-routing guard test
   asserting every route pattern is literal segments or a plain `:param` (the CVE-2024-45296
   ReDoS-safety property the in-house router gets by construction). Block on any undocumented diff.

Acceptance for every commit (the PR ships green): `tsc` clean, the changed-file biome check clean,
the full Vitest suite green (including `tests/architecture.test.ts`, the S3 i18n guard, and the new
parity suite), and the `/qa` gate. New error codes get a catalog entry plus the code-parity test
(4.7) in the same change.

---

## 7. Build sequence (one PR)

Delivered as one PR with the suite green at every commit (bisectable). The old if-ladders are NOT
deleted in this PR: they stay behind an env flag (default the new path) and are removed in the next
release once metrics are clean, so rollback is a flag flip, not a revert. The seam is structured to
split into stacked PRs (spine + parity harness, then per-domain batches, then deletion) with no
rework if review capacity needs it (the ~200-400 LOC window; defect detection drops sharply past
~1000 lines). The stages below are the internal build order on one branch.

| Stage | Work | Risk |
|---|---|---|
| 0 | Importable spine (`startServer()` + entry guard) + characterization net for the inline routes and dispatch glue. No behavior change. | Very low |
| 1 | Build the seam (router, compose, context, schema, errors/mapError + the error envelope, the middleware set, the top-level security wrapper, the two-tier ratelimit policy + `ratelimit_db.ts`, the error-code catalog) with full unit tests. Wire the new dispatcher in FRONT of the old `handleApi` with a catch-all that delegates un-migrated paths (coexistence during development). | Low |
| 2 | Port routes in batches (public reads first), each batch its own commit, green against the net, hardening + localized error codes baked in. Admin and OAuth are in this wave. | Low per commit |
| 3 | Keep the old if-ladders behind the env flag (default the new path); they are deleted in a FOLLOW-UP release once metrics are clean, NOT in this PR. | Low |
| 4 | Update all docs/CLAUDE.md (see deliverables). | Low |

Deliverables in the one PR:

- The `server/http/` seam + per-domain route tables (component-first) + the registry.
- The two-tier rate-limit policy + `ratelimit_db.ts` (decision 4, in this PR).
- The conventions that ship IN this PR: unified `page`/`pageSize` pagination (decision B),
  trailing-slash normalization (H), `/livez` + `/readyz` drain-aware health (I), and the
  `withSecurityHeaders` top-level wrapper. Deferred to a consumer-driven follow-up (decisions
  A/D/F/G): the `/api/v1` prefix + aliasing, `withETag`, `Deprecation`/`Sunset` headers, and the
  generated OpenAPI document. Ship paths unversioned until a breaking change forces `/api/v1`.
- Unit tests for every seam module + characterization/behavior tests for every route.
- The `apiError.*` error-code catalog entries (English) for every code, wired into the client i18n
  so errors render in the user's selected language.
- Documentation updates:
  - `server/CLAUDE.md`: replace the route-table description with the request-pipeline model, add an
    "Adding an endpoint" recipe (declare route + schema + middleware + error codes + catalog entry +
    test), and the error-localization rule.
  - Root `CLAUDE.md`: note the `server/http` seam under module-first.
  - New `server/http/CLAUDE.md` (repo convention: a directory with its own conventions gets a local
    CLAUDE.md).
  - `src/ui/CLAUDE.md` / the i18n docs: the new `apiError.*` domain and the code-based path.

### Contributor on-ramp (make the backend easier to contribute to)

First-class deliverables, not prose, because the new model RAISES the per-endpoint floor (an
endpoint now needs a paired error code + client catalog entry frozen by a parity test, where today
it is one `json(res,400,...)` line), so the on-ramp must offset that:

- A `npm run new:endpoint <domain> <path>` SCAFFOLD that emits the `RouteDef` stub, the typed
  schema, a paired error code + English catalog entry, and a copy-from test file. Since all ~100
  endpoints share one shape, this is the single highest-leverage approachability move.
- Steer handler tests to the repo's own injected-interface `FakeDb` pattern
  (`SocialService`/`SocialDb`), NOT the fragile pg-mock-by-SQL-substring idiom in
  `account_server.test.ts` (which matches SQL via `sql.includes(...)` and mis-routes silently when a
  query is reworded). Document this as THE recommended test recipe in `server/CLAUDE.md`.
- A real CONTRIBUTING flow: designate one early migration commit as the canonical linked "full diff
  that adds one authenticated endpoint" example; document the one-command local-dev story
  (`npm run db:up` on :5433, `npm run server`) and the fast inner loop (`npx vitest run
  tests/server/<domain>.test.ts`, no db:up needed for a handler unit test). Standardize handler test
  naming/location (`tests/server/<domain>.test.ts`) so a contributor finds a surface's test from the
  route name alone.
- A graduated recipe in `server/CLAUDE.md`: a MINIMAL endpoint (RouteDef + handler + one test,
  schema/middleware/error-codes omitted via the optional `RouteDef` fields) for a trivial public
  GET, and a FULL endpoint, each pointing at a real copy-from template module, so ceremony stays
  proportional and newcomers do not pattern-match the heaviest example.
- Make `requireOwned*` the documented deny-by-default for any `:id` route and have the scaffold
  attach it automatically, so the OWASP API1 BOLA check is impossible to forget and reads as one
  declarative line. Restate the root i18n rule verbatim (contributors add ENGLISH only; the
  maintainer fills locales at release) and make the parity-test failure message name the exact
  English key to add.
- Carve a handful of the backlog gaps (the missing limiters, per-route OpenAPI descriptions, missing
  ETags) into good-first-issue stubs rather than folding every gap into the maintainer's single PR.

### Execution rules (Branch by Abstraction inside one branch)

- Decompose the shared request PROLOGUE first (the IP-block check, web-login guard, IP-keyed
  rate-limit, `readBody`) into ordered middleware before migrating any endpoint. Otherwise some
  routes cannot be served old while others are new behind one seam, forcing an all-at-once swap that
  loses per-commit green. (Turnstile and CORS/OPTIONS are not part of this prologue, see 4.3 and
  4.8.)
- Keep MECHANICAL endpoint-move commits (parity-clean) separate from BEHAVIORAL commits, each
  labeled. The error-envelope flip (English prose to code + params) IS behavioral; it lands in its
  own `feat(server):` commit on a `knownDeviation` list, never smuggled into a mechanical move. Per
  quirk locked by golden-master: either preserve it as a documented `knownDeviation` or fix it in an
  explicit behavioral commit, never let the schema layer change it silently.

---

## 8. Hardening to bake in while migrating

Safe, additive improvements applied as each route moves (each asserted by a test):

- `Retry-After` + `RateLimit` headers on every 429 (4.5).
- Correct client-error status codes: oversized body -> 413, bad JSON -> 400, validation fail -> 422
  with field detail, unique-violation -> 409 (centralized in `mapError`).
- Add the missing limiters: character create/rename/delete/takeover, `POST /api/reports`.
- Security headers via the top-level wrapper (4.3), so the static/SSR/OAuth-GET surfaces are covered
  too. CSP stays a separate Report-Only task.
- One bearer resolver: closes the `/api/realms`, `/api/search`, and `perf_report` authz gap (apply
  moderation/scope uniformly; keep `/api/realms` anonymous-friendly when no token).
- Trim `/api/status` to `{ ok, realm, players_online }` (drop the unauthenticated name list).
- Fix the em-dash rate-limit strings at `main.ts:617/623/691/707` (not `ratelimit.ts`, not
  `server_i18n`), matching them to the existing comma form; the `userFacingApiError` prefix match
  (`src/main.ts:261/336`) still resolves because the prefix is unchanged. Also fix the
  operator-facing em dashes in `src/admin/i18n.locales/en_CA.ts` and its
  `i18n.resolved.generated/en_CA.ts` copy.

Per decision 5, these fixes are folded into the relevant migration batches: the `/api/status`
name-list trim ships with the public-reads batch, and the em-dash fix (plus its matcher) ships with
the account batch.

### World Market realm-scope fix

Bundled with the persistence-touching batch (decision 5), as its own labeled behavioral commit. It
is not a one-line save-path change: the literal `'market'` key is written at TWO independent sites
that must change in lockstep, `db.ts:1712` inside the `saveCharacterAndMarketState` escrow
transaction AND `db.ts:1977` via `saveWorldState`, plus the read at `db.ts:1984`; a fix touching only
`loadMarketState`/`saveMarketState` leaves the escrow path writing the global key. The backfill is
not a rename: the global blob holds listings escrow-debited from realm-scoped characters, so it must
be PARTITIONED by each seller character's realm (copying the blob to every realm duplicates escrow
items into realms whose characters never listed them) and must run BEFORE any realm first autosaves
the new key. Severity is normal-operation item loss, not a crash edge case: two realms sharing one
`DATABASE_URL` mutually clobber the single row (realm B erases realm A listings; at boot realm B
loads realm A listings referencing characters it does not have, orphaned or duplicate escrow). The
backfill is spelled out and tested.

---

## 9. Invariants and guardrails to honor

- Tiny dependency set: router, middleware, and schema are in-house. No Express/Fastify.
- NO MAGIC VALUES, anywhere. Every tunable is a NAMED constant with a single source of truth, not a
  literal inlined at a call site or re-typed across files: rate-limit limits AND windows, body byte
  caps, `page`/`pageSize` defaults + max page size, server/socket timeouts, cache TTLs, retry/backoff,
  pg pool sizes, the WS `maxPayload` (16 KiB), and the SIGTERM drain grace window. The rate-limit
  POLICIES values DERIVE from the existing named constants (`CARD_UPLOAD_MAX_PER_MINUTE`,
  `WALLET_LINK_MAX_PER_MINUTE`, `WOC_BALANCE_MAX_PER_MINUTE`, `PUBLIC_READ_MAX_PER_MINUTE`, and the
  auth/admin login limits), never a duplicated number (this prevents a policy table silently
  re-typing and drifting from the limiter it replaces). Environment-driven values are read ONCE
  through the validated, fail-fast config module (no scattered `process.env` reads). Each constant
  carries a unit and a one-line comment. A literal that appears in more than one place, or whose
  meaning a reader would have to guess, MUST become a named constant.
- `server/` imports only `src/sim/`, `src/world_api.ts`, and `node:*`. No render/ui/game/net.
- SQL only in `db.ts` and `*_db.ts` (the pg-backed limiter lives in a new `ratelimit_db.ts`).
- No migration files: any DDL is idempotent (`CREATE TABLE/INDEX IF NOT EXISTS`) under the existing
  `pg_advisory_xact_lock`.
- Server stays language-agnostic: API errors are English at source and carry a stable `code`; the
  CLIENT renders the user's selected language from the error-code catalog (see 4.7). Logs stay
  English. Every new code ships with its catalog entry (contributors add English, the maintainer
  fills all locales at release), backed by the S3 guard (`tests/localization_fixes.test.ts`) and the
  release-tier i18n gate. No `?? 'English'` fallbacks; no raw English shown to a user.
- Bearer-only, no cookies: all auth is `Authorization: Bearer` (REST, OAuth POST, admin), so classic
  CSRF is structurally absent. Keep it so; enforce `Content-Type: application/json` on `/api` JSON
  bodies (415 otherwise). Any future cookie session reopens CSRF and must be treated as such.
- No em dashes, en dashes, or emojis anywhere (the `Stop` hook blocks on them).
- No change to the WS wire protocol or `maxPayload` (16 KiB) here.
- Nothing in `src/sim/` changes. Determinism and the one-sim-three-hosts invariant are guarded by
  `tests/architecture.test.ts`.

---

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| A port silently drops a moderation check or reorders a load-bearing per-route sequence (e.g. login checks the IP block only after the account is known so admins are not locked out). | Characterization net asserts gating and ordering per route before any move. |
| Coexistence period has two routing styles at once. | It is bounded and intentional; the catch-all delegate keeps behavior identical until the last route moves. The old ladder ships behind the env flag and is deleted in the next release. |
| Single ~100-endpoint PR is hard to review and conflict-prone on a tree with concurrent sessions. | Commit-sized batches on one branch, suite green at every commit (bisectable); per-domain modules scope conflicts; the characterization net makes review about diffs. The seam splits into stacked PRs with no rework if review stalls. |
| Blanket 405 + Allow header discloses which methods exist (anti-enumeration concern on auth routes). | Decide 404-vs-405 per route; keep the deliberate 404 on register/login (knownDeviation). |
| New error codes need client-side localization across many languages. | Reuse the existing `domain.reason` key vocabulary; the client looks the code up directly in its catalog. A per-surface code-parity test plus the release-tier i18n gate enforce that every code resolves in every locale. Codes are append-only. See 4.7. |
| A blanket problem+json flip would BREAK OAuth and admin clients. | `mapError` serializes per surface (4.7), never one global shape; a contract test per surface freezes each. |
| A ported `:id` handler silently drops its ownership check (BOLA, OWASP API1). | A `requireOwned*` resource-loader seam plus a deny-by-default coverage test asserting every `:id` route resolves through an account-scoped loader (4.8). |
| Post-merge rollback. | The old dispatcher ships behind an env flag; rollback is flipping the flag back, not a revert. The flag is removed only in the next release once metrics are clean. |
| WS-auth functions are nested closures inside `main()`. | Stage 0 lifts them into an importable module (mirrors how `account.ts` was extracted), not a one-line export. |

---

## 11. Decisions

1. Module layout: seam under `server/http/`, route tables on the existing per-domain
   `server/<domain>.ts` modules, declared in one registry barrel (section 4).
2. Batch order: public reads first (lowest risk), then character ownership, account portal,
   wallet/cards/misc.
3. Sub-dispatchers: all four (main, admin, oauth, internal) in the first wave, not a deferred phase.
   Public reads still go first.
4. Rate limiter: two-tier, IN this PR. Tier-1 in-memory IP gate runs first (floods never reach pg);
   tier-2 is a global-keyed pg backstop via a new `ratelimit_db.ts` so auth limits survive restart
   and do not multiply across realm processes. Promoted from follow-up because multi-realm is
   imminent.
5. Bug fixes (market key realm-scope, em-dash strings, `/api/status` trim): folded into the relevant
   migration batches, not a separate pre-rewrite PR.
6. Delivery: ONE PR, but the old dispatcher stays behind an env flag in the shipped artifact (default
   the new path; delete the old ladders in the NEXT release once metrics are clean). Rollback is
   flipping the flag, not a full revert. If review capacity stalls, the seam splits into stacked PRs
   with no rework.
7. Error localization: every API error returns a stable `code`; the client renders the user's
   selected language from the i18n error-code catalog; server messages and logs stay English (4.7).
8. Documentation: server/CLAUDE.md, root CLAUDE.md, the new local CLAUDE.md, and the i18n docs are
   updated within the same PR.

Conventions A to I (all tiny-dep-clean, node:http/zlib/crypto + in-house):

A. Versioning: DEFERRED. Ship paths unversioned for now; adding the `/api/v1` prefix + alias set now
   would double the route table and the parity surface to guard a `/api/v2` that does not exist. Add
   `/api/v1/*` (keeping `/api/*` as v1 aliases for shipped native/companion/OAuth clients) when the
   first breaking change forces it. (`/admin/api`, `/oauth`, `/internal` keep their own prefixes.)
B. Pagination: one offset vocabulary, `page`/`pageSize`, with envelope
   `{ items, page, pageCount, total, pageSize }`, applied to every NEW list endpoint. Admin's
   existing `page`/`limit` + `{ success, data, error }` stays a frozen internal contract.
C. Compression: defer to the Cloudflare edge, which gzip/br's the API responses (confirmed
   2026-06-29). The nginx/origin layer does NOT compress, so any traffic that bypasses Cloudflare
   (direct-to-origin, internal/health checks, a non-Cloudflare deployment) is served uncompressed.
   That is acceptable for the current topology (all clients reach the API through Cloudflare), and
   the server adds NO app-layer `node:zlib` (it would waste CPU or double-encode behind the edge).
   Documented assumption: if a direct-origin consumer appears, enable nginx gzip or add a guarded
   app-layer fallback rather than silently shipping uncompressed.
D. ETag: DEFERRED to a follow-up. Cheap (a `withETag` on cacheable GETs reusing `etagFor` from
   `static_cache.ts`, returning 304) but speculative at this scale with no consumer pressure; add it
   when caching is actually needed. Good-first-issue candidate.
E. Idempotency keys: SKIP for now (name-UNIQUE covers create; dupes elsewhere are low-harm). Revisit
   if mobile double-submits show up.
F. Deprecation: DEFERRED. No routes to deprecate yet; add the `deprecated?`/`sunset?` `RouteDef`
   fields + the `Deprecation`/`Sunset` header emit when the first endpoint is retired.
G. API description: DEFERRED. A full OpenAPI document is NOT free from the schemas: Standard Schema
   v1's core is `{ version, vendor, validate }` with NO `jsonSchema` method, so it needs a
   hand-written schema-to-JSON-Schema adapter (target draft-2020-12 in a hand-assembled OpenAPI 3.1
   doc). Build it consumer-driven (companion API / `/wiki`) in a follow-up. Keep the `RouteDef`
   registry shaped so the doc can be generated later with no route-table churn.
H. Route normalization: strip a single trailing slash before matching, so `/api/x` and `/api/x/`
   both resolve.
I. Health: include `/livez` + `/readyz` in this PR. `/readyz` reports NOT-ready during the SIGTERM
   drain (so a load balancer stops routing in). A Prometheus `/metrics` exporter is recommended to
   pull forward now that Grafana is provisioned (the collection point is in this PR; the metric
   catalog and alerts are in 4.9); the broader metrics workstream follows. (`/api/status` is also
   trimmed of its name-list leak.) Note `/readyz` only gates new HTTP at the LB; the WS-aware drain
   that close-sweeps live players is in the realtime workstream (section 12).

---

## 12. Adjacent workstreams (out of scope here, tracked for sequencing)

The request-API pipeline above covers the request layer end to end (router, middleware, rate limits
including the tier-2 pg backstop, error model, security headers, BOLA, health, observability seam,
tests). The items below are NOT the request API and NOT gameplay; they are sequenced separately.

### Realtime-reliability workstream (the actual per-realm ceiling)

Independent of the 100-endpoint move; lands in its own small PR. These are the real crash/stall
vectors:

- Tick-loop error boundary: the 20 Hz loop (`game.ts:805-857`) runs `sim.tick()` inside a bare
  `setInterval` with no try/catch, so one mid-tick throw silently corrupts the shared `Sim` for
  everyone and keeps ticking. Wrap each catch-up tick in try/catch with an injectable error sink and
  a tick-error metric. This is the single highest server reliability risk and the fix is small.
- Bounded WS egress: `broadcastSnapshots`/`sendRaw` never check `bufferedAmount`, so one slow client
  can balloon memory (OOM/crash vector). Add a per-connection `bufferedAmount` budget that DROPS or
  coalesces stale snapshots (last-write-wins), at the TOP of the per-session loop before
  `sentEnts`/`lastSent` advance, snapshot-path-only, never in the shared `sendRaw` (which also
  carries non-idempotent combat/loot events).
- Per-connection WS INGRESS token bucket at the top of the message handler, plus OWASP WS handshake
  hardening (validate `Origin` against an allowlist on every upgrade; `ws` does not do this for you).
- Graceful shutdown for a WS server: `shutdown` (`main.ts:1567-1576`) has no `server.close()`, no WS
  close sweep, and no grace window, so every live player is hard-dropped on SIGTERM. Flip `/readyz`
  to 503 on SIGTERM, stop the 20 Hz broadcast, send WS close frames, drain within a bounded window,
  flush state, then exit; keep `/livez` green while the loop is responsive. (Autosave is already
  non-blocking via `void this.saveAll`; the real cost is the synchronous `serializeCharacter` CPU
  burst with no dirty-skip plus redundant full-blob writes, so the "DB stall" framing below is
  inaccurate.)
- Event-loop-lag SLI (`perf_hooks.monitorEventLoopDelay`, p95/max) + a per-tick budget metric, so
  the realtime ceiling is observable before it bites.
- Horizontal scale (named even though building it is out of scope): shard by world partition
  (realm/zone/instance), each a single-threaded process, fronted by sticky LB routing with Redis
  pub/sub for cross-process social/chat and density-triggered zone instancing as the relief valve.
  Explicit non-goal: parallelizing one `Sim` across threads or seamless server meshing. The market
  bug is a symptom that the current "all realms share one `DATABASE_URL`" topology is not isolated at
  the data layer.

### Backlog (a good backend should have these, sequenced separately)

| # | Theme | Item | Priority | Effort |
|---|---|---|---|---|
| 1 | Middleware | Typed middleware onion + one error mapper (this PR) | P1 | M |
| 2 | Rate limiting | Declarative per-endpoint policy + Retry-After/RateLimit headers (this PR) | P1 | M |
| 3 | Rate limiting | Postgres-backed auth-class limits, survive restart + multi-realm (this PR, tier-2) | P1 | M-L |
| 4 | Security | Baseline security headers + OAuth anti-clickjacking, CSP separate (this PR) | P1 | S |
| 5 | Realtime | WS egress backpressure + per-connection ingress token bucket | P1 | M |
| 6 | Observability | Structured logger + correlation id (this PR, collection seam) | P1 | M |
| 7 | Observability | `/livez`, `/readyz` (this PR); `/metrics`; trim `/api/status` name leak | P1 | S |
| 8 | Observability | Harden graceful shutdown + tick try/catch + injectable error sink | P1 | M |
| 9 | Persistence | Tune pg pool; cache + index the arena leaderboard | P1 | M |
| 10 | Persistence | Autosave dirty-skip + stagger; realm-scope the market key, bug (this PR, market part) | P1 | M |
| 11 | Testing | Make the request spine importable; add auth/dispatch tests (this PR) | P1 | M |
| 12 | Request spine | In-house table router replacing the if-ladder (this PR) | P1 | L |
| 13 | Security | Unify bearer parsing; close `/api/realms` + `/api/search` authz gap (this PR) | P1 | S |
| 14 | DX | One validated, fail-fast config module (this PR, minimal subset) | P2 | S |
| 15 | Persistence | Versioned migration ledger (needs maintainer sign-off) | P2 | M |
| 16 | Security | TOTP-at-rest encryption, password floor, session revocation | P2 | M |
| 17 | Realtime | Dirty-gate the self-state encoder + reuse scratch buffers | P2 | L |
| 18 | Persistence | Generated columns over the JSONB blob | DROPPED (premature) | - |

Caveats worth remembering when the deferred items are built:

- WS backpressure (#5): snapshots are DELTA-encoded, not idempotent. The bufferedAmount guard must
  sit at the top of the per-session loop in `broadcastSnapshots` (before `lastSent`/`sentEnts`
  advance), snapshot-path-only, never inside the shared `sendRaw`.
- Pool tuning (#9): do not set `statement_timeout` as a blanket pool option, it would abort the boot
  `CREATE INDEX` DDL run under the advisory lock. Scope it per statement. The single `max:10` pool
  also has no acquisition timeout today, so exhaustion hangs requests/saves; pull
  `connectionTimeoutMillis` + `application_name` forward.
- Self-encoder (#17): true counter-gating needs new sim-side mutation counters, so it is not a
  server-only change. Defer; the safe server-only wins are scratch-buffer reuse and short-circuiting
  eager builders.
- Migration ledger (#15): a single `pg_advisory_xact_lock` cannot span per-step transactions; it
  would need a session-level lock, and it nudges against the deliberately chosen
  inline-idempotent-DDL model. Checkpoint with the maintainer first.

---

## 13. Appendix: research sources

Current best-practice sources (2024 to 2026):

- IETF RateLimit header fields draft: https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-ratelimit-headers
- Rate-limiting algorithms (token bucket vs sliding window vs fixed window): https://blog.arcjet.com/rate-limiting-algorithms-token-bucket-vs-sliding-window-vs-fixed-window/
- Cloudflare rate-limiting best practices: https://developers.cloudflare.com/waf/rate-limiting-rules/best-practices/
- Generic middleware pattern in Node: https://evertpot.com/generic-middleware/
- OWASP API Security Top 10 (2023): https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- OWASP HTTP security headers cheat sheet: https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html
- OWASP WebSocket security cheat sheet: https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html
- Node WebSocket backpressure / flow control: https://loke.dev/blog/websockets-backpressure-websocketstream-memory
- RED/USE metrics method: https://betterstack.com/community/guides/monitoring/red-use-metrics/
- Kubernetes liveness/readiness/startup probes: https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/
- Node graceful shutdown (SIGTERM, connection draining): https://dev.to/axiom_agent/nodejs-graceful-shutdown-the-right-way-sigterm-connection-draining-and-kubernetes-fp8
- AsyncLocalStorage for request context: https://www.usamaamjid.com/blog/async-local-storage-nodejs-24
- Postgres upsert patterns (for the DB-backed limiter): https://viprasol.com/blog/postgres-upsert-patterns/
- Express alternatives / lightweight routing tradeoffs: https://betterstack.com/community/guides/scaling-nodejs/expressjs-alternatives/
- RFC 9457 Problem Details for HTTP APIs (obsoletes RFC 7807): https://www.rfc-editor.org/rfc/rfc9457.html
- Google AIP-193 (error model, structured values not prose): https://google.aip.dev/193
- Standard Schema v1 (swappable validator interface): https://github.com/standard-schema/standard-schema
- Node.js best practices (component-first, thin handlers, separate web from logic): https://github.com/goldbergyoni/nodebestpractices
- Custom middleware + router registry on raw node:http: https://oneuptime.com/blog/post/2026-01-30-how-to-implement-custom-middleware-pattern-in-nodejs/view
- Do not use URLPattern to route HTTP (static Map vs radix, ReDoS / CVE-2024-45296): https://adventures.nodeland.dev/archive/you-should-not-use-urlpattern-to-route-http/
- Koa vs Express (onion model, centralized error handling, ctx): https://github.com/koajs/koa/blob/master/docs/koa-vs-express.md
- Speakeasy: designing API errors (stable codes, domain.reason namespacing): https://www.speakeasy.com/api-design/errors
- Branch by Abstraction (Martin Fowler): https://martinfowler.com/bliki/BranchByAbstraction.html
- Characterization / golden-master tests for legacy code: https://understandlegacycode.com/blog/best-way-to-start-testing-untested-code/
- Do not mix refactorings with behavior changes: https://www.codewithjason.com/dont-mix-refactorings-behavior-changes/
