<!-- server/: the authoritative game server. Local conventions only.
     Root CLAUDE.md (architecture, the one-sim invariant, build/test) loads
     alongside this; don't repeat it here. server/ is NOT under src/. -->

# server/: authoritative game server

esbuild-bundled for Node via `npm run server` (output `dist-server`); persists to
Postgres and serves the built client from `dist/`.

## Key files
| File | Role |
|---|---|
| `main.ts` | HTTP server + the prefix-ladder dispatch (`routeHttpRequest` sends `/api` `/admin/api` `/oauth` `/internal` to four flag-gated entries) + the RETAINED legacy handler ladder, WS `/ws` upgrade + auth handshake, boot/shutdown, leaderboard cache. Migrated routes live in per-domain `RouteDef` modules behind `server/http/` (see `server/http/CLAUDE.md`), NOT in a route table here |
| `game.ts` | `GameServer`: owns the `Sim`, the 50 ms loop, interest-scoped snapshots, command dispatch, chat. **Largest file** |
| `db.ts` | `pg` pool, `SCHEMA` DDL, all character/account/token/world-state queries |
| `auth.ts` | scrypt hashing, `newToken`, name/password validators (`obscenity` profanity) |
| `social.ts`/`social_db.ts` | friends/guilds/blocks/presence, logic / SQL |
| `admin.ts`/`admin_db.ts`, `moderation_db.ts` | admin API + dashboard reads / moderation writes |
| `admin_permissions.ts`/`admin_routes.ts`/`staff_db.ts` | fine-grained admin authz: permission vocabulary + role bundles / declarative route-to-permission map (fail-closed, guarded by `tests/admin_routes.test.ts`) / `accounts.admin_roles` SQL + `admin_role_changes` audit (docs/prd/admin-permissions.md) |
| `chat_filter.ts`/`chat_filter_db.ts` | host-agnostic profanity/slur filter (soft cosmetic + hard server-enforced tiers) / admin word-list SQL |
| `bot_detector/contract.ts` / `stub.ts` | `BotDetector` seam (`#bot-detector`): the contract interface / the no-op stub used when the private clone is absent |
| `antibot_config_db.ts` | per-realm JSONB state plus append-only audit history for the bot-detector runtime config (the admin Bot Detector > Configuration panel); validation and live apply happen inside the detector (`BotDetector.applyConfig`), replayed in `startServer()` right after the first `liveGame()` touch (next to `configureAdminRuntime`) |
| `turnstile.ts`, `web_login_guard.ts` | Cloudflare Turnstile siteverify / auth-endpoint Origin guard (anti-bot) |
| `realm.ts` | `REALM`, `REALM_DIRECTORY`, `REALM_ORIGINS` from `REALM_NAME`/`REALMS` env |
| `ratelimit.ts` | per-IP sliding-window limiter + `X-Forwarded-For` resolution |
| `internal.ts` | secret-gated `/internal/*` ops endpoints (e.g. restart-countdown trigger) |
| `ws_buffer.ts` | buffers in-flight WS frames during the async auth handshake, then replays them |
| `woc_balance.ts` | the sole Solana RPC reader: holder-tier flair and connected-wallet balance, cached |
| `player_card.ts` | shareable player-card PNGs, Open Graph unfurl, referral capture |
| `bank_ledger.ts` | append-only `bank_ledger` observer: diffs `Sim.bankInfoFor` around each bank dispatch and writes the moved delta via a fire-and-forget FIFO (audited offline by `scripts/bank_audit.mjs`) |
| `bank_entitlements.ts` | pure bonus-slot source registry + `computeBankBonus` (email verified / Discord / wallet / qualified referrals); stamped at the fresh-join handshake via the injected `WsAuthDeps.bankBonusForAccount`, never client-supplied |
| `perf_report.ts` / `provider_usage.ts` | rate-limited client perf-report ingestion / process-local provider and usage telemetry for the admin dashboard |

## Invariants, YOU MUST keep these
- **Trust nothing from the client.** Movement intent + `cmd`s arrive over WS;
  every combat/loot/quest/economy/talent outcome resolves *inside the `Sim`*.
  `dispatchMessage` (game.ts) type-checks each field before calling a `sim.*`
  method, keep that guarding when you add a command.
- **Wire protocol lockstep with `src/net/online.ts`.** Server sends `hello` /
  `snap` (with `self`/`ents`/`keep`) / `events` / `social` / `error`; client
  first sends `{t:'auth',token,character}`. Any wire change must land in both files together.
- **No browser/render/ui imports.** This bundles for Node, import only from
  `src/sim/`, `src/world_api.ts`, and `node:*`. Never from `render/`/`ui/`/`game/`/`net/`.
- **SQL lives only in `db.ts` and `*_db.ts`.** Logic modules (`game.ts`,
  `social.ts`, `admin.ts`) carry zero raw SQL: `SocialService` talks to a
  `SocialDb` interface so tests use an in-memory fake. Don't inline `pool.query` in a logic module.
  `wallet_link.ts` (pure, IO-free, unit-testable without a DB) versus `wallet.ts` (DB+HTTP shell) is the canonical IO/pure split to copy, mirroring `chat_filter.ts`/`chat_filter_db.ts` and `SocialService`/`SocialDb`.
- **`ALLOW_DEV_COMMANDS=1` gates `dev_level`/`dev_teleport`/`dev_give`** (dev/E2E only, **never prod**).

## Persistence model
- Character level + full state (gear/bags/bank/quests/position/money/talents/arena/lifetimeXp)
  stored as **JSONB** in `characters.state`; `serializeCharacter` converts to and from the `Sim`.
  Same-blob atomicity is the bank's anti-dupe cornerstone: the personal bank NEVER gets its own
  `world_state` row. Treat the bank rollout as forward-only (a pre-bank binary's save drops the field).
- **Per-character load lease** (`character_leases`): acquired at the WS handshake between
  `getCharacter` and `game.join` (90 s TTL, heartbeats on the autosave loop, nonce-fenced release),
  so two processes can never double-load one character. `bank_ledger` is the append-only per-op
  audit trail (`scripts/bank_audit.mjs` replays it offline).
- Save cadence: autosave every **30 s** (`AUTOSAVE_SECONDS`), on `leave`, and on
  `SIGINT`/`SIGTERM` shutdown (`saveAll`). World Market is a per-realm JSONB row (`world_state` key `market:<realm>`), realm-scoped like everything else; a pre-scoping bare `'market'` row is migrated by a one-shot per-seller-realm partitioned backfill (`server/market_backfill.ts`) that `ensureSchema` runs under the advisory lock, recording completion in the `'market_backfill_done'` marker row and RETAINING the legacy `'market'` row for rollback (see `docs/api-pipeline/phase-20-rollback-runbook.md`). Market writes are gated at boot until that marker is confirmed.
- **Character names are globally `UNIQUE`** (catch `23505`, return 409 "name taken").
- Leaderboards (`topLifetimeXp`, `topArenaRatings`) sort on JSONB expressions and
  are read through the **in-memory cache in main.ts**, never per-request under load.

## Realms / auth / limits
- **One process = one realm.** Characters/friends/guilds/presence are scoped to
  `REALM`; every realm process shares one `DATABASE_URL`. Schema setup is
  serialized behind a `pg_advisory_xact_lock` (concurrent boots).
- Auth: scrypt + bearer token (`auth_tokens`, 64-hex). REST uses
  `Authorization: Bearer`; WS authenticates via the first message. Banned/suspended
  accounts blocked at both entry points (`moderationStatusForAccount`).
- Rate limiting: `rateLimited(req)` on register/login + admin login. Behind a proxy
  set `TRUSTED_PROXY_IPS`; otherwise private/loopback sources are trusted to set XFF.

## Adding a typical command
1. Add the wire token to the shared `COMMAND_NAMES` table in `src/world_api.ts`
   (append-only; both `game.ts` and `online.ts` import it), then add the matching
   `case` in `dispatchMessage` (game.ts), validating every field, then call the
   `sim.*` method that owns the rule. A server-only case the client never sends (a
   `dev_*` cheat, an `enter_crypt`/`leave_crypt` legacy alias, the `social_refresh`
   push, the RL-only `targetNearest`) goes on the `DISPATCH_ONLY_COMMANDS` allowlist
   in `src/world_api.ts` instead, so the send-subset check stays green. 2. If it
   changes self-state the client reads, surface it via `selfWireJson` (use `maybe(...)`
   for heavy fields that ride only on change). 3. Mirror the wire shape in
   `src/net/online.ts`. 4. Add a Vitest. Command-schema lockstep is pinned by
   `tests/command_schema.test.ts` (W0b).

- **Delta-key registry.** The heavy self fields `selfWireJson` may omit are written
  with `maybe(...)`; the 35 such keys plus their terse-key to IWorld-name mapping are
  pinned by `ALL_DELTA_KEYS` + `TERSE_TO_IWORLD` in `tests/snapshots.test.ts` (W0a),
  which guards the `selfWireJson` (encode) to `applySnapshot` (decode) round-trip. A
  new heavy self field lands in `selfWireJson` (here) and `applySnapshot` (`online.ts`)
  in one commit, and is added to that registry.

- **Workstream #4 inherits this command + encoder surface.** Workstream #3 (the World
  API refactor) made the `CommandName` table and the 20-facet `IWorld` real; the
  PHYSICAL `game.ts` restructure is workstream #4. #4 owns reordering the
  `dispatchMessage` switch into facet sections, extracting per-facet command modules,
  and grouping/extracting the `selfWireJson` encoder into a facet-aligned encoder.
  Until #4 lands, add new commands inline as above. See
  `docs/refactor/world-api-to-server-runtime-handoff.md` for exactly what #4 inherits
  and owns.

## The REST request pipeline (`server/http/`)
Every REST surface (`/api`, `/oauth`, `/admin/api`, `/internal`) runs through the in-house
pipeline under `server/http/` (its own `CLAUDE.md` is the spine reference). `main.ts` is a
prefix ladder: `routeHttpRequest` sends each prefix to one of four flag-gated entries
(`apiEntry` / `adminApiEntry` / `oauthApiEntry` / `internalApiEntry`), each built by
`selectApiEntry`. Under `API_DISPATCH=new` (the default) a matched `RouteDef` from the registry
runs the middleware onion; an unmatched path (and HEAD) delegates to the retained legacy handler
for that prefix. `API_DISPATCH=legacy` is the one-flag rollback to the old ladder. A migrated
route is served by BOTH arms until the ladder-deletion follow-up, so any behavior edit to one twin
MUST land in the other in the SAME change (the flag model, the `RouteDef`/envelope contract, and
this dual-edit rule live in `server/http/CLAUDE.md`).

## Adding an endpoint (REST)
0. **Scaffold it.** `npm run new:endpoint -- --domain <slug> --method <METHOD> --path </api/...>
   [--public]` (`scripts/new_endpoint.mjs`) emits the `RouteDef` stub in a domain module, a typed
   `Infer`-derived schema (`server/http/schema.ts` combinators), a paired error code appended to
   `error_codes.ts`, the English `apiError.*` catalog entry plus its `API_ERROR_KEYS` client
   mapping, and a `FakeDb`-based test. It auto-attaches a `requireOwned` loader on a `:id` route
   unless `--public`.

Then fill the handler in by rung (real reference commits, reference by hash + module):
1. **Public read:** commit c07d677af, `server/leaderboard.ts`. Shows a static `export const routes`
   array, a `configure<Domain>Runtime` injection (avoids an import cycle), lenient query decoders,
   and `meta.publicRead` on an intentional public `:param`.
2. **Authenticated:** commit 14275d39e, `server/auth_routes.ts`. The canonical "add one
   authenticated endpoint" example.
3. **Owner-gated `:id`:** commit 5bba9353e, `server/characters.ts`. Uses the `requireOwned` loader
   (`server/http/middleware/require_owned.ts`) with `meta.requireOwned`; denial is 404
   (anti-enumeration); order is the auth guard, then the per-action limiter, then `withBody`, then
   `requireOwned<X>`, then the handler.

Register the domain's `routes` in `server/http/registry.ts` (import + spread into `apiRoutes`); the
registry sorts most-specific-first and runs the BOLA-shadow guard at build time.

## Error localization: emit the CODE, never English
A REST handler raises an `HttpError` (`server/http/errors.ts`) carrying a stable `<domain>.<reason>`
code appended to `server/http/error_codes.ts`, NEVER English prose (the server stays
language-agnostic). The client localizes code-first: `userFacingApiError` (`src/ui/api_error_i18n.ts`)
maps a code verbatim to `apiError.<domain>.<reason>`, English source in
`src/ui/i18n.catalog/api_error.ts`; `tests/api_error_code_parity.test.ts` fails a server code with no
client key. Contributors add English only, same as the WS emits above. A new `apiError.*`
English leaf that is wordy (any word of 4+ letters, i.e. most real prose) also needs its five
non-Latin fills (`zh`, `zh_TW`, `ja`, `ko`, `ru`) in the same change, or M16
(`tests/i18n_completeness.test.ts`) reds; `npm run new:endpoint` prints this reminder for the
leaf it appends.

## Endpoint tests: FakeDb, not a pg-mock
Test a migrated endpoint through its `routes` + `configure<Domain>Runtime` + the
`tests/server/helpers/` barrel: `fakeCtx` builds a well-formed frozen `Ctx` with a `FakeRes`, and
`FakeCharactersDb`/`FakeLeaderboardDb`/`FakeReportsDb` are type-only fakes with zero runtime `pg`.
Exemplar: `tests/server/leaderboard.test.ts` (unit-tests the pure read functions with a `FakeDb`,
then drives handlers via `routes` + `configureLeaderboardRuntime` + `fakeCtx`). This REPLACES the old
`vi.mock('../server/db')` + `sql.includes()` idiom for NEW endpoint tests.

## i18n: player-facing text is English at the source
- Like the sim, `server/` is **language-agnostic** (no `t()`, no DOM). `game.ts` emits
  English literals in `type:'log'|'error'` events (and forwards the sim's `'loot'`
  events), via `sendChatNotice(session, text)`, and via `broadcastSystem(text)`. The
  client re-localizes at the boundary: most
  strings through `src/ui/server_i18n.ts` (`localizeServerText`: an `EXACT` map + ordered
  `RULES` + a `RESTART_MESSAGES` table), a few (chat-rate limit, etc.) through the hud's
  own `localizeErrorText`/`localizeSystemText` arms. Durations re-localize via
  `localizeServerDuration`, which maps `formatDuration` output (`"5 minutes"`, `"1 hour"`,
  ...) onto the `time.*` keys. **Add the matcher entry in the same change** as a new emit.
- The **S3 guard** (`tests/localization_fixes.test.ts`) scans `game.ts` emit literals
  (`type/text`, ternary `text:`, `sendChatNotice`). It is **blind** to variable-routed
  emits (`broadcastSystem(step.text)` for the `RESTART_COUNTDOWN_STEPS`, the
  `chatMuteMessage()` return) and to `?? 'literal'` fallbacks, so localize those
  deliberately and back them with a dedicated test.
- `server_i18n.ts`'s `DICT` carries **explicit per-dialect entries** (`es_ES`, `fr_CA`,
  `en_CA`) as first-class keys, resolved at runtime by `getLanguage()` with no
  base-collapse: a new key needs a value in every locale block (`en_CA` stays English).

## Never do this here
- Never resolve gameplay (damage, drops, gold, XP) on the server outside the `Sim`.
- Never widen WS `maxPayload` (16 KiB) or skip field validation: one socket must not be able to crash the loop or OOM the process.
