<!-- server/: the authoritative game server. Local conventions only.
     Root CLAUDE.md (architecture, the one-sim invariant, build/test) loads
     alongside this; don't repeat it here. server/ is NOT under src/. -->

# server/: authoritative game server

esbuild-bundled for Node via `npm run server` (output `dist-server`); persists to
Postgres and serves the built client from `dist/`.

## Module-first: where new server code lands
- **A new REST endpoint** is a `RouteDef` module (`server/<domain>.ts`) registered in
  `server/http/registry.ts` (recipe below), never an inline handler in `main.ts`.
- **New WS/loop-side behavior** is a sibling module, never another `GameServer`/`main.ts`
  method cluster. Pure decision logic (join rules, command parsing, rate windows) goes in a
  host-agnostic module a Vitest imports directly (exemplars: `linkdead.ts` `planJoin`,
  `moderation_commands.ts`); anything needing IO goes behind an injected deps bag or a narrow
  host interface so it tests without a DB or HTTP server (exemplars: `ws_auth.ts`
  `createWsAuth`, `moderation_service.ts`). `wallet_link.ts` (pure, IO-free) versus
  `wallet.ts` (DB+HTTP shell) is the same split for REST domains.
- **A new domain's tables** go in an exported `<DOMAIN>_SCHEMA` DDL constant in its
  `<domain>_db.ts`, applied by `ensureSchema` (`db.ts`) under the advisory lock (exemplars:
  `SOCIAL_SCHEMA`, `MAPS_SCHEMA`); only core character/account/token/world-state DDL lives
  in `db.ts` `SCHEMA` itself.
- **Tests** go in `tests/` (endpoint tests via the `FakeDb` helpers below). Bug fixes are
  test-first: a failing repro (extract the pure core if buried), then the smallest green change.

## Key files
The load-bearing seams, not an inventory (`ls server/*.ts` for the live set; a `<domain>.ts`
logic module pairs with a `<domain>_db.ts` that owns its SQL).

| File | Role |
|---|---|
| `main.ts` | HTTP server + the prefix-ladder dispatch (`routeHttpRequest` sends `/api` `/admin/api` `/oauth` `/internal` to four flag-gated entries) + the RETAINED legacy handler ladder, WS `/ws` upgrade wiring (builds the `createWsAuth` deps bag), boot/shutdown, leaderboard cache. Migrated routes live in per-domain `RouteDef` modules behind `server/http/` (see `server/http/CLAUDE.md`), NOT in a route table here |
| `game.ts` | `GameServer`: owns the `Sim`, the 50 ms loop, interest-scoped snapshots, command dispatch, chat. **Largest file; extract beside it, never grow it** (Module-first above) |
| `ws_auth.ts` | the whole WS auth handshake behind an injected deps bag (`createWsAuth`): first-frame `{t:'auth'}` check, moderation/character checks, per-IP cap, the realm admission cap (`MAX_PLAYERS_PER_REALM`, default 5000, explicit 0 disables; checked with an in-flight admission counter so racing handshakes cannot admit past it; resumes and admins exempt), lease acquire, `game.join`. Unit-testable without a DB or HTTP server. Its rejection literals are wire contract the client matches verbatim (`src/ui/api_error_i18n.ts`): change one and the matcher in the SAME commit. Every refusal sends an `{t:'error'}` frame before closing (never a bare close code): the client classifies the literal, so a frameless refusal turns into a silent retry loop |
| `ws_buffer.ts` | buffers in-flight WS frames during the async auth handshake, then replays them |
| `linkdead.ts` | pure session-lifecycle decision core: `planJoin` (resume/reject/join) + `LINKDEAD_GRACE_MS` (see Persistence) |
| `keepalive_sweep.ts` | pure self-clocked keepalive-sweep decision (`keepaliveSweepDelayed`, `KEEPALIVE_STALL_FACTOR`): a sweep that fires late (an event-loop stall) re-arms every session instead of terminating them, so one stall can never mass-disconnect the realm; a genuinely dead socket still reaps one clean interval later |
| `db.ts` | `pg` pool, core `SCHEMA` DDL + `ensureSchema`, character/account/token/world-state queries. Owns the timeout ladder (connect < statement default < the `runWithStatementTimeout` heavy allowance < the driver-side `query_timeout` backstop; constants + rationale at the top, relation pinned by `tests/server/tunables.test.ts`): wrap a known-long read in `runWithStatementTimeout`, never lift the session default, and remember `SET LOCAL` cannot lift the driver backstop. Boot DDL runs on a dedicated non-pool `Client` so schema setup is never capped |
| `auth.ts` | scrypt hashing, `newToken`, name/password validators (`obscenity` profanity) |
| `account.ts`, `totp.ts` | account self-service routes: password change/forgot/reset, verified email change, data export, TOTP 2FA (`totp.ts` is the pure RFC 6238 core) |
| `social.ts`/`social_db.ts` | friends/guilds/blocks/presence, logic / SQL |
| `admin.ts`/`admin_db.ts` | admin API + dashboard reads |
| `admin_permissions.ts`/`admin_routes.ts`/`staff_db.ts` | fine-grained admin authz: permission vocabulary + role bundles / declarative route-to-permission map (fail-closed, guarded by `tests/admin_routes.test.ts`) / `accounts.admin_roles` SQL + `admin_role_changes` audit |
| `moderation_commands.ts`/`moderation_service.ts`/`moderation_db.ts` | pure parser for the in-game moderator chat commands (`/kick` `/mute` `/ban` `/suspend` `/spectate` `/jail`, ..., with duration caps) / the moderation service behind a host interface, wired into `GameServer` / writes + unified history |
| `chat_filter.ts`/`chat_filter_db.ts` | host-agnostic profanity/slur filter (soft cosmetic + hard server-enforced tiers) / admin word-list SQL |
| `bot_detector/contract.ts` / `stub.ts` | `BotDetector` seam (`#bot-detector`): the contract interface / the no-op stub used when the private clone is absent |
| `antibot_config_db.ts` | per-realm JSONB state plus append-only audit history for the bot-detector runtime config (the admin Bot Detector > Configuration panel); validation and live apply happen inside the detector (`BotDetector.applyConfig`) |
| `turnstile.ts`, `web_login_guard.ts` | Cloudflare Turnstile siteverify / auth-endpoint Origin guard (anti-bot) |
| `realm.ts` | `REALM`, `REALM_DIRECTORY`, `REALM_ORIGINS` from `REALM_NAME`/`REALMS` env |
| `ratelimit.ts` | per-IP sliding-window limiter + `X-Forwarded-For` resolution |
| `internal.ts` | secret-gated `/internal/*` ops endpoints (e.g. restart-countdown trigger) |
| `woc_balance.ts` | the sole Solana RPC reader: holder-tier flair and connected-wallet balance, cached |
| `player_card.ts` | shareable player-card PNGs, Open Graph unfurl, referral capture |
| `bank_ledger.ts` | append-only `bank_ledger` observer: diffs `Sim.bankInfoFor` around each bank dispatch and writes the moved delta via a fire-and-forget FIFO (audited offline by `scripts/bank_audit.mjs`) |
| `bank_entitlements.ts` | pure bonus-slot source registry + `computeBankBonus` (email verified / Discord / wallet / qualified referrals); stamped at the fresh-join handshake via the injected `WsAuthDeps.bankBonusForAccount`, never client-supplied |
| `deeds_db.ts` / `deeds_records.ts` | deeds SQL boundary (`character_deeds` upserts, rarity counts, recent earns, broadcast opt-out; the board roll-up is `deedsBoardRanked` in `db.ts`, aggregated SQL-side with Renown passed as parameters) / the `deedUnlocked` observer: fire-and-forget FIFO upserts, the `isMarqueeDeed` predicate, and the env-gated Steam mirror hook (the marquee guild/friend broadcast fan-out itself lives in `game.ts`); the sim decides unlocks, this only records them |
| `deeds_board.ts` / `deeds.ts` | the Renown leaderboard's pure scoring core (account-level dedupe, entry floor, score-then-earliest tie-break; Renown values come from the content table, never SQL) / the `RouteDef` API surface (public rarity read, broadcast toggle), TTL-cached in `main.ts` |
| `steam/` | the env-gated (`STEAM_ENABLED`, off by default) Steam achievements mirror: link-not-login ticket handshake, `achievement_map.ts` (deed id to `ACH_*`, hard cap 100), publisher Web API push + reconcile-on-link |
| `daily_rewards.ts`/`daily_rewards_db.ts` | wallet-gated daily reward tasks + Discord winner announcements; participation bans live HERE, not in `moderation_db` |
| `discord.ts` (+ `discord_oauth`/`discord_db`/`discord_relay`/`discord_activity`) | Discord integration: link/unlink OAuth shell + rewards, in-game `!` community-command relay, activity feed the bot drains |
| `github.ts` (+ `github_oauth`/`github_db`/`github_contributors`) | GitHub contributor linking for the developer badge + merged-PR tally |
| `oauth.ts`/`oauth_db.ts`, `character_sheet.ts`, `profile_page.ts`, `avatar.ts` | read-only companion API: OAuth code+PKCE and device grants (scope `character:read`), pure sheet normalizer, public SEO profile pages + generated avatars |
| `maps.ts`/`maps_db.ts`/`maps_routes.ts`, `user_assets*.ts` | map editor: custom-map persistence with fork lineage / hardened player GLB uploads (both mirror the `SocialService`/`SocialDb` split) |
| `tick_profiler.ts` / `tick_rate_meter.ts` / `client_perf_metrics_db.ts` | debugging the 50 ms budget: rolling per-phase loop timings, achieved wall-clock tick rate (the two can disagree, see the meter header), capped client-perf aggregates behind `/metrics` |
| `mob_scan_tick_stats.ts` | folds the sim's per-tick mob-scan visit counters (`Sim.mobScanCounters`, observer-only) into the `PERF_TICK_LOG` heartbeat tokens (`aggroVisits=`/`threatVisits=`) and the admin tick-capture accumulators; `game.ts` keeps only the holder and the apply call |
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
- **`ALLOW_DEV_COMMANDS=1` gates `dev_level`/`dev_teleport`/`dev_give`** (dev/E2E only, **never prod**).

## Persistence model
- Character level + full state (gear/bags/bank/quests/position/money/talents/arena/lifetimeXp/
  deeds/deedStats/activeTitle/renown) stored as **JSONB** in `characters.state`;
  `serializeCharacter` converts to and from the `Sim`.
  Same-blob atomicity is the bank's anti-dupe cornerstone: the personal bank NEVER gets its own
  `world_state` row. Treat the bank rollout as forward-only (a pre-bank binary's save drops the field).
- **Per-character load lease** (`character_leases`): acquired at the WS handshake between
  `getCharacter` and `game.join` (90 s TTL, heartbeats on the autosave loop, nonce-fenced release),
  so two processes can never double-load one character. The steal predicate has three arms
  (expiry, same holder, same AUTHENTICATED account), so a player whose old process died
  reclaims their own character immediately instead of waiting out the TTL; rows with a NULL
  `account_id` fail that arm closed. Character saves are lease-fenced: both save functions
  take the session's lease nonce and land only while the row still carries it (an in-statement
  EXISTS fence, never check-then-write), and a fenced-out session is kicked with the existing
  takeover signal, so a displaced zombie can never overwrite live state. `bank_ledger` is the
  append-only per-op audit trail (`scripts/bank_audit.mjs` replays it offline).
- **Disconnect is not leave.** `linkdead.ts` holds a dropped session in-world for
  `LINKDEAD_GRACE_MS` (5 min); `planJoin` (pure, unit-tested) decides resume/reject/join, and a
  resume never re-acquires the lease. Forced disconnects (moderation, takeover, anti-bot) skip
  grace and tear down via `GameServer.leave()`. Never resume a session whose teardown has begun
  (the `left` flag): the reconnect would get a zombie whose lease is released under it.
- Save cadence: autosave every **30 s** (`AUTOSAVE_SECONDS`), on `leave`, and on
  `SIGINT`/`SIGTERM` shutdown (`saveAll`). World Market is a per-realm JSONB row (`world_state`
  key `market:<realm>`), realm-scoped like everything else; the one-shot legacy `'market'` row
  backfill lives in `server/market_backfill.ts`, its rollback story in
  `docs/api-pipeline/phase-20-rollback-runbook.md`.
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
- Sign-in surfaces beyond password: Apple native sign-in (`apple_auth.ts`/`apple_auth_db.ts`),
  the native-app Discord login handoff (`native_discord_handoff.ts`), Electron desktop login
  codes (`desktop_login.ts`/`desktop_login_routes.ts`), and the companion OAuth grants
  (`oauth.ts`). Native apps must present a platform attestation (`native_attestation.ts`);
  the Electron `app://` desktop origins bypass Turnstile by Origin header alone, a deliberate,
  documented softening (see the `passesTurnstile` header in `turnstile.ts`).
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
  with `maybe(...)`; the delta keys and their terse-key to IWorld-name mapping are
  pinned by `ALL_DELTA_KEYS` + `TERSE_TO_IWORLD` in `tests/snapshots.test.ts` (W0a),
  which owns the list and guards the `selfWireJson` (encode) to `applySnapshot`
  (decode) round-trip. A new heavy self field lands in `selfWireJson` (here) and
  `applySnapshot` (`online.ts`) in one commit, and is added to that registry.

- The PHYSICAL `game.ts` restructure (facet-ordered dispatch, per-facet command
  modules, a facet-aligned encoder) is workstream #4; until it lands, add new
  commands inline as above. Scope and ownership:
  `docs/refactor/world-api-to-server-runtime-handoff.md`.

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
