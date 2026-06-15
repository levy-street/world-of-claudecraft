<!-- server/ — the authoritative game server. Local conventions only.
     Root CLAUDE.md (architecture, the one-sim invariant, build/test) loads
     alongside this; don't repeat it here. server/ is NOT under src/. -->

# server/ — authoritative game server

Node HTTP + WebSocket server that runs the **one shared `src/sim` `Sim`** per realm,
persists to Postgres, and serves the built client. esbuild-bundled for Node via
`npm run server` (→ `dist-server`); the client is served from `dist/`.

## Key files
| File | Role |
|---|---|
| `main.ts` (~550) | HTTP server + route table, REST `/api/*`, WS `/ws` upgrade + auth handshake, boot/shutdown, leaderboard cache |
| `game.ts` (~1120) | `GameServer`: owns the `Sim`, the 50 ms loop, interest-scoped snapshots, command dispatch, chat. **Largest file** |
| `db.ts` (~500) | `pg` pool, `SCHEMA` DDL, all character/account/token/world-state queries |
| `auth.ts` (~126) | scrypt hashing, `newToken`, name/password validators (`obscenity` profanity) |
| `social.ts`/`social_db.ts` | friends/guilds/blocks/presence — logic / SQL |
| `admin.ts`/`admin_db.ts`, `moderation_db.ts` | admin API + dashboard reads / moderation writes |
| `realm.ts` (~73) | `REALM`, `REALM_DIRECTORY`, `REALM_ORIGINS` from `REALM_NAME`/`REALMS` env |
| `ratelimit.ts` (~71) | per-IP sliding-window limiter + `X-Forwarded-For` resolution |
| `chat_log.ts`, `http_util.ts`, `static_cache.ts`, `report_target.ts` | batched chat logging, JSON/body helpers, ETag caching, report-target resolution |

## Invariants — YOU MUST keep these
- **Trust nothing from the client.** Movement intent + `cmd`s arrive over WS;
  every combat/loot/quest/economy/talent outcome resolves *inside the `Sim`*.
  `dispatchMessage` (game.ts) type-checks each field before calling a `sim.*`
  method — keep that guarding when you add a command.
- **Wire protocol lockstep with `src/net/online.ts`.** Server sends `hello` /
  `snap` (with `self`/`ents`/`keep`) / `events` / `social` / `error`; client
  first sends `{t:'auth',token,character}`. Any wire change must land in both files together.
- **No browser/render/ui imports.** This bundles for Node — import only from
  `src/sim/`, `src/world_api.ts`, and `node:*`. Never from `render/`/`ui/`/`game/`/`net/`.
- **SQL lives only in `db.ts` and `*_db.ts`.** Logic modules (`game.ts`,
  `social.ts`, `admin.ts`) carry zero raw SQL — `SocialService` talks to a
  `SocialDb` interface so tests use an in-memory fake. Don't inline `pool.query` in a logic module.
- **`ALLOW_DEV_COMMANDS=1` gates `dev_level`/`dev_teleport`/`dev_give`** — dev/E2E only, **never prod**.

## Persistence model
- Character level + full state (gear/bags/quests/position/money/talents/arena/lifetimeXp)
  stored as **JSONB** in `characters.state`; `serializeCharacter` ⇄ `Sim`.
- Save cadence: autosave every **30 s** (`AUTOSAVE_SECONDS`), on `leave`, and on
  `SIGINT`/`SIGTERM` shutdown (`saveAll`). World Market is one global JSONB row (`world_state` key `'market'`).
- **Character names are globally `UNIQUE`** (catch `23505` → 409 "name taken").
- Leaderboards (`topLifetimeXp`, `topArenaRatings`) sort on JSONB expressions and
  are read through the **in-memory cache in main.ts** — never per-request under load.

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
1. Add a `case` in `dispatchMessage` (game.ts), validating every field, then call
   the `sim.*` method that owns the rule. 2. If it changes self-state the client
   reads, surface it via `selfWireJson` (use `maybe(...)` for heavy fields that
   ride only on change). 3. Mirror the wire shape in `src/net/online.ts`. 4. Add a Vitest.

## Never do this here
- Never resolve gameplay (damage, drops, gold, XP) on the server outside the `Sim`.
- Never widen WS `maxPayload` (16 KiB) or skip field validation — one socket must not be able to crash the loop or OOM the process.
