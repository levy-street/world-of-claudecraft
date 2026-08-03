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

**This directory is typechecked TWICE.** The repo-wide `npm run check:ts` includes `bot/`
under the browser lib, and `npm run check:ts:bot` (`tsconfig.bot.json`, chained into
`npm run check:types`) re-checks it with `lib: ES2022` and `types: node` alone. The second
pass is the one that matters here: esbuild bundles a DOM global without complaint and the
bot then dies at runtime in Node, which the repo-wide check cannot see because its lib
includes `DOM` for the game client. Nothing in `bot/` may depend on a browser global.

## Files (one line each; each file's header comment is the reference)
- `logic.ts`: **pure, IO-free** protocol/diff/message-builder logic. Unit-tested in
  `tests/discord_bot.test.ts`, except the diff-before-write predicates
  (`nicknameNeedsWrite`, `memberMetaChanged`/`changedMemberMeta`, `isSelfNickEcho`), which
  are pinned in `tests/discord_bot_diffs.test.ts` beside the write paths they serve.
- `gateway.ts`: ws Gateway (v10) IO shell (HELLO/heartbeat, IDENTIFY, RESUME). A FATAL
  close code (`isFatalCloseCode` in `logic.ts`) now EXITS the process with 1 rather than
  parking a live process that syncs nothing: every one of those codes needs a human (a
  rotated token, an intent switched off in the developer portal), so the restart policy
  is what should decide, and the visible crash loop is the intended outcome (R13; no
  retry limiter, no backoff, no supervisor here). `process.exit` is the third injected
  trailing seam, after the socket factory and the timers.
  Tested in `tests/discord_bot_gateway.test.ts`.
- `rate_governor.ts`: **pure, IO-free** Discord rate-limit governor. Owns ALL REST
  pacing: serialized FIFO queues keyed by the PROVISIONAL route template, rate state
  keyed by the `X-RateLimit-Bucket` hash PAIRED WITH the major parameter (the hash alone
  names a route shape, not one bucket: Discord documents it as non-inclusive of the
  top-level resource, so two channels share a hash and not a limit), proactive gating at
  `Remaining == 0`, the global pause (full `retry_after`, no ceiling), the Cloudflare ban
  pause on a non-JSON 429, the invalid-request breaker, the permanent-failure cache
  (400, 401 and 403 for a subject-keyed request), and the Phase 8
  counters. A 400 enters that cache but deliberately does NOT spend breaker budget:
  the breaker counts against Discord's own invalid-request ban threshold, which counts
  401, 403 and 429 and never 400. Only the rate state is remapped; the queues are
  never re-keyed, which is what makes the remap safe mid-flight. Time is injected; it reads no clock.
- `discord_api.ts`: thin Discord REST client (bot-token authed), an IO shell over the
  governor. Also owns the governor's production IO (`systemGovernorClock`,
  `consoleGovernorLog`) and `governorFromConfig`, the ONE construction site for a
  production governor: `main.ts` calls it, and `DiscordApi`'s own default routes through
  it. Every dispatched call carries an abort deadline (`DISCORD_CALL_TIMEOUT_MS`), armed
  INSIDE the send callback so it times Discord's answer and never the governor's queue
  wait. Tested in `tests/discord_bot_discord_api.test.ts`.
- `server_client.ts`: client for the game server's secret-gated `/internal/discord/*`
  endpoints (`x-woc-discord-secret`); grep `/internal/discord/` there for the live set.
  Tested in `tests/discord_bot_server_client.test.ts`.
- `config.ts`: env to `BotConfig` (throws on missing required). Tested in
  `tests/discord_bot_config.test.ts`.
- `cadence.ts`: the poll-loop interval DEFAULTS, importable without booting `main.ts`.
  `config.ts` layers the D13 env overrides over them; `main.ts` reads the resolved
  `BotConfig` fields, never these constants.
- `scheduler.ts`: the loop scheduler. A **pure, IO-free** decision core (overlap guard,
  coalescing kicks, jitter, the adaptive active-to-idle backoff) plus a thin driver that
  owns the one timer. Chained timeouts, never `setInterval`. NOT IO-free as a whole, unlike
  `logic.ts` and `rate_governor.ts`: `LoopScheduler` calls `setTimeout`/`clearTimeout` and
  defaults its random source to `Math.random`, both as injected trailing parameters with
  forwarding production defaults. Tested in `tests/discord_bot_scheduler.test.ts` against
  the virtual clock.
- `member_writes.ts`: the diff-before-write paths (nickname, members-meta, the
  member-update echo decision) with their cache bookkeeping, behind injected IO. Tested in
  `tests/discord_bot_member_writes.test.ts`.
- `linked_sweep.ts`: **pure, IO-free.** Who is believed to have a linked game account, and
  the paced pass that re-syncs their flair one bounded SLICE at a time. Every belief is fed
  from outside (the outbox link-change feed, the flex-batch echo, the members-meta linkage
  signal) and each signal is applied for exactly as much as it can prove. Tested in
  `tests/discord_bot_linked_sweep.test.ts` and `tests/discord_bot_sweep_cycle.test.ts`.
- `sweep_cycle.ts`: the role-sync sweep cycle behind injected deps: one flex-batch slice
  per run, and what each answered member gets (the tier-role diff, the level nickname, the
  diff-guarded meta follow-up). Extracted from `main.ts` so the composed D18 suite
  (`tests/discord_bot_sweep_cycle.test.ts`) drives the PRODUCTION unit rather than a
  hand-kept mirror; `main.ts` binds the deps and registers the task, and decides nothing.
- `liveness.ts`: the container healthcheck's evidence. A pure freshness rule
  (`isHeartbeatFresh`, fresh means strictly under the stale window, and a FUTURE mtime is
  fresh so a clock step never kills a working bot) plus the thin writer the
  `heartbeat-file` task runs. The default path is `/tmp` because the runtime image runs as
  USER node and only `/app/dist/media` is chowned. A failed write is logged once and
  resolves false; it never throws. Tested in `tests/discord_bot_liveness.test.ts`.
- `presence_counters.ts`: **pure, IO-free.** The governor counters shaped for the wire and
  attached to the presence POST (Phase 8), so telemetry needs no loop of its own. The shape
  is a fixed key set built as a fresh literal in one order (the server pins it, and
  `JSON.stringify` follows source order), and collection is TOTAL: a snapshot that throws or
  is not a record at all yields no `counters` key, and a wrong-typed individual field
  normalizes to 0 inside an otherwise-shipped block; either way the presence push itself
  never fails. Tested in `tests/discord_bot_presence_counters.test.ts`.
- `outbox_consumer.ts`: the consolidated poll's behavior, behind injected IO: the breaker
  gate, the per-stream fan-out, the winners announce-then-mark ordering, the didWork signal
  the cadence reads, and the factory that binds each stream's channel id and message
  builder. Tested in `tests/discord_bot_outbox.test.ts`.
- `main.ts`: wiring only: guild state seeded from `GUILD_CREATE` (plus the op 8
  member backfill for large guilds), kept live by the `GUILD_MEMBER_*` events,
  event dispatch, and the scheduler task registrations.

## New bot feature recipe (module-first)
1. Pure message-builder/diff/shaping logic in `logic.ts`, with a test in the suite that
   owns that family: message builders and protocol shaping in `tests/discord_bot.test.ts`,
   diff-before-write predicates in `tests/discord_bot_diffs.test.ts`. Bug fixes are
   test-first: a failing test that reproduces the bug, then the smallest change that turns
   it green.
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
- **One injection convention in the three shells.** Each shell takes its IO as
  TRAILING parameters with production defaults, on a constructor or on a factory
  (`governorFromConfig`), so `main.ts` keeps
  constructing with the leading arguments only and gets exactly production IO.
  Every default FORWARDS to the global, `(...args) => fetch(...args)` and
  `(cb, ms) => setTimeout(cb, ms)`, never `= fetch` or `= { setTimeout }`: the
  forwarding form reads the global at CALL time, so a test that swaps a global
  after construction is still seen, and the global is never invoked with the
  instance as its `this`. Every shell also has a test that drives the DEFAULT
  path, not just the injected one; keep that pair when adding a shell, and write
  it so that it can actually fail, which takes BOTH of these:
  **construct the shell BEFORE stubbing the global** (stub-then-construct passes
  for a capturing `= fetch`, so it does not guard this rule at all), and
  **assert every argument the default forwards**, not just the first (a
  one-parameter stub passes for `(input) => fetch(input)`, which type-checks
  because TypeScript accepts an arity-reduced function, and which would strip
  the auth header off every request in production).
- **Every Discord REST call goes through the governor.** `discord_api.ts` never paces,
  retries, or sleeps on its own; it normalizes one response and hands the decision to
  `rate_governor.ts`. A new REST method is a `request()` call with the right options
  (`subjectKey` for a member write so the 401/403 cache can see it, `essential: true`
  only for traffic that must survive an open breaker, such as a slash-command reply and
  its 3 second deadline), never a bare call to the injected sender.
- **No credential ever reaches a bucket key, a log line, or a thrown message.** Three
  interaction routes carry a live ~15 minute bearer token in the PATH. `routeTemplate`
  emits `:token` and `redactPath` redacts the throw; ids are deliberately kept.
- **Secrets are env only**; never commit them. `DISCORD_BOT_SECRET` must match the server's.
- **Privileged intents:** `GUILD_MEMBERS` + `GUILD_PRESENCES` must be enabled for the
  application in the Discord developer portal, or IDENTIFY is rejected (close 4014). That
  close is FATAL, so the bot exits 1 rather than retrying a handshake that cannot succeed.

## Poll loops (all on `scheduler.ts`, wired in main.ts)
**There are no bare `setInterval` loops in `main.ts`, and a new loop must not add one**
(pinned by `tests/discord_bot_main_wiring.test.ts`, which also bans a bare `setTimeout`,
requires EXACTLY the registrations listed below with each reading its own `cfg` cadence field
AND running its own sweep, pins every event `kick()` call site with an exact count, and
asserts `startAll()` precedes `gateway.connect()`; the gateway heartbeat in `gateway.ts` is a
different concern and stays). A repeating timer fires whether or not the previous run
finished, so once a sweep ran long the sweeps stacked and a slow minute became a storm that
survived restarts. Every loop is a `scheduler.add({...})` task instead: the next delay is
armed only after the previous run SETTLES, delays are jittered so loops armed in one boot do
not stay phase-locked, and repeated event kicks coalesce into exactly one follow-up run.
- Role sync (`role-sync`): one paced SLICE of the linked-member set per run, every
  `cfg.sweepSliceMs` (3 s) while a pass has ids left, decaying to `cfg.roleSyncIntervalMs`
  (5 min) between passes, which is the pass interval itself. The window is a FLOOR, not a
  deadline: a pass opens at the first wake at or after it. The idle intervals double
  3, 6, 12, 24, 48, 96, 192 s (the 300 s ceiling is never reached before a pass opens),
  putting the cumulative wakes at 3, 9, 21, 45, 93, 189, then 381 s, so the default
  effective gap between passes is about 6.4 minutes (an event kick bypasses it).
  `linked_sweep.ts` decides WHICH members, the scheduler decides WHEN. Feed-dirtied members
  are served ahead of the pass, BOUNDED: dirty and pass-shaped work (an in-flight cursor,
  an armed discovery walk, or a requested or due pass) alternate slices, so a busy feed
  cannot starve the pass indefinitely. Kicked by `GUILD_CREATE` (preceded by
  `requestPass()`, because a kick alone only wakes the task early and it would find the
  pass window still open), by a COMPLETE roster seed, and by the outbox link-change feed
  when it moved something.
- Special-roles refresh + members-meta push (`special-roles-and-meta`): every
  `cfg.roleSyncIntervalMs` (5 min), plus a coalescing `kick()` on `GUILD_CREATE` and when
  the op 8 member backfill finishes. The refresh and the push are ONE task because the push
  reads the index the refresh rebuilds, so their ordering is load bearing. Tier-role refresh
  (`tier-roles`) runs once at startup (before the gateway connects) and on the same 5 min
  cadence.
  The role sync also sets the level-on-name nickname (`buildLevelNick`; the base name
  fallback can be the member's own already-suffixed live nick, so `buildLevelNick` strips any
  existing suffix first to stay idempotent across re-syncs; `DISCORD_SYNC_NICKNAMES=0`
  disables).
- Presence push (`presence-push`): a `debounce` task, so voice/presence events open one
  `cfg.presenceDebounceMs` (4 s) window and every event inside it folds into one push.
- Outbox (`outbox`): the ONE pickup loop, every `cfg.outboxPollMs` (3 s) while it keeps
  finding work, decaying to `cfg.outboxIdleMs` (15 s) once the drains come back empty.
  `GET /internal/discord/outbox` answers four streams at once (relay posts, the activity
  feed, the reward-winner days, and the link-change feed), replacing the three separate
  3 s pollers and the sweep's full flex re-read. `outbox_consumer.ts` owns what it does with
  them: it will NOT drain while the rate governor's breaker is open or half-open (those
  posts are non-essential, so the governor would refuse them, and a 200 is the outbox's only
  acknowledgement, so draining into refusals loses the items); each post is caught per item;
  a winners day is marked back on the server ONLY after its post landed, so a failed post
  retries (at-least-once, duplicates accepted); a bounded process-local announced-days memo
  (`OutboxPollState`) keeps a day whose MARK keeps failing from being re-announced every
  poll (the re-serve skips straight to the mark retry; a restart costs the one documented
  duplicate); and the poll runs on its own much longer
  deadline (`cfg.outboxTimeoutMs`, 70 s), which must stay ABOVE the server's read deadline.
  didWork is split by stream class: the three DRAINED streams count by carriage, the
  re-served winners read counts by successful MARK (the event that stops the re-serve), so
  a winners day that cannot finish (unset channel, durable 403, a failing mark endpoint)
  cannot pin the loop at the active cadence forever.
  Two honest limits of the consolidation, both deliberate: with a stream's channel id UNSET,
  drained relay/activity items are dropped after a once-per-channel notice (the pre-outbox
  pollers checked the channel BEFORE draining and left items queued; the drain is now
  all-streams-at-once, so per-stream pre-checks are impossible), and while the breaker is
  open the skipped drain also delays link-change consumption, so flair can lag until the
  breaker closes or, if the Phase 5 ladder evicted the items, until the hourly full-resync
  reconciliation heals it (about one hour worst case).
- Liveness stamp (`heartbeat-file`): re-writes `cfg.heartbeatFile` every
  `cfg.heartbeatIntervalMs` (`DISCORD_HEARTBEAT_INTERVAL_MS`, 30 s), and the compose
  healthcheck compares that file's mtime against now. It is on the scheduler rather than
  on a timer of its own so that it PROVES something, and exactly this much: the mtime
  advances only while the process, its event loop, and the scheduler machinery are alive
  (a Discord bot has no port to probe, and a process that reconnected to nothing looks
  perfectly healthy from outside). It does NOT prove the sibling tasks are healthy: tasks
  chain independently, so one loop wedged on a never-settling run (L10) keeps the stamp
  fresh; the IO deadlines on both shells are the defense there. An unwritable path is
  logged and the run still settles, so a bad mount degrades the healthcheck and never the
  bot.
- Daily engagement grant: first message or voice-join per member per day, deduped
  bot-side AND server-side (grant dedupe key), so it is exactly-once.
- The adaptive active-to-idle backoff has two consumers: the outbox poll (D1: 3 s active
  decaying to 15 s idle) and the role sweep (slice interval decaying to the pass interval).
  Every other task sets `activeMs` only, so its cadence is constant. Backoff is only safe
  because recovery is instant: a run that finds work snaps straight back to `activeMs`.
- **Every `run` handed to `scheduler.add` must always settle** (ledger L10). The next delay
  is armed only after the previous run settles, which is the whole overlap guarantee, so a
  `run` that never resolves leaves the task claimed with nothing armed, no counter and no
  log, for the life of the process. A watchdog in the scheduler cannot fix it: recovery
  needs the run CANCELLED, and the scheduler holds a promise it has no way to abort. Only a
  deadline on the IO underneath can, and as of Phase 7 both shells carry one, so every
  run settles structurally: `SERVER_CALL_TIMEOUT_MS` for an ordinary game-server call and
  `DEFAULT_OUTBOX_TIMEOUT_MS` for the outbox poll (deliberately longer than the server's own
  read deadline) in `server_client.ts`, and `DISCORD_CALL_TIMEOUT_MS` in `discord_api.ts`.
  That does not retire the rule, it satisfies it for today's tasks: NEW work behind a
  seam that has no deadline (a bare promise, a stream, a lock) re-opens the same hole, so
  a new `run` still has to settle by construction. A Discord deadline is armed INSIDE the
  send callback, never around `governor.run`, or a legitimately queued request aborts.

## Diff before write (D5): nothing is written unless it changed
`member_writes.ts` owns all three decisions, over the pure predicates in `logic.ts`, because
`main.ts` calls `main()` at module scope and so is unreachable from any test.
- **Nickname PATCH** only when the computed nick differs from the member's cached RAW nick.
  The raw nick is cached separately from `memberNames`: `displayNameOf` collapses nick,
  `global_name` and username into one string, so it cannot tell "the nick is X" from "there
  is no nick and the global name is X".
- **members-meta** pushed only for members whose record changed since the last SUCCESSFUL
  push, still byte-batched. A cleared record IS a change, so both clearing paths push, and
  they drop the member's cache entries so a rejoin re-pushes.
- **Self-echo suppression**: Discord answers every nickname PATCH with a
  `GUILD_MEMBER_UPDATE`, and answering that with a members-meta POST is the bot generating
  load against itself. An update carrying only the nick we just wrote, with an unchanged role
  SET (order is not promised), is dropped; anything else still pushes.
- **Caches move only after the write succeeded**, the `computeRoleSync` pattern. A cache
  written optimistically claims a failed write landed, and the retry never happens. Note
  `server_client.ts` answers `null` for a failed push rather than throwing, so the RETURN
  VALUE is the only success signal there is (and `undefined` counts too: a success envelope
  with no data comes back as `env.data` verbatim).
- **The diff cache is dropped wholesale every `FULL_RESYNC_INTERVAL_MS` (1 h).** It records
  what the bot BELIEVES the server holds, and the server can lose those values with nothing
  to tell the bot: a member in the guild who has not linked yet is written by an UPDATE that
  matches no row and is still counted as accepted, an unlink-relink inserts a fresh row with
  both meta columns null, and a restore or a moderation delete edits the table out of band.
  Before D5 every sweep re-pushed everything, so all of those healed within one interval
  without anyone enumerating them; the periodic resync is what keeps that property while
  still sending nothing for eleven sweeps out of twelve. **Do not "optimize" it away.**
- **Echo suppression is consumed, not remembered.** One PATCH produces one
  `GUILD_MEMBER_UPDATE`, so `decideMemberUpdate` reports `forgetWrittenNick` and the caller
  drops the entry. Holding it lets a moderator's rename BACK to a value the bot once wrote
  be misread as our own echo.

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
on). Governor knobs (all optional, safe defaults): `DISCORD_MAX_RPS` (8),
`DISCORD_BAN_PAUSE_MS` (600000), `DISCORD_BREAKER_LIMIT` (300),
`DISCORD_FORBIDDEN_TTL_MS` (86400000). Loop cadences (D13, all optional):
`DISCORD_ROLE_SYNC_INTERVAL_MS` (300000), `DISCORD_PRESENCE_DEBOUNCE_MS` (4000),
`DISCORD_OUTBOX_POLL_MS` (3000), `DISCORD_OUTBOX_IDLE_MS` (15000),
`DISCORD_SWEEP_SLICE_MS` (3000), `DISCORD_HEARTBEAT_INTERVAL_MS` (30000); the defaults are
`bot/cadence.ts`, so the value the suite
pins and the value the bot falls back to cannot drift apart. The three knobs that are NOT
cadences take their defaults from the module that spends them, for the same reason:
`DISCORD_SWEEP_SLICE_SIZE` (100, `DEFAULT_SWEEP_SLICE_SIZE` in `linked_sweep.ts`, how many
members one slice may write to), `DISCORD_OUTBOX_TIMEOUT_MS` (70000,
`DEFAULT_OUTBOX_TIMEOUT_MS` in `server_client.ts`, one poll's abort deadline; the
default is also an enforced FLOOR, since a deadline under the server's own 65 s
drain deadline silently loses outbox items, so the knob can only raise it), and
`DISCORD_HEARTBEAT_FILE` (`/tmp/discord-bot-heartbeat`, `DEFAULT_HEARTBEAT_FILE` in
`liveness.ts`, the path the compose healthcheck stats; empty or whitespace falls back, and
the value is trimmed). Each of these
knobs falls back to its default for an empty or non-numeric value, never to 0. `DISCORD_WELCOME_CHANNEL_ID` is read but currently
unwired (no welcome message is posted). Boot loads `.env`/`.env.local` when present but
runs fine from ambient env alone (`process.loadEnvFile`).

Adding an env key means adding it to `BOT_ENV_KEYS` in
`tests/discord_bot_config.test.ts` too: that suite pins the complete key set and asserts
exactly one dynamic `process.env[...]` lookup, so read a new key as a direct
`process.env.NAME` and pass the VALUE to a parser.

## Limits / notes
- Guild state is seeded from `GUILD_CREATE` and then kept live: `GUILD_MEMBER_ADD`
  seeds a joiner's roles/join date, `GUILD_MEMBER_UPDATE` reconciles a member's
  role set (so a role granted or revoked after boot reflects on the next push), and
  `GUILD_MEMBER_REMOVE` clears their stored flair and prunes them from the linked
  sweep (departure does not delete the link row, so without the prune the pass would
  keep spending doomed writes on them until the next complete seed). Guilds above the IDENTIFY
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
