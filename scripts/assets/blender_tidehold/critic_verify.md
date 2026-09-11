# Tidehold Kit-Bash, VERIFICATION PASS (vs critic_report.md, 42 defects)

Reviewed: all 45 renders in `critic2/` (plus zoom crops of suspect regions), the five updated
`bl_*.py` scripts, and the five current `out/tidehold_*.collision.json`. Every verdict below is
tied to a render or to arithmetic against the current scripts/JSON. Note: the tavern GLB/JSON
were regenerated at 14:17, AFTER the 14:05 `critic2` tavern renders, the stair verdicts were
cross-checked against the builder's own 14:17 `tavern_int_up.png` and the 14:17 JSON, which are
the current deliverables.

Verdict codes: **FIXED**, **NOT FIXED**, **PARTIAL** (core complaint reduced but not resolved).
New defects introduced by the fixes are listed per building.

---

## The Gilded Gull, tavern

Previous high/med:

1. **[HIGH] Stair-top landing connects to nothing, FIXED (visually).** The stair was flipped:
   it now descends toward the front door and its top lands flush on the south 2F tile edge at
   y=−1.25, west-edge rails guard the hole (`tavern_ext_ne`/`tavern_ext_nw` outline silhouettes,
   builder's 14:17 `tavern_int_up`, `tavern_plan`). The 2F floor collision now matches the tiles
   exactly. **But see NEW T-1, the fix broke the collision ramp.**
2. **[MED] Stairs across the east window, FIXED.** East ground floor is now a windowless
   3-module run (`tavern_ext_se`, `tavern_ext_ne`).
3. **[MED] Barrels/sack clipping the stair, FIXED.** Moved to the west back corner
   (`tavern_plan` top-left cluster); the crate stack at (4.3,−2.0) sits south of the stair run.
4. **[MED] Chandelier rod through the 2F bedroom, NOT FIXED.** The L0 light was only lowered
   0.15 (z 2.95→2.8). Its suspension still rises through the 2F floor and stands mid-bedroom,    plainly visible as a gray chain column in the builder's own 14:17 `tavern_int_up`, and the
   chain runs past the ceiling plane in `tavern_int_c`.
5. **[MED] Invisible collision shelf over the stairwell, FIXED.** JSON 2F floor boxes now end
   exactly at the tile edges (x 2.5 / y −1.25): boxes at (−2.31, z 0) hx 6.94 and (6.94, z 4.62)
   hx 2.31, no phantom strip.
6. **[MED] Overfilled side walls / broken trim band, FIXED.** Clean 3×2.5 module runs; the
   storey trim runs unbroken (`tavern_ext_se`, `tavern_ext_sw`).

Previous lows: #7 rails rebuilt (fixed), #8 furniture collision added (fixed, bookcase,
sideboard, chest, dresser boxes all in JSON), #9 wainscot extended to 3 back + 2 west strips
(acceptable; break at the fireplace bay is motivated), #10 **NOT FIXED**, `tavern_int_a` is
still a camera inside the hanging sign and `tavern_int_b` is still a face full of wall planks.
The tavern interior remains unreviewable from the critic set.

**NEW defects:**

- **T-1 [HIGH] The stair's walkable collision ramp is INVERTED.** The visible stair now rises
  south (top at y=−1.25), but the exported ramp still rises north:
  `ramps[1] = {x 7.215, z −1.7113, hx 4.07, ry 1.5708, y0 0.37, y1 5.92}` puts the 5.92-high end
  at the FRONT-wall end of the run and the 0.37 end where the visible stair tops out. Walking up
  the visible treads you sink through them; stepping off the 2F floor onto the stair top drops
  you to ground height; the invisible deck peaks in mid-air by the front door. Cause:
  `bl_tavern.py` `ramp(3.9, 0.925, 2.2, 0.95, math.pi/2, 0.2, 3.2)` kept z0/z1 from the old
  north-rising stair, they must be swapped (z0 at the −hx end maps to the SOUTH under rz=π/2,
  cf. `steps()` which passes `y_top` first). This nullifies the headline stair fix in gameplay.
- **T-2 [MED] The chimney is buried inside the roof.** `Chimney_01` at (−4.3, 1.25, 6.7) sits
  entirely under the west slope (roof surface ≈9.1 over the fireplace bay; gable eave 6.0, ridge
  10.7). No chimney appears in ANY of the five exterior renders, a tavern with a lit hearth and
  no stack on the skyline. Raise it ~2.5 units or slide it to the eave.

---

## The Tidevault, bank

Previous high/med:

1. **[HIGH] Roof misplaced / floating gable / open attic, NOT FIXED.** The church roof was
   swapped for `HouseRoof_05` as claimed, but it is placed **rotated 90°**
   (`use('buildings/HouseRoof_05', 0, 0, 1.44, math.pi/2, 'H2')`): the ridge runs front-to-back
   on a 10×7.5 footprint. Its own OPEN glazed half-timber truss gables hang over the FRONT and
   BACK facades, dead over the entrance, see-through into the sky (`bank_ext_front` is
   damning), while the two solid plank `gable_solid` fins at x=±4.9 stand detached at the east
   and west wall tops with open sky between fin and roof (`bank_ext_ne`, `bank_ext_nw`,
   `bank_ext_sw`). The east/west attic flanks are open. Same failure class as before, new
   mechanism. Rotate the roof 0 (ridge along X, gables at the plank fins) and it resolves.
2. **[HIGH] No eaves, NOT FIXED.** East/west: the rotated roof's raked edges stop inboard of
   the side walls, bare wall-top ledge exposed, eave course sinking into the masonry at the
   corners (`bank_ext_ne`, `bank_ext_se`). Front/back: the trusses overshoot instead.
3. **[HIGH] Teller counters interpenetrating, FIXED.** Three counters at 1.6 spacing with clean
   floor gaps between them (`bank_plan` zoom, `bank_int_a`, `bank_int_b`); single tidy collision
   slab with the east staff gap.
4. **[MED] Vault flanks open, FIXED.** `CastleWall_07` strips seal y ±1.58..±3.78 on both
   flanks (`bank_int_a`, `bank_plan`) and matching collision boxes at (−6.29, z ±4.96) close the
   gap chain: strip, column, grate, column, strip.
5. **[MED] Floating carpets, FIXED.** Runner re-seated at z 0.215, lies flush, no shadow gap
   (`bank_int_b`, `bank_int_a`); now reaches under the counter face and to ~0.2 of the door.
6. **[MED] No windows, FIXED.** Real glazed gothic lancets: front flanks (`CastleWall_04`),
   one per side wall, pair on the back (`bank_ext_front`, `bank_ext_ne`, `bank_ext_se`).
7. **[MED] Gable style chaos, NOT FIXED.** The two plank fins now match each other, but the
   90°-rotated roof adds white glazed trusses on the other two ends: stone walls + plank fins +
   glazed trusses = still three finishes, now with broken geometry on top (all ext views).
8. **[MED] NoticeBoard collision, FIXED** (JSON box at 5.18, −6.11).
9. **[MED] Entrance lantern collision, FIXED** (JSON boxes at ±5.37, −8.32).

Previous low: #10 base skirt still front-only (`bank_ext_se`, `bank_ext_sw`), unchanged.

**NEW defects:**

- **B-1 [MED] Banner brackets pierce the roof eaves.** The side-wall `Flag_02` mounts at
  (±4.85, −2.4, 3.9) poke through the rotated roof's low eave courses near the SE and SW
  corners, thin finials sticking out of the tiles, street-visible (`bank_ext_se` zoom,
  `bank_ext_sw`). Consequence of the 90° roof; will vanish when the roof is rotated correctly,
  but must be re-checked then.
- **B-2 [LOW] `bank_int_c` is unusable**, camera embedded in a teller-counter hutch (flat brown
  plane fills the frame). New camera dud in the verification set.

---

## The Glass Market

Previous high/med:

1. **[HIGH] East canopy invisible, FIXED.** Both wings are `TerraceRoof_01` now and BOTH render
   from every angle, verified in `market_ext_ne`, `market_ext_nw` (crops confirm the thin
   grazing-angle west canopy is present), `market_ext_front`, `market_ext_se`, `market_ext_sw`.
2. **[HIGH] Half-height stub posts blocking every aisle mouth, FIXED.** Down to four corner
   posts scaled to the eave (3.3 units); all aisle mouths and the north entry are clear
   (`market_ext_front`, `market_int_c`, `market_plan`).
3. **[MED] Post collision taller than the prop, FIXED.** Post collision hy 2.81 (game) = 3.3
   units = the new visual height. JSON and render agree.
4. **[MED] Missing prop collision, FIXED.** Barrel_01, Barrel_02, Firewood_01 all have boxes
   in the JSON ((−2.38, 1.02), (−10.54, 3.06), (11.22, 2.38)).

Previous low: #5 wing-post colliders still at ±2.6/±2.9 vs the script's own ~±2.9/±3.1 comment, code unchanged; still needs an in-engine walk check.

**NEW defects: none.** Cleanest verification of the set.

---

## The Emberworks, smithy

Previous high/med (all med):

1. **[MED] Fence never reaches the corner post, FIXED.** South run 3.8..6.8 meets the post at
   6.9; east run −3.35..−0.35 meets it and stops mid-wall by design (`smithy_ext_se`,
   `smithy_ext_ne`, `smithy_plan`). Rail collision matches.
2. **[MED] Porch pavement short of the hut wall, FIXED.** `Tile_02` sx=1.3 now runs
   3.875..7.125, tucked to the wall face, threshold continuous (`smithy_plan`, `smithy_int_b`
   through the porch door).
3. **[MED] Interior props float, NOT FIXED (made worse).** Props were re-seated the WRONG
   DIRECTION: z 0.2 → 0.24 while the `Floor_06` deck tops out ≈0.14. The green carpet visibly
   hovers with a shadow gap at the front-door threshold (`smithy_ext_front` doorway zoom), and
   the barrel at (2.9, 2.9) still shows a light gap at its base (`smithy_int_c`). Everything on
   this floor needs z≈0.14, not 0.24 (the bank seats the same floor at 0.1).
4. **[MED] Door leaf airborne / across the shop window, NOT FIXED.** `HouseDoor_02` kept
   rot −2.5 and was RAISED to z 0.2: the open leaf still swings across the shop window and now
   hangs visibly higher off the floor (`smithy_int_c`, clear band of skirting under the bottom
   rail).
5. **[MED] No lintel collision, FIXED.** Front lintel (−0.99, 4.68, z −6.75) and porch lintel
   (6.75, 4.68, 0) boxes are in the JSON.
6. **[MED] Gable infill sandwich / z-fight, FIXED** (the `gable_solid` planks were removed, no
   more double surface), **but see NEW S-1 for what that exposed.**

Previous lows: #7 upright-sword display removed (helmet on the crate instead), fixed;
#8 firewood + candelabra collision added, fixed.

**NEW defects:**

- **S-1 [MED] Both gables are now see-through glass.** With the plank prisms deleted, the
  street and rear gables are `HouseRoof_04`'s translucent glazed trusses, from the street you
  look straight through the attic and out the other gable (`smithy_ext_front` is a greenhouse
  A-frame; `smithy_ext_sw`, `smithy_ext_nw` confirm). Inconsistent with the tavern/bank plank
  gables and reads unfinished on a smithy. The sandwich fix needed the roof's own panels
  retextured/backed, not just the planks removed.
- **S-2 [MED] Geometry pokes through the lean-to roof.** A gray masonry block (forge/ember-pit
  hood) pierces the lean-to slope mid-porch, visible as a floating cube on the tiles from the
  street side (`smithy_ext_ne` zoom), and a wooden member tops out above the lean-to's wall seam
  from the SE (`smithy_ext_se` zoom). The main forge stack's pierce is intentional and reads
  fine; these two do not.
- **S-3 [LOW] `smithy_int_a` is unusable**, camera buried against the forge chimney mass.

---

## The Warden's Hall

Previous high/med:

1. **[HIGH] Church roof overshooting the front / open rear ridge slot, FIXED.** Recentered
   (y −1.135) with the transept over the throne end as claimed: the ridge now lands on both
   walls, the front gable is closed by a solid plank panel behind the glazed truss (reads as
   proper half-timber, `hall_ext_front`, `hall_ext_nw`), and the transept + end truss close the
   rear (`hall_ext_sw`, `hall_ext_se`). No floating gable, no sky slot.
2. **[HIGH] Eaves inset both sides, FIXED.** Modest but real overhang with fascia proud of the
   wall planes on all four renders; no exposed wall-top course, no tiles sunk in masonry.
3. **[MED] Mismatched gable pair, FIXED.** Front planked half-timber; rear reads as a transept
   composition. Coherent.
4. **[MED] Windowless ground storey, FIXED.** Real glazed gothic lancets at eye level on the
   sides and front flanks (`hall_ext_sw`, `hall_ext_ne`, `hall_int_a`).
5. **[MED] Bench row facing away from its table, FIXED.** Bench rz is mirrored per side; both
   pew rows face their feast tables, backs to the aisle (`hall_int_a`, `hall_int_b`,
   `hall_int_c`, `hall_plan`).
6. **[MED] Runner: disjoint, short, floating, PARTIAL.** Seating FIXED (flush at 0.215) and
   extent FIXED (last mat at the door sill, first mat dies into the dais steps). But it is still
   FIVE DISJOINT MATS with ~0.6-unit floor gaps between every pair, reads as stepping stones
   down the axis of the hall, visible even from the street through the arch (`hall_int_c`,
   `hall_int_a`, `hall_plan`, `hall_ext_front`). The mats need to butt (spacing ≈ scaled mat
   length) or be one stretched piece.
7. **[MED] Dais reads as a rock pancake, PARTIAL.** The crisp `stone_slab` box geometry fixes
   the smeared-cobble shape, but the execution introduces NEW H-2 and H-3 below.
8. **[MED] Shield display half missing, FIXED.** Two `Shield_03` both render facing the hall,
   symmetric about the entrance (`hall_int_c`).
9. **[MED] Entrance lamps no collision, FIXED** (JSON boxes at ±6.6, −16.8).

**NEW defects:**

- **H-1 [HIGH] Dais step ramp INVERTED in collision.** Same z0/z1 error as the tavern stair:
  `ramp(0, −4.5, 0.55, 2.1, math.pi/2, 0.2, 0.71)` puts the 0.71 end on the AISLE side and the
  0.2 end at the dais edge (JSON: `{x 0, z 9.0, y0 0.4, y1 1.42, ry 1.5708}`, y0/top-side
  convention proven by the entry-steps ramp in the same file). Walking to the throne you hit a
  0.5-yd invisible wall where the visible steps start, and the deck slopes DOWN into the
  plateau face. The hall's focal approach is broken in gameplay.
- **H-2 [MED] The dais platform renders near-BLACK.** The `stone_slab` flat-UV pick lands on a
  charcoal tile: the platform is a black monolith against the light-gray floor, light-gray step
  slabs, and gray walls (`hall_int_a`, `hall_int_b`, and `hall_plan` in full top light, so not
  shadow). The steps and platform don't even match each other.
- **H-3 [MED] Stray raised slab band at the dais front, no collision.**
  `stone_slab(0, −4.98, 0.0, 2.4, 0.26, 0.475)` tops out at 0.95, 0.24 PROUD of the 0.71
  platform (hz is half-height in `stone_slab`: top = z + 2·hz; almost certainly meant 0.2375).
  It reads as a curb across the dais leading edge (two-level black mass in `hall_int_a`) and has
  no collision box, so it is also intangible.

---

## Deliverable quality (cross-cutting)

Four of the fifteen interior renders are unusable camera duds: `tavern_int_a` (inside the sign, repeat offense), `tavern_int_b` (inside the wall, repeat offense), `bank_int_c` (inside the
counter hutch, new), `smithy_int_a` (against the forge stack, new). The critic camera rig was
not fixed and got worse. Also note the tavern renders predate the 14:17 tavern rebuild; the next
critic pass must re-shoot after the final build, not before it.

---

## Scorecard (previous high/med items)

| Building | FIXED | PARTIAL | NOT FIXED | NEW (high/med/low) |
|----------|-------|---------|-----------|--------------------|
| Tavern   | 5     | 0       | 1 (chandelier) | 2 (1 high, 1 med) |
| Bank     | 6     | 0       | 3 (roof ×2, gable chaos) | 2 (1 med, 1 low) |
| Market   | 4     | 0       | 0         | 0 |
| Smithy   | 4     | 0       | 2 (prop float, door leaf) | 3 (2 med, 1 low) |
| Hall     | 7     | 2 (runner, dais) | 0   | 3 (1 high, 2 med) |
| **Total**| **26**| **2**   | **6**     | **10** |

## Bottom line

The market is done. The hall's silhouette rescue is genuinely good work, undermined by an
inverted walkable ramp and a black-rubber dais. The tavern's stair is now RIGHT visually and
WRONG physically: the single most important collision surface in the building rises the wrong
way (and the same copy-paste error broke the hall dais steps, fix `ramp()` argument order in
both call sites, or teach `ramp()` a direction-explicit API). The smithy fixed its edges and
forgot its middle: props re-seated upward instead of downward, the same window-blocking floating
door, and glass gables where planks were promised. The bank remains the problem child: the roof
was replaced, not fixed, it is 90° off, with open glazed trusses over the entrance and two
plank fins saluting the sky. Until `HouseRoof_05` is rotated to put its ridge along X, the bank
cannot ship.
