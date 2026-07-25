# The Source Cave: design decisions and constraints

The living reference for anyone touching the cave: the decisions the code was built
against, the constraints it must keep, what is still open, and the traps that cost time.
The encounter and the room are specified in [encirclement-waves.md](encirclement-waves.md)
and [friendly-reboot.md](friendly-reboot.md); how the feature was built and verified is in
[final-report.md](final-report.md).

Code comments in `src/sim/source_cave/`, `src/sim/content/items.ts`, `src/ui/`, and two
test files cite this file by its **D** and **O** identifiers. Keep those identifiers
stable when editing: renumbering them silently breaks those citations.

**Where this doc and the code disagree, the code wins.** Balance numbers in particular
live in `src/sim/source_cave/tier_profiles.ts` (with their full derivation in its header
comment) and in `encounter.ts`, deliberately not here, so there is exactly one place to
change them.

## What the cave is

A dungeon generated at server startup from the GitHub contributors leaderboard: one mob
per contributor, named after the contributor, with body, color, weapon, and rank derived
from merged-PR count. The top-ranked contributor is the boss. Contributors start friendly
in a single arena around a centre reboot button and a stone seal; pressing the button
turns the roster hostile and starts deterministic weak-to-strong waves. Access is level
20, once per day. Clearing it arms a reward chest.

It is a *runtime* dungeon: it uses the dungeon engine (instance slots, enter/leave, door
trigger, empty-timeout free) but a delve-style module-assembled interior, so it physically
lives in the delve x-band at a reserved delve index and its colliders resolve through the
existing delve module path.

## Locked design decisions

- **D1 (architecture)**: dungeon semantics (entry, party/solo instance slots, lockout)
  with a delve-style interior. The spec is generated ONCE at Sim construction and is
  identical for every instance slot until the process restarts. The interior is exactly
  one delve module (`source_cave_arena`, a square room), not a chain of sealed rooms: the
  original room chain had no way to reach any module past the entrance.
- **D2 (spec derivation)**: `buildSourceCaveSpec(roster, seed)` is a pure deterministic
  function using a salted generator (`new Rng(seed ^ SOURCE_CAVE_SALT)`), never the shared
  `this.rng` stream. Same roster plus same seed gives the same cave on every host. Mobs are
  placed in concentric rings around the centre button.
- **D3 (roster source)**: the server awaits `topContributors()` before the first
  `liveGame()` and passes the roster in via `configureSourceCaveRuntime()`, a module-local
  injection mirroring `configureGithubContributorsRuntime`, NOT a `liveGame()` signature
  change (`liveGame()` is a lazy first-touch singleton that parity and characterization
  harnesses also call without ever running `startServer()`). Offline, headless, and any
  fetch failure fall back to `SOURCE_CAVE_PLACEHOLDER_ROSTER`.
- **D4 (tiering)**: reuse `devTierIndexForMergedPrs`. The rank 1 mob is boss-flagged, top
  dev tiers are `elite`, the rest standard. Stat blocks copy existing level-appropriate mob
  archetypes and the existing `createMob` elite/boss multipliers. Never invent balance
  constants.
- **D5 (access)**: `minLevel: 20` (a generic optional `DungeonDef` field checked in
  `enterDungeon`), solo or party entry, daily lockout under key `source_cave` through the
  existing `raidLockouts` plus `raidResetMs(lockoutNowMs())` mechanism. The lockout is
  granted ON CLEAR, Nythraxis-style, to every player in the instance; entry while locked is
  denied at the door.
- **D6 (clear plus chest)**: `updateInstances` detects "every required mob dead" per cave
  instance and arms the reward chest exactly once. The chest spawns SEALED at claim time
  (its own `source_cave_chest_sealed` templateId, the delve plate/rope template-swap idiom)
  and the clear pass swaps the template to arm it, which is both the once-only guard and
  the client-side reveal. Loot is a classic SHARED drop distributed by the group's own loot
  method, not personal loot.
- **D7 (names)**: contributor logins ride `Entity.name` and wire `nm` verbatim end to end.
  Render and HUD get a verbatim-name branch for these mobs (never `tEntity` by template
  id); the HUD escapes them as HTML; sim_i18n rules splice `{name}` verbatim, never through
  `locMob`. This is a deliberate, documented amendment to the "mob names never use raw
  `e.name`" rule in `src/render/CLAUDE.md`.
- **D8 (client spec delivery)**: ONE delta-guarded snapshot field, `scave`, carries both the
  static spec summary and live progress. It is not null outside the cave (the cave is one
  shared spec per D1, not a per-player run); only `killed` and `cleared` vary per player.
  The IWorld member is `sourceCaveInfo(): SourceCaveInfo | null` in
  `src/world_api/dungeons.ts`.
- **D9 (refresh)**: boot-time generation only. A new contributor appears after the next
  server restart. Each realm process generates independently, so `GITHUB_TOKEN` should be
  set or multi-realm boots hit the unauthenticated rate limit.
- **D10 (docs)**: this packet ships with the feature. It was built as disposable planning
  scaffolding, then curated down to the living design record you are reading, because code
  comments came to cite it by identifier.

## Non-negotiable constraints

- **Determinism**: all sim randomness through `Rng`; no `Math.random`, `Date.now`, or
  `performance.now` in `src/sim/`; wall clock only through the `lockoutNowMs` and
  `raidResetMs` SimConfig seams.
- **Sim purity**: `src/sim/` imports nothing from render, ui, game, or net, and has no DOM
  or Three imports (`tests/architecture.test.ts` guards it).
- **Seam order**: extend `IWorld` first, implement in BOTH `Sim` and `ClientWorld`, and let
  render and ui consume only `IWorld`.
- **Server authority**: clients never decide combat, loot, clear state, or lockouts.
- **i18n**: every player-visible string is a `t()` key; sim and server emit English matched
  by `src/ui/sim_i18n.ts` and `server_i18n.ts` rules added in the SAME change. Contributor
  logins are proper-noun data, spliced verbatim.
- No em dashes, en dashes, or emojis anywhere.
- Don't hand-edit generated files; regenerate through the build.

## Where things live

Paths only, no line numbers: the anchor rule in the root `CLAUDE.md` exists because line
numbers rot faster than anyone updates them.

- **Cave code**: `src/sim/source_cave/` (barrel `index.ts`). Spec and placement in
  `spec.ts`, tier stats in `tier_profiles.ts`, template synthesis in `templates.ts`, the
  wave state machine in `encounter.ts`, spatial rules in `occupancy.ts`, clear and despawn
  in `clear.ts`, loot in `loot.ts`, the IWorld projection in `wire.ts`.
- **Spec inputs**: `server/github_contributors.ts` (`topContributors`, `ContributorStat`),
  `src/sim/dev_tier.ts` (`devTierIndexForMergedPrs`, `DEV_TIER_DEFS`).
- **Dungeon engine**: `src/sim/instances/dungeons.ts`; defs in `src/sim/content/dungeons.ts`;
  registry in `src/sim/data.ts` (`DUNGEONS`, `instanceOrigin`, `INSTANCE_SLOT_COUNT`).
- **Delve precedent**: `src/sim/delves/runs.ts`, `src/sim/delve_layout.ts`,
  `src/world_api/delves.ts`, `src/render/delve_interiors.ts`, `src/ui/delve_map.ts`.
- **Lockout**: `raidLockouts` in `sim.ts`, `isRaidLocked` in `instances/dungeons.ts`, the
  grant in `encounters/nythraxis.ts`, `server/raid_reset.ts`.
- **Names and wire**: `src/net/online.ts`, `src/render/nameplate_painter.ts`,
  `src/render/entity_labels.ts`, `src/ui/sim_i18n.ts`, `src/ui/server_i18n.ts`.
- **Boot**: `startServer` in `server/main.ts`, the GameServer ctor in `server/game.ts`,
  `SimConfig` in `src/sim/types.ts`, `server/source_cave_boot.ts`.
- **Render**: `src/render/source_cave_interior.ts`, `source_cave_reboot.ts`,
  `source_cave_seal.ts` plus its pure core `source_cave_seal_state.ts`.

## Resolved

- **O1 (roster cap)**: the default is the full roster. `topContributors()` is awaited with
  no limit argument. If the real count ever exceeds `SOURCE_CAVE_ROSTER_MAX` (60),
  `startServer()` defensively caps to the first 60 (already rank-sorted) and emits a loud
  `console.error` naming the actual count, so an unplanned scale change is visible in ops
  rather than silent. The occupancy clamp already bounds cross-slot credit, so an oversized
  cave fails safe by undercounting rather than crediting a neighbour slot.
- **O3 (portal location)**: `SOURCE_CAVE_DOOR_POS` in `source_cave/runtime.ts`. The
  entrance visual is a well (reusing `well.glb`), not the generic dungeon-door arch, with
  its own landmark name shown only within interact proximity. Entry is gated by the well
  banter sequence below.
- **O5 (boss flag)**: exactly one boss, the single top-ranked entry by identity. The flag is
  positional, applied as an overlay, never a property of a tier: a tier-level flag would
  mint one boss per top-tier contributor and break the single-boss contract.

## Naming

The player-facing name is **The Open Source**, the same name its entrance well already
carried, so the well and the dungeon read as one place. Every internal id stays
`source_cave` (the dungeon id, the `SOURCE_CAVE_*` constants, the deed ids, the clear
key): ids are frozen, only display strings changed.

One consequence to know: `worldContent.sourceCaveWellName` and
`entities.dungeons.source_cave.name` now hold the SAME English value, so the separate
well-name key no longer distinguishes anything in English. It is kept because it is
already translated and because the two remain conceptually distinct surfaces.

**Locale debt from the rename**: seven keys inline the dungeon name in their translated
value (`entities.dungeons.source_cave.{name,enterText,leaveText}` and
`sim.sourceCave.{enter,leave,cleared,killProgress}`). Their non-English overlays still say
"Source Cave" and are now stale in all 20 non-English locales. Contributors never edit
`src/ui/i18n.locales/`, so this is a release-time refill (the `i18n-locale-fill` skill).
It will NOT be caught by the pending-row check: the rows are populated, just wrong.

## Open items

- **O2 (themed rare name)**: `source_cave_mantle` ships as "Mantle of the Source", a
  working title that still needs sign-off. Its stats are copied verbatim from
  `gravewyrm_mantle`, the level-20 Gravewyrm Sanctum rare, so no balance number was
  invented; only the id and name differ. If the name changes, update the entity catalog
  entry plus its five non-Latin fills and re-run `npm run i18n:gen`.
- **O4 (guide page)**: `src/guide/` has no Source Cave content and no `guide.*` prose keys
  for it. The root `CLAUDE.md` requires player-facing content to feed the `/wiki` guide.
- **O-deeds**: the Book of Deeds shipped in v0.25.0 and the repo rule is that every new
  piece of conquerable content authors its deed records in the SAME change
  (`src/sim/CLAUDE.md`, recipe in `docs/design/deeds.md`). The cave predates the system and
  `src/sim/content/deeds.ts` still contains no cave records: no clear deed, no wave or seal
  marks. Author them before calling the feature complete, or flag the gap in the PR body.

### The well banter gate

The well does not open on first interaction. `src/sim/source_cave/well_banter.ts` holds the
banter lines and `interactWithSourceCaveWell(ctx, pid)`: each interaction shows the next
line and does NOT enter, and once the sequence is exhausted every later interaction defers
to the real `enterSourceCave(ctx, pid)`, so the level and lockout gates still apply on the
interaction that actually opens it. The tap count is session-only (never serialized), so a
fresh login replays the sequence but a player who already ran it this session gets instant
entry.

Two traps this exposed, both worth knowing before touching any dungeon door:

- **There were three client-side shortcuts around the server's `interact()` dispatch**, not
  one: both mouse-click branches in `game/interactions.ts` and the interact keybind in
  `src/game/nearby_interaction.ts` each called `world.enterDungeon()` directly. Only
  `dungeonId === 'source_cave'` was rerouted through `world.interact()`; every other door
  keeps its direct call, because there is no existing "click-required" precedent and other
  doors' behavior must not change. `tests/interactions.test.ts` pins both arms.
- **The S3 i18n guard cannot see variable-routed emits.** The banter lines were emitted as
  `text: line` from an array, so the guard's literal-string scan never flagged them, and
  two green test runs were a false positive: without an explicit matcher every player would
  have seen raw English forever. The fix was explicit `RULES` entries in `sim_i18n.ts`, and
  the tests now call `localizeSimText()` per line per language rather than trusting green.

## Known gotchas

- `DUNGEON_LIST` and `DUNGEONS` are frozen at module load; runtime registration must thread
  through the Sim ctor, never mutate the module constants.
- Ctor-time `addEntity` calls shift entity id draw order and can break parity goldens. Use
  the reserved-id pattern (the Vale Cup groundskeeper precedent). Reserved singleton ids
  must stay distinct: a collision used to make the door silently vanish, and
  `tests/source_cave_sim.test.ts` now pins them apart.
- `src/ui/map_dungeon_portals.ts` iterates the static `DUNGEONS` for world-map dots, so a
  runtime dungeon needs an explicit arm to appear there.
- `render/dungeon.ts` and `colliders.ts` resolve interiors by static key; the cave goes
  through the delve module path instead (runtime origins). Do not force it into the
  `interior` key mechanism.
- Cave mobs carry a synthetic `source_cave_<login>` templateId that is deliberately never in
  the static `MOBS` table. Any code doing `MOBS[mob.templateId]` unguarded crashes on them;
  resolve through `mobTemplateOf(ctx, mob)` (`src/sim/mob/mob_template.ts`). This is exactly
  how a shared-tick crash reached a live playtest once.
- The cave's x-band makes `isDelvePos()` true for cave positions. That is intentional (it is
  what gives the cave collider resolution for free), but it means delve-scoped code applies
  to the cave unless it narrows through `isSourceCavePos()`.
