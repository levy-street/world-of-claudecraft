# New Eastbrook: measured site plan (the harbor town)

Status: FOR OWNER REVIEW. No world-mutating code lands from this document
until the owner approves the layout. Shape follows the fenbridge-rebuild
master plan and the eastbrook-vale-rebuild measured site plan; coordinates
here are measured against the phase 0b ground (branch commit that landed
the harbor-town plat, the beach apron, and the Copper Dig move).

Compass and units: distances in yards, positions as (x, z); world +z is
north, world +x is WEST, so east is negative x. Facings are Three.js yaw
radians derived via facingToward(from, to) = atan2(dx, dz) and then
literal-pinned after validation, never hand-authored.

## Evidence classes

Every row below is one of:
- AUTHORED FACT: read from live data (src/sim/content/zone1.ts,
  src/sim/eastbrook_layout.ts, src/sim/world.ts) on the phase 0b tree.
- MEASURED FACT: probed from the shipped heightfield at the production
  seed (terrainHeight/waterLevelAt); reproducible with a tsx probe.
- DESIGN PROPOSAL: this plan's layout decision, awaiting owner approval;
  becomes an authoritative literal only when the build wave lands it.

## 1. The canvas (measured facts)

- Town plat: x [-66, 44], z [-151, -73]. After the phase 0b lobes and
  grading stamps: 0.0 percent wet, 0.1 percent steep, heights -1.2 to
  +1.5 across the street grid below. The plat's south strip is the new
  beach apron (shore-band slopes 0.07-0.18, beach widths 23-30yd).
- Freed east flank (the old Copper Dig ground): x [-104, -65],
  z [-82, -29]. Dry today; low corridor at z -45..-65 (h about 0,
  falling to -2.9 by x -110) with a ridge at z -75..-85 (h 2.0-4.3)
  separating it from the plat.
- Landmarks kept as the green seam: Reliquary Hill POI (-5, -52), the
  Vale Chapel Yard graveyard (4, -56), both north of the plat.
- Open sea: south of the beach (z below about -175) and east of about
  x -115 at the flank's latitudes. The ferry lane is the open water east
  of the flank (the reverted dig headland).

## 2. Layout language (design proposal)

Not circular, no ring wall. A harbor town grown along two axes:

- THE HARBORFRONT: a quay along the carved cove on the flank's low
  corridor, where the Copper Dig stood. Ships, piers, the ferry berth,
  warehouse dressing. This is the arrival face of the game.
- THE MAIN STREET: from the quay, southwest around the flank ridge's
  saddle, entering the plat at its northeast corner and running
  southwest to the market square, then west to the civic square.
- Districts hang off the main street with generous spacing (building
  separations 8yd minimum vs the old town's 5): harbor, market, civic,
  crafts, and the chapel green rising toward Reliquary Hill.
- Three open squares instead of one center: market square, civic
  square, chapel green. Crowd room is a requirement, not polish.

## 3. The harbor (design proposal; terrain acceptance targets)

Water MUST come from the lobe/bay field: isOpenSeaAt reads the
un-stamped heightfield, so a stamp-carved basin would be a dry pit
(issue #1518). The carve is therefore a VALE_BAYS entry, tuned
empirically to these acceptance targets:

- Bay center near (-115, -52), radius near 35 (probe-tuned): the cove
  floods x -96..-110 at z -42..-64, connecting east to open sea.
- Quay line: the cove's west rim graded by level stamps to a quay walk
  at h -1.0 with an honest built edge to water (a quay is not a beach;
  the drop is faced by the quay wall asset/kit, target 1.5-2.2yd of
  freeboard). Quay walk runs roughly (-96, -42) to (-96, -64).
- Ferry berth: the longest pier, extending east from about (-98, -54),
  Wickharbor stilt-deck idiom (gale_harbor GaleDeckDef family +
  deck_render planks/stilts/rails/bollards), deck at
  WATER_LEVEL + 0.55 freeboard. Arrival point ON the deck.
- Two shorter piers south of it; moored hulls via decorProps float
  (sea_boat_sail_a/b, sea_boat_fishing from the shipped CC0 watercraft
  kit, registered into PROP_ASSET_DEFS in the dock wave), buoys marking
  the fairway.
- The murloc camp (-75, 57), Mirror Lake, and the fishing dock are far
  north and untouched. The jail stamps are untouched.
- Beach stays beach: the cove's south lip blends into the plat's beach
  apron around (-70, -150) with no cliff (same 0.2 slope ceiling).

## 4. Streets and squares (design proposal; centers measured dry)

Roads join the canonical road set (one lane set for terrain paint, map
lines, vegetation suppression, movement). halfWidth 1.5 like all town
lanes; corridor clear width after building padding at least 3.2yd.

| Route | Points (measured h at each) |
|---|---|
| Quay walk | (-96,-42) -> (-96,-64), h -0.2..0.3 pre-grade |
| Harbor road | (-96,-58) -> (-80,-66) 0.1 -> (-70,-68) 0.6 -> (-62,-76) 1.2 -> joins main street |
| Main street | (-62,-76) -> (-44,-98) -0.36 -> (-26,-100) -0.75 -> (-14,-102) -0.96 (market sq) -> (2,-104) -0.96 -> (10,-96) -0.52 (civic sq) |
| Chapel rise | (10,-96) -> (6,-80) 1.53 -> chapel green -> north toward Reliquary Hill seam |
| Crafts lane | (-14,-102) -> (-6,-124) -1.17 -> (-26,-126) -1.01 |
| Beach promenade | (-14,-102) -> (-10,-142) -2.92, ending at the strand |
| North road tie-in | civic square north to the existing wolf-run road near (-2,78) via the old town's west side (exact tie surveyed in the street wave) |

Squares: market square centered (-14,-102) about 14yd across; civic
square (10,-96) about 12yd; chapel green (4,-76) about 12yd, holding
the relocated graveyard on its north side.

## 5. Buildings (design proposal; existing GLB kit reused)

The six shipped building GLBs are reused as-is (no new architecture
assets in the first waves; the dock wave registers the shipped CC0
dock/ship kit). Native sizes are authored facts from the layout module;
positions are this plan's proposal, all probed dry and near-grade;
facings derive toward their street or square and pin after validation.

| Stable id | Asset | Center (x,z) | h (measured) | District, notes |
|---|---|---|---|---|
| eastbrook_inn | inn 7.5x8.5x6 | (-38, -88) | -0.69 | Harbor end of main street; rest service; kitchens station + Cook Marlow at its yard |
| eastbrook_bank | bank 7x7.8x5.5 | (12, -94) | -0.5 | Civic square east side; banker chest beside |
| eastbrook_chapel | chapel 5.5x7x6 | (2, -78) | 1.4 | Chapel green, facing the green; graveyard (gy_eastbrook) relocates to (0, -70) area, headstone rows re-laid |
| eastbrook_smithy | smithy 7x7.5x5.5 | (-2, -122) | -1.1 | Crafts district; forge station 1-3yd from Darva |
| eastbrook_toolworks | toolworks 5.5x5.8x4.5 | (-16, -128) | -1.1 | Crafts district |
| eastbrook_weaving_workshop | loom 5.5x5.8x4.5 | (-28, -122) | -1.0 | Crafts district |
| eastbrook_grand_armoury | PRESERVED LANDMARK | (17.5, -5.5) | authored | DECISION: stays at its shipped coordinates with its frozen capture contract; it becomes the old keep on the future Wolf Run's edge. Moving it would break the polish capture identity. |

Well beacon + benches: market square. The two market stalls: market
square west side (The Merchant, Trader Wilkes). Mailbox: market square
edge near (-10, -98) (7yd interaction approach kept clear).
Noticeboard: civic square near (8, -94). Fences: smithy yard only,
as today.

## 6. NPC distribution (design proposal; ids and roles authored facts)

All sixteen keep ids, quests, stock, and roles; only position and
facing move (the payload-hash suite re-baselines). Distribution by
function so pickup does not pool:

- HARBOR: Fisherman Brandt (pier root), Foreman Odell (harbor road
  east end, pointing at the Mirefen-road dig), Card Master (inn-side,
  dealer by the harbor lanterns).
- MARKET SQUARE: The Merchant (world market stall), Trader Wilkes
  (provisions stall), Apothecary Lin (square's north edge).
- CIVIC SQUARE: Marshal Redbrook (square center flag), Bursar
  Fernando (bank front), Saul the Chronicler (noticeboard).
- CRAFTS: Forgemistress Darva + Smith Haldren (forge), Tinker Gizzel
  (toolworks), Weaver Ottilie (loom).
- CHAPEL GREEN: Brother Aldric (chapel), FURY (green's west edge).
- INN: Cook Marlow (kitchens station at the inn yard).
- Groundskeeper Bram's successor: OPEN maintainer decision (master
  plan section 6); the plan reserves a harborfront standing point at
  (-92, -48) should a harbormaster NPC be minted.

## 7. Spawn and arrival (design proposal)

New-character spawn moves to the quay: playerStart (-94, -58),
bodyRadius 0.5, on the quay walk at the ferry berth's root, facing the
town (the arrival fiction: you just stepped off the ferry). Spirit
release fallback follows spawn. The old town keeps spawn until the
migration wave carries services (no homeless-NPC window), then
old-town dismantling + the Wolf Run rotation land as their own slice.

## 8. Build waves (each gates green and pushes before the next)

- WAVE A terrain: the harbor bay carve + quay grading + street-bed
  smoothing where a lane exceeds slope 0.25 (probe-tuned stamps only);
  full world-move ripple (parity, fixtures, digests with lattice
  evidence, plates).
- WAVE B streets + squares: canonical road defs, terrain paint, the
  three squares, streetlamp respacing fallout.
- WAVE C buildings + props by district (reused GLBs, stations beside
  masters, mailbox/noticeboard/chest/graveyard relocations).
- WAVE D docks: deck family on the gale idiom, quay wall, piers,
  ferry berth + arrival point, ship/buoy dressing, PROP_ASSET_DEFS
  registrations, dock-parkour contract tests.
- WAVE E migration: NPC placements + spawn move + services rebind;
  payload hash, bearing suites, camp-density re-pins.
- WAVE F: old-town dismantle + Wolf Run rotation (separate slice per
  master plan), then dressing and polish passes.

## 9. Acceptance (inherited gates, applied per wave)

Layout-suite re-derivation over the new module; OBB clearance proof
(0.8yd padding, all pairs); road corridors 3.2yd minimum; station
masters 1-3yd from stations; spawn resolves with no findSafePos
relocation; interior-parkour and dock-deck contracts (standable decks,
honest collision, no wedge pockets); before/after screenshots per the
pr-screenshots skill; full gate green per wave. Content obligations
ride each wave (wiki regen, world-entity i18n, deed/reliquary review
where content changes).
