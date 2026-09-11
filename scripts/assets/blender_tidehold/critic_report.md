# Tidehold Kit-Bash Review, Environment Art Direction Pass

Reviewed: all 45 renders in `critic/` (plus targeted crops and the builder's own `tavern_int1/int_up`, used only to confirm findings), the five `bl_*.py` layout scripts, and the five `out/tidehold_*.collision.json` files. Only defects I could see in a render or verify arithmetically against the scripts/JSON are listed. Severity: **high** = breaks silhouette/gameplay, **med** = clearly visible or collision-relevant, **low** = polish.

---

## The Gilded Gull, tavern (`bl_tavern.py`, `tidehold_tavern.collision.json`)

1. **[HIGH]** The stair-top landing connects to nothing, the ramp tops out at y 2.85 over x 2.95..4.85, but both the visual 2F floor and its collision end at x 2.5 (stairwell hole runs x 2.5..5, y −1.25..3.75), leaving a 0.83 yd gap at the landing and an open pit between the stair's top edge and the north wall; stepping off the top of the stairs drops you back to the ground floor, `tavern_plan`, `tavern_int_c`/`tavern_int_up` (fence line ends at open hole), bl_tavern.py: floor skip `if ix == 3 and iy in (1, 2)`, `ramp(3.9, 0.55, 2.3, 0.95, …)`, 2F floor cols `col(-1.25, 0.0, 3.14, 3.75, 3.75, 0.08)` / `col(3.75, -2.15, …)`.
2. **[MED]** The staircase climbs straight across the east ground-floor window, treads visible in the window opening from the street and pressed against it inside, `tavern_ext_se` (zoom), `tavern_ext_ne`, `Stairs_03` at (3.9, 0.55) vs `HouseWall_12` window at (5.0, 1.25).
3. **[MED]** Barrels and a sack are shoved inside the stair footprint and clip through the open risers/stringer (barrel top visibly cut by the stair slope), `tavern_plan` bottom band, confirmed in the builder's `tavern_int1.png`, `Barrel_01 (4.45, -1.4)`, `Barrel_02 (4.5, -0.6)`, `Bag_02 (4.1, -1.0)` all inside the stair run y −1.75..2.85.
4. **[MED]** The ground-floor chandelier's suspension rod passes through the 2F floor and stands as a gray pole in the middle of the bedroom, capped above the wall top (also the wire verticals poking through the roof in exterior shots), `tavern_int_c`/`tavern_int_up`, `use('props/Light_01', 0.0, -0.5, 2.95, 0, 'L0')` (fixture's mount rod is ~4 units long; same issue milder for the H1 light at (−1.5, 0, 5.95)).
5. **[MED]** Invisible collision shelf over the stairwell: the east 2F floor collision box runs to y −0.55 while the visible floor tiles end at y −1.25, a 1.3 yd standable strip of thin air past the guard rail, JSON box `{x: 6.9375, z: 3.9775, hx: 2.3125, hz: 2.96}` vs the tile grid; `tavern_plan`.
6. **[MED]** Side walls are overfilled: two full modules + two sx=0.68 fillers = 8.4 units jammed into the 7.5 bay, so fillers interpenetrate the full modules by 0.45 on every side wall on both storeys, the squashed filler breaks the horizontal trim band near each corner (visible step/stop in the storey trim), `tavern_ext_se` zoom, `use('buildings/HouseWall_02', ±HX, ±2.9, …, sx=0.68)`.
7. **[LOW]** 2F guard-rail piece at (4.6, −1.2) overlaps its neighbor by ~0.2 and its end (x 5.35) pokes past the east wall plane (x 5.0); rail run also leaves the west stairwell edge open y 1.85..3.75 (that is the "landing", see #1), bl_tavern.py fence rows.
8. **[LOW]** Reachable large furniture with no collision: bar-back bookcase `Furniture_03 (4.3, -3.45)`, sideboard `Furniture_05 (2.0, -3.5)`, 2F `Chest_01 (0.6, -3.1)` and dresser `Furniture_07 (0.8, 2.9)`, inconsistent with the barrels/beds that got boxes, collision JSON.
9. **[LOW]** Wainscot run is arbitrary: interior `HouseBase_01` strips on only 2 of 4 back-wall modules and 1 of 3 west modules, the skirting visibly stops mid-wall at the fireplace, builder's `tavern_int2.png`.
10. **[LOW]** Deliverable: `tavern_int_a` and `tavern_int_b` are unusable, camera embedded in the hanging sign and inside the wall planks respectively; the tavern interior is effectively unreviewable from the critic set.

**Tavern: 10 defects (1 high / 5 med / 4 low)**

---

## The Tidevault, bank (`bl_bank.py`, `tidehold_bank.collision.json`)

1. **[HIGH]** The church roof is shifted along its ridge: it overshoots the west wall by ~1.5 units (gable end floats in mid-air past the facade) and stops ~1.2 short of the east wall, leaving an open attic slot with sky visible straight through; the plank `gable_solid` at x 4.62 stands detached from the roof like a billboard, `bank_ext_ne`, `bank_ext_se` (open ridge notch), `bank_ext_nw`, `bank_ext_front`, `roof = use('buildings/ChurchRoof_01', 0, 0, 0.6, math.pi/2, 'H2', s=0.72)` (mesh origin is not centered; rotation swept the offset west).
2. **[HIGH]** No eaves anywhere: the roof sits inboard of all four wall planes, bare wall-top ledges on front and back, and the eave tile row visibly clips into the masonry on the sides, `bank_ext_front`, `bank_ext_sw`, `bank_ext_se`.
3. **[HIGH]** Teller counters interpenetrate: four `BarCounter_03` (≈1.7 units wide) at 1.25 spacing, every unit is buried ~0.45 into its neighbor; the plan shows a castellated double-silhouette and int_a shows a neighbor's hutch-end poking up through the counter top, `bank_plan` (zoom), `bank_int_a`, `for tx in (-2.5, -1.25, 0.0, 1.25): use('props/BarCounter_03', tx, -0.9, …)`.
4. **[MED]** The vault is theater: columns + portcullis seal only y −1.6..1.6, both flanks (y ±1.6..±3.75) are wide open in geometry and collision, anyone strolls around the grate into the chest alcove, `bank_int_a`, `bank_plan`; collision JSON has no boxes on either flank.
5. **[MED]** Floating carpets: `Carpet_04` runners at z 0.28 (and `Carpet_05` at 0.29) hover ~0.3 yd above the stone floor, clearly airborne with shadows beneath; the runner also stops ~1.5 units short of both the door and the counter, `bank_int_b` (blatant), `bank_int_c`, `bank_plan`.
6. **[MED]** Intended windows never happened: `CastleWall_02` is a plain module, not the "gothic window" the comments claim, front flanks and both side walls are blank stone; the only windows ended up on the back (`CastleWall_05`). The street face reads as a windowless bunker, `bank_ext_front`, `bank_ext_ne`, `bank_ext_se` vs bl_bank.py comments.
7. **[MED]** Gable style chaos: west end shows the roof's white half-timber gable, east end raw pale planks, walls castle stone, three finishes on one civic building, `bank_ext_nw` vs `bank_ext_se`.
8. **[MED]** `NoticeBoard_01` (≈1.9 yd freestanding board at (2.8, 3.3)) has no collision box, the market's identical board has one, collision JSON.
9. **[MED]** Entrance street lamps (`Lantern_01` ×2) have no collision, walk-through solid posts, collision JSON.
10. **[LOW]** Base skirt only on the front facade; sides/back meet the ground bare and the corner base blocks leave stepped notches in the rear silhouette, `bank_ext_sw`, `bank_ext_se`.

**Bank: 10 defects (3 high / 6 med / 1 low)**

---

## The Glass Market (`bl_market.py`, `tidehold_market.collision.json`)

1. **[HIGH]** East wing canopy (`TerraceRoof_02`) is one-sided/flipped: invisible from above and from the north, in `market_ext_ne` and `market_ext_nw` the entire east half of the market stands roofless (only the selection outline traces the canopy); it pops back in from low south angles (`market_ext_se`), `w2 = use('buildings/TerraceRoof_02', 7.1, 0, 0, -math.pi/2, 'H2')`. The west `TerraceRoof_01` renders correctly, so this is asset/normals, not layout.
2. **[HIGH]** The eight scaled `Corner_02` "posts" are half-height stubs (~2.2 units, the piece is not the 6.7-tall corner the comment assumed, so sz=0.52 halves an already short piece) supporting nothing, and four of them stand dead-center in every aisle mouth, including the middle of the main north entry between the two stalls, `market_ext_front` (center bollard), `market_int_c` (stub blocking the west aisle), all ext views, `use('buildings/Corner_02', px, py, 0, 0, 'L0', sz=0.52)`.
3. **[MED]** Those stubs' collision is 3.5 units tall (JSON `hy: 2.975` yd = 5.95 yd full) vs ~2.2 visible, every entrance bollard carries ~2 yd of invisible blocker above it, `col(px, py, 1.75, 0.3, 0.3, 1.75)` vs renders.
4. **[MED]** Missing collision on walk-into props: center-aisle `Barrel_01 (-1.4, -0.6)`, west-wing `Barrel_02 (-6.2, -1.8)`, and the east firewood pile `Firewood_01 (6.6, -1.4)` (all ≥1 unit) have no boxes while the crate clusters and stalls do, collision JSON.
5. **[LOW]** Wing-post colliders may be offset from the actual terrace-roof legs: boxes placed at ±2.6/±2.9 around each wing center while the script's own comment says the roofs' posts sit at ~±2.9/±3.1 (~0.5 yd offset if the comment is right), bl_market.py `for ox, oy in ((-2.6, -2.9), …)`; needs an in-engine walk check.

**Market: 5 defects (2 high / 2 med / 1 low)**

---

## The Emberworks, smithy (`bl_smithy.py`, `tidehold_smithy.collision.json`)

1. **[MED]** Porch fence never reaches its corner post: the south rail ends at x 6.35 (post at 6.9, 0.55 gap) and the east rail ends at y −2.45 (post at −3.4, 0.95 gap); the corner post stands stranded between two floating rail segments, `smithy_ext_se`, `smithy_plan`, `smithy_ext_ne`, `Fence_01 (5.6, -3.55)` / `(6.9, -1.7)`.
2. **[MED]** Porch pavement doesn't meet the hut: `Tile_02` row starts at x 4.1 while the east wall sits at 3.75, a 0.46 yd strip of bare ground runs the full length of the wall, straight across the porch-door threshold, `smithy_plan` (dark slit between wall and tiles), `use('environment/Tile_02', 5.35, …)`.
3. **[MED]** Interior props float: `Barrel_01 (2.9, 2.9, 0.2)` visibly hovers above the stone floor with a shadow gap, `Floor_06`'s deck top sits lower than the wood `Floor_04` the tavern used, and every interior prop in bl_smithy.py was placed at the tavern's z=0.2, `smithy_int_c` (barrel), same z applies to workbench/grindstone/candelabra.
4. **[MED]** The open front-door leaf hangs in the air (clear gap under the bottom rail) and swings across the shop window, `smithy_int_c`, `use('buildings/HouseDoor_02', -1.03, HY - 0.1, 0.0, -2.5, 'L0')`.
5. **[MED]** No lintel collision over either doorway: the front gap (x −1.05..−0.05) and the porch gap (y ±0.55) are cut full-height 0..5.5 in the wall boxes, the visually solid wall above both doors stops nothing (tavern, bank and hall all add lintel boxes), collision JSON wall boxes vs `col_wall` calls.
6. **[MED]** Gable infill sandwich: the `gable_solid` plank prisms sit at effectively the same depth as the roof's own half-timber gable panels, so the gable reads plank infill from one angle and navy panels from another (compare the south gable in `smithy_ext_sw` vs `smithy_ext_se`), z-fight/popping risk in a moving camera, `gable_solid(±3.66, 3.05, 7.72, 4.1, axis='y')` vs `HouseRoof_04`'s gable face.
7. **[LOW]** `Weapon_05` stands upright balanced on the wares crate like a lollipop, reads unnatural for a display (lean it or lay it flat), `smithy_ext_front`, `smithy_ext_se`, `use('props/Weapon_05', 6.4, 2.5, 0.55, 1.9, 'L0')`.
8. **[LOW]** Missing collision: interior firewood pile `(-3.15, 0.9)` and the floor candelabra `Candle_05 (2.75, -2.85)` (the hall's identical candelabra all get boxes), collision JSON.

**Smithy: 8 defects (0 high / 6 med / 2 low)**

---

## The Warden's Hall (`bl_hall.py`, `tidehold_hall.collision.json`)

1. **[HIGH]** Same church-roof misplacement as the bank, un-rotated: the roof overshoots the FRONT facade (~1.5 units of half-timber gable hangs in mid-air directly over the entrance) and stops short of the rear, leaving an open ridge slot into the attic; the rear plank `gable_solid` stands detached with sky between it and the roof end, `hall_ext_sw`/`hall_ext_se` (black ridge notch), `hall_ext_ne`, `hall_ext_nw`, `roof = use('buildings/ChurchRoof_01', 0, 0, 4.45, 0, 'H2', sx=0.92, sy=0.98, sz=0.95)`.
2. **[HIGH]** Eaves inset on both long sides: roof edge sits inside the wall planes, wall-top course exposed, tiles clipping into the masonry, `hall_ext_nw`, `hall_ext_se`.
3. **[MED]** Mismatched gable pair, white half-timber over the entrance, raw planks over the throne end, on a stone great hall, all ext views.
4. **[MED]** The entire ground storey is windowless: `CastleWall_02` is plain (same mix-up as the bank), so the "alternating gothic windows" exist only on the upper `CastleWall_05` modules; at eye level every wall inside and out is blank stone, `hall_ext_ne/nw/sw/se`, `hall_int_a`, side-wall loop in bl_hall.py.
5. **[MED]** One whole bench row turns its back on its own feast table: both `Furniture_14` rows use the same rz=pi/2 instead of mirroring, so one side's diners face the aisle with the table behind them, `hall_int_a` (bench back against the table with bottle/goblet), `hall_int_b`, `use('props/Furniture_14', sx_ * 2.55, ±, 0.2, math.pi/2, 'L0')`.
6. **[MED]** The "carpet runner" is four disjoint mats with floor gaps (a fifth on the dais), starting 1.5+ short of the door and ending 2.5 short of the dais, and floating ~0.16 yd (z 0.28 vs floor 0.2), aisle candelabra bases clip through the raised mat borders, `hall_int_c` (five separate mats), `hall_int_b` (base/border clip), `hall_ext_front` (visible through the arch).
7. **[MED]** The throne dais reads as a rough rock pancake, not masonry: `Tile_01` stretched sz=4.2 smears its beveled cobble sides into lumpy terrain, and the "grand steps" render as a curb-height blob, `hall_int_b` (zoom on throne), `hall_int_a`, `use('environment/Tile_01', ±1.25, -6.3, 0.0, 0, 'L0', sy=0.9, sz=4.2)` + `steps(0, -5.15, math.pi, 5.4, 2, 0.71, y_low=0.2)`.
8. **[MED]** North-wall shield display is half missing: only `Shield_03` renders facing the hall; `Shield_01` at (−2.8, 7.3, 3.6, rot pi) shows nothing but its outline (single-sided mesh facing into the wall), lone off-center shield over the entrance, `hall_int_c`.
9. **[MED]** Entrance street lamps (`Lantern_01` s=1.25, ~2.5 yd posts) have no collision, collision JSON (same omission as the bank).

**Hall: 9 defects (2 high / 7 med)**

---

## Worst offenders

1. **Bank, worst in show.** The roof is the single most visible failure on any of the five buildings (shifted ridge, floating gable, open attic, zero eaves), and the interior stacks three more real problems on top: interpenetrating teller counters, a vault you can stroll around, and carpets levitating a foot off the floor. Nothing about it survives a street pass.
2. **Hall.** Same roof disease as the bank on a bigger silhouette (the floating gable is over the front door), plus a windowless ground storey, a backward bench row, a rubble-looking dais, and a segmented floating runner. The bones of the layout are good; the execution isn't.
3. **Market.** Two loud failures: half the market has no visible roof from the north, and every entrance has a pointless bollard in the middle of it (with collision taller than the prop). Fix those two and it's actually the most charming build of the set.
4. **Tavern.** The best-dressed building with the worst gameplay bug: the staircase strands players at a hole in the second floor, runs across a street-facing window, and eats the props stored under it. Exterior and ground-floor dressing are otherwise the strongest of the five.
5. **Smithy.** No high-severity defects, the composition (gable street front + lean-to forge porch) works. It's let down by finishing sloppiness: orphaned fence rails, a dirt slit at the porch threshold, floating props, and missing door-lintel collision.

**Totals: tavern 10, bank 10, market 5, smithy 8, hall 9, 42 defects.**
