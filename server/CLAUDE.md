<!-- server/: the authoritative game server. Local conventions only.
     Root CLAUDE.md (architecture, the one-sim invariant, build/test) loads
     alongside this; don't repeat it here. server/ is NOT under src/. -->

# server/: authoritative game server

esbuild-bundled for Node via `npm run server` (output `dist-server`); persists to
Postgres and serves the built client from `dist/`.

## Key files
| File | Role |
|---|---|
| `main.ts` | HTTP server + route table, REST `/api/*`, WS `/ws` upgrade + auth handshake, boot/shutdown, leaderboard cache |
| `game.ts` | `GameServer`: owns the `Sim`, the 50 ms loop, interest-scoped snapshots, command dispatch, chat. **Largest file** |
| `db.ts` | `pg` pool, `SCHEMA` DDL, all character/account/token/world-state queries |
| `auth.ts` | scrypt hashing, `newToken`, name/password validators (`obscenity` profanity) |
| `social.ts`/`social_db.ts` | friends/guilds/blocks/presence, logic / SQL |
| `admin.ts`/`admin_db.ts`, `moderation_db.ts` | admin API + dashboard reads / moderation writes |
| `chat_filter.ts`/`chat_filter_db.ts` | host-agnostic profanity/slur filter (soft cosmetic + hard server-enforced tiers) / admin word-list SQL |
| `bot_detector/contract.ts` / `stub.ts` | `BotDetector` seam (`#bot-detector`): the contract interface / the no-op stub used when the private clone is absent |
| `turnstile.ts`, `web_login_guard.ts` | Cloudflare Turnstile siteverify / auth-endpoint Origin guard (anti-bot) |
| `realm.ts` | `REALM`, `REALM_DIRECTORY`, `REALM_ORIGINS` from `REALM_NAME`/`REALMS` env |
| `ratelimit.ts` | per-IP sliding-window limiter + `X-Forwarded-For` resolution |
| `internal.ts` | secret-gated `/internal/*` ops endpoints (e.g. restart-countdown trigger) |
| `ws_buffer.ts` | buffers in-flight WS frames during the async auth handshake, then replays them |
| `woc_balance.ts` | the sole Solana RPC reader: holder-tier flair and connected-wallet balance, cached |
| `player_card.ts` | shareable player-card PNGs, Open Graph unfurl, referral capture |
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
- Character level + full state (gear/bags/quests/position/money/talents/arena/lifetimeXp)
  stored as **JSONB** in `characters.state`; `serializeCharacter` converts to and from the `Sim`.
- Save cadence: autosave every **30 s** (`AUTOSAVE_SECONDS`), on `leave`, and on
  `SIGINT`/`SIGTERM` shutdown (`saveAll`). World Market is one global JSONB row (`world_state` key `'market'`).
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
  with `maybe(...)`; the 25 such keys plus their terse-key to IWorld-name mapping are
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
