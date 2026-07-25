# bot/: World of ClaudeCraft Discord bot

A standalone Node process (separate from the game server) that bridges the
official Discord server and the game two ways:

- **In Discord:** `/whoami` (link status + reward points) and `/link` (connect
  instructions); status-tier roles + a level-on-name nickname synced from in-game
  data (the `/flex` command was removed; `FlexData` survives because the role-sync
  poll reads it); in-game "!" community posts relayed as embeds with a respond
  deep-link button; a significant-activity feed (max level, rare drops, duels,
  arena); daily-rewards top-10 winner posts; a member reward on guild join
  (server-deduped; no welcome message is posted, intentionally quiet).
- **Into the game:** presence (online count + the featured voice room) and member
  metadata (guild join date + top staff role) pushed to the server, which renders
  the HUD Discord widget and the in-world name color + role tag.

Built like the server: `npm run bot` (esbuild bundle to `dist-bot/bot.cjs`, then run).
Zero new dependencies: Gateway over the existing `ws`, REST via built-in `fetch`.

## Files (one line each; each file's header comment is the reference)
- `logic.ts`: **pure, IO-free** protocol/diff/message-builder logic. Unit-tested in
  `tests/discord_bot.test.ts`.
- `gateway.ts`: ws Gateway (v10) IO shell (HELLO/heartbeat, IDENTIFY, RESUME).
- `discord_api.ts`: thin Discord REST client (bot-token authed).
- `server_client.ts`: client for the game server's secret-gated `/internal/discord/*`
  endpoints (`x-woc-discord-secret`); grep `/internal/discord/` there for the live set.
- `config.ts`: env to `BotConfig` (throws on missing required).
- `main.ts`: wiring only: guild state seeded from `GUILD_CREATE` (plus the op 8
  member backfill for large guilds), kept live by the `GUILD_MEMBER_*` events,
  event dispatch, the poll loops.

## New bot feature recipe (module-first)
1. Pure message-builder/diff/shaping logic in `logic.ts`, with a test in
   `tests/discord_bot.test.ts`. Bug fixes are test-first: a failing test that
   reproduces the bug, then the smallest change that turns it green.
2. If it talks to the game: a method in `server_client.ts` plus the matching
   secret-gated `RouteDef` in `server/internal.ts` (registered via `server/http/registry.ts`).
3. Only the wiring (a dispatch case or a poll loop) lands in `main.ts`.

## Invariants
- **The game server is the authority for rewards.** The bot never computes points
  or status; it reads them and pushes grants the server validates (dedupe keys).
  Discord (gateway/REST) state lives only here.
- **Pure/IO split** (like `wallet_link.ts` vs `wallet.ts`): protocol/diff/embed
  logic in `logic.ts` (tested), ws/fetch IO in the shells. Don't inline opcode or
  role-diff logic into `gateway.ts`/`main.ts`.
- **Secrets are env only**; never commit them. `DISCORD_BOT_SECRET` must match the server's.
- **Privileged intents:** `GUILD_MEMBERS` + `GUILD_PRESENCES` must be enabled for the
  application in the Discord developer portal, or IDENTIFY is rejected (close 4014).

## Poll loops (all wired in main.ts)
- Role sync + members-meta push: every `ROLE_SYNC_INTERVAL_MS` (5 min), plus once on
  `GUILD_CREATE`. Tier-role refresh + special-roles refresh: once at startup (before the
  gateway connects) and every 5 min, NOT on `GUILD_CREATE`. The same sync also
  sets the level-on-name nickname (`buildLevelNick`; the base name fallback can be
  the member's own already-suffixed live nick, so `buildLevelNick` strips any
  existing suffix first to stay idempotent across re-syncs;
  `DISCORD_SYNC_NICKNAMES=0` disables).
- Presence push: debounced `PRESENCE_DEBOUNCE_MS` (4 s) after voice/presence events.
- Relay, activity feed, daily-rewards winners: drained every `RELAY_POLL_MS` (3 s).
  Daily-rewards days are marked back on the server only after a successful post,
  so a failed post retries (at-least-once).
- Daily engagement grant: first message or voice-join per member per day, deduped
  bot-side AND server-side (grant dedupe key), so it is exactly-once.

## Roles
- **Status tiers** (`WoC Initiate` up to `WoC Mythic`; ladder in
  `src/sim/discord_tier.ts`) are auto-provisioned at startup with per-rung colors
  (needs MANAGE_ROLES; idempotent). Without that permission, missing rungs are
  logged and skipped: create them by hand only in that case. A member holds
  exactly the role for their current rung (`computeRoleSync`).
- **Staff/special roles** (e.g. Levy St, Core Dev, Mods) live in the shared catalog
  `src/sim/discord_roles.ts`, matched by exact name or alias (case-insensitive);
  the member's top-priority role is pushed via members-meta and drives the
  in-world name color + tag. Grants and revokes are observed live
  (`GUILD_MEMBER_UPDATE` re-pushes that member's meta immediately), and EVERY
  guild role id matching a catalog key is indexed, so duplicate-named roles
  (an `Admin` and an `Admins`) both resolve. **A guild-side rename silently
  breaks the match**: add an alias to the catalog instead of renaming.

## Env (see .env.example; the live set is `grep process.env bot/config.ts`)
Required: `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`,
`DISCORD_BOT_SECRET`. Optional: `GAME_SERVER_URL`, `PUBLIC_GAME_URL`,
`DISCORD_VOICE_CHANNEL_ID` (featured voice room), `DISCORD_TEST_CHANNEL_ID`
(one-time startup announcement), `DISCORD_RELAY_CHANNEL_ID` (falls back to test),
`DISCORD_ACTIVITY_CHANNEL_ID` (falls back to relay, then test),
`DISCORD_DAILY_REWARDS_CHANNEL_ID`, `DISCORD_SYNC_NICKNAMES` (`0` disables, default
on). `DISCORD_WELCOME_CHANNEL_ID` is read but currently unwired (no welcome message
is posted). Boot loads `.env`/`.env.local` when present but runs fine from ambient
env alone (`process.loadEnvFile`).

## Limits / notes
- Guild state is seeded from `GUILD_CREATE` and then kept live: `GUILD_MEMBER_ADD`
  seeds a joiner's roles/join date, `GUILD_MEMBER_UPDATE` reconciles a member's
  role set (so a role granted or revoked after boot reflects on the next push), and
  `GUILD_MEMBER_REMOVE` clears their stored flair. Guilds above the IDENTIFY
  `large_threshold` (250, the gateway max) omit offline members from
  `GUILD_CREATE`, so the bot backfills the full roster with
  `REQUEST_GUILD_MEMBERS` (op 8, streamed back as `GUILD_MEMBERS_CHUNK`). After
  every COMPLETE seed it also reconciles stored flair against the roster
  (`/internal/discord/flaired-ids`), clearing members who left while the bot was
  offline. Member-meta pushes are batched by BYTES (`MEMBERS_META_BATCH`), sized
  so a worst-case batch stays under the server's 64 KiB JSON body cap; the
  server's 1000-entry slice is defense in depth, never the binding constraint.
- "Speaking" indicators are not live (that needs a voice-gateway connection); the
  voice list shows membership + self-mute.
