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

### D1 shipped + the harbor program inserted (2026-07-27, later)

D1 shipped (dcf397487 + c50955600 + 9bd0900b1) and the owner's dock review
rejected the landing experience (plank-kit pier + procedural dinghy). The
boat/dock experience is now its own three-phase program, specced with
per-phase file manifests and acceptance criteria in
docs/prd/last-bell-harbor.md: H1 the harbor (boardwalk system + real ship
GLB + ferryman at the gangplank), H2 the fare (dialog purchase through the
choice engine, gaining a personal shared-world arm), H3 the voyage
(departure cinematic with a ship cast-off prop cue + real bell/harbor SFX
through the sfx pipeline; absorbs D4's arrival half). Interim state on the
branch: the small-kit piers at both landings work end to end (fare-less
F-boarding, tests green) and are torn out by H1. Key facts for H1: the
owned ship models are public/models/biome/sea_boat_sail_a.glb and siblings
(CC0, credited); the 3-section dock kit seats each deck on its own anchor
terrain, so level piers over deep water need the new harbor layout's
authored deck heights, never chained dock anchors.

### H1 built: the two harbors (2026-07-27, later still)

H1 is in: src/sim/harbor_layout.ts is the layout contract (per harbor:
deck rects with AUTHORED heights, rail segments, stair flights, dressing
points, ship berth, gangplank + arrival anchors; bounds precomputed for
the groundHeight hot path). Both defs live there: the mainland harbor
(shore apron y 1.2 at the old landing, level pier y 0.5 east over the
shelf drop, pier head y -0.3 at x 196..204 with the ship berthed off its
east end at (208,-48) on the dive plateau) and Gullhaven's (waterfront
apron y 5.9 on tall pilings, stepped pier 4.2 / 2.6 / 1.1 west over the
bay drop, ship at (757,124)). Wiring: ZonePropsDef.harbors (optional,
content-gated like docks) -> data.ts merge -> harborWalkHeight arm in
groundHeight beside dockSurfaceHeight; colliders.ts builds rail OBBs +
dressing circles; FATIGUE_FREE_WATERS gained the mainland basin rect
{178..214, -58..-36} (kept south of the farshore pin-6 crossing line).
Render: src/render/harbor.ts (dockPlatform-tiled decks, pilings, rails,
stairs, lamps/crates/barrels/bollards, shipSail GLB scaled to the berth
length with waterline on the sea, gangplank plank), built once in the
renderer ctor after props; props.ts exports propAsset and adds the
shipSail def (preload is derived, low-tier landmark list extended); the
lb_ferry branch slims to buildFerryMooring (sparkle + nameplate + post).
Campaign anchors read the layout (fixtures at the gangplanks, Ewald
beside the mainland one); the interim docks are torn out of zone1/
farshore and the ferry POI moved to the apron. Traps learned: authored
edges need an epsilon in the rect test (float representation of 2.6
drops exact edge points, which rail topY reads); the mainland shelf
tail stays above WATER_LEVEL until x ~196 on some seeds, so the head
starts there; the arrival deck is a real 25 yd walk from the Gullhaven
gangplank now, so return-boarding tests teleport to the pier head
first. Tests: tests/last_bell_harbor.test.ts (multi-seed walkability,
level-pier-over-deep-water, berth depth, gangplank/arrival on deck,
rail blocking + open gangplank gap, calm basins, edge-point pins);
fixtures/q0 re-pinned. NOT in H1 (per the PRD): the fare dialog (H2),
the departure cinematic + SFX (H3).

### H1 v2: the walkable ship and the ramp system (2026-07-27, owner review round)

The owner's walk rejected v1 (small dock, buried stairs, toy boat, deck
floating over grass, no keeper on the island side). v2 rebuilds the
experience: (1) STAIRS ARE OUT, RAMPS ARE IN: HarborRamp rects interpolate
walkable height between decks and down to the shore, because the movement
kernel gates climbing at PLAYER_MAX_CLIMB_SLOPE 1.5 and a raised deck edge
is a wall (this was why the dock could not be walked onto); every entry
and seam is a planked gangway with cleats. (2) Terrain grading:
HARBOR_TERRAIN_EDITS (level stamps through the world edit layer) hug the
mainland apron to the shore and level each entry pocket so ramp lips meet
ground within a step on every seed. (3) THE SHIP IS REAL AND WALKABLE:
public/models/props/harbor_ferry_ship.glb, generated with Max's Tripo
asset pipeline ($0.55, QA PASS, prompt-engineered for a flat open main
deck), moored at both berths at hull length 22; its measured deck plane
(1.9 of 11 normalized, so -2.68 world at draft 1.0) is authored as
shipDecks walkable rects with shipRails hull colliders, and the boarding
fixture spawns ON the deck: walk the pier, cross the gangplank ramp, and
board like the FFX Besaid ferry. (4) Ferryman Ewald keeps both gangplanks.
(5) The deck look is procedural
long planks in muted driftwood tones merged per tone (a few draw calls
per harbor), chunky post-and-cap rails, skirt beams, pilings.
tests/last_bell_harbor.test.ts gained ramp-slope/flush pins, entry-step
pins, and a 4-seed end-to-end walk (grass to ship deck, no step over
0.35). Traps learned: the marketing shell fronts the game so headless
shots must poll-click #btn-offline until handlers bind (networkidle never
settles against the dead :8787 proxy), and swiftshader world boots can
outlast enterOfflineGame's 30 s rAF-polled __game wait: interval-poll it
yourself (tmp/harbor_shots.mjs pattern).

### H1 v3: unstuck aboard, upright gangways, the 34 yard ship (2026-07-28)

Owner round 2 fixes. (1) THE STUCK-ABOARD BUG: rideSteepnessAt read the
bare terrain under dry footing, and the strip-edge dive wall under the
mainland berth is steeper than the climb gate, so standing on the level
ship deck stripped all control. The footing arm returns the AUTHORED
surface slope (0 decks, gradient ramps) whenever a harbor surface stands
above the terrain; a motion-loop regression walks aboard and back.
General rule minted: any authored walkable surface over wild terrain
needs a footing arm in the steepness gate, or the terrain below leaks
through. (2) Gangway ramps rendered tilted the wrong way: the rotation
signs were inverted on both axes (rotateZ lifts +x, rotateX drops +z).
(3) The ship grows to hull 34 (the basin maximum: probed floors bottom
at -5.68/-5.72, draft 1.0), berths pushed out for the 15.6 beam,
boarding amidships. Max's parkour physics engine (#2527, merged to
main: swept collision, standable world, ledge climb) is the long-term
replacement for authored shipDecks and the footing arm; adopting it here
means a main-base migration, deliberately deferred to its own task.

### H1 v4: the grand ferry ship and the outer piers (2026-07-28)

The ship becomes the landmark the program asked for: grand_ferry_ship.glb
(Tripo, replacing harbor_ferry_ship.glb) at hull 60, beam wider than the
old basins allowed, so both harbors grow a long outer pier and berth head
running the boardwalk out to a CARVED berth basin (terrain level stamps
under the hull; the old "probe the floor, fit the draft" sizing is gone,
the basin is authored to the draft instead). Draft 2.5 puts the main deck
at +0.72, ABOVE pier height, so both gangplanks now run UP onto the deck
(dir flipped, highY on the ship side). Mainland: outer pier x 205..231,
berth head, ship berthed at (240.5,-44) lying north-south. Gullhaven: the
boardwalk runs west over the deep bay (outer run x 732..750), berth head,
ship at (732,132.5) bow west (rot PI flips the model's +x bow). Ewald's
two posts move to ON-DECK positions at the top of their gangplanks. Fatigue-free
rects widened around both new basins (mainland kept south of z -33; the
farshore.test.ts crossing line at z -30 stays open sea). Deck plane
measured from the new model: 4.68 of its 24-unit normalized height,
scale 1.649. harbor/fixtures/q0 suites re-pinned; parity goldens hold
(the carve stamps sit outside the golden probe set).

### H2: the fare, a personal dock dialog (2026-07-28)

Boarding the ferry, or talking to Ewald at either post, opens
the dialogue-choice window with the fare: 10 copper (the owner priced it
down from the PRD's 50), "Pay the fare." / "Not today.", each party rider
answering their own prompt. The engine change is the choice system's
personal shared-world arm (src/sim/scenes/choices.ts), mirroring the
scene engine's: audience of one, keyed -pid so claim choices never
collide, leader is the rider, and ALL effects run through an onResolve
callback (no campaignFlags write: a dock transaction colors no story).
Declining, walking 10 yd off the prompt anchor, or the 25 s response
window all leave the rider ashore unchanged; answers prefer the
answering player's own personal prompt so two riders sharing a choiceId
never eat each other's clicks. A broke FIRST crossing rides free with
Ewald's waiver line (log.ferryFareWaived, filled in every matcher
locale); any other empty purse gets the shared "Not enough money."
refusal. The sceneChoice event gained interpolation values ({price},
formatNumber in the window) and the crossing logs were re-aligned to the
registered log.ferryEnter/ferryLeave matcher strings (the emitted
English had drifted; the fills already existed). Fare strings shipped
with their five non-Latin fills (M16). tests/last_bell_fare.test.ts
pins pays/declines/waiver/party/return-leg/drift/timeout/keeper-talk.

### H3: the voyage cinematic and the harbor's voice (2026-07-28)

Paying the fare now letterboxes into the departure: harbor ambience,
one bell toll, and the grand ferry casting off along its bow while the
camera holds the berth, fade to black, fade up at the far pier. The sim
teleports at PAY time, so the whole cinematic is world-coordinate
presentation and an Esc skip at ANY point leaves state identical to a
watched voyage (the scene has zero authoritative ops). The FIRST
crossing splices the departure core and the Q0 arrival into one scene
(scn_lb_q0_voyage) so a single skip covers the whole trip; re-rides get
the short line-free departure per side. New machinery: a 'prop'
SceneWireOp (target key + cue id) routed by the scene director to
src/render/harbor.ts, whose ships register as harbor_ship_<id> and ease
out on a cast_off cue (pure math in harbor_cast_off.ts, a registered
RENDER_PURE_CORES core; a ship un-freezes matrixAutoUpdate ONLY while
its cue is live and refreezes on reset, per review, and the scene end
op resets every cue). Audio: scene music directives map to samples in
src/game/scene_sfx.ts (lb_bell_toll_one stops being a no-op); the bell
toll, harbor ambience, and cast-off takes are DETERMINISTIC BAKED
PLACEHOLDERS from scripts/gen_last_bell_harbor_sfx.mjs through the
standard conform path, with ElevenLabs prompts already in the catalog
for a paid or CC0 replacement. The bell is the campaign's signature
sound: OWNER SIGN-OFF PENDING on the sample, and the departure camera
yaws are authored blind (owner-walk polish expected). The arrival
scene's harbor wide was re-framed to the v4 berth (the old frame missed
the ship).

### H2 v2: the fare moves into the keeper's gossip button (2026-07-28)

Owner playtest verdict on H2 v1: talking to the ferryman showed his plain
greeting dialog with nothing to click, because NPC talk is a CLIENT-side
gossip dialog (quest_dialog_controller.open via click or the F key's
nearby_interaction path) that never routes through sim interact(), where
the fare arm lived. The owner's spec: talk to the dude, press the button,
buy the fare, sail. v2: the keepers' gossip dialog gains a fare button
(ferryFareOfferFor in last_bell/campaign.ts is the one source of truth
for keeper -> choiceId + promptKey; the button labels itself with the
existing lb.fare.prompt keys and the price), and clicking it drives
targetEntity + interact + answerSceneChoice('pay'), so the tested
sim-authoritative flow (charge, waiver, refusal, teleport, cinematic)
runs unchanged on every host and the standalone choice window never
paints (open and answer resolve in the same command batch). The ferry
moorings became pure scenery (non-lootable, sparkle removed): the
keeper at the gangplank is the interaction affordance, not a stick on
the dock. Suites re-pinned to keeper talk; verify pass deferred to
after the owner's session (tight-loop rule: no local runs while the
owner tests).

### The main sync lands (2026-07-30)

Merged feature/last-bell-campaign-main-sync (commit 27ab35a14): the
owner's reconciliation branch that carried the release/v0.32.0 era
integration base and the latest origin/feature/procedural-dungeons into
the campaign, with its own merge-audit round already closed. The only
campaign commit that branch had not seen was the cinematic fix-loop
review closure, and the two sides had refactored the same ship-cue
machinery in parallel: the sync side's HarborShipCueRegistry plus
harbor_ship_update_core won (it subsumes the campaign-side
HarborShipPendingCueState extraction, now deleted), and the campaign's
review finding was ported into it: a world rebuild discards pending
ship cues (registry clear()), because ship registration is synchronous
inside buildHarbors, so any cue still pending at rebuild time was
recorded against the prior world's handles. Registry and attach-core
tests re-pin the merged semantics. Post-merge audit found one stale
generated artifact (the untracked i18n status registry predated the
merge on disk; npm run i18n:gen refreshed it and the S3 guard went
green with a clean tree) and confirmed the campaign's scene wire verbs,
scene-director bindings, and planning-doc premises all survived.
