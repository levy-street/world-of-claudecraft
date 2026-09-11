# The Warden's Keep, defect list

Ruler used throughout: **1 kit unit = 2 yd**, **player = 1.8 yd = 0.9 kit** (the red cylinders).

## BLOCKERS (ship-stopping)

### B1. The whole build is exported at 2x the scale the kit was authored for
- **What**: `S = 2.0` doubles a kit whose native unit is ~1 yd. This single value is the root cause of "weird looking scale".
- **Where**: `bl_castle.py:14` (`S = 2.0`), consumed by `finalize(..., S)` at `bl_castle.py:315`.
- **Why it is wrong**: measured against the 0.9-kit player, every kit piece comes out roughly 2x life size.
  - `CastleFence_01` railing = 1.03 kit tall = **2.06 yd = 1.14x player height**. A handrail taller than the player. (Visible as the chunky white balustrade in `c_in_eaststair.png` and `c_in_weststair.png`.)
  - `CastleDoor_02` = 2.786 kit = **5.57 yd** door leaf (3.1x player).
  - `Table_02` = 0.672 kit = **1.34 yd** table top height; `Table_01` = 1.47 yd. Waist-high on a giant, chest-high on the player.
  - `Throne_01` unscaled = 1.942 kit = **3.88 yd** (2.2x player) *before* the extra 1.5x applied at line 99.
  - Storey height = 5 kit = **10 yd = 5.6x player**. The great hall is a 10-yard-tall room.
  At `S = 1.0` every one of those numbers lands correctly: railing 1.03 yd (0.57x player, hip height), door 2.79 yd (1.55x), table 0.74 yd, throne 1.94 yd with a ~0.87 yd seat, storey 5 yd.
- **Fix**: set `S = 1.0` at `bl_castle.py:14`. Then delete the compensating scale hacks that were added to fight the doubling: `s=1.5` on the throne (line 99), `s=1.2` on the dais candles (101-102), `s=1.6/1.4` on the hall flags (103-105, 113-114), `s=2.2` on the terrace flag (210), `s=1.8` on the gate banners (246-247). If you want a *grand* hall at S=1.0, grow the plan instead: `HX, HY = 12.5, 10.0` (line 15) with `XS`/`YS` extended on the 2.5 module.

### B2. The entire second storey and terrace are unreachable, the west stair lands in a sealed box
- **What**: the west flight tops out on a 2.5 x 5.0 kit strip that is walled off from the rest of the gallery. Everything above the ground floor is dead content.
- **Where**: `bl_castle.py:145` (`stone_stair(-7.25, -5.05, -6.0, 1.1, 0.2, 5.0, 14, 'L0')`), the deck colliders at `:295-297`, and the railing collider at `:299` (`col(-5.0, 0.0, 5.75, 0.12, 6.25, 0.55)`).
- **Why it is wrong**: two independent seals.
  1. The west flight's head is at `y = +1.25, z = 5.0`. The only deck it touches is `col(-6.25, 3.75, 4.90, 1.25, 2.5, 0.08)` = **x -7.5..-5.0, y 1.25..6.25** (5 x 10 yd). The back gallery deck is `col(0, -3.75, 4.90, 5.0, 2.5, 0.08)` = **x -5.0..5.0, y -6.25..-1.25**. Their y ranges do not overlap at all, there is a 2.5-kit (5 yd) void of double-height hall between them. The two decks never touch.
  2. Even if they did, `col(-5.0, 0.0, 5.75, 0.12, 6.25, 0.55)` is one unbroken 12.5-kit-long railing box running the *full* depth y -6.25..6.25 at x = -5.0, and the fence art at `:164-172` is likewise continuous (centres every 1.25 from -5.625 to 5.625, each piece 1.25 long, zero gaps).
  The bookcases, reading table, armoury wall, east stair, roof terrace, flagpole and both terrace braziers are therefore unreachable content.
- **Fix**: build the missing front arm of the U and open the rail. Add `use('buildings/Floor_01', x, 5.0, 4.9, 0, 'H1')` for `x in (-3.75, -1.25, 1.25, 3.75)` plus `col(0, 5.0, 5.12, 5.0, 1.25, 0.08)`, and move the inner railing from x = -5.0 / y = -1.25 to enclose the new opening. Then split `:299` into two boxes leaving a 1.5-kit door: `col(-5.0, -3.75, 5.87, 0.12, 2.5, 0.55)` and `col(-5.0, 3.75, 5.87, 0.12, 2.5, 0.55)`, and delete the fence pieces at y = 0.625 and 1.875 from `:168/:171`.

### B3. Neither stair flight has any collision, the stone is a ghost
- **What**: `stone_stair()` emits visual `stone_slab` boxes and exactly one `ramp()` deck. It calls `col()` zero times.
- **Where**: `bl_build_common.py` has no `col` in `stone_slab` (`:576-599`); `bl_castle.py:136-143` `stone_stair` only appends a ramp.
- **Why it is wrong**: the west flight is a 2.2 x 7.1 x 4.8 kit (4.4 x 14.2 x 9.6 yd) block of masonry that the player walks straight through. Worse on the east: `col(6.25, 0.0, 4.90, 1.25, 6.25, 0.08)` (`:296`) declares a continuous standable deck across **x 5.0..7.5, y -6.25..6.25**, and the east flight (`:146`) sits on top of it occupying x 5.05..7.25, y -6.0..1.1. So the gallery walkway reads as blocked by a stone staircase and is actually walk-through, the player strolls through the treads at ankle height.
- **Fix**: have `stone_stair` emit a solid collider for the stringer and a thin one per side. Minimum: after the tread loop add `col((x0+x1)/2, (y0+y1)/2, (z0+z1)/2, w/2, (y1-y0)/2, (z1-z0)/2)` clipped so the ramp deck stays 0.02 above it, or emit one `col` per tread mirroring each `stone_slab` call.

### B4. Both flights are entered by crawling under their own soffit; the east one is entered from a sealed pocket
- **What**: the foot of each flight is jammed against the back wall and buried beneath the flight's own underside.
- **Where**: `bl_castle.py:145-146`, both flights run `y0 = -6.0` (the back wall) to `y1 = 1.1`, and `stone_stair` puts the lowest tread at `y0`. Back-wall collider `col_wall(-HX, -HY, HX, -HY, 0, 10, 0.22)` (`:272`) has its inner face at y = -6.03.
- **Why it is wrong**: the deck height above the walk plane is `0.2 + (y + 6.15)/7.4 * 4.8`. Solve for player height (0.9 kit): headroom drops below the player at **y = -5.07**, and at the wall (y = -6.0) it is **0.30 kit = 0.6 yd**. The player must duck for the final **1.86 yd** of approach and then stand up inside 0.6 yd of clearance. The proxy at (-6.2, -5.4) marked "foot of the west stair" is already standing on the deck at z = 0.686 kit, there is no floor-level landing at all.
  The east flight is worse: its foot is at (x 5.05..7.25, y -6.15), and the only approach along the east gallery strip is blocked for its whole length by the flight itself. Once B3 is fixed the east stair becomes **completely unreachable**.
- **Fix**: reverse both flights so the foot faces the open room. Add a `flip` argument to `stone_stair` that emits `top = z1 - i*rise` and calls `ramp(..., rz=-PI/2, z0, z1)`; then call `stone_stair(-7.25, -5.05, -6.0, 1.1, 0.2, 5.0, 14, 'L0', flip=True)` so the foot is at y = +1.1 with the whole hall in front of it, and land the head on the back gallery (extend the H1 west deck to `col(-6.25, -3.75, 5.12, 1.25, 2.5, 0.08)` and add Floor_01 at (-6.25, -5.0) and (-6.25, -2.5)). Same flip for the east flight at `:146`. Independent of direction, give every flight a **2.5 x 2.5 kit landing** at both ends.

### B5. Every spire is off its tower by 2.4 kit (4.8 yd), this is the "floating roofs"
- **What**: all six `ChurchTower_03` spires are shifted +Y off their tower centre. On the +Y side 6.4 yd of cone hangs over nothing; on the -Y side 3.2 yd of tower top is left bare and open to the sky.
- **Where**: `bl_castle.py:72`, `sp = use('buildings/ChurchTower_03', cx, cy, top - 4.899, 0, grp)`. Applies to all four keep towers (`:88`) and both gate towers (`:239-240`).
- **Why it is wrong**: `ChurchTower_03` bbox is y **-0.894..5.699**, i.e. centred about **y = +2.4025**, not on its origin. The tower body is 5 x 5 (walls at cy ± 2.5). Placed as-is the cone's skirt runs cy -0.897 .. cy +5.697, so:
  - the skirt's -Y edge stops **1.60 kit (3.2 yd) short** of the tower's -Y wall, bare stone and daylight;
  - the skirt's +Y edge cantilevers **3.20 kit (6.4 yd)** past the +Y wall on nothing.
  Clearly visible in `c_tower_top.png` (near tower: cone skirt overhangs to the left/front, exposed grey tower top on the right/back) and `c_elev_east.png` (all cones sit visibly to the right of their shafts). The gate spires are the worst offenders: at (±12.5, 21.25) the cone centre lands at y = 23.65, so a 29-yd cone hangs **11.4 yd outside the front gate line**.
  Height is also wrong: the cone is **14.459 kit = 28.9 yd**, a 2.9:1 needle on a 5-kit-wide shaft, and 96% of the tower body's own height.
- **Fix**: two edits at `:72`.
  1. Centre it: `use('buildings/ChurchTower_03', cx, cy - 2.4025, top - 4.899, 0, grp)`.
  2. Bring the proportion back to a stylised MMO cone (~1.3:1). Use `sx=sy=0.78, sz=0.45`; the geometry then spans y (-0.894..5.699) x 0.78 → centroid +1.874, and local z min becomes 2.205. So: `use('buildings/ChurchTower_03', cx, cy - 1.874, top - 2.205, 0, grp, sx=0.78, sy=0.78, sz=0.45)`, base 5.12 kit (a 0.06-kit eave over the 5.0 tower), height 6.5 kit.
  Note the same origin trap on `ChurchTower_02` (y -0.22..4.85, centred +2.315) before you swap to it.

### B6. There is no walkable floor anywhere on the ground storey, and every deck sits 0.22 kit under its own art
- **What**: the player walks 0.4 yd below the visible floor indoors and in the courtyard, and 0.44 yd below the visible floor on the gallery and terrace.
- **Where**: `Floor_01` placed at `z = 0.1` (`:25`), `5.1` (`:158, :160, :162`) and `10.1` (`:196`); `Tile_01` yard at `z = 0.0` (`:218`). Decks: `:295-297` at `cz = 4.90, hz = 0.08` and `:302-303` at `cz = 9.90, hz = 0.08`. No ground-storey `col` at all in the `# COLLISION` block (`:266-311`).
- **Why it is wrong**: `Floor_01` spans ±0.1, so placing at 0.1 puts its **top at 0.2 kit = 0.4 yd**. The ground-floor walk plane is terrain z = 0, so the player's shins pass through the flagstones while every prop (all placed at z = 0.2) stands 0.4 yd proud of them. On the gallery the tile top is **5.2** but the deck top is **4.98**, a 0.22 kit = **0.44 yd** sink; identical on the terrace (10.2 vs 9.98). The script even contradicts itself: `stone_stair` starts the west flight at `z0 = 0.2` (the art plane) while the decks use 4.98/9.98.
- **Fix**: drop the tiles instead of raising the decks (the decks are already tuned against the flights). Change `0.1` → `-0.1` at `:25`, `5.1` → `4.9` at `:158/:160/:162`, `10.1` → `9.9` at `:196`, `Tile_01` z `0.0` → `-0.165` at `:218`. Then add the missing ground deck: `col(0, 0, -0.04, 7.25, 6.0, 0.04)` for the keep and `col(0, 13.75, -0.04, 12.5, 7.5, 0.04)` for the yard.

### B7. The throne faces the back wall, and there is no usable way onto the dais
- **What**: `rz = 0` points `Throne_01`'s seat at the -Y masonry. The door is at +Y. Approach is a 35.7-degree ramp whose walking surface cuts straight through the two stone steps that are supposed to represent it, and those two steps are in reverse order.
- **Where**: `bl_castle.py:95-99` (`stone_slab(0,-5.1,...)`, `stone_slab(0,-3.78,...)`, `stone_slab(0,-4.2,...)`, `ramp(0,-3.65,0.55,2.8,-PI/2,0.2,0.99)`, `use('props/Throne_01', 0, -5.4, 1.0, 0, 'L0', s=1.5)`). Images: `c_in_dais.png`, `c_in_dais_side.png`, `c_in_door_to_dais.png`.
- **Why it is wrong**:
  - **Orientation**: `Throne_01` bbox y = -0.396..+0.294, the deep side (0.396) is the seat/arm direction, the shallow side is behind the backrest. At `rz = 0` the seat therefore points at -Y, i.e. into the back wall 0.7 kit away, with its back turned to the door at +Y.
  - **Step order**: the upper slab (`:96`, top **0.68**) sits at y -4.03..-3.53; the lower slab (`:97`, top **0.34**) sits at y -4.45..-3.95, *closer to the dais*. Walking in from the hall you meet the tall step first, then step **down** 0.34, then face a 0.66-kit (1.32 yd) wall to the dais top. They also overlap each other by 0.08 kit in y.
  - **Riser sizes**: 0.68 kit = **1.36 yd = 76% of player height** for the first step. The dais itself is 1.0 kit = **2.0 yd**, taller than the player.
  - **Ramp vs art**: the deck runs z 0.2 at y -3.10 to 0.99 at y -4.20 (run 1.1, rise 0.79 → **35.7 degrees**). At y = -3.53 the deck is at 0.509 while the stone step top is 0.68, the player walks *through* 0.34 yd of stone; at y = -4.03 the deck is 0.868 against a 0.68 step top, the player floats 0.38 yd above it. The deck's top 0.2 kit (y -4.20..-4.0) is buried inside the dais collider `col(0,-5.1,0.5,3.2,1.1,0.5)` (`:284`), so the last stride resolves against a wall.
  - **Seat height**: the throne at `s=1.5` is 2.913 kit = **5.83 yd tall = 3.24x player height**, standing on a 2.0-yd dais; its seat lands around **4.5 yd** off the hall floor, ~2.5x player height.
- **Fix**: `rz = PI` on line 99, and rebuild the approach as three real steps with a matching deck. Replace `:96-98` with, at S = 1.0 scale intent (halve if you keep S = 2.0):
  `stone_slab(0, -3.60, 0.0, 3.0, 0.30, 0.167)`, `stone_slab(0, -4.20, 0.0, 3.1, 0.30, 0.333)`, `stone_slab(0, -4.80, 0.0, 3.2, 0.30, 0.500)`, three 0.333-kit (0.67 yd) risers, 0.6-kit goings, then `ramp(0, -4.20, 0.90, 3.0, -PI/2, 0.2, 1.0)` so the deck spans y -3.30..-5.10 and dies *inside* the dais footprint at full height. Add `col` for each tread. And take the throne to `s = 1.0`.

## MAJOR (clearly wrong, must fix)

### M1. The hall "braziers" are 0.26-yd matchsticks wearing 1.8-yd invisible boxes
- **What**: four `Fire_02` flames sit free-standing in the middle of the great hall with no stand, sunk into the floor, each wrapped in a collider 7x its own size.
- **Where**: `bl_castle.py:110-111` (`use('props/Fire_02', bx, by, 0.2, 0, 'L0')` at (±3.6, 3.6) and (±3.6, 0.0)) and `:291-292` (`col(bx, by, 0.6, 0.45, 0.45, 0.5)`).
- **Why it is wrong**: `Fire_02` measures 0.131 x 0.131 x 0.491 kit = **0.26 x 0.26 x 0.98 yd**, a fifth of the player's width, well under the 0.5-yd litter threshold, and it is a flame with no vessel. Its local z runs -0.115, so placed at 0.2 it starts at 0.085, **0.23 yd below the floor top**. The collider is 0.9 x 0.9 x 1.0 kit = **1.8 x 1.8 x 2.0 yd**, i.e. a player-sized invisible pillar around a matchstick. Four of them stand in open floor. This is the "torches are too small and placed in weird places" complaint, plus an invisible-wall bug.
- **Fix**: swap to a real brazier: `use('props/Fire_01', ...)` (0.428 x 0.428 x 0.655) on top of a plinth, at `s = 1.6` for a 1.37-yd-wide bowl, and move them off the floor onto the wall line at (±6.9, 3.6) and (±6.9, 0.0) beside the wall banners. Shrink the collider to `col(bx, by, 0.35, 0.35, 0.35, 0.35)`. If you want wall torches instead, mount `Fire_01` at z = 2.4 on the wall face with no collider at all.

### M2. The terrace parapet is 5.0 yd tall, you cannot see over your own battlements
- **What**: the crenellated parapet stands 2.8x player height above the roof deck.
- **Where**: `bl_castle.py:198-203` (`use('buildings/CastleRoof_01', ..., 10.85, ...)`), collision `:304-307`.
- **Why it is wrong**: `CastleRoof_01` local z is -0.852..1.851, so at 10.85 the merlon top is **12.70 kit**. Terrace floor top is 10.2. Parapet height = **2.5 kit = 5.0 yd = 2.8x player height**; even the crenel floor is ~3.3 yd up, above the player's head. `c_tower_top.png` shows the roof deck as a walled pit. A player standing on the terrace sees nothing but stone.
- **Fix**: fixing B1 (S = 1.0) halves this to 2.5 yd, which is still tall, additionally place the parapet on the deck rather than raised, i.e. `z = 10.85 - 0.55 = 10.3` combined with `sz = 0.55`, giving a 1.4-kit merlon with a 0.8-kit crenel sill at chest height.

### M3. Tower massing: six identical 59-yard needles bracketing a 25-yard box
- **What**: the silhouette does not read as one castle. It reads as six rockets with a shed between them.
- **Where**: `bl_castle.py:54-88` (`tower()` with `storeys=3`), `:239-240`. Images `c_hero.png`, `c_elev_east.png`, `c_elev_north.png`, `c_elev_south.png`.
- **Why it is wrong**: keep tower total = 15 kit body + 14.459 kit spire = **29.46 kit = 58.9 yd = 32.7x player height**, on a 5 x 5 kit (10 x 10 yd) footprint. The keep it is supposed to serve is 12.5 kit (25 yd) to its parapet, the **spire alone (28.9 yd) is taller than the whole keep**. All six spires are the same piece at the same size, so there is no hierarchy and no read of a dominant central mass; in `c_hero.png` the keep is the least visible element in its own composition. The shafts are 100% `CastleWall_01` (`:60-64`), 30 yards of blank, unrelieved masonry with no arrow slits, no string course, no machicolation, no batter.
- **Fix**: (a) cut the keep towers to `storeys=2` at `:88` and apply the B5 spire scale, total 10 + 6.5 = 16.5 kit, a healthy 1.3x the keep parapet. (b) Give one tower primacy: keep a single 3-storey tower at the (-HX-TOFF, -HY-TOFF) corner as the donjon. (c) Break the shafts: swap the middle band of `CastleWall_01` for `CastleWall_05` (arrow slits) at `:60-64` when `st == 1`, and add a `CastleBase_02` skirt at each tower base.

### M4. The two front keep towers interpenetrate the two courtyard towers, and a curtain wall is buried inside them
- **What**: at each front corner, two separate 5 x 5 towers overlap by 2.3 x 2.7 kit for their full height, and a 13.7-yd stretch of curtain wall runs straight through them.
- **Where**: keep towers at `(±(HX+2.3), HY+2.3) = (±9.8, 8.55)` (`bl_castle.py:86-88`); courtyard cap towers at `(±CHX, CY0) = (±12.5, 6.25)` (`:241-242`); curtain return `col_wall(HX, CY0, CHX, CY0, ...)` / `col_wall(-CHX, CY0, -HX, CY0, ...)` (`:281-282`) with art at `:233-237`.
- **Why it is wrong**: the west keep tower spans x -12.3..-7.3, y 6.05..11.05; the west courtyard tower spans x -15..-10, y 3.75..8.75. Overlap = **x -12.3..-10 (2.3 kit = 4.6 yd) by y 6.05..8.75 (2.7 kit = 5.4 yd)**, from z 0 to z 10. Their colliders overlap too (`:81` emits a box per tower). The curtain return runs y = 6.25 from x = -12.5 to -7.5, entirely inside the merged lump. The result in `c_elev_east.png` and `c_hero.png` is a lumpy welded double-shaft with wall stubs sprouting out of it.
- **Fix**: delete the two cap towers at `:241-242` (the keep towers already terminate that corner) and reroute the curtain return to die into the keep tower's outer face: `col_wall(12.3, CY0, CHX, CY0, 0, 6.8, T)` with matching art at x = 11.25 only.

### M5. The corner towers barely touch the keep, they read as four detached chimneys
- **What**: `TOFF = 2.3` pushes each tower so far out that only 0.2 kit of it overlaps the keep corner.
- **Where**: `bl_castle.py:85-86`.
- **Why it is wrong**: the keep corner is at (7.5, 6.25); the tower spans x 7.3..12.3, y 6.05..11.05. Contact is **0.2 x 0.2 kit (0.4 x 0.4 yd)**, a lick. In `c_hero.png` and `c_elev_east.png` you can see daylight-and-shadow notches between each tower and the keep wall; nothing corbels, ties or steps between them, so the keep reads as a separate box parked between four pylons.
- **Fix**: `TOFF = 1.0` (tower spans 6.0..11.0 in x, overlapping the keep wall by 1.5 kit = 3 yd of real engagement) and add a `CastleBase_02` skirt where each tower meets the keep wall to sell the junction.

### M6. A pillar is driven through the west stair, and another pillar holds up nothing
- **What**: `CastlePart_02` at (-5, 0) intersects the west flight; the same pillar (and the whole west row's logic) supports open air.
- **Where**: `bl_castle.py:107-108` (`for px, py in ((-5,0),(-5,2.5),(-5,5), ...)`) and colliders `:286-287` (`col(px, py, 2.5, 0.5, 0.5, 2.4)`); flight at `:145`.
- **Why it is wrong**: the pillar art spans x -5.488..-4.512 and the flight spans x -7.25..-5.05, a **0.438 kit (0.88 yd) solid interpenetration**. The collider is worse: x -5.5..-4.5, z 0.1..4.9, cutting **0.45 kit (0.9 yd)** out of a 2.2-kit (4.4 yd) flight at mid-height (the deck is at z 4.19 where the pillar passes). Usable stair width drops to 1.75 kit = 3.5 yd with an invisible obstacle in it. This is the user's "pillars are colliding with the stairs".
  Separately, the pillar at (-5, 0) tops out at z = 5.01 under **nothing**, the west gallery floor only exists for y 1.25..6.25 (`:162`). A 9.6-yard column ending in mid-air.
- **Fix**: move the west pillar row to x = -4.4 (`:107` and `:286`), clearing the flight's x -5.05 edge by 0.6 kit = 1.2 yd, and delete the (-5, 0) entry entirely since there is no floor above it. Keep the east row at x = 5 but narrow the colliders to `hx = hy = 0.5` -> `0.4` so they match the 0.488 art.

### M7. Clearance failures beside the hall braziers and in the east stair mouth
- **What**: two circulation gaps fall below the 1.5-yd (0.75 kit) minimum, and a railing is planted in a stair opening.
- **Where**: braziers `:291-292` vs pillars `:286-287`; terrace fence `:207` / `:309` (`col(5.625, 1.25, 10.75, 0.7, 0.12, 0.55)`).
- **Why it is wrong**:
  - Brazier collider outer edge x = 4.05, pillar collider inner edge x = 4.5 → **0.45 kit = 0.9 yd**, well under 1.5 yd. Four such pinch points (both sides, both y rows).
  - The east flight's mouth on the terrace is x 5.05..7.25 (2.2 kit). The fence collider at `:309` spans x 4.925..6.325 and sits **across** it at y = 1.25, leaving a **0.925 kit = 1.85 yd** slot at x 6.325..7.25. The player squeezes past a railing to exit the stair, and the actual open edge of the stairwell at x 6.325..7.5 is left unguarded.
- **Fix**: move the braziers to the wall line (see M1). Move the terrace rail off the exit: delete `:207`/`:309` and instead guard the east edge with `use('buildings/CastleFence_01', 6.875, 1.25, 10.2, 0, 'H2')` + `col(6.875, 1.25, 10.75, 0.625, 0.12, 0.55)`, keeping x 5.05..6.25 open as the walk-off.

### M8. Every stair tread, the dais and every platform is untextured flat grey
- **What**: `stone_slab` paints all six faces of every box with a **single atlas texel**, so all the built masonry in the interior has no stone pattern at all while the walls around it are bricked.
- **Where**: `bl_build_common.py:576-599`, specifically `:592-595`, `suv = _stone_uv()` returns one (u,v) pair and every loop of every polygon gets it. Called from `bl_castle.py:95-97, 142` (dais, dais steps, all 28 stair treads).
- **Why it is wrong**: `c_in_eaststair.png` shows the east flight as one enormous smooth grey wedge against brick-patterned walls; `c_in_weststair.png` and `c_in_dais.png` show the dais and treads as flat blocks. At 4.4 yd wide and 14 yd long these are the largest surfaces the player touches indoors and they carry zero detail, zero texel density, zero shadow break-up.
- **Fix**: box-project a real UV instead of a constant. In `stone_slab`, per face use the face normal to pick a plane and set `uv = (world_coord_a * K + suv[0], world_coord_b * K + suv[1])` sampling a stone *region* of the atlas rather than one texel, or simplest, build treads from scaled `environment/Tile_01` the way `steps()` already does (`bl_build_common.py:229-248`), which keeps the cobble texture.

### M9. The heraldic shield, the focal point of the throne room, is completely hidden behind the throne
- **What**: `Shield_02` is placed on the back wall directly behind a throne that is taller and wider than it.
- **Where**: `bl_castle.py:105` (`use('props/Shield_02', 0, -HY + 0.2, 3.6, 0, 'L0', s=1.4)`) vs the throne at `:99`.
- **Why it is wrong**: shield centre z = 3.6; the throne occupies z 1.0..3.913 at x -0.67..0.67, y -5.99..-4.96, i.e. directly in front of and taller than the shield. `c_in_dais.png` shows nothing at all behind the throne back. The two green `Flag_04` banners at (±1.5) are the only things reading, and they are the *secondary* dressing.
- **Fix**: raise the shield above the throne crown, `use('props/Shield_02', 0, -HY + 0.2, 4.45, 0, 'L0', s=1.4)`, or move the throne forward to y = -5.0 and enlarge the shield to `s = 2.0` as the wall's crest.

### M10. Roughly fifteen props have no collision at all
- **What**: the entire gallery's furniture and the entire courtyard's dressing are walk-through.
- **Where**: no `col()` exists for `bl_castle.py:174-188` (three `Furniture_03` bookcases, `Table_01`, `Furniture_08`, `Chest_01`, `Candle_05`), `:211-212` (terrace fires), `:244-261` (banner poles, four `Lantern_01`, four flower beds, two `Box_01`, two `Barrel`, `Dryer_01`, `NoticeBoard_01`, `Weapon_01`). The collision block `:266-311` covers only walls, pillars, dais, throne, three hall props, the braziers and the fountain.
- **Why it is wrong**: a 3.5 x 3.76 yd notice board and 5.07-yd lanterns that the player walks through destroy the physicality of the space; the gallery is the one room the stairs exist to reach and none of it is solid.
- **Fix**: add a `col()` beside every `use()` of a prop with a footprint over ~0.4 kit. Minimum set: bookcases `col(x, -5.9, 5.6, 0.6, 0.3, 0.5)` x3, `col(-2.0, -3.4, 5.55, 0.95, 0.45, 0.37)` for the table, `col(6.25, 4.4, 5.55, 0.5, 0.5, 0.4)` for the chest, `col(-4.5, 7.25, 0.9, 0.9, 0.25, 0.95)` for the notice board, `col` for each barrel/box/flower bed at their measured half-extents.

### M11. The throne collider covers only the bottom 61% of the throne
- **What**: 2.2 yards of throne back is a ghost.
- **Where**: `bl_castle.py:285` (`col(0, -5.4, 1.9, 0.7, 0.5, 0.9)` → z 1.0..2.8) vs the art at `:99` (z 1.0..3.913).
- **Why it is wrong**: **1.113 kit = 2.23 yd** of solid-looking carved back has no collision; a player or a camera passes through it. The plan extents are also 0.03 kit tight on y.
- **Fix**: `col(0, -5.4, 2.46, 0.7, 0.55, 1.46)` after re-orienting per B7, or simply rebuild it from the throne bbox once `s` is corrected.

### M12. The keep doors fill 70% of the arch's width and 65% of its height
- **What**: undersized leaves leave a large empty tympanum and side gaps in the main entrance.
- **Where**: `bl_castle.py:34-35` (`CastleDoor_02/03` at x = ∓0.95) inside `CastleWall_06` at `:29`; collision gap `col(0, HY, 7.2, 1.3, T, 2.8)` at `:271` gives |x| < 1.3, z 0..4.4.
- **Why it is wrong**: door leaf = 0.996 kit long, hinged at x = ±0.95, so closed they would span x -0.95..0.046 and 0.046..0.95, leaving **0.35 kit = 0.7 yd of daylight at each jamb**. Leaf height 2.786 kit vs a ~4.0-kit arch head, a **1.2 kit = 2.4 yd** void above them. The passable opening itself is 2.6 x 4.4 kit = **5.2 x 8.8 yd = 4.9x player height**, a gate for giants (see B1).
- **Fix**: hinge the leaves at the actual jambs, `x = ∓1.30`, and scale them to fill: `use('buildings/CastleDoor_02', -1.30, HY - 0.15, 0, -2.35, 'L0', sx=1.31, sz=1.44)` and the mirror. After B1 the opening drops to a correct 2.6 x 4.4 yd.

### M13. The fountain sits dead centre on the gate-to-door axis and wears a square collider
- **What**: the only approach line through the courtyard is blocked by a 9.5-yd-wide fountain, and its collider is a box.
- **Where**: `bl_castle.py:248` (`use('environment/Fountain_01', 0, CY0 + 7.5, 0.0, 0, 'L0', s=1.1)`), collider `:293` (`col(0, CY0 + 7.5, 1.3, 2.4, 2.4, 1.3)`).
- **Why it is wrong**: fountain diameter 4.343 x 1.1 = 4.78 kit = **9.55 yd**, height 2.84 kit = **5.7 yd = 3.2x player**. It sits at (0, 13.75) exactly between the gate (|x| < 1.4 at y = 21.25) and the keep door (|x| < 1.3 at y = 6.25), the player walks out of the gate straight into it. The square collider projects **0.99 kit = 2 yd** of invisible wall past the basin at each corner, and there is no path, road or paving change to lead the player around it.
- **Fix**: move it off-axis to `(0, CY0 + 7.5)` → `(-6.0, CY0 + 7.5)` or split the axis with a paved processional: keep the fountain at x = 0 but push it to y = CY0 + 12.0 and lay a 3.4-kit-wide `Tile_01` road strip down x -1.7..1.7. Replace the collider with an octagon of four rotated boxes, or at minimum `col(0, CY0+7.5, 1.3, 2.2, 2.2, 1.3)` with corner boxes at 45 degrees.

### M14. Gallery floor tiles are buried inside the east stair, and a candelabrum is inside the treads
- **What**: art placed under art.
- **Where**: `bl_castle.py:156-160` places `Floor_01` at (6.25, -5.0), (6.25, -2.5) and (6.25, 0.0); `:146` puts the east flight over x 5.05..7.25, y -6.0..1.1 starting at z = 5.0. `:188` puts `Candle_05` at (6.0, 1.0, 5.2).
- **Why it is wrong**: the flight's stringer base is at z = 5.0 while the tiles top out at 5.2, so **0.2 kit of every tile** on the east strip is inside the stone, giving coplanar faces and z-fighting along the whole run. The 2.8-yd candelabrum at (6.0, 1.0) is entirely inside tread 13.
- **Fix**: skip the buried tiles (`if x == 6.25 and y in (-5.0, -2.5, 0.0): continue` in the H1 loops, mirroring the terrace cut at `:194`), raise the flight base to `z0 = 5.2`, and move the candelabrum to (6.9, 4.0, 5.2).

### M15. Dead code leaves the gallery layout unstated
- **What**: `bl_castle.py:150-155` is a loop whose entire body is `continue` statements, it places nothing. The actual tiles come from the following loop.
- **Where**: `bl_castle.py:150-158`.
- **Why it is wrong**: the intent encoded in the comments ("the west stairwell", "the hall's double height") never executes; the real layout is decided by `:156-162` and only accidentally matches the colliders at `:295-297`. Any future edit to the visible loop will silently do nothing.
- **Fix**: delete `:150-155` and write the tile list explicitly, then derive the deck `col()` boxes from the same list so art and collision cannot drift.

### M16. The interior has no lighting design
- **What**: one sun, no interior lights, and the only implied light sources are the 0.26-yd flames from M1.
- **Where**: `reset_build()` -> `ensure_sun()` (`bl_build_common.py:344`); no light placement anywhere in `bl_castle.py`.
- **Why it is wrong**: `c_in_dais.png`, `c_in_door_to_dais.png` and `c_in_top_down.png` are near-monochrome grey, the great hall reads as a cave, the blue runner and green banners are the only hue in the frame, and the throne has no key light on it. For a cartoon-realistic MMO the throne room must have a lit focal point.
- **Fix**: raise the gothic window openings' contribution (the side walls at `:42-44` already carry `CastleWall_04`), add warm point lights at each corrected brazier and a stronger key over the dais, and lift the roof retint (see m13).

## MINOR (polish)

### m1. The hall runner is four separate mats with visible cross-seams
- **What**: the "runner" reads as four doormats laid end to end, each with its own gold border.
- **Where**: `bl_castle.py:92-93`, `for cy in (4.9, 2.4, -0.1, -2.6): use('props/Carpet_04', 0, cy, 0.215, PI/2, 'L0', sy=1.45, sx=1.7)`.
- **Why it is wrong**: each mat is 1.506 x 1.7 = 2.56 kit long on 2.5-kit centres, a **0.06 kit overlap at identical z = 0.215**, so every seam z-fights, and the gold end-border repeats four times. Clearly visible as a gold cross-band in `c_in_door_to_dais.png` and `c_in_top_down.png`.
- **Fix**: one piece: `use('props/Carpet_04', 0, 1.15, 0.215, PI/2, 'L0', sy=1.45, sx=6.75)` (spans y -3.93..6.23), or stagger the z by 0.002 per mat and use a borderless carpet variant for the middle pieces.

### m2. The runner dies 3 yd short of the dais and clashes with the dais mat
- **What**: blue-and-gold runner stops at y = -3.88, red-and-gold mat starts at y = -5.6, two different colourways 3 yards apart with bare stone between.
- **Where**: `bl_castle.py:92-93` vs `:100` (`use('props/Carpet_03', 0, -5.1, 1.01, PI/2, 'L0', sx=1.2)`).
- **Why it is wrong**: the runner also intersects the bottom dais step (the step slab at `:96` spans y -4.03..-3.53, z 0..0.68, so it swallows the last 0.35 kit of the carpet). And `Carpet_03` at `sx=1.2` with `rz=PI/2` ends up **1.0 kit (2 yd) wide** under a **2.69-yd-wide** throne, narrower than the thing it sits under.
- **Fix**: extend the runner to y = -4.0 and carry the same blue/gold up the new steps; drop `Carpet_03` or re-scale to `sy=1.9, sx=1.2` so it is 3.8 yd wide.

### m3. The two front door leaves swing at different angles
- **Where**: `bl_castle.py:34-35`, `rz = -2.35` vs `rz = +2.30`.
- **Why it is wrong**: a 2.9-degree asymmetry on the building's centrepiece. It reads as a mistake, not as staging. (The gate pair at `:231-232` is correctly ±2.0.)
- **Fix**: `-2.30` / `+2.30`.

### m4. Three banners on the east hall wall, one on the west
- **Where**: `bl_castle.py:112-113` places `Flag_05`/`Flag_06`/`Flag_05` at y = 3.75, 1.25, -1.25 on `x = HX`; `:114` places a single `Flag_06` at y = 3.75 on `x = -HX`. Same story with weapons: `Weapon_03` alone on the west (`:115`), `Weapon_05` + `Shield_03` on the east (`:116-117`).
- **Why it is wrong**: a symmetric hall with a 3:1 dressing split reads as unfinished, not as deliberate variation.
- **Fix**: mirror the east set onto the west, then remove *one* piece deliberately if you want asymmetry.

### m5. The base plinth exists on the front face only
- **Where**: `bl_castle.py:51-52`, `CastleBase_02` at x in (-6.25, -3.75, 3.75, 6.25), y = HY + 0.24. Nothing on the back or sides.
- **Why it is wrong**: from `c_elev_east.png` the keep's side elevation has no ground transition at all while the front has a moulding, the massing changes rules per face.
- **Fix**: run the same skirt along `-HY` and both `±HX` faces (y in YS with `rz = PI/2`).

### m6. Parapet corner pieces interpenetrate at all four terrace corners
- **Where**: `bl_castle.py:198-203`. The x-run places `CastleRoof_01` at (±6.25, ±6.25) spanning x ±5..±7.5; the y-run places one at (±7.5, ±5.0) spanning y ±3.75..±6.25.
- **Why it is wrong**: they cross over a **0.3 x 0.3 kit** region at each corner, two crenellated blocks merged into a lump. The comment on `:197` promises "corner pieces at the corners"; none are placed.
- **Fix**: shorten the y-runs to `for y in (-2.5, 0.0, 2.5)` and place a dedicated corner piece (or a `sx=0.5` `CastleRoof_01`) at each of the four corners.

### m7. The terrace braziers are 0.28-yd specks floating 0.24 yd above the roof
- **Where**: `bl_castle.py:211-212`, `use('props/Fire_03', ±3.75, 2.5, 10.2, 0, 'H2')`.
- **Why it is wrong**: `Fire_03` measures 0.14 x 0.148 x 0.207 kit = **0.28 x 0.30 x 0.41 yd**, pure litter, and its bbox is asymmetric (x -0.14..0.0), so it does not even sit on its own origin. Local z min is -0.101, so at z = 10.2 it starts at 10.099 while the terrace deck top is 9.98: **0.24 yd of air** underneath.
- **Fix**: use `Fire_01` on a plinth at z = 9.98, `s = 1.6`.

### m8. Four wall-bracket lanterns stand free in the middle of the courtyard
- **Where**: `bl_castle.py:249-250`, `Lantern_01` at (±6.0, CY0+3.0) and (±6.0, CY0+12.0).
- **Why it is wrong**: `Lantern_01`'s bbox is y **-0.856..0.234**, the arm hangs 0.856 off a mounting face; it is a wall bracket, not a standard. Placed in open cobbles it floats on nothing. It is also 2.533 kit = **5.07 yd tall = 2.8x player height**.
- **Fix**: mount them on the curtain wall faces at x = ±12.2 with `rz = ∓PI/2`, or swap to a free-standing `CastlePart_01` post with `Fire_01` on top.

### m9. War table and altar colliders overlap the dais collider
- **Where**: `bl_castle.py:288` (`col(3.6, -3.6, 0.6, 0.45, 1.6, 0.45)` → x 3.15..4.05) and `:289` (`col(-3.6, -3.8, 0.6, 0.5, 0.5, 0.55)` → x -4.1..-3.1) against the dais `col(0, -5.1, 0.5, 3.2, 1.1, 0.5)` at `:284` (x ±3.2).
- **Why it is wrong**: 0.05 kit and 0.1 kit of interpenetration. The art clears by 4 mm and 4.6 cm respectively, a razor tolerance that will break the moment anything moves.
- **Fix**: move the table to x = 4.0 and the altar to x = -4.0.

### m10. Openings do not line up storey to storey
- **Where**: back wall `bl_castle.py:37-40`, ground gothic windows at x = ±3.75, upper arrow slits at x = ±1.25 and ±6.25. Side walls `:42-47`, ground windows at y = ±2.5, upper slits at y = 0, ±5.0.
- **Why it is wrong**: every upper opening sits over blank wall and every ground opening has blank wall over it. Read as elevation composition (`c_elev_north.png`, `c_elev_east.png`) it is noise, not rhythm.
- **Fix**: align the piece lists so openings stack: back wall upper row `('CastleWall_05','CastleWall_01','CastleWall_05','CastleWall_05','CastleWall_01','CastleWall_05')` → `('CastleWall_01','CastleWall_05','CastleWall_01','CastleWall_01','CastleWall_05','CastleWall_01')`; same swap on the side walls at `:45`.

### m11. The gate's arch head has 2 yd of solid-looking stone with no collision
- **Where**: `bl_castle.py:280`, `col(0, CY1, 6.0, 1.4, T, 1.0)` blocks z 5.0..7.0, but the `CastleWall_06` arch piece at `:228` is only 5.0 kit tall so its visual head is around z 4.0.
- **Why it is wrong**: a **1.0 kit = 2 yd** band of visible masonry that mounts and projectiles pass through. Same class of gap: the curtain parapet is collided only to z = 6.8 (`:276-279`) while the merlons top at 7.70, **0.9 kit = 1.8 yd** of uncollided crenellation.
- **Fix**: `col(0, CY1, 4.5, 1.4, T, 0.5)` for the arch head and raise the curtain `col_wall` z1 from 6.8 to 7.7.

### m12. The `interior()` volume ends exactly at the terrace floor
- **Where**: `bl_castle.py:313`, `interior(-HX + 0.25, HX - 0.25, -HY + 0.25, HY - 0.25, 0.0, 10.0)`.
- **Why it is wrong**: the terrace deck stands at z = 9.98 and the player's feet at 10.0, right on the boundary, so interior/exterior state (audio, fog, lighting) will flicker while walking the roof, which is an *outdoor* space.
- **Fix**: `interior(..., 0.0, 9.85)`.

### m13. The roof retint comes out dark and desaturated
- **Where**: `bl_build_common.py:185-186`, `v = mx * 0.72`, `s2 = clip(sat * 0.55, 0, 0.5)`.
- **Why it is wrong**: the spires are the **only** colour on the entire exterior and they render near-black in shadow (`c_hero.png`, `c_elev_east.png`). A cartoon-realistic MMO silhouette needs the roof to carry chroma at distance.
- **Fix**: `v = mx * 0.95`, `s2 = clip(sat * 0.8, 0, 0.68)`.

### m14. Courtyard dressing reads as random scatter
- **Where**: `bl_castle.py:251-261`, three different flower-bed types across four corners (`FlowerBed_01`, `_02`, `_03`, `_01`), crates and a barrel only at x ≈ +10.5/+11.2 with a single lone barrel at -11.0, `Dryer_01` on the west and `Weapon_01` on the east.
- **Why it is wrong**: nothing groups, nothing tells a story of use. A castle yard should read as zones (stable corner, market corner, drill ground), not as one prop per quadrant.
- **Fix**: cluster: put all crates/barrels/dryer into one 5 x 5 kit service corner at (-9.5, CY0+2.5) with a cart, and use a single flower-bed type repeated along the curtain wall base.

### m15. Wall-mounted weapons are 2.9 yd long
- **Where**: `bl_castle.py:115-116`, `Weapon_03` (1.469 kit = 2.94 yd) and `Weapon_05` at `s = 1.0`.
- **Why it is wrong**: a sword 1.6x the player's height mounted as wall trophy. Fixed automatically by B1; if S stays at 2.0, scale to `s = 0.5`.

### m16. `c_in_gallery.png` is a dead frame, the camera is inside the NW tower
- **What**: the gallery crit shot is flat grey with only a 3D cursor.
- **Where**: the capture camera position corresponds to `bl_castle.py:324`'s gallery framing at (-11, 11, 15); the NW keep tower (`:86-88`) occupies **x -12.3..-7.3, y 6.05..11.05, z 0..15**, the camera is inside its solid mass.
- **Why it matters**: the gallery is completely unreviewed, and the fact that a camera 11 kit out and 15 kit up is *inside* geometry is itself evidence of how much volume the oversized towers eat (see M3/M4).
- **Fix**: re-shoot from inside the keep, e.g. eye at (-3.0, 4.0, 6.6) looking at (2.0, -5.0, 6.0), and disable viewport relationship lines, the dotted black spray across every interior frame is the group-empty parenting overlay and makes the shots hard to read.
