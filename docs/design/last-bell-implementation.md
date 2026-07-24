# The Last Bell: implementation plan and build log

Working plan for building the Farshore "Last Bell" campaign end to end, from
boarding the ferry on the mainland through The Last Watch, fully playable solo
and in a party of up to five. Local-only work: commits stay on
`feature/last-bell-campaign`, no push, no PR, so the result is a baseline the
team iterates on.

Content source of truth: `docs/design/last-bell-campaign.html` (the QUESTS
array carries every quest, beat, dialogue line, choice, and scene; SQUAD/NPCS
carry the voice rules; SCRIPT_GAPS and BARK_SHEETS are lines still to write,
which this build writes). The older `farshore-last-bell-spec.md` stays the
engineering reference for topology and the story-scenario layer (section 12)
and the build order (section 13).

## Branch and ground rules

- Branch: `feature/last-bell-campaign` off `origin/feature/procedural-dungeons`
  (merge `2193ec4e1`), because Demi's Farshore island
  (`src/sim/content/farshore.ts`, terrain in `world.ts`) and the escort system
  (PR #2323) live only there. Verified green at branch point: `tsc` clean,
  architecture + escort + world_api_parity suites pass (321 tests).
- Every phase lands as one or more Conventional Commits with a body. Changed
  files get `npx @biomejs/biome check --write <file>`. No em dashes, no
  emojis, anywhere.
- Scope: ferry boarding, Q0 to Q11, The Last Watch, the Willowfen epilogue,
  post-campaign state, barks, deeds, i18n catalog. The act-6 attunement chain
  and the Drowned Relief dungeon are explicitly deferred (post-baseline).
- Every sim/server change carries tests. End state passes `npm run gate` and
  the reviewer agents (architecture, frontend seam, cross-platform sync, test
  coverage, qa checklist).

## Architecture decisions (settled against code)

1. **Story instances ride the dungeon pool.** New `DungeonDef` entries in the
   overflow band (`DUNGEON_OVERFLOW_INDEX` 7+, `dungeonAt` resolves by x-band,
   origins from `instanceOrigin(index, slot)`, 24 slots each, footprint
   `instanceContains` is +-120 x / +-250 z). Claim, occupancy,
   disconnect-resume, and idle recycling reuse
   `src/sim/instances/dungeons.ts` (`claimInstance`/`freeInstance`) unchanged.
   A story instance declares `spawns: []` and is populated by its scenario.
2. **Outdoor story terrain mirrors the island.** The Orkadia/Wildheart pattern:
   `groundHeight` (src/sim/world.ts) dispatches on `DungeonDef.interior` past
   `DUNGEON_X_THRESHOLD` and displaces the flat instance plane with a field
   function of instance-local coords; the renderer displaces its ground mesh
   and the collider builder keys on the same `interior` string. New interior
   kinds sample `terrainHeight(sourceX + lx, sourceZ + lz, seed)` so a private
   Riftfields / Landing / cliff-vault copy has terrain identical to the real
   island slice. Breach interior (Q9 to Q11) is authored dream-stone relief,
   not a mirror.
3. **Solo-always claims.** Q0's Tidemill, The Last Watch, and the Willowfen
   epilogue claim per durable character even in a party (extend
   `instanceKeyFor`'s solo arm inside the story module, never for dungeons).
4. **Squad roster** (`src/sim/squad/`): N named actors generalizing the delve
   companion brain (`src/sim/delves/companion.ts` updateDelveCompanion: follow,
   target pick, swing, heal, teleport recovery) plus escort waypoint walking
   (`src/sim/escort.ts`). Actors are friendly mobs owned by the instance
   (unattackable by players, like escortees), with per-actor kit (role,
   abilities, priorities), directives (follow unit / hold point / man station),
   group damage share scaling down as human player count rises, and a scripted
   floor during story stages (downed to 1 hp and pressured, relieved by the
   player, never ambient-killed).
5. **Scenario sequencer** (`src/sim/scenarios/`): ordered stages, per-claim run
   state keyed by the instance's `exitId` (the live claim identity), party-wide
   progress, per-stage failure = retry from stage start. Definitions are
   data-as-code in `src/sim/content/scenarios/`. Tick hook beside
   `updateInstances`/`updateEscorts` in the sim tick (thin delegate on Sim,
   logic behind SimContext).
6. **Scene system** (`src/sim/scenes/`): generalizes the Nythraxis dialogue
   scheduler (delayed events + busy-until reservation in
   `src/sim/encounters/nythraxis.ts`). A scene script is a list of timed ops:
   dialogue (stable key + speaker), actor move/face orders, camera directives
   (abstract data: shot list of focus/orbit/dolly holds), letterbox on/off,
   input lock, music directive, fade. Sim emits scene events; it never knows
   what a camera is. Client side: new `scenes` IWorld facet
   (src/world_api/scenes.ts, implemented by BOTH Sim and ClientWorld, parity
   pin updated in the same change), interpreted by a new
   `src/game/scene_director.ts` (camera path math follows
   `src/game/spawn_cinematic.ts`: pure, tested, eased) plus
   `src/ui/` letterbox + subtitle presentation. Skippable per player (client
   request the sim honors; solo skip fast-forwards scenario-side effects);
   scenes gate combat via the scenario stage being safe.
7. **Dialogue choice UI**: pure view core registered in `UI_PURE_CORES` + thin
   painter on PainterHost. Party semantics: leader answers, selection
   broadcast, response window with default. Choices color, never branch:
   recorded per character on PlayerMeta campaign flags (for example
   `lastBellVote: for | against`), read by later scenes for variant lines.
8. **i18n**: every dialogue line, objective, choice, bark, and scene subtitle
   is a stable key. English lands in a new
   `src/ui/i18n.catalog/campaign_last_bell.ts` domain module. Sim-side text
   emits keys + values (S3 guard: `tests/localization_fixes.test.ts`).
   Sim/server stay language-agnostic.
9. **Quests**: campaign quests are QuestDefs merged from
   `src/sim/content/farshore.ts` (FARSHORE_QUESTS is waiting empty), gated in
   a strict chain; scenario stages grant quest credit through the existing
   quest pipeline (`src/sim/quests/`). The ferry: a "board the ferry"
   interaction at the Eastbrook Vale east dock plus the Gullhaven pier,
   arrival plays the Ashore cutscene (the bell tolls once and the street
   stops); travel itself is the scene, not a sailed boat.

## Phase order (tasks 2 to 15)

Build order follows spec section 13: story instances, squad roster, scenario
sequencer, scene system, dialogue choice UI, then content Q0 forward, then
barks/i18n/deeds/balance, then reviews + gate. The story is playable with
placeholder presentation after the sequencer lands; cinematic quality layers
on top.

## Cutscene budget (locked in the doc)

Q0 Ashore 20s, Q3 Raising the Bellheart 40s, Q4 The council 90s, Q6 The fleet
dies 45s, Q8 The seal fails 40s, Q9 The wound divides 100s, END The Old Beacon
30s, EPI Five lights 45s. Total 6 minutes 50 seconds, under the 8-minute
budget. Q10/Q11 have zero cutscenes on purpose: the ending is played.

## Build log

- Branch created, base verified green, plan committed.
- Story instances (de5e6a06e): nine 'farshore_story' spaces on the dungeon
  pool, terrain-mirror + authored heightfields, per-area colliders, solo
  claims, /dev story. Parity fix that mattered: DUNGEON_DOORS skips
  overworldDoor:false defs (a doorPos-only anchor must not displace camps).
  Goldens untouched. Wiki generator excludes story spaces.
- Squad roster (e22896297): src/sim/squad/, five named actors, follow /
  hold / station directives, healer duty, ranged bolts, scripted 1 hp floor
  + player relief in combat/damage.ts, group damage scaling. Sparse Entity
  fields; zero-rng idle tick phase; parity green with no re-mint.
- Render story interiors (73617b73e): one builder for all nine areas,
  ground displaced from the same heights the sim stands on, walls as
  timber/stone or boulder ridges, props sized to collider specs, per-mood
  sky/fog/lights through the renderer ambience swap.
- Sequencer design decision: the QUEST pipeline stays the source of truth
  for objective progress (kills, collects, interacts already credit inside
  instances); a scenario advances its stage when the tracked quest
  objective completes, and owns spawns (rng-free rings), squad directives,
  scene hooks, wipe-retry, and stage credit. This avoids a parallel
  objective system entirely.
