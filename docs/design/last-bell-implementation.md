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
- Scenario sequencer (cc60d770d), scene system (3bd47860d, timed key-based
  scripts over personal 'scene' events, all-living-participants skip),
  dialogue choices (db4543f7d, leader answers, campaignFlags persisted).
- Q0 Ashore complete end to end (9a620e618): ferry crossing auto-accepts,
  arrival scene, Marsh report, meadow cull, solo Tidemill scenario with
  timed add waves, the doorway stage (stage-level squad arrival), turn-in
  recruitment. Goldens re-minted for the fixture/NPC world shift
  (c47a5fa14). Pinned by tests/last_bell_q0.test.ts.
- PAUSE POINT (owner decision 2026-07-24): STOP after the ferry arrival is
  playable and hand over for manual testing. Remaining before handoff: the
  client scene presentation (director/letterbox/subtitles/choice window,
  in flight), the lb.* i18n catalog entries for Q0's scene lines, and
  npm run dev. Q1 onward (tasks 8 to 14) intentionally NOT started.

## Program reset after the first playtest (owner, 2026-07-27)

The owner's verdict on the playtest: the WORLD is the gap, not the systems.
Demi's Farshore is a small starter island fused to the mainland by a
walkable sandbar; the campaign doc describes a large, remote island with a
walled harbor town, mountains, a visible breach, and a boat as the only way
in. The engine work above (instances, squad, scenarios, scenes, choices)
survives unchanged; the MAP must be rebuilt to AAA standard before any more
quest content lands, one testable deliverable at a time:

- D1 The island, the ocean, the boat: relocate + enlarge farshore_isle far
  off the coast across deep fatigue ocean; terrain rewrite with the doc's
  topology (harbor bay + town flat, the Landing, Watch Meadow, Sundered
  Cliffs mountain wall, Riftfields plateau + breach crater, Wreckfields
  flats, hilltop spring); real dock piers + a visible moored ferry both
  sides; remove the causeway; move every coordinate consumer (content,
  campaign fixtures, scene coords, terrain mirrors, tests); named /dev tp.
- D2 Gullhaven town pass: walls + gate, pier district, redoubt, statue,
  bell tower, market dressing, ambient wandering villagers.
- D3 The wilds and the breach: per-region monster populations, the breach
  landmark visible from afar, patrols, ambience.
- D4 Ferry arrival cinematic + Q0 restaged on the new geography.
- D5+ the quest acts (the old tasks 8 to 14), then reviews + gate.

Each deliverable ends with a playable hand-off and waits for the owner's
eyes before the next begins.

### D1 state (2026-07-27, in progress)

Terrain landed in src/sim/world.ts: farshore_isle rect is x 700..1300 /
z -250..290; new ISLE lobes/bays; applyFarshoreSea owns the whole eastern
sea (near arm smoothstep(182,200,x) with z fade 160..180, far arm 552..570,
east fade 1352..1372, z window -400..-380 to 348..368; deep floor
WATER_LEVEL-9; beach apron; Wreckfields flats; Riftfields plateau; breach
crater at exported FARSHORE_BREACH (1012,-172); Sundered Cliffs domes 34/50/36
with jag noise; interior dome +8 at (1000,10); town shelf +4 at (828,124)).
Causeway REMOVED (onCauseway/applyCauseway/CAUSEWAY gone; starter moat kept
minus the skip). Fatigue: starter branch to x 1372 / z -390, plus a
z<368 && x>552 island-sea branch; Gullhaven bay calm via FATIGUE_FREE_WATERS
rect {748..804, 96..138} (CAREFUL: a second, grading array shares the
ROW_MERES tail anchor). Rim-zero gate widened to (x<=1372 && z<=368).
Content moved: farshore.ts (zone/POIs incl. the_breach + the_wreckfields,
town cluster at (820,118) delta +515/+48, 9 camps, 3 bells, escort, 6 roads,
chained pier docks), graveyards, 6 gather nodes, zone1 POI label 'The
Farshore Ferry', campaign docks MAINLAND_DOCK (152,-48) / GULLHAVEN_PIER
(806,122), tidemill door (930,12), scene camera coords, 9 story doorPos,
5 field mirrors. Named /dev tp <zoneOrPoiId> added. tests/farshore.test.ts
re-pinned (9/9) and last_bell_q0 green. In flight: agent A re-pins
terrain_window_seams/world_grid/zone_streaming/fixes + mapbg/wiki/i18n
regen; agent B builds ferry-boat/door/breach visuals + mainland dock prop.
Then: parity re-mint, commits, dev server, owner handoff. NOT in D1:
town walls/villagers (D2), region ambience (D3), arrival cinematic
re-staging (D4).
