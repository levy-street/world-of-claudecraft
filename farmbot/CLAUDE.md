<!-- farmbot/: the autonomous farming client. Local guidance only; root +
     src/sim/ CLAUDE.md load alongside this, don't repeat them. -->

# farmbot/: farming bot (live-server client)

A standalone Node process that logs into a WoC realm as a REAL client and farms
autonomously: gathers herb/ore/wood nodes along a priority route, fishes between
respawns (spot rotation), fights mobs that aggro it (or grinds them for XP),
levels through camp circuits with zone-ups, runs dungeon gold rotations, flees
overleveled or outnumbering attackers, interrupts enemy casts, pops emergency
defensives and potions, auto-equips better drops, sells rares on the World
Market, rides a mount on long legs, loots corpses, eats/drinks to recover,
handles death (true corpse run via the mirrored corpsePos, spirit-healer
fallback, rest-after-res), rotates across zones through road passes and
portals, mails gathered mats to an alt or sells junk when bags fill, pauses
when players are near, and takes scheduled breaks. Safety watch:
whispers/nearby says can log, raise a webhook alarm, or log out.

The server runs the authoritative sim; the bot is just a WebSocket client built
on the game's own `ClientWorld` (`src/net/online.ts`). Only typed `ClientWorld`
command methods are used (no `devCmd`, no protocol anomalies), and the input
stream goes out on the same 20 Hz cadence every real client sends, because it
IS the same code path.

## Build / run

```bash
npm run build:farmbot          # esbuild bundle -> dist-farmbot/farmbot.cjs
WOC_USERNAME=... WOC_PASSWORD=... \
  node dist-farmbot/farmbot.cjs --config farmbot.config.json
```

`npm run farmbot` builds and runs in one step. `farmbot.config.example.json` is
the documented profile shape; `parseConfig` rejects unknown keys, so only real
keys. `serverUrl` is an http(s) origin (e.g. `http://localhost:8787`), never a
ws URL: `ClientWorld` derives the socket path itself.

## Launcher GUI

`npm run farmbot:gui` builds both bundles and starts `launcher.ts`, a small
node:http server (zero dependencies) that serves a single-page form at
http://127.0.0.1:4787 (`FARMBOT_GUI_PORT` overrides): account sign-in with a
character picker (`POST /api/characters` runs the same `Api.login` +
`characters()` path as main.ts, Origin shim included), farming profile fields,
and Start/Stop with a live log pane (`GET /api/logs?since=N` off a 2000-line
ring buffer). It **binds 127.0.0.1 only** and **never writes credentials to
disk**: the password lives in the page and the launcher memory only, the temp
config file handed to the child contains no credentials (they reach the child
as `WOC_USERNAME`/`WOC_PASSWORD` in its environment), and the file is deleted
when the child exits. The launcher resolves `farmbot.cjs` next to its own
bundle, so the two `dist-farmbot/` outputs must ship together. One caveat:
stopping the bot is graceful on POSIX (SIGTERM runs main.ts's logout), but on
Windows every signal is an unconditional terminate, so the character lingers
linkdead until the server grace expires or the next start takes it over.
The pure seams (ring log, form-to-config assembly, zone list, FBSTAT parsing,
zone map payload) live in `launcher_core.ts`, tested in
`tests/farmbot_launcher.test.ts`; the page is the embedded template string in
`launcher_page.ts`.

GUI extras: a Live panel (state, uptime, HP/resource bars, bags, items/hour,
session copper earned + gold/hour, harvests/catches/kills/deaths, and the
level-mode progression boxes: level, xp, session xpGained, xp/hour), a mode
dropdown with gold and level field rows (level: targetLevel, lootRule,
zoneUp; gear upgrades auto-check for level mode), an Advanced: economy
section (gearUpgrades / marketSell / mount toggles), an
inline-SVG mini map of the current zone (rect, lakes, node dots by type, live
position), a read-only inventory grid,
named form profiles in localStorage (password never saved), and page-side
character rotation (checked profiles + interval, driven through stop/start;
the rotation uses the credentials typed in the page, which are gone on
reload). Endpoints: `GET /api/live` (`{running, pid?, startedAt?, stat}` from
the FBSTAT channel), `GET /api/meta` (zones, nodeTypes, defaultServerUrl,
`zoneInfo` map payload).

## FBSTAT channel

main.ts prints one `FBSTAT {json}` line every 2 s: pos, live zoneId, brain
mode, hp/resource pools, bags, the stats counters (harvests/catches/kills/
deaths/copperGained/raresKept/xpGained/levelsGained), the progression mirrors
(xp, level), and the inventory. The
launcher skims those lines off the child stream (they never reach the log
pane) and serves the latest at `/api/live`. Alerts are a separate channel:
the brain pushes `state.alerts` entries at the alert-worthy sites (death,
circuit breaker, spirit-healer res, bags-full or max-runtime logout, whisper
alarm, player-pause, schedule break, mail send, level-up, target level
reached); main.ts drains the queue
each tick, prints `ALERT: <text>`, and POSTs `{content: text}` to
`safety.webhookUrl` when configured (Discord/Slack-compatible,
fire-and-forget).

## Config surface (parseConfig is strict; unknown keys fail)

- `mode`: 'gather-fish' | 'gather' | 'fish' | 'gold' | 'level'. Gate rule:
  'gather' never fishes; 'fish' never gathers; 'gather-fish' fishes only when
  the legacy `fishing.enabled` is true (pre-mode minimal configs keep their
  behavior). 'gold' is the dungeon gold-farm: Rite of Expulsion (`exorcism`)
  pull only, then auto-attack + Crusader Strike, Holy Ground (`consecration`)
  when 2+ attackers, and keep Oath of Iron + one paladin aura (Requital
  preferred; Steadfast fallback) up. Ignores `combat.rotationMode` /
  `abilitySlots`. 'level' is the camp-circuit leveling grind (see below).
- `fishing.spots`: rotation list (legacy `spot` mirrors to `spots[0]` and
  back); `castsPerSpot` per spot before advancing. With the world seed,
  main.ts injects a `fishableAt` probe so dead spots are skipped locally.
- `nodePriority` (type preference order, then distance), `nodeBlacklist` /
  `nodeWhitelist` (config-level node id filters), `maxNodeTier`, `nodeTypes`.
- `zones`: multi-zone rotation (empty = legacy single `zoneId`). **List the
  character's spawn zone first**; the route graph (zone_graph.ts over ZONES +
  PORTALS) walks road passes and portals, skips unwalkable targets with a log
  line, and farshore_isle has no walkable route at all.
- `levelGrind` (mode 'level'): `targetLevel` (logout + alert when reached),
  `restBelowPct` (REST gate between pulls), `lootRule` ('money-blues' rides
  the gold corpse filter + discard sweep; 'all' rides the normal LOOT state),
  `zoneUp` (move to the next level band when every camp here is gray or
  spent). The circuit (grind_circuits.ts over the real CAMPS/MOBS/ZONES
  tables) picks the nearest non-gray camp in the [level-2, level+3] band,
  walks to it (zone-graph legs cross-zone), pulls singly (ranged `exorcism`
  when known, else walk-aggro), marks a camp cleared after 8 s quiet, and
  waits out respawns (65 s) when all camps are spent. XP/level tracking rides
  the `lifetimeXp` mirror; `xpGained`/`levelsGained` land in the FBSTAT stats.
- `gearUpgrades`: after any loot pass, equip strictly-better drops by
  `itemScore` (gear.ts; level/class gates use the same derivation the server
  enforces; rings land in the weaker of ring1/ring2). Never downgrades, never
  touches bags or reins. v1 notes: an equip is issued once per item per
  session (a server-side reject is not retried), and the gold discard sweep
  protects issued items.
- `bags.marketSell`: on a BAGS_FULL trip with a World Market merchant in
  range (the_merchant / Auctioneer Voss), collect proceeds once, then list
  rare+ drops at `max(sellValue * 10, 100)` copper (v1: no marketSearch
  undercut check, no pathing to the merchant, one listing per itemId, session
  cap 10). Everything not listed falls through to the vendor/stop flow.
- `mount`: `enabled` summons a bagged reins for overworld legs over 60 yd
  (guided walks and zone legs; level 20+, riding trained; dismounts on combat
  entry and when the leg shortens to 60 yd, not at the exact arrival point);
  `buyTraining` fires `learnRiding` once when passing the stablemaster with
  80g (level 20+). No mounted combat.
- `combat`: `abilitySlots` round-robin ('slots') or `rotationMode: 'auto'`
  (first ready damage ability by cooldown/GCD/resource/range, rotation.ts);
  `grind` pulls nearby hostiles between node spawns; `flee`: 'never' |
  'outleveled' | 'outnumbered' | 'both' ('outleveled' trips on
  `fleeAboveLevelDelta`, 'outnumbered' on 3+ attackers; hub-ward for up to
  15 s before turning to fight); `maxPullSize` (default 2) skips level-mode
  pull targets whose 10 yd pack count exceeds it (60 s skip; gold and grind
  ignore the cap because dungeon packs are authored at 2-3). Every COMBAT
  tick, before the rotation: emergency buttons
  (survival.ts: Ward of Faith under 40% hp, Last Rite under 20%, best hp
  potion under 35%), then the class interrupt (survival.ts table: rebuke /
  kick / counterspell / counter_shot / skull_bash / spell_lock) when an
  attacker is casting with > 0.4 s left, then the rotation. Zone trash rarely
  hardcasts; the interrupt's value is on bosses/casters.
  `eatItemId`/`drinkItemId` + thresholds.
- `death`: `waitUntilFull` (REST after a revive until both pools are 95%,
  3-minute cap), `maxDeaths` circuit breaker (0 = off), `avoidDeathSpotMinutes`
  danger memory (nodes and fish spots within 25 yd of a death spot are avoided).
- `safety`: `whisperAction` ('log'|'alarm'|'logout'), `playerPause` (pause
  while another player lingers in radius), `schedule` (session/break rhythm,
  break idles or logs out), `webhookUrl` (alert POSTs).
- `bags`: `fullPolicy` ('sell-junk'|'stop'), `sellAllowlist` (only listed
  greys are sold), `mailTo` + `mailItems` (mail gathered mats to an alt from
  a mailbox, then fall through to the vendor path).
- Brain modes: TRAVEL, HARVEST, FISH_CAST, FISH_WAIT_BITE, COMBAT, FLEE,
  LOOT, RECOVER, REST, PAUSED, BREAK, DEAD, BAGS_FULL. Pre-empt order in
  stepBrain: runtime cap, death, combat/flee, chat watch, pause, schedule,
  bags, then dispatch.
- Optional `deps.rng` (main.ts passes Math.random) spreads node picks over
  the top 3 candidates and adds a 0.5-2 s pause before harvest/cast actions.

## WARNING: credentials, realms, dev flags

- **Credentials come from the environment only** (`WOC_USERNAME` /
  `WOC_PASSWORD`), never from the config file (the parser rejects a `password`
  key), and are never logged.
- **Run this only against your own realm.** The in-repo bot detector
  (`server/bot_detector/stub.ts`) is a no-op; the live realm may run the private
  implementation whose heuristics are unknowable from here. The bot stays inside
  real-client cadence and typed commands, but that is not a guarantee.
- `PROVISION_TEST_ACCOUNTS=1` and `ALLOW_DEV_COMMANDS=1` are dev-only server
  flags. They were used for the local smoke test (grant a rod + tier-1 tools via
  the `dev_give` wire command) and must never be set on a real realm.

## The shim contract (why not bot/)

`ClientWorld` was written for a browser, so bundling it for Node needs three
concessions, all owned here:

- `shims.ts`: installs `globalThis.window = globalThis` (the constructor arms
  the input timer through `window.setInterval`) and overwrites `WebSocket` with
  the repo-pinned `ws` package. The exact socket surface used is small
  (onopen/onmessage/onclose property handlers, `WebSocket.OPEN`, send/close;
  message data goes through `String(ev.data)`, so `ws` Buffers need no
  binaryType handling). Must run BEFORE `new ClientWorld(...)`.
- `capacitor_stub.ts`: `App`/`Capacitor` stubs aliased over `@capacitor/app` and
  `@capacitor/core` at bundle time (`scripts/build_farmbot.mjs`); the imports at
  the top of `online.ts` must resolve even though `NATIVE_APP` is falsy.
- `build_farmbot.mjs` defines every `import.meta.env.*` the reachable graph
  reads at module scope (`src/client_origin.ts`, `src/runtime.ts`) to inert
  values.

`bot/` was NOT reused: its CLAUDE.md forbids browser globals (it is typechecked
twice, once without DOM libs, exactly to keep `ClientWorld` out), and its
process contract (Discord gateway, restart-on-fatal) has nothing to do with a
game session. The farmbot typechecks once, under the repo-wide `npm run
check:ts`, which already carries the DOM libs `online.ts` needs.

## Pure/IO split

Same doctrine as `bot/` (logic vs gateway) and `wallet_link.ts` vs `wallet.ts`:

- `config.ts` (pure): JSON profile to `FarmBotConfig`, strict validation with
  every problem listed in one throw. Tested in `tests/farmbot_config.test.ts`.
- `navigator.ts` (pure): `pickNextNode` (nearest ready node by zone/type/tier,
  blacklist-aware), `steerToward` (absolute facing + forward, arrived inside
  `INTERACT_RANGE`), `StuckDetector` (held recovery maneuvers: back, sides,
  reverse with optional rng, then blacklist). Tested in
  `tests/farmbot_navigator.test.ts`.
- `brain.ts` (pure): the state machine (`stepBrain(state, world, events,
  nowMs)` over a narrow `BotWorld` interface) covering TRAVEL, HARVEST,
  FISH_CAST/FISH_WAIT_BITE, COMBAT, FLEE, LOOT, RECOVER, REST, PAUSED, BREAK,
  DEAD, BAGS_FULL. Commands are fire-and-forget; outcomes are read from the
  world mirror and events. Tested in `tests/farmbot_brain.test.ts` against a
  fake `BotWorld`.
- `rotation.ts` (pure): 'auto' combat ability picking (cooldown/GCD/resource/
  range gates) plus the gold-mode mana-lean kit (`pickGoldCombatAbility`,
  `pickGoldMaintainBuff`). Tested in `tests/farmbot_rotation.test.ts`.
- `survival.ts` (pure): emergency-button picking (Ward of Faith / Last Rite /
  best hp potion, one defensive action per tick, combat and flee), the
  10 yd pack counter, and the class-interrupt table + picker. Tested in
  `tests/farmbot_survival.test.ts` (and via the brain suite).
- `grind_circuits.ts` (pure): the level-mode camp tables (CAMPS/MOBS/ZONES
  plus the xp curve), camp picking (gray-reject, level band, nearest), and
  the next-zone band finder. Tested in `tests/farmbot_grind_circuits.test.ts`.
- `gear.ts` (pure): `findUpgrades` (strictly-better-by-itemScore per slot,
  level/class gates, weaker-of-two rings). Tested in
  `tests/farmbot_gear.test.ts`.
- `zone_graph.ts` (pure): zone walkability graph from ZONES + PORTALS and a
  BFS path finder. Tested in `tests/farmbot_zone_graph.test.ts`.
- `main.ts` (IO shell): argv/env, login + character resolution (+ takeover on a
  live session), shim install, hello wait (`world.connected` flips when the
  server's hello lands; there is no onHello callback), the 10 Hz decision loop,
  and SIGINT/SIGTERM teardown (`sendLogout` + `close`).

**Time and randomness never enter the pure modules**: `nowMs` is a parameter,
the loop owns `Date.now()`. Two live-smoke findings are encoded in the brain
and pinned by tests: the drink threshold only applies to mana classes (rage and
energy rest at zero), and a fishing cast must trail its probe facing by
`FISH_ARM_MS` (the facing rides the input stream, so a same-tick cast is probed
server-side against the stale facing).

## Where new logic lands

New decision behavior goes in `brain.ts` (or a new pure sibling) with a test in
the matching suite, test-first. `main.ts` takes wiring only. If a change needs
a new `ClientWorld` method, verify its wire shape in `server/game.ts` first;
the smoke-test lesson is that the command envelope is `{t:'cmd', cmd, ...}` and
facing rides `{t:'input', ...}` frames, both of which `ClientWorld` owns.

## Files

- `config.ts`, `navigator.ts`, `brain.ts`, `shims.ts`, `capacitor_stub.ts`,
  `main.ts`: each file's header comment is the reference.
- `launcher.ts`, `launcher_page.ts`, `launcher_core.ts`: the local GUI (see
  Launcher GUI above); IO shell, embedded page, and pure seams respectively.
- `scripts/build_farmbot.mjs`: the bundler (mirrors `build_bot.mjs` plus the
  alias/define concessions above); builds both farmbot.cjs and launcher.cjs.
- `farmbot.config.example.json`: the profile shape, eastbrook_vale defaults.
- Tests: `tests/farmbot_config.test.ts`, `tests/farmbot_navigator.test.ts`,
  `tests/farmbot_brain.test.ts`, `tests/farmbot_launcher.test.ts`,
  `tests/farmbot_rotation.test.ts`, `tests/farmbot_zone_graph.test.ts`,
  `tests/farmbot_village_gates.test.ts`, `tests/farmbot_survival.test.ts`,
  `tests/farmbot_grind_circuits.test.ts`, `tests/farmbot_gear.test.ts`.
