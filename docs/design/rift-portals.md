# Rifts: procedural infinite dungeons + ranked world portals

A seed-driven, infinitely varied instanced dungeon system ("Rifts"), parallel to
the hand-authored dungeons and delves but in its own coordinate band. Everything
about a rift (geometry, visual style, mobs, boss, mechanics) is regenerated
deterministically from a compact descriptor, so the authoritative server and
every client produce byte-identical content and only the descriptor crosses the
wire, the same model as `terrainHeight(x,z,seed)`.

This doc is the map of the system: where each piece lives, the rules, and the
tests that pin them.

## The two halves

1. **The rift itself** (`src/sim/rift/`): the pure generator plus the per-run
   lifecycle. Entered from a portal, descended floor by floor, ends on a boss.
2. **World portals** (`src/sim/rift/portals.ts`): a scheduler that opens ranked
   (C/B/A/S) portals across the three overworld zones on a timer, announces them,
   and pays out when a rift is cleared.

## Generation (deterministic, descriptor-driven)

- `rift/rift_gen.ts` is a PURE generator. A floor is `generateRiftFloor(seed,
  baseLevel, floorIndex)`: room geometry (`shellPolygon` star-shaped rooms with a
  plain-hall fallback), an `InteriorStyle` colour/fog grade over one of the KayKit
  kits, a spawn plan, a gate (clear-to-open, rune-pylons, ice-slide, boulder-push,
  or a step-in-order sequence), optional lava / rolling-boulder hazards, an
  always-available way-out beacon, and the boss on the last floor. See "Floor
  variety" below. `generateRiftPlan(seed, baseLevel)` names the rift and gives its
  floor count.
- **Determinism invariant.** The generator uses its OWN `Rng` seeded from the
  descriptor, NEVER the live sim rng, so generating a rift never perturbs the
  global draw order the rest of the sim depends on. (Rift content is also never in
  the golden parity traces.)
- Because both hosts run the same generator from the same descriptor, only
  `{seed, baseLevel, floorIndex, origin}` (`RiftDescriptor`) travels over the
  wire; the renderer regenerates geometry from it.

## Run lifecycle (`src/sim/rift/runs.ts`, behind the `SimContext` seam)

State lives on `Sim` as live `ctx` views (`riftInstances`, `riftPortalIds`,
`naturalRiftPortals`, `riftPortalSpawnCount`); behaviour lives in the module. The
per-tick drivers `updateRiftTriggers` (walk-in/descend/exit/pylon triggers) and
`updateRiftInstances` (gate progression + empty-slot cleanup) are called from
`tick()`; `enterRift`/`leaveRift`/`descendRift` are on the seam for the dev
command + interaction click paths.

- **Enter:** walking into (or clicking) a `rift_portal` object calls `enterRift`
  with the portal's descriptor. A party sharing a portal shares the instance.
- **Level 20 gate.** Every rift is endgame: `enterRift` refuses a player below
  `RIFT_MIN_LEVEL` (20) with a localized denial line, in EVERY zone (the Eastbrook
  portal exists for low levels to see, but turns them away). The gate is applied on
  the portal path only; a direct programmatic `enterRift` (tests) is not gated.
- **Descend:** clear the floor (kill the trash AND solve its puzzle: light the
  pylons, slide onto the frost sigil, socket the boulders, or step the sequence) to
  open the descent; walk onto it to regenerate the next floor in place and teleport
  the whole party there. Stuck or overwhelmed? The entry beacon takes you home.
- **Boss + exit:** the final floor's exit (the way home) opens only when the boss
  dies, alongside a sealed reward cache to lockpick for bonus spoils.
- **Leave / death:** walking into the exit returns you to the overworld return
  position; dying sends your spirit to the overworld cemetery nearest where you
  entered. The return position is pushed clear of the portal's walk-in radius and
  a short re-entry grace is set, so leaving never bounces you back in (regression
  in `tests/rift_sim.test.ts`).
- **Collision.** A floor's collision comes from its generated layout, published to
  a per-`Sim` region registry in `colliders.ts` keyed by a per-instance
  `riftCollisionToken` (NOT the world seed, so two same-seed `Sim`s in one process
  stay isolated).

## Floor variety: puzzles, hazards, and the way out (v3)

Every non-boss floor layers ONE headline mechanic on top of the clear-the-room
requirement, so an endless run never reads as the same corridor twice. All of it is
generated from the floor descriptor (pure, deterministic) and placed on or around
the always-clear central spine (`|x| <= AISLE_HALF`), so the entry-to-dais path is
always walkable and every puzzle is solvable by construction.

- **Layouts.** A `corridor` room archetype (thin winding passage) joins the shape
  set, and other floors may grow one-sided baffle walls: alternating stubs that
  force a serpentine path without ever crossing the spine.
- **Puzzles** (`RiftPuzzleKind`, `planPuzzle`), each gating the descent exactly like
  a full set of lit pylons (`puzzleSolved`):
  - `rune_pylons`: walk onto every pylon to light it (pre-v3).
  - `ice_slide` (FFX / Pokemon): the floor carries a frictionless `iceZone`; moving
    onto it flings you along your heading until a wall stops you (reuses the swept
    `resolveMovement` resolver). Stop on the Frost Sigil to solve it.
  - `boulder_push` (Pokemon Strength): shove each heavy boulder one heading-step at a
    time onto its socket pad; every socket filled solves it.
  - `sequence` (Simon / pattern memory): step the runes south-to-north; a skipped
    step goes dark and resets to the start.
- **Hazards.** `planHazards` lays molten lava bands (the delve blackwater damage
  model, `tickRiftHazards`, 1 Hz, jump to clear); `planRollers` sends a rolling
  boulder down the spine (`advanceRiftRollers`, 20 Hz motion; overlap bowls you
  aisle-ward and chips HP on a short cooldown; jump to clear). A floor carries at
  most one of lava / roller / ice, never a pile-up.
- **The way out.** A `rift_beacon` at the floor entry returns you to the overworld
  any time (walk-on or click), so a run is never a dead end (too hard, stuck, lost).
- **Victory gate.** The post-boss exit renders as the same "dimensional gate" GLB as
  the overworld portal, tinted by the run's rank (`exit.riftTier`), so beating the
  giga-boss tears the way home open rather than dropping a plain stone arch.
- **Verticality** (`RiftPlatform`, `planPlatform`): a floor can step UP toward the
  dais over a full-width staircase to a raised rear "sanctum", so it has two walkable
  levels. `riftPlatformLift(platform, localZ)` is a single-valued height field (pure
  function of local depth) applied as a POST-movement Y lift to everything in the
  rift; the movement kernel (`player_motion.ts`) is never touched, and the online
  client's self-prediction is gated off in rifts so it renders the authoritative Y
  with no stair jitter. Boss floors raise when the room is long enough; ~30% of other
  floors do too, never with a roller/lava/ice. See "Verticality" note below.
- **Sealed cache + lockpicking** (`rift/rift_lockpick.ts`): the giga-boss also drops a
  `rift_locked_chest` the party can pick for bonus copper spoils, REUSING the pure
  "Tumbler's Path" engine (`sim/lockpick.ts`) and the SAME client HUD + wire
  (`lockpickOffer`/`Session`/`Step`/`End`/`Bonus`) as the delve chests. The session
  lives on `RiftInstance` (never a `DelveRun`), so the delve lockpick controller is
  untouched; `Sim.lockpick*` dispatches to the rift driver when the player is in a
  rift, else the delve one. The lid swings open + the keyhole pulses on solve.
- **Render.** Puzzle props (pylons, frost sigil, boulders + sockets, sequence runes,
  the beacon, the roller, the cache) are procedural bodies in `buildRiftPuzzleProp`
  (`src/render/door_portal.ts`); lit/placed/open states swap by `templateId` (the view
  rebuilds on change), glowing nodes spin, and the roller rolls with its motion. The
  lava/ice overlays and the raised deck + staircase are drawn by `buildInterior`
  (`src/render/dungeon.ts`).
- **Interaction VFX.** Every interactive MOMENT punches a themed effect via the
  already-wired `spellfxAt` world event (a `riftFx` helper in `rift/runs.ts`), so the
  slide, shove, flare, burn, and wallop read on all three hosts with no new wire:
  frost spray on an ice-slide launch + a nova on the frost sigil; grinding dust as a
  boulder scrapes forward (deterministically throttled) + a nova per socket on solve;
  an arcane flare per sequence/pylon light, a bright holy nova on the final one, a
  shadow puff on a sequence reset; fire licking up on a lava burn; a heavy dusty nova
  when the roller bowls you; a spoils burst / dark puff on a cache pick success/fail.
  All render-only (no rng, no sim state), so determinism holds.

## Floor variety additions (v4)

A second polish pass, all still descriptor-driven and within the region bounds
(`RIFT_REGION_HALF_X/Z`, so the far dais + side walls stay inside the trigger region):

- **Bigger, more varied floors.** Longer naves + wider envelopes (`buildLayout` dims),
  so runs feel grand, not cramped. Baffle walls are now SHORT wall-hugging fins (both
  the spine and the far side stay open) rather than long walls: you weave around small
  obstacle bits. Pylons/runes are placed a good fraction inside the width and cleared
  by their prop radius (`toClear(..., r)`), so a prop never renders embedded in a wall.
- **Elevation everywhere + varied bosses.** `planPlatform` runs on ~50% of non-boss
  floors (was 30%) in two flavours: a steep rear sanctum OR a long gentle climb that
  lifts most of the nave. Only ~55% of boss floors sit on a dais now (a flush arena is
  a change of pace). The renderer treats the raised tier as floor: it adds
  `riftPlatformLift` to the airborne heuristic's ground reference so a standing/climbing
  player animates walk/run instead of freezing the jump pose (the v3 lift regressed
  this). The stair step-count scales with ramp length.
- **Ice slide is a real glide + maze.** Pushing onto the frost sheet locks your heading
  and glides you a fixed step per tick (input-locked, frozen `riftSliding` pose, wired
  `sld`) until a wall/rock stops you or you skate off the edge; `addIceBlockers`
  scatters rocks (Pokemon-style) while keeping a clear central north corridor to the
  Frost Sigil (solved by sliding through it, radius 4).
- **Switch-gate** (`planGate`, `RiftGate`): a subset of otherwise-plain floors bar the
  nave with a portcullis until you step its pressure plate (south of the gate). The
  closed gate is a RUNTIME clamp (never a static collider, so the spine invariant
  holds) that shoves you back to its south face; the plate flips `gateOpen`, retracts
  the bars, and emits "The gate grinds open."
- **Off-path treasure + illusion walls.** ~45% of non-boss floors hide a golden reward
  chest in a wall pocket behind an `illusionWalls` panel (rendered solid, NO collider,
  so you walk through the "dead end"). Interact (`riftOpenTreasure`) rolls real item
  loot (rank-scaled `delveChestItemsForTier`), grants it, and pops the shared loot
  overlay (`delveChestLoot`). No lockpick.
- **Epic pylon/rune assets (Tripo).** `rift_flame.glb` crowns a lit pylon (an arcane
  flame from a brazier, flickering, replacing the old crystal/beam) and `rift_rune.glb`
  is the sequence-rune monolith (its baked runes reused as an emissive map so they glow
  in the murk). See CREDITS.md.
- **Minimap** shows the rift floor name + rank (`world.riftFloor.tier` threaded through
  the `riftState` event) instead of the overworld zone. The **way-home beacon** is a
  real upright swirling portal, not a flat decal.

## Set-piece floors: The Infernal Citadel

Roughly one seed in seven (`isSetPieceSeed`, `Rng(mix(seed, 0x1f3e)).chance(0.15)`) opens a
HAND-AUTHORED dungeon instead of a procedural descent: a fixed TWO-FLOOR citadel
(`INFERNAL_FLOOR_COUNT`) with two bosses, the halls above and The Pit below. Because the theme
is chosen by the SEED; the citadel is C-rank content only. B, A and S portals on a set-piece seed
open a procedural descent instead (`isSetPieceRift` requires `riftHeroicTuningFor(baseLevel) === null`).
The two authored bosses (ritualist, pitlord) run their full hand-tuned kit at every level; they are
exempt from the procedural rank-mechanic budget so the citadel identity is never stripped by rank gating.

- **The authored-layout seam** (`src/sim/rift/authored.ts`). `DungeonLayout` gained optional
  `rooms` / `doors` / `decor`. `authoredWallSegments(rooms, doors)` unions every coincident room
  edge and subtracts the doorways; BOTH `layoutColliders` (collision) and
  `dungeon.ts placeAuthoredWalls` (render) build from those same segments, so a wall you see is a
  wall you bump into. The single-nave, clear-central-spine invariants of the procedural generator
  do NOT apply to an authored floor (`RiftFloorPlan.authored`); the procedural playability tests
  skip set-piece seeds and `tests/rift_infernal.test.ts` pins the room graph instead
  (reachability BFS over the door graph, spawn/decor clearance, region bounds).
- **Floor 0, the halls** (`src/sim/content/rift/infernal_citadel.ts`, data-as-code). Broad
  gatehouse, Sacrificial Hall (altar + Blood Orb), Relic Gallery (gibbets, a cache behind an
  illusion wall), West Processional (a lava band), Pentagram Rotunda, Bone Chamber, and the
  stairhead. The west wing loops back into the central route, so killing the Magus gives a short
  return to the Orb; the Bone Chamber remains a compact optional branch and cannot bypass the
  portcullis.
- **The gating chain.** Kill **Magus Vel'Kor the Pactbound** on the pentagram; the Blood Orb on
  the altar wakes (`orbActive`, a templateId swap like a lit pylon). Touch the woken orb and the
  portcullis grinds open: a `RiftGate` with `openOnOrb`, NO pressure plate, reusing the runtime
  clamp (never a static collider). Behind it the stairhead holds the **Rift Descent**, the only
  way down (a BFS test pins the gate as the sole cut to it). Both transitions have positional
  audio: ground-anchored `spellfxAt` novas play the shared nova clip layered with a
  school-flavored impact, so the orb's fire flare and the gate's holy release each read.
- **Floor 1, The Pit.** The descent lands on a raised balcony (lift 3.2) above the temple nave
  tier (1.6); the arena where the giga-boss **Azgorath, Lord of the Pit** waits drops to the pit
  floor (0), with the Hell Forge wing (molten-runoff hazard, forge cache) off the nave. His death
  opens the usual exit + sealed cache + the rank-gated clear loot, and the won run SEALS its
  entry portal (dev portals included), so a cleared rift can never be re-entered.
- **Authored relief.** `AuthoredRoom` carries an optional per-room `lift`; the pure
  `authoredLiftAt(rooms, doors, x, z)` turns every lift-changing door into a linear stair ramp,
  and `riftLiftAt` is the ONE entry point read by the sim's entity lift, the movement kernel
  strip, the renderer's ground reference, the camera clamp, and the riser/stair geometry
  (`placeAuthoredRelief`), so sim ground and drawn geometry agree by construction on all hosts.
  Both bosses reuse existing rigs (`mob_demonalt`, `skel_necromancer`) re-tinted by their
  templates; the miniboss rides `RiftSpawn.miniboss` so `bossId` (and the payout) stay the pit
  lord's.
- **Assets.** Ten Tripo-generated props (brazier, altar, demon idol, hell forge, hanging cage,
  bone pile, obsidian fang, hooded sentinel statue, slag cauldron, bone throne; see CREDITS.md),
  placed by `src/render/rift_decor.ts` with footprints MEASURED from the built GLBs, so decor
  collision matches the models, and each riding its room's lift. Authored light sources spawn
  real point lights on the shared budgeted fire-light seam; wall modules are fitted to their
  segments (`fitAuthoredWallSegment`) so a short piece never visually covers a doorway. The
  pentagram sigil and the rugs are procedural (a generated mesh of a flat sigil reads as a
  lumpy disc).
- **Dev command.** `/dev portal [seed] [level] [C|B|A|S] [infernal|random]` forces the dungeon
  type. The kind is NOT a wire field: it searches for a seed of the requested kind (the roll is a
  pure function of the seed), so the descriptor stays `{seed, baseLevel, floorIndex, origin}` and
  every client regenerates the same dungeon from it.

## Ranks (C / B / A / S) and world portals (`src/sim/rift/portals.ts`)

A scheduler opens ranked portals automatically. Tuning is `RIFT_TIER_INFO` plus the
`RIFT_PORTAL_*` constants at the top of the module.

- **Cadence.** The first population fills ~2 min after boot
  (`RIFT_PORTAL_FIRST_AT`). Past that, each ELIGIBLE ZONE keeps its own hourly
  respawn boundary (`RIFT_PORTAL_ZONE_CYCLE`, 1 h), anchored on that zone's own
  last opening: at a boundary the zone gets a new rift UNLESS its current one is
  still open, in which case that boundary is skipped and the zone is re-judged
  at the next one (`riftZoneNextOpenAt`, derived purely from the zone's own
  event history: no per-zone persisted field, no schema change). The scheduler
  still spawns at most one portal per pass even when several zones are due at
  once. Enabled by `SimConfig.riftPortals` (on for the live server and the
  offline client; OFF by default so tests / parity / the RL env stay
  portal-free).
- **Determinism.** Each spawn rolls rank, position and rift seed from a
  DEDICATED `Rng` derived from `(worldSeed, spawnOrdinal)`, never the shared
  stream, so adding the scheduler shifts no existing draw order. Which zones are
  due is itself rng-free: pure arithmetic over each zone's own event history.
- **Zone to rank pool** (`riftTierForZone`): eligible regions are The Amberfall,
  The Drakelands, The Evergarden, The Farshore, The Frostveil Reach, The
  Galecrest, The Nightbloom, The Palmreach, The Veiled Hollow, The Willowfen,
  and The Wraithwood. Each region owns its C/B/A/S weights. The rank sets the
  generated dungeon's `baseLevel` (C=20 up to S=28, so B+ runs above the level
  cap) and the reward.
- **Lifecycle:** a portal ANNOUNCES world-visibly on open, stays until its rift's
  final boss dies (SEALED) or `RIFT_PORTAL_LIFETIME` (2 h) passes uncleared
  (COLLAPSED), each with its own world announcement. The close time feeding the
  zone's hourly schedule is read straight off the event record: the first-clear
  timestamp for a sealed rift, `expiresAt` itself for a collapsed one.
- **Rewards.** Rifts pay NO Heroic Marks at any rank (maintainer decision: marks
  stay a heroic dungeon/raid currency). The clear prize is the rank-gated gear
  ladder on the boss corpse (C a guaranteed themed rare + coin; B/A/S the epic
  ladder up to the S legendary), the natural-first-clear personal rings, essence
  and gems, the mount rolls, and the rank coin bonus. Dev-portal runs (tier
  null) still pay the gear ladder but no first-clear extras. A race LOSER pays
  nothing at completion (egress only, no gear ladder, no sealed cache): losers
  keep only what dropped off the mobs during the run.
- **Population policy (all realms).** A zone only receives a new rift at an
  hourly boundary once its current one has CLOSED. A rift that closes at 1:30
  (measured from its own opening) respawns at the 2:00 mark; one that closes at
  0:45 respawns at 1:00; one that is never cleared collapses at
  `RIFT_PORTAL_LIFETIME` (2 h), which, being an exact multiple of the cycle, is
  itself a boundary, so the replacement spawns immediately. A first-cleared
  (sealed) zone can never be immediately refarmed. The cadence derives from the
  persisted event history (latest event per zone: its opening plus its close),
  so restarts preserve it without extra saved state. The former
  `COMMUNITY_TEST_RIFTS` public-test flag is gone: this is the one policy on
  every host.

## Client sync + render

- `IWorld.riftFloor` (`RiftFloorView`) + a `riftState` event carry the descriptor
  to the client; the renderer regenerates geometry/fog from it. Collision isolation
  remains private to each `Sim`; it is not part of `IWorld` or `ClientWorld`.
- The world portal renders a bespoke "dimensional gate" GLB
  (`public/models/props/rift_portal.glb`, in the boot preload) via
  `buildRiftGateBody` in `src/render/door_portal.ts`, with a rank-tinted swirling
  energy membrane filling the opening. The rank shows as a floating C/B/A/S badge
  (`src/render/rift_rank.ts`). The rank COLOUR is the single source `RIFT_TIER_COLORS`
  (`src/sim/types.ts`), shared by the gate shimmer, the badge, and the chat alert.
- The rank on the wire is the terse `rt` field (render-only, see `server/game.ts`
  `identityFields` + `applySnapshot` in `src/net/online.ts`).

## i18n

`src/sim/` is language-agnostic: rift player text is emitted as English literals
and re-localized client-side by `sim_i18n.ts` (the `sim.rift.*` keys + matcher
RULES). `src/sim/rift/runs.ts` and `rift/portals.ts` are under the S3 drift guard
(`tests/localization_fixes.test.ts`), so a new rift emit with no matcher fails CI.
Mob names are fully localized incl. the five non-Latin fills; the C/B/A/S rank
LETTER is a game glyph (like item-quality colour), not translated.

## Dev commands (gated by `ALLOW_DEV_COMMANDS`, never in production)

- **`/dev portal [seed] [level] [C|B|A|S]`** spawns a walk-through portal in front
  of you. Fresh seed each time (or a fixed one), level defaults to yours, and an
  optional rank letter forces the tier (colour + badge); omitted, a random rank is
  rolled so a dev portal always shows its coloured shimmer and letter.
- **`/dev god`** toggles invulnerability; **`/dev smite`** toggles one-shot mode.
  Handy combo to tour the giga-boss rifts solo: `/dev god`, `/dev smite`,
  `/dev portal`, walk in.

## Tests (the coverage map)

- `tests/rift_gen.test.ts`: generator determinism / variety / playability /
  balance, shape variety, boss-arena fit.
- `tests/rift_mechanics.test.ts`: the v3 variety (generator surfaces every puzzle +
  hazard kind, boss floors stay clean, ice-goal solve, boulder socketing, sequence
  step + reset, the way-out beacon, lava damage, the rolling boulder's motion +
  knockback, the raised-tier lift, and the boss-cache lockpick solve + abort).
- `tests/rift_sim.test.ts`: full enter/descend/boss/exit lifecycle, rotated-OBB
  clearance matching runtime `pushOut`, two-`Sim` collision isolation, the
  entry-zone graveyard on death, the client-sync `riftState` event, and the
  leave-does-not-bounce-back-in regression.
- `tests/rift_infernal.test.ts`: the authored set-piece (seed selection + rank
  independence, determinism, the room-graph geometry and door reachability, the
  two-boss content, and the full miniboss -> orb -> gate -> giga-boss lifecycle).
- `tests/rift_portals.test.ts`: zone->rank mapping, monotonic rank tuning, the
  scheduler (cadence + world announce + determinism + collapse), the level-20
  gate (deny + admit + rank stamping), and sealing paying NO Heroic Marks at any
  rank (the no-marks contract, incl. the untouched heroic daily ledger).
- Cross-cutting guards that also cover rifts: `tests/world_api_parity.test.ts`
  (the `riftFloor` IWorld member), `tests/architecture.test.ts`
  (sim purity + the `rift_rank`/render pure-core registration), `tests/sim_context.test.ts`
  + `tests/entity_roster.test.ts` (the seam stubs), and `tests/localization_fixes.test.ts`
  (S3 rift emit drift).

## Known scope / deferred

- Rift EVENT state persists across restarts (`rift/persistence.ts`: portal
  deadlines, event history, winners, scheduler state, upgrade artifacts, with
  manifests re-validated on load); runtime PARTY instances stay ephemeral and are
  never restored. The AI Dungeon Upgrader and runtime asset bridge that ride the
  events are documented in `docs/design/rift-mode.md`.
- **Dungeon break** (an uncleared portal spilling mobs into the overworld) is
  deferred: the design intent is to build a whole new zone around that mechanic
  (NPCs aware of the breaks, defend-the-town). The open/sealed/collapsed portal
  lifecycle here leaves the seam for it.
- **Verticality is single-valued** by design (a height field, not stacked floors):
  you can climb a staircase to a raised tier, but not walk UNDER it. This is the only
  form the shared `groundHeight`/2D-collision model allows; true stacked geometry
  would need a second collision layer across all three hosts and is out of scope.
- `trimEventHistory` keeps the most recent `RIFT_EVENT_HISTORY_LIMIT` (64)
  completed events across ALL zones combined, not per zone. A quiet zone's
  latest event can in principle be trimmed away by busier zones elsewhere,
  after which that zone's schedule reads as "no history" and it becomes due
  immediately rather than waiting out its real boundary. Harmless at today's
  cadence and zone count, but the schedule is silently coupled to this limit.
