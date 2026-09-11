# Tidehold buildings, Blender assembly chain

> Moved here from `tmp/blender_tidehold/` on 2026-08-21. `tmp/` is gitignored,
> so the chain that builds the shipped `public/models/tidehold/*.glb` was one
> `git clean` from being lost. The scripts still expect to be COPIED into a
> scratch directory and driven from there (they `exec()` each other by absolute
> path and write their renders beside themselves), see "Running them" below.

The five explorable buildings in `public/models/tidehold/` (tavern, bank,
market, smithy, hall) are ASSEMBLED from the `medieval_village_v2` kit by the
`bl_*.py` scripts here, driven over the BlenderMCP bridge
(`~/.claude/tools/blender_bridge.py run <script>` with Blender open).

- `bl_helpers.py` + `bl_build_common.py`: the shared toolkit (import/dedup/
  linked placement, crow-step gable filler, slate-blue roof retint of the
  CartoonTown atlas, collision/ramp/interior authoring, GLB export).
- `bl_<building>.py`: one self-contained scene each. Front faces +Y in
  Blender = -Z in the GLB. Groups: L0 shell, G_H1 second storey, G_H2 roof
  (render/interior_reveal.ts hides H1/H2 from inside).
- `*.collision.json`: authored boxes/ramps/interiors in FINAL model yards,
  written by finalize(). `tmp/_merge_tidehold_collision.mjs` scales these by
  each model's normalization and merges them into
  data/asset_collision_overrides.json (plus the flat ground-floor DECKS it
  adds itself, see its comments for why decks, not boxes).
- After re-exporting a GLB: run `tmp/_install_tidehold_buildings.mjs`
  (texture compress + measure), then the merge script, then
  `node scripts/gen_collision_overrides.mjs && node scripts/gen_asset_catalog.mjs`,
  and update SIZE/AUTHORED in src/sim/deepglass/citadel.ts plus the volumes
  in src/render/interior_reveal.ts if bounds changed.

## 2026-08-21, the tavern rebuilt bigger (`bl_tavern2.py`)

The Gilded Gull is now a 12.5 x 10 kit-unit hall (5 x 4 modules; 26 x 18.5 yd
at S=1.85), the town's meeting point: one long feast table with benches down
the middle, a 7-counter bar along the back wall with the innkeeper behind it
(`th_innkeeper` in citadel.ts stands 8.9 model yards east of the origin, facing
the west-facing door), a hearth lounge, a notice board inside by the door and
another on the west wall outside, three hanging wheel-lights, four bedrooms up
the east-wall stair. Exterior planks are `Planks85_08_Color.jpg` (the WOC Asset
Textures pack, 1K), `bl_build_common.py`'s PLANK_JPG points at it; `plankify()`
bakes the same x1.38 dusk gain as before.

Roof: HouseRoof_05 scaled (1.227, 1.29, 1.25) so its eave sits at z=6 over the
2F wall top; ridge at 11.96. `gable_solid` closes both glazed ends at
x = +-(HX+0.08) with half-width 4.291*1.29-0.12.

Measured: 26.05 x 22.84 x 24.52, norm 0.084466 (SIZE + AUTHORED in citadel.ts,
interior_reveal volume +-11.8 / 22.5 / +-9.5). Re-export recipe is unchanged
except the scripts now live as `tmp/_install_tidehold_buildings2.mjs <name>`
(merges into the existing report) and `tmp/_merge_tidehold_collision2.mjs`.

## 2026-08-21, filler houses (`bl_houses.py`) and the Warden's Keep (`bl_castle.py`)

**`bl_houses.py`** builds five NON-enterable houses (`tidehold/house_a..e`) from
a `shell()` helper: rectangular runs of HouseWall modules per storey, closed
`HouseDoor_01`, plank walls, slate roofs, and `box_collision()` (footprint box
plus two stepped boxes up to the ridge). No interiors, no reveal spec.

**`bl_castle.py`** builds `tidehold/castle`, the enterable keep at th(0,182):

- `tower(cx, cy, storeys, cap)`, a 5x5 stone tower from CastleWall_01 modules
  (2 per side per storey) + CastleCorner + a Floor_01 cap, finished with a
  `ChurchTower_03` spire (base at top-4.899) or a CastleRoof_01 merlon band
  (each 2.5 wide, sitting at top+0.85). **Do not use ChurchTower_02 as a tower
  drum**, it is cream PLASTER and reads wrong against castle stone.
- `stone_stair(x0,x1,y0,y1,z0,z1,treads,grp)`, a solid masonry flight: one
  `stone_slab` per tread, each standing from the flight's base to its own top,
  plus one `ramp()` deck (rz=+pi/2, high end at kit +y). The kit's own
  `CastleStairs_04` is a QUARTER-TURN flight (rises +y then +x) and cannot sit
  under a single straight deck.
- Towers are centred 2.3 units OUTSIDE the keep corners. Centred ON a corner
  they poke into the hall (one buried the west flight entirely).
- Gallery/terrace floors are standable BOXES shaved 0.02 under their flight's
  deck summit (5 and 10 kit), the merge script enforces this for `castle`, the
  same rule the tavern's 2F floor follows.
- `tidehold/castle` is deliberately NOT in `render/interior_reveal.ts`: its
  "roof" (G_H2) is the walkable battlement terrace, so hiding it would strip
  the hall's ceiling. The hall is lit by its own braziers instead.


## Running them

The `bl_*.py` scripts load each other with `exec(open(SCRATCH + '/...').read())`
and write GLBs to `SCRATCH/out`, so they are run from a scratch copy rather than
from the repo:

```
SCRATCH=/tmp/bl && mkdir -p $SCRATCH/out $SCRATCH/shots $SCRATCH/tex
cp scripts/assets/blender_tidehold/*.py scripts/assets/blender_tidehold/*.jpg $SCRATCH/
# point SCRATCH= at the top of each bl_<building>.py, and PLANK_JPG in
# bl_build_common.py, at that directory, then with Blender open:
python3 ~/.claude/tools/blender_bridge.py run $SCRATCH/bl_castle.py
node tmp/_install_tidehold_buildings2.mjs castle
node tmp/_merge_tidehold_collision2.mjs castle
node scripts/gen_collision_overrides.mjs && node scripts/gen_asset_catalog.mjs
```

The `*.collision.json` files here are the LAST authored output of each
building's `finalize()`, the input the merge script scales into
`data/asset_collision_overrides.json`.


## 2026-08-22, the keep rebuilt at player scale

The first castle shipped at **S = 2.0**, which put a castle storey at 10 yards
and made the great hall read as a canyon full of doll furniture. Rebuilt at
**S = 1.35** (a storey is 6.75yd, the arch ~4.5yd, a player 1.8yd = 1.333 kit)
with `PLAYER_KIT` in the script as the ruler. What changed and why:

- **`ChurchTower_03`'s geometry is not centred on its origin**, its bbox runs
  y -0.894..5.699 (centre **+2.4025**) and z 4.899..19.358. Dropped at a tower
  centre it sat 2.4 kit to +y and left the tower's top face bare on the other
  side: the "floating roofs". `tower()` now offsets by that centre and scales
  the piece to 5.6 wide over the 5.0 tower (`sp_s = 5.6 / 6.559`).
- **Stairs vs pillars.** The flights ran to x=-5.05 with the pillars at x=-5.0,   a 0.488-radius pillar overlapping the treads. The stair strip
  (`ST_OUT/ST_IN` = 7.25/5.6, 1.65 kit = 2.2yd of tread) and the pillar line
  (`PILLAR_X` = 4.55) are separate numbers now with ~0.5 kit of daylight, and
  each flight carries a raking balustrade on its open side.
- **The dais.** A 1.0-kit plinth with three textured cobble treads via
  `steps()`. Do NOT hand-roll the treads from `stone_slab`: it paints the same
  flat grey UV as the floor, so the steps are invisible and only a carpet on
  them reads, in game as red plates hovering with a shadow gap underneath.
  For the same reason there is no carpet ON the treads, only on the dais top.
  The dais collision box tops out 0.02 UNDER its ramp summit (the tavern rule).
- **Throne** at `1.65 / 1.942`, a 2.23yd back, about 1.25x player height. It
  shipped at s=1.5, i.e. a 5.8yd back, over three times player height.
- **Braziers** are a stone plinth plus `Fire_01` at s=1.35, ~1.7yd to the bowl.
  `Fire_02` (0.18 x 0.66yd) is a table candle and read as litter on the floor;
  `brazier()` takes a z so a gallery or terrace one lands on its own storey.
- **Banner masts**: `CastlePart_01` raw is 9.5 kit of bare pole (12.8yd at the
  old scale) and read as an antenna. Scaled to 0.42 on the terrace, 0.36 in the
  courtyard.


### Circulation: ONE walkable deck per (x, z)

The keep's two flights must have **separate footprints**. A switchback stacked
in one strip (lower z 0.2-5 under upper z 5-10) looks right in Blender and is
broken in game: the engine keeps a single walkable deck per ground point, so
the upper flight wins everywhere and the lower one cannot be climbed at all.
A `/dev tp` ladder up the shaft proves it, every step reads the upper deck.

Current routing: the **lower** flight climbs the WEST strip front-to-back
(kit y 1.2 -> -3.3, z 0.2 -> 5.0), the **upper** flight climbs the EAST strip
back-to-front (y -3.3 -> 1.2, z 5.0 -> 10.0), and a minstrel's balcony across
the back of the hall joins them, with a stub into each stair shaft. Verify with
`tmp/_gallery_reach.mjs`, which flood-fills the authored gallery boxes and
fails loudly if any of them is an island, the first cut ran the balcony round
three sides and left the piece the stairs landed on unreachable, i.e. the whole
upstairs was dead content.

`tmp/_castle_collision.mjs` is the headless referee; probe against the KEEP
FLOOR, and remember a `/dev tp` can never land on the gallery or terrace (they
are standable BOXES, not decks), only the flights answer a tp.

`castle_critic_report.md` is a harsh-critic pass over the first cut, kept for
the numbers it measured. Items still open there: tower silhouette hierarchy
(M3), door-leaf proportion (M12), and most of the minor list.


### Stair treads: flat tile on a riser block

Do **not** build a tread by scaling a floor tile in Z to reach the flight's
base. `Tile_01` and `Floor_01` both carry relief on their top face, and at the
20-30x needed for a real flight that relief stretches into a palisade of
vertical SPIKES, the flights looked like a bed of nails. Do not reach for
`stone_slab` for the tread top either: it paints one flat atlas texel over
every face, so the flight reads as a smooth grey wedge instead.

`stone_stair` therefore builds each tread as an UNSCALED-in-Z `Floor_01` tile
seated 0.1 under the tread's top, on a `stone_slab` riser block carrying the
mass down to the flight base. Textured where you look, solid underneath.

### Close the art gap where a flight meets its landing

The decks are continuous but the KIT TILES are not: a plain 2.5-wide floor tile
at y=-5 stops at y=-3.75, so a flight whose head is at y=-3.3 leaves a 0.45-kit
hole in the floor exactly where you step off it, on every storey. Every landing
tile that abuts a flight is SCALED (`sy`) to meet the flight's end, and the
terrace's shaft exclusion list must drop every tile the scaled ones overlap or
the two z-fight.

## 2026-09-03, filler houses audited and lightened (`bl_lite.py`)

An audit pass over `tidehold/house_a..e` (report and renders in the session
scratchpad `house_audit/`) found the same faults in all five: the HouseBase_01
plinth stood 1.3 yd high across every door, the door leaf left a slot on the
latch side, the corner posts stood proud of the eaves, the slate retint turned
the gable plaster steel-blue, several props sat inside walls or below ground,
house_b's dormer shipped terracotta over a cavity, and house_e's door was inside
a solid wall with the real doorway an open hole. 52-57% of every house's
triangles were never visible from outside.

`bl_houses.py` now: skips the plinth on the doorway module and sinks the rest
to a 0.2 kerb, stretches the leaf to the opening and asserts its x against the
shell's HouseWall_08 modules, scales corners to the wall top (`CORNER_H`),
snaps props to the ground (`use(..., snap_ground=True)`), drops a near-black
`dark_box()` inside each storey (windows are open holes), and runs `lighten()`
from `bl_lite.py` before `finalize()`. `bl_build_common.py`: `use()` retints
every roof-family piece, `load_template()` planks the roof gables before the
retint and strips the kit's duplicate TEXCOORD_1 and COLOR_1/2.

`bl_lite.py` = `flatten_tiles()` (Tile_01 steps to 12-tri boxes),
`cull_hidden()` (BVH ray-escape test, two-sided, outward wall faces always
kept, downward faces get a 5-unit block distance), `dissolve_planar()` (8 deg,
delimit MATERIAL, the atlas is flat colour so merged n-gons cannot smear),
`decimate_slabs()` (collapse on boards, pots, barrels, the lantern; never on
roofs, walls, doors or ivy, the roof tiles shred at any collapse ratio).
Result per house ~55-60% fewer triangles and ~half the bytes with the kit
detail intact. Re-export loop: copy this folder to a scratch dir, fix SCRATCH
in bl_houses.py and PLANK_JPG/PACK, `bridge run bl_houses.py` (prepend
`HOUSES='ab'` for a subset), then the install/merge/update scripts in
`tmp/tidehold/` (`_install_tidehold_buildings2.mjs`, `_merge_tidehold_collision2.mjs`,
`_update_citadel_sizes.mjs`), `gen_collision_overrides.mjs`,
`gen_asset_catalog.mjs`, `build_media_manifest.mjs`.

**Wall style.** `bl_build_common.py` now has `WALL_STYLE = 'planks' | 'plaster'`
(a build script sets it before its first `use()`): 'planks' is the tavern's
dark Planks85_08, 'plaster' is `Plaster007_Color.jpg` (the game's own
structures texture, kept here too) with a cream tint (`PLASTER_TINT`) and a
4-unit repeat (`PLASTER_UV_K`). The filler houses use 'plaster' since
2026-09-03 (Troy: a light exterior that complements the slate roofs); the
timber trims, windows and doors stay on the kit atlas, the dark interior
box is unchanged.

## 2026-09-04, plaster exteriors on the explorable buildings, flames re-seated

`bl_lite.py` gained `plaster_exterior()`: after placement, every WocPlankWall
face whose world normal is roughly horizontal and points away from the
building centre (or straight up, for roof-side gable bands) is moved to
WocPlasterWall with world-planar UVs; inward faces keep their planks, so the
tavern, smithy, bank and hall are plaster outside and planked inside.
`bl_tavern2.py`, `bl_bank.py`, `bl_smithy.py`, `bl_hall.py` exec `bl_lite.py`
and call it before `finalize()`. The tavern also runs `bl_optimise3.py`,
`flatten_tiles()` (now every Tile_*/Floor_* template: Floor_04 alone was 70k
vertices of modelled grout, which is what the old *_BAKED floors replaced),
`dissolve_planar()` and `decimate_slabs()`, never `cull_hidden()` on an
explorable building. `finalize()` no longer exports tangents (no normal maps
ship). The tavern's Ivy_02 is scaled onto the east gable (legs to the eave
corners, apex under the ridge, group H2).

Flame seats in `citadel.ts` are now derived, not eyeballed: kit coords from
the build script x S -> (x, z, -y) model yards, plus the prop's own flame
geometry (warm atlas texels of Blacksmith_02/03, Lantern_02's glass, candle
tips, chandelier ring = Light_01 origin - 0.35). `render_flames.py` in the
session scratchpad renders emissive marker spheres over a shipped GLB to check.

## 2026-09-04, the smithy porch rebuilt as a real forge

`bl_smithy.py`'s east porch is a timber frame now: Corner_01 posts scaled to
the eave (2.85), a tie beam and two eave beams (`wood_box`), and HouseRoof_07
turned so its ridge runs OUT from the wall, scaled post-to-post (sx 2.14,
sy 1.64, sz 0.75 at (6.1, 0, 2.5)) so the eave underside meets the beams and
the ridge tucks under the main slope. `bl_forge.py` holds the custom pieces:
`forge(x, y, facing)` = brick base (Bricks076A, world-planar UVs, kept here as
`Bricks076A_Color.jpg`), stone rim around an emissive ember bed (WocEmber),
brick back, iron hood frustum (WocIron) and a brick stack to 5.6 with a slab
cap; `bellows()`, `quench_trough()` (WocWater top), `brick_box/stone_box/
wood_box/iron_box`. Layout: forge against the wall at (4.85, 1.75) facing +x,
bellows at its south side, anvil (Blacksmith_01) at (6.0, 1.6), trough at
(6.0, 0.3), chain tools on the wall, stores and the only rail at the south
end, east side open. Flame seats: hearth centre (4.85, 1.75, 1.04) kit ->
(8.73, 1.9, -3.15) model yards.

**Brimstone forge (2026-09-04).** `make_brimstone.py` authors a tileable
`Brimstone_Color.jpg` + `Brimstone_Emissive.jpg` (numpy: periodic Voronoi crack
network with a third of the cracks sealed, dark-red heat halo, yellow-white
cores, charred rock base, granular sulfur crust near the cracks). `bl_forge.py`
`FORGE_STYLE = 'brimstone' | 'brick'` picks the masonry material (`WocBrimstone`
= colour + emissive crack map at strength 2.5, world-planar UVs at 0.35). The
planar UV picks its projection axes from the WORLD normal: choosing them from
the local normal on a rotated box collapses one axis to a constant (streaks).

**Forge masonry, final (2026-09-04):** Troy rejected the brimstone ("ugly") and
asked for one of his tile textures, darker. `FORGE_STYLE = 'tile'` uses
`ForgeTile_Color.jpg` (= Tiles224_12 from the WOC Terrain Textures pack, dark
charcoal small tiles) at `TILE_GAIN` 0.7 baked into the packed image, world-
planar UVs at `TILE_UV_K` 0.6. The bellows and quench trough builders remain in
`bl_forge.py` but are no longer placed ("they look cursed"): forge, anvil, chain
tools, stores and the south rail are the porch.
Hood + floors: the fume hood is `masonry_frustum()` in the same forge tile;
`stone_floors()` (after `flatten_tiles()`) puts every flattened Tile_*/Floor_*
slab on `WocStoneFloor` = `FloorStone_Color.jpg` (Tiles224_01 flagstones from
the terrain pack, x0.85) with world-planar UVs so the flags run continuous
from the porch through the hut.
Forge v3 (more architecture, Troy: "less basic"): footing course, corner
pilasters, dark firebox niche with grate bars, cornice under the hearth, side
tool ledges, stepped lintel, two-stage hood with iron straps and collar, tapered
stack with corbelled cap and iron plate, tuyere into the bed. All boxes and
frustums via `masonry_frustum()` / `iron_box()`. **finalize() now bakes every
member's transform before the join**: a join keeps the first member's frame and
a rotated first member (a barrel at 52 deg) inflated the exported bounds to
34 yd for a 21 yd building, which would have mis-scaled SIZE/AUTHORED.
Coals + floors + base course (2026-09-04): `coal_heap()` piles glowing WocCoal
lumps over the ember quad above a lowered rim so the heap shows from standing
height; the citadel 'pit' embers emitter is scaled up and the 'forge' bonfire
turned down to a low tongue. `_flatten_one()` now tops each slab at the kit
piece's WALKING surface (area-median of its upward faces: Floor_06 0.111,
Tile_02 0.120) instead of its bbox, and bl_smithy places every prop on
FLOOR_Z / PORCH_Z (0.211 / 0.120), not the kit's nominal 0.14 / 0.17. The porch
collision deck in tmp/tidehold/_merge_tidehold_collision2.mjs is 0.13 to match.
HouseBase_01 runs along all four outside walls except the two door bays.

