# Revamping Eastbrook: the New Eastbrook program master plan

Status: ACTIVE epic. Integration branch `feature/eastbrook-v0.39.0`, based on
`release/v0.39.0`, PR "revamping eastbrook". This document is the program's
source of truth for scope, the land plan, the demolition map, and the open
decisions. It follows the program-doc pattern of
`docs/design/eastbrook-vale-rebuild/` and `docs/design/fenbridge-rebuild/`
(Fenbridge's `master-plan.md` is the closer template: a locked contract, then
the site plan, then phased work).

## 1. Program goal

Build New Eastbrook: a coastal harbor town in the vale's southern basin,
the arrival shore of the whole game. The owner's brief (2026-08-17, locked
in section 3): new players finish a tutorial on an island offshore to the
east (a SEPARATE workstream, not this program) and are ferried across the
sea into Eastbrook's docks, stepping off a pier straight into town. The
town itself is a FULL REBUILD, not an extension: much larger than the old
circle, deliberately spaced out, NON-circular layout, NPCs distributed
instead of clustered, because every new player funnels through Eastbrook
and the old tight ring overwhelms.

The land changes that follow from the brief:

- The Sowfield boarball stadium (the Vale Cup minigame's home) is REMOVED
  from the game; the town rises on its basin.
- The old walled town circle at the origin is DISMANTLED once the new town
  stands; its ground becomes the NEW Wolf Run (the wolves move inland and
  reclaim the old town's fields).
- The Copper Dig moves to the vale's NORTHEAST, near Mirror Lake on the way
  to the Mirefen border. Phase 0's coastal dig headland (built before the
  harbor decision existed) REVERTS to open sea: that water is the ferry
  lane and harbor mouth.
- The docks rise on the town's eastern flank, on the ground the dig vacated
  in phase 0, with the sea carved in to meet clean walkable piers, ships,
  and the ferry berth.

Everything else in this plan happens as sub-work on the epic branch, by any
contributor, one concern per PR, gate green at every merge
(`node scripts/gate_select.mjs`).

## 2. How to contribute to this epic

- Branch a worktree off `feature/eastbrook-v0.39.0`, land your slice back into
  the epic branch as a focused PR. Never straddle a release boundary; regen
  artifacts ride at the tip of each slice (the castles-port discipline).
- Claim a work item by editing its checkbox line in the epic PR description
  (add your handle), so two people never demolish the same wall.
- The three-class pipeline applies: docs are Class A (merge fast), text-only
  content wiring is Class B, world-mutating changes are Class C (full
  content-obligations checklist, parity re-records, one concern per PR).
- Compass convention, stated once because it bites: in this world +z is north
  and +x is WEST, so east is negative x. The Copper Dig at negative x is
  southeast of town. Screen-space "west" in older docs (the Vale Cup PRD) is
  in-fiction east.

## 3. The land plan (v2, the owner's 2026-08-17 brief)

Compass reminder: +z is north, +x is WEST, so east is negative x. The
tutorial island sits offshore beyond the vale's east coast; it is another
contributor's workstream and this program never builds it, only the shore
that receives its ferry.

The macro moves, as one rotation of the map's northwest-to-southeast axis:

- THE TOWN: New Eastbrook fills the southern basin (the Sowfield parcel,
  `SOWFIELD_EXCLUDE` x [-66, 44], z [-151, -73], flat at -2.6 once the
  stadium goes) and spreads onto the freed dig flank to its northeast
  (x [-104, -65], z [-82, -29]). Full rebuild: spawn, every town NPC, and
  every service moves here. Layout requirements from the owner: much larger
  footprint than the old circle, generously spaced, NON-circular (no rings,
  no radial wall), NPCs distributed across districts instead of pooled at
  one center, because the whole playerbase funnels through this town.
- THE DOCKS: on the town's east flank around the old dig ground, the sea
  carved in to meet them (the harbor takes a bite of the pastures coast).
  Clean walkable piers, moored ships, a ferry berth facing the open east
  water where the tutorial-island ferry arrives. Classic coastal town:
  docks against the town, a harborfront street, the arrival experience IS
  the town's front door.
- THE FERRY LANE: the east water from the harbor mouth outward stays OPEN
  SEA. Phase 0's dig headland (lobe + stamp + relocated cluster) sits in
  exactly that water and REVERTS in phase 0b.
- OLD TOWN TO WOLF RUN: the walled circle at the origin is dismantled after
  the new town takes over. The wolves move inland onto that ground: the new
  Wolf Run is the old town's fields (Old Greyjaw prowling the leftover
  foundations is encouraged scenery). Their old northern range frees up.
- THE COPPER DIG: re-relocates NORTHEAST, near Mirror Lake on the way to
  the Mirefen border (the band northeast of the lake toward the north road,
  roughly x [-40, -90], z [90, 140], exact site probed like phase 0). Its
  neighbors there (the murloc shore camp, the lake herb field, the fishing
  dock) constrain placement; the gather-node margin suites arbitrate.
- LANDMARKS THAT STAY: Reliquary Hill (POI (-5, -52), delve door, ruin
  ring) and the Vale Chapel Yard graveyard (4, -56) become the green seam
  between the new town and the old-town-turned-Wolf-Run. The bandit camps
  and Gorrak (x +50 to +95), Sableweb, Boar Meadow, and Mirror Lake itself
  do not move.
- DIRECTION PROSE: the town hub MOVES, so every "direction of town" phrase
  in quest and guide text re-derives from the new hub. The compass-truth
  suites enforce the sweep mechanically; budget for it in the town slice.

## 4. Phase 0, DONE in this PR: the Copper Dig relocation

SUPERSEDED IN PART by the v2 land plan: the harbor decision puts open sea
where phase 0 authored the dig headland, so phase 0b (section 4b) reverts
the headland coast authoring and moves the cluster to its northeast home.
The rest of phase 0 stands (the basin flank stays clear, the relocation
machinery and its test lanes are the template phase 0b reuses). The record
below stays as shipped history.

The whole mine cluster translated rigidly by (-60, -24) to a new coastal
headland, keeping every intra-cluster distance, the town bearing (still
southeast, so no quest or guide text changed), and the camp's radius/count.

| Piece | Old | New |
|---|---|---|
| POI `copper_dig` (`ZONE1_ZONE.pois`, index 5) | (-84, -64) | (-144, -88) |
| `tunnel_rat` camp (ZONE1_CAMPS, index 8, in place) | (-82, -62) | (-142, -86) |
| Grix the Tunnelking camp (`src/sim/data.ts` CAMPS tail) | (-95, -78) | (-155, -102) |
| Mine portal prop (`ZONE1_PROPS.mines`) | (-88, -68) | (-148, -92) |
| Camp campfire | (-80, -60) | (-140, -84) |
| Ore veins `ore_eastbrook_1..6` | 20 yd ring on the POI | same ring, translated |
| Mine road (`ZONE1_ROADS`, southeast) | ended (-70, -55) | extended to (-132, -82) |

Because the vale's southeast held no dry land big enough for the camp's 33 yd
scatter disc (the old site was the only 36 yd dry pocket in the quadrant),
the relocation AUTHORS its ground, using two existing mechanisms:

- A new coast lobe in `VALE_LAND_LOBES` (`src/sim/world.ts`): "the dig
  headland", centered (-138, -95) r 58. Landness only; it makes the ground
  land instead of open sea for the map, water rules, and the coast applier.
- A `mode: 'level'` terrain stamp `COPPER_DIG_TERRAIN_EDITS`
  (`src/sim/content/zone1.ts`, merged into the builtin world's `terrainEdits`
  beside the jail's): holds the site at working grade (-0.6, smooth falloff,
  r 70). Stamps apply after the coast in `terrainHeightUnpadded`, so the
  headland cannot be drowned back.

Consequences carried in the same change:

- `ONLINE_WORLD_LAYOUT_VERSION` bumped 6 to 7 (`src/world_api.ts` states the
  rule: a differently shaped authoritative world is a new epoch), with the
  script mirror `scripts/lib/world_auth.mjs`.
- Test re-pins, each annotated at the site: the camp left the starter band so
  it left `tests/eastbrook_camp_spacing.test.ts`'s governed set; literal
  coordinate pins moved in `tests/eastbrook_gameplay_integration.test.ts`,
  `tests/editor_persist.test.ts`, `tests/fixes.test.ts`,
  `tests/gather_tool_use.test.ts`, `tests/map_window_view.test.ts`,
  `tests/gather_node_placement.test.ts` (the Grix counter-example pair), and
  the parity scenario teleport in `tests/parity/scenarios.ts`.
- Regenerated at the tip: six parity goldens (world-gen rejection sampling at
  the new site shifts the shared draw stream; diffs are value-shaped only,
  and `professions_gather` keeps its `poi:eastbrook_vale:copper_dig` visited
  mark), the terrain-height parity fixture, and the `eastbrook_vale` +
  `world_strip` map plates (`npm run assets:mapbg`; the other zones' plates
  differ from this machine's encoder only and were deliberately restored).
- Verified green: `tests/gather_nodes.test.ts`,
  `tests/gather_node_placement.test.ts`, `tests/copper_dig_pathing.test.ts`
  (real-sim spawn + melee reach at `WORLD_SEED`),
  `tests/eastbrook_camp_spacing.test.ts` (spawnability probe at the new
  site), the compass-truth and quest-direction suites (unchanged text still
  true), threat, guide freshness, and the full parity suite.

## 4b. Phase 0b, OPEN: dig to the northeast, headland back to sea

The reverse-and-redo of phase 0's placement, same rigid-cluster machinery:

- Remove the dig headland lobe from `VALE_LAND_LOBES` and the
  `COPPER_DIG_TERRAIN_EDITS` level stamp: the east water reopens for the
  ferry lane and harbor mouth.
- Translate the whole cluster (POI, camp, Grix, portal, campfire, six
  veins) to the probed northeast site near Mirror Lake; re-route the mine
  road tail off the old southeast spur and onto the northern road network.
  The southeast road reverts to a harbor approach the town slice owns.
- The murloc camp, lake herb field, fishing dock, and Mirror Lake's
  waterline are the placement constraints; the same suites that gated
  phase 0 arbitrate (camp spacing, gather margins, copper_dig_pathing,
  compass truth: the direction word re-derives from whichever hub is
  current when the slice lands, so sequence this AFTER the town hub moves
  or budget two prose touches).
- Expect the full phase-0 ripple again (parity, terrain fixture, plates,
  chunk digests, seeded hunts, balance diet lanes) plus a layout epoch
  bump riding whichever slice lands first in a release window.

## 5. Phase 1, OPEN: remove the Sowfield and retire the Vale Cup

Removing the stadium removes the minigame's only venue, so this phase retires
the whole feature. It is far too entangled for one commit: the surface is
roughly 9k LOC of dedicated modules, 6k LOC of dedicated tests, and about 200
other files with references. The work splits into the claimable slices below;
each slice must leave the gate green, which sometimes means a slice carries a
temporary shim the next slice deletes.

Before any slice lands, read section 6: several removal decisions are the
maintainer's, and slices S5 to S7 depend on them.

- [ ] S1 world/render shell: delete the physical stadium. The terrain flatten
  arm + stand lift + decoration exclusion in `src/sim/world.ts` (and the
  `sowfieldFlatten` slot in `src/sim/terrain_region_index.ts`), the collider
  push in `src/sim/colliders.ts` (lower the monolith ceilings in
  `tests/monolith_budget.test.ts` after each extraction-by-deletion), the
  calm-anchor pad, `src/render/vale_cup_stadium.ts` and its renderer wiring,
  the place-keyed sky, foliage/grass/motes suppressions, world audio bed, and
  `src/game/instance_music.ts` gates. Regen: terrain parity fixture, map
  plates, parity goldens.
- [ ] S2 sim feature: `src/sim/social/vale_cup.ts` + `vale_cup_bots.ts`, the
  ball (`src/sim/vale_cup_ball.ts`, mob record, entity cadence carve-out),
  sport abilities in `src/sim/content/vale_cup.ts` and their effect-dispatch
  arms, the tick phase (it draws ZERO shared rng, so its removal is
  draw-order safe by the same rule that let it append), the `vcup` SimContext
  callbacks (their removal needs a maintainer note: the callback registry is
  append-only by stated intent), hostility/damage-truce arms, cross-system
  exclusions in arena/yumi/card_duel/unstuck.
- [ ] S3 wire and server: the `IWorldValeCup` facet, both world
  implementations, the six `vcup_*` dispatch cases, delta keys
  `vcup`/`vcupb`/`sport`, the realm-readout memo tenant, presence name, kick
  paths, `scripts/vale_cup_online_probe.mjs`. Re-pin: `IWORLD_MEMBERS`,
  `FACET_MEMBER_ARRAYS`, `ALL_DELTA_KEYS`, `EXPECTED_DISPATCH_COUNT`,
  `CALLBACK_KEYS` (values as of the v0.39.0 base are tabled in the epic PR
  description).
- [ ] S4 UI: the thirteen `src/ui/vale_cup_*` modules, hud.ts construction
  and update sites, the 'sport' hotbar form, the KeyY keybind, gossip button,
  DOM nodes in `index.html`/`play.html`, mobile CSS, i18n catalog blocks
  (`hud_chrome.ts` vcup block, guide keys) with `npm run i18n:gen` regen.
- [ ] S5 POI index 10: remove "The Sowfield" from `ZONE1_ZONE.pois` WITHOUT
  shifting The Farshore Causeway off index 11. Locale keys are positional
  (`entities.zones.eastbrook_vale.pois.N.label`) and
  `src/ui/server_i18n.ts` hardcodes `poiIndex: 10`, so this slice must
  renumber every locale overlay row and the admin mirror in the same change,
  or the maintainer pre-approves a tombstone entry. Decide with section 6.
- [ ] S6 content obligations: the 11 vale cup deeds, the Boarball Legend
  Reliquary title row, Steam/Epic achievement maps, daily-rewards task type
  and its two renderers, guide page + routes + `npm run wiki:content`,
  sitemap regen, deed art files and `src/ui/deed_image_ids.ts`, the icon
  glyph. Blocked on section 6 decisions.
- [ ] S7 assets and audio: the two Sowfield music tracks + music zone +
  mix-policy flag, the two SFX (manifest regen via `npm run sfx:manifest`),
  the two HDRs, ball portraits/webp art, `CREDITS.md` rows. Check
  `docs/achievements/` provenance records stay as history (they are records,
  not live pins, except `vale-cup-ball-portrait` which
  `tests/vale_cup_ball_portrait_art.test.ts` pins until S8 removes it).
- [ ] S8 tests and docs: delete the 18 dedicated suites, sweep the ~68
  brushing suites, regen `scripts/ci_shard_weights.generated.json`, update
  `README.md`/`DESIGN.md`/CLAUDE.md mentions, and mark
  `docs/prd/vale-cup.md` superseded (done in this foundation) plus
  `bot/logic.ts` + `server/discord_activity.ts` Discord surfaces.
- [ ] S9 Groundskeeper Bram: decide his fate in section 6 (delete, or rehome
  as a New Eastbrook NPC; he is a full NPC record with voice lines).

## 6. Decisions that are the maintainer's (do not guess in a slice)

1. Player-earned records: the 11 vale cup deeds sit in players' persisted
   `deedsEarned` with Renown attached, and `pvp_vcup_wins_25` grants the
   "Boarball Legend" title (a locked glossary term). Deleting the deed
   catalog rows wipes earned progress; the shipped-content precedent
   (`RETIRED_HEROIC_ITEMS`) suggests RETIRING instead: keep the records,
   remove every acquisition path. The deeds table is append-only by its own
   header, which argues retirement too. Needs an explicit call.
2. The eight persisted `vcup*` meta counters in player saves: migration,
   or dead-field tolerance.
3. Steam/Epic achievements already unlocked externally cannot be revoked:
   confirm the mapping just goes dark (and new unlocks become impossible).
4. Daily-rewards ledger rows of type `vale_cup_result` already in the
   database: keep the two renderers as tolerant dead branches, or migrate.
5. The Vale Cup nation lore (eight banner nations, the Copper Pail, Marshal
   Redbrook's harvest truce): worth carrying into New Eastbrook's lore as
   history? The Sowfield's "the goal was once a grave" hook in
   `docs/design/world-lore.md` suggests the site's story continues. Pairs
   with the ORKADIA "Undreamt" precedent in the lore rework plan.
6. Bram's rehoming (S9), and whether a future venue elsewhere ever revives
   boarball (affects how aggressively S2 deletes vs quarantines).
7. The opt-in five-seed balance full sweep (WOC_FULL_BALANCE_SWEEP=1 over
   tests/owned_class_balance_role_bands.test.ts) is known-red on the merged
   v0.39 base itself, measured BEFORE the demolition landed: the merged
   castle-plus-headland tip reads warspirit area/single 1.0849 against the
   1.1 full floor and the warspirit/vespers boss pair 1.2519 against the
   1.2 full ceiling. The demolition tree improves both (area/single back
   inside the floor, boss pair 1.2185) but the ceiling still trips. The
   diet lanes the gate runs are re-anchored and green; both FULL arms are
   deliberately left untouched for the owned-class re-author the test
   comment already reserves. Actuals are recorded at the pin site.

## 7. Phase 2, OPEN: build New Eastbrook (the harbor town)

The town program per the owner's brief, to be detailed in this directory's
next artifact (a measured site plan in the fenbridge-rebuild shape, with a
locked gameplay contract) before world-mutating code lands:

- Layout language: NOT circular. A harbor town grown along streets: a
  harborfront running the dock edge, a main street climbing west into the
  basin, districts off it (market, civic, crafts, chapel-side green toward
  Reliquary Hill), open squares instead of one center. Generous spacing
  everywhere: this is the town every new player stands in, and crowd room
  is a stated design requirement, not polish.
- NPC distribution: the sixteen town NPCs (plus Bram's successor decision,
  section 6) spread by function across districts so quest pickup does not
  pool at one point. The quest-camp bearing suites and the NPC payload pin
  re-baseline with the move.
- The docks: piers on the carved harbor, ships, the ferry berth for the
  tutorial-island arrival (the berth and its arrival point land here; the
  island and the ferry ride itself are the other workstream's). Dock
  geometry follows the physics/parkour contracts (standable pier decks,
  honest collision, no wedge pockets).
- Spawn and arrival: new-character spawn moves to the new town (the ferry
  berth becomes the fiction of arrival; actual spawn placement decided in
  the site plan). `ONLINE_WORLD_LAYOUT_VERSION` bumps with the first
  layout-shaping slice of each release window.
- Old-town dismantling and the Wolf Run rotation land only after the new
  town carries spawn, NPCs, and services (no homeless-NPC window). The
  preserved Grand Armoury's fate is a site-plan decision (it is a
  landmark asset with its own capture contract).
- Pipeline: measured site plan first, GLBs through the `image-to-glb`
  skill and `docs/image-to-glb-asset-workflow.md`, the Eastbrook surface
  atlas reused, terrain via coast lobes + `terrainEdits` stamps (never new
  bespoke world.ts arms), before/after screenshots per the `pr-screenshots`
  skill, content obligations per slice (deeds, reliquary, wiki regen,
  world-entity i18n, webp art).
- Suggested slice order: S1/S2 demolition and phase 0b land moves first
  (they free the ground and the water), then the site plan, then terrain
  and streets, then buildings by district, then NPC/spawn migration, then
  old-town dismantling + Wolf Run, then dressing and polish.

## 8. Regen lanes cheat sheet (every slice needs some of these)

- Gate: `node scripts/gate_select.mjs` (needs a real pnpm on PATH for turbo).
- Parity goldens: `UPDATE_PARITY=1 npx vitest run tests/parity`, then a plain
  verify run; diffs must be value-shaped unless the slice explains why not.
- Terrain fixture: `UPDATE_TERRAIN_HEIGHT_PARITY=1 npx vitest run
  tests/terrain_height_parity.test.ts`.
- Map plates: `npm run assets:mapbg`; commit only plates whose content
  changed (cross-machine encoder bytes differ on the rest).
- Wiki: `npm run wiki:content` (+ `npm run wiki:stills` for new models).
- i18n: `npm run i18n:gen`; contributors touch English catalogs only.
- SFX manifest: `npm run sfx:manifest`.
- Shipped-item golden: `UPDATE_SHIPPED_ITEMS=1` only at a release re-mint.
