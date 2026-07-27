# Physics asset audit: every prop against the traversal engine

The v0.29 parkour pass audit: each prop category, the physical model it
carries, and the deliberate exceptions. The traversal ladder the models feed
(constants in `src/sim/physics/character.ts`, `src/sim/colliders.ts`,
`src/sim/physics/ledge.ts`): a rise inside `MAX_STEP_HEIGHT` is a stride, a
top inside jump apex + `MANTLE_REACH` is a silent vault, a lip inside apex +
`LEDGE_GRAB_MAX` is a grab-and-climb, and everything above is a wall. Tops
may be flat or shaped (`TopSlope`), sampled through `colliderTopAt`.

## Open world

| Category | Model | Notes |
|---|---|---|
| Houses, inn, blacksmith | full-height OBB | Single merged meshes with no per-part data; roofs are out of climb reach by design. |
| Chapel | composed: full-height tower OBB + standable gabled hall roof | Composition single-sourced in `prop_layout.ts` (CHAPEL_TOWER/CHAPEL_HALL); the entry hall is the climbable low roof section. |
| Market stalls | measured 3.1 x 2.5 OBB; awning is a steep gable (ridge 2.54, eaves 1.50) along the stall's axis | Vault on at the eave edge, walk up the fabric, or grab the higher slope; counters block walks. |
| Stall dressing (crates, barrels, anvil, weapon stand) | standable circles at measured heights | Stride or vault per the ladder. |
| Wells | full-height circle | Roof (3.6) is deliberately out of climb reach. |
| Dock decks | raised walkable ground (`world.ts`) | Planks are floor, not colliders. |
| Dock hut | OBB with a standable gabled roof | Ridge along the hut's long axis. |
| Dock loose dressing (two barrels, one crate) | standable circles at measured heights | Stride/vault; tops ride the deck surface via groundHeight. |
| Moored rowboat | measured hull OBB (2.3 x 0.9), deck at 0.4 | Step in and stand IN the boat; afloat or beached by the waterline predicate. |
| Tents | full-height circle | Cloth cones are not standable on purpose. |
| Camp crates | per-point kind and scale via the shared placement roll: wooden crate (~1.14-1.27 top, r 0.57-0.64) or barrel (1.13, r 0.44) | The collider takes the SAME roll the renderer draws. |
| Campfires | pass-over top, NOT standable | A jump clears the flame; nobody perches in it. |
| Mud huts (murloc mushrooms) | stem-only circle (r 1.1) | The cap overhangs; extruded-2D cannot model overhangs, so walking under the cap is the honest choice. |
| Ruin ring columns | intact monoliths full-height; broken STUMPS standable at their drawn heights (1.0/1.56/2.11 by index) | Stumps are parkour pillars, not infinite walls. |
| Ruin heart relics (statue head, block, fallen column) | standable circles + a lying-cylinder OBB (top ~1.1, yaw from the shared roll) | The fallen column is a walkable log. |
| Mine timber portal | two post circles (r 0.27) | Lintel beams start above head height and never block. |
| Fences | rail OBBs (`isFence`) | Grounded collide, jumps clear. |
| Field rocks | standable circles, heights from `decoration_dims.ts` | Stride/vault/climb by size; tops are flat (small enough that a dome profile would read identically). |
| Graveyard headstones | standable circles at per-shape heights | The cross is the town's classic climb. |
| Town/station furniture | standable per `town_props.ts` sizes | Everything except open flame. |
| Editor placements | full-height circles | Custom maps author `collideRadius` only. |

## Eastbrook civic rebuild (v0.31)

The rebuild replaced Eastbrook's legacy procedural props with authored kit
GLBs (`eastbrook_layout.ts` owns placement for BOTH render and collision).
The composed-chapel and gabled-stall physics stay live on the legacy
procedural path (a building/stall with no `assetId`/`w`), which still ships
in zone2 and zone3 and in custom worlds; their audit anchors moved there.

| Category | Model | Notes |
|---|---|---|
| Kit buildings (bank, smithy, inn, chapel, workshops) + Grand Armoury | full-height authored OBB | Rooftops out of climb reach by design; the Armoury adds the terrain-envelope camera top. |
| Rebuild market stalls | authored OBB; FLAT standable canopy at exactly the authored height | The mesh's bounding box is scaled to the authored envelope and its tallest element is the canopy deck, so the drawn deck IS the authored height. Grab at the counter, stand, walk off. |
| Civic benches | standable OBB at the drawn seat height (`benchDrawnHeight`) | The renderer scales `bench.glb` uniformly to the authored footprint, so the seat height is a pure function of w x d (0.40 for the civic three): a stride, not even a vault. |
| Town wall | standable parapet OBB per segment + two pillar OBBs | The drawn wing is a stone parapet with an OPEN iron railing, so the slab top is standable at its drawn height (a jump vaults on or clean over; the see-through railing follows the fence rule and clips the shins of a body standing astride it, the forgiving choice). The short capped pillar is a standable step; only the tall lantern pylon (gate-side on mirrored wings, one shared rule in eastbrook_layout.ts) is a full-height blocker. Grounded movers without a jump still treat the slab as a wall, so mob containment and pathfinding keep using the gates. |
| Civic well beacon | full-height circle | Sculpted monument (basin, pole, crystal): the top is statuary, not a platform, the wells rule again. |
| Notice board | full-height OBB | A thin board; its top edge is no platform. |
| Ravenpost mailbox | full-height OBB (the pillar's lower body) | Spawned at its exact authored spot now (the noticeboard pattern); the raven crown is sculpture, not a platform. Walkers aim for its `frontStandingPoint`. |
| Banker's strongbox | standable OBB at the drawn 1.3 lid | The sim resolves the spot while building the colliders (candidates keep the banker's interaction point clear; a too-cramped custom spot keeps the chest decorative) and `render/banker_chest.ts` places the mesh from the SAME record. |
| Gather nodes (ore vein, wood pile) | standable circles at the drawn tops | The node GLBs draw at fixed spots whether or not they are ready to harvest. Herb clusters stay soft vegetation on purpose. `INTERACT_RANGE` (5) dwarfs the radii. |
| Dungeon door arches | two full-height jamb OBBs, mouth OPEN | Walking into the mouth IS the enter trigger; the crown is out of climb reach. The Abandoned Crypt draws no arch and gets no jambs. |
| Delve entrance portals | solid full-height slab OBB | A one-way threshold entered by talking to the warden; `delveExitDropZ` seats leavers mouth-side, clear of the slab. |
| Marsh reeds | NO collider | Soft vegetation by the release's own contract (camera-hideable only); a body wades through. |
| Drowned Court arena | full-height walls, flat floor | The arena-band contract: the reliquary tombs stay legacy full-height blocks DELIBERATELY, because the release's layout authors them as "a reliquary block midway along each aisle as the only extra cover" (dungeon_layout.ts): the cover extent is PvP balance, not scenery, even though the drawn shrine is smaller than the block. |

## Dungeon interiors

| Category | Model | Notes |
|---|---|---|
| Walls, chamber stubs, pillars | full-height | Reach the ceiling. |
| Boss dais | raised FLOOR (`dungeon_floor.ts`, DAIS_HEIGHT 0.6) | Real elevation through `groundHeight`: mobs and players stand ON it, the rim strides up and down, jumps arc onto it. Flat rooms (arena, Nythraxis raid) have no lift. |
| Tomb slots, `coffins` dressing | standable HUMP: ridge along the coffin's length (plain 1.72 over a 1.10 plinth, decorated 1.17 over 0.71) | Feet ride the lid's crest and fall to the plinth at the sides. |
| Tomb slots, `cargo` dressing (Sunken Bastion) | TWO-TIER staircase per stack (broad tier 1.35/1.20, measured top crate above) + cask circles at true radii (0.70/0.75) | Vault the tier, stride to the top crate; the stack-cask gap is walkable, as drawn. |
| Tomb slots, temple altars | full-height (no dressing field) | Candle shrines are sacred, not furniture. |

## Instanced bands left flat by contract

Delves, the arena, and the Yumi maze keep flat floors and full-height wall
sets (their own `CLAUDE.md` contracts). KNOWN GAP: the delve finale rooms
draw the same dais platform visually but their floor stays flat; lifting it
means extending `dungeon_floor.ts` to the delve module frames, a follow-up.

## Forced movement obeys the same ladder

Heroic Leap's landing sweep re-resolves diverted points at the arc's crest
(takeoff feet + FLIGHT_APEX), so a canopy or crate stack under the crest is
flown over and landed ON (at its sampled sloped height), while a full-height
wall still ends the sweep at its face; knockback seats keep the mover's own
feet height and can never embed a body in a prop; warrior Charge requires
line of sight and paths around standable props at ground level (they are
walls to a runner). Pinned by `tests/physics_audit_interactions.test.ts`,
which also pins client-predictor parity inside dungeons, persistence on a
roof, and the step-smooth easing for the dais rim.

## Verification anchors

`tests/dungeon_parkour.test.ts` (dais walk/jump, coffin mantle, cargo climb,
temple walls, delve inertness), `tests/climb.test.ts` (roof reach pins, the
stall cone walk), `tests/parkour.test.ts` + `tests/physics_character.test.ts`
(the ladder itself), `tests/physics_audit_world.test.ts` (the rebuild suite:
bench stride, flat-canopy grab, the full-height sweep over the beacon, walls,
armoury, and notice board, plus the re-anchored legacy chapel and gable
flows), `tests/town_collision.test.ts` (station furniture + headstones),
captures under `docs/screenshots/dungeon-parkour-roofs/` and
`docs/screenshots/ledge-climb-roofs/`.

## Slope glue: walking up a pitched surface stays grounded

The grounded support query is capped at the feet (a taller prop BESIDE a
body must never levitate it), which would flicker a body climbing a roof
gable airborne every other tick. `slopeGlueHeight` re-samples exactly the
surface the body stood on at its previous position and carries the feet up
its pitch within a stride, in the shared kernel, so slope walking is smooth
and bit-identical across hosts.
