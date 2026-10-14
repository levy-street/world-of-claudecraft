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
- **Stairs vs pillars.** The flights ran to x=-5.05 with the pillars at x=-5.0 , 
  a 0.488-radius pillar overlapping the treads. The stair strip
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
2026-09-03 (SPACEY: a light exterior that complements the slate roofs); the
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

**Forge masonry, final (2026-09-04):** SPACEY rejected the brimstone ("ugly") and
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
Forge v3 (more architecture, SPACEY: "less basic"): footing course, corner
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


## 2026-09-11, bank awning, hall nave, castle B stairs + reveal

- **Bank awning** (`bl_bank.py`): the lean-to is a `HouseRoof_07` gable
  bisected at the wall; its plaster gable-end wall (template y -1.46..-1.08)
  hung 0.8 kit inside the overhang, short of the post, and read from the
  street as a dark triangle floating over the wares. A lean-to has open
  ends: those faces are deleted after the bisect. Bounds unchanged.
- **Hall = the church** (`bl_hall.py`): the Furniture_14 pews sat lengthways
  along the aisle at feast tables, i.e. sideways to the throne. Now four rows
  a side (`PEW_X`, `PEW_YS`) face the dais (rz 0: back to the door), the
  candelabra moved to the side walls between rows, the two tables flank the
  dais as credence tables. Collision follows; the merge re-ran (28 boxes).
- **Castle B stairs** (`bl_castle_b.py`): every flight is ONE stepped
  `stone_prism` in the walls' cobble (joins the stone bake) instead of a
  Floor_01 tile per tread over stacked WocSlabStone masses, those shipped
  as flat grey wedges with each tile's side faces smeared dark across the
  riser. The blocks start 0.08 off the wall faces (a vertex inside solid
  stone bakes to the vertex-AO floor). The raking parapets are `rake_wall`
  bands in slab stone (a 0.28 band's faces are all margin in the shared
  stone bake and came out black in cobble). The band's bottom edge runs
  through the riser BOTTOMS, not the nosings: along the nosing line it left
  a row of triangular pockets over each tread that sat in the band's own
  shadow, a black stripe down every flight. `bake_vertex_ao` now also skips
  WocSlabStone meshes, as slab_material's docstring always claimed.
  `ceiling()` joists now stop at
  the stairwell `skip` rect, they ran the full length at 0.36 under the
  floor, i.e. at head height over the top of every flight. The two
  CastleFence_01 across the east end of flight B's well (where B lands) are
  gone. `tests/tidehold_castle_b_flights.test.ts` walks every flight against
  the installed colliders (step size, summit height, head-room) and then
  walks the level PATHS between flights and floors, which found two real
  drops: the Warden's floor box stopped at the inner wall face so the
  balcony doorway had no floor, and each wing landing box left a 0.1 kit
  crack against its floor box. Later the same day SPACEY wanted the flights
  "shorter and steeper" with room at their feet: A now runs y -5.6..-12.4
  (11 treads) with a standable box (top 0.15, the hall deck's height) in the
  bay before its foot, the 16-ramp cap was full, so no deck, and B runs
  x -8..-3 (10 treads), leaving a 2 kit walkway from A's landing along the
  back wall onto the middle floor (before, B's block began at A's well and
  the only way onto the middle floor was a zero-width corner).
- **Reveal** (`src/render/interior_reveal.ts`): `keepStoreys` keeps G_H1/G_H3
  visible whenever the player is inside (only the roof hides); set for
  castle_b, whose floors carry their own always-visible ceilings, so a
  floor's furniture no longer pops in when the player arrives on it.


## 2026-09-22, grain on the kit's flat palette, and the tavern's awnings

SPACEY, with a screenshot of tavern B's end awning: *"tweak the tavern model so
the overhang actually makes sense right now its floating and the beams are not
connected ... a lot of the assets are missing textures and just have a solid
look which looks a bit mid"*.

**`CartoonTown_Texture_01` is a palette, not a texture.** Its bottom half is a
grid of flat swatches and a kit face's whole UV footprint is about a TENTH of a
texel (measured over the shipped buildings: p50 0.1 texel on the 1K atlas).
There is nothing to sharpen, every brown beam, trim band, door, bench, plinth
and stone base course in the city samples one constant colour. Painting detail
into the swatch cells cannot fix it either: a sub-texel face still reads one
flat value, and tiling inside a 64 px cell needs wrapping UVs, which a
per-vertex planar projection cannot produce.

**`detail_kit()` (bl_build_common.py)** moves those faces onto two tiling
materials with planar UVs and carries the ORIGINAL swatch colour across in the
`Col` vertex attribute, which three multiplies over the albedo, the channel
`_weather_stone` already used. `make_kit_detail.py` builds the maps as HIGH
PASSES (source divided by a blurred copy of itself) normalised to a linear mean
of 1.0, so `swatch x detail` averages back to the swatch: the city's palette is
untouched and the surfaces stop being flat. Two materials cover thirteen
buildings instead of one per palette cell.

- `WocKitTimber`, Wood184_12 high-passed, `TIMBER_UV_K` 1.30 (a board ~0.35 yd).
  Grain runs along each face's own long axis, so a post's runs up it and a
  beam's along it.
- `WocKitStone`, the game's Bricks076B, `KITSTONE_UV_K` 0.40 (a course ~0.6 yd),
  courses always horizontal.
- Classification is by atlas colour (`_kit_detail_class`), measured by area off
  the shipped buildings: timber is the SATURATED r>=g>=b ramp led by
  rgb(81,48,28) (22% of the kit's surface), every member of it between
  saturation 0.55 and 0.75, which is what keeps the roof's terracotta
  (0.85-0.88) and the church spire's pure orange (1.00) out. Stone is the
  neutrals rgb(84,84,84)/93/70 (57%), saturation under 0.18. Near-black
  (41,41,41 and below) is the kit's DRAWN mortar and ironwork, texturing it
  only blurs the drawing. Reds, greens, purples and cream fail the tests.
  One family exception: `Chimney_01`'s shaft is 65% rgb(221,183,153), a pale
  tan BRICK, but the kit spends that same swatch on sacking and book pages, so
  the `masonry` flag widens the stone band for that family alone.
- **A face only counts if its whole UV footprint is ONE flat swatch**
  (`_face_flat_colour` samples the corners as well as the centre). Most kit
  faces are, but a few pieces are genuinely UV-mapped across the atlas , 
  ChurchTower_03's spire has 1466 distinct colours, and for those the centroid
  colour means nothing. Without that guard the castle shipped TERRACOTTA
  spires: the cone's UVs crossed the palette's orange cells, the faces were
  called timber, and they then escaped bl_castle.py's own `retint_roof()`.
- `DETAIL_HEADROOM` 1.45 must match the number make_kit_detail.py divided the
  stored maps by; the vertex tint is multiplied by it to put the mean back.
  `scripts/assets/blender_tidehold/detail_check.mjs` decodes a shipped GLB's COLOR_0 and prints
  the swatches it recovers, they must match the palette to within 1/255.
- **Anything re-materialled downstream is skipped**: `use()` retints every roof
  family and lantern, and `flatten_tiles`/`stone_floors` own the Tile_/Floor_
  slabs. The roof-family list must also cover the pieces a BUILD SCRIPT retints
  by hand, `ChurchTower` is in it because bl_castle.py does that for its
  spires. Roof pieces are the exception, their TIMBER (saturation < 0.75; the
  terracotta tiles sit at 0.85-0.88) is detailed with the slate retint applied
  to the swatch analytically (`_roof_retint_rgb`), so a porch post keeps its
  blue and gains grain while the tiles are left alone.
- COLOR_0 is load-bearing now. `ensure_col()` normalises every mesh to exactly
  one POINT layer named `Col` before any join (a join FILLS a layer the other
  mesh lacks, and the fill would multiply over its whole albedo), and the
  install script drops only the layers that are uniformly white.
  **It sets `render_color_index`, not just `active_color_index`**, the glTF
  exporter's "ACTIVE vertex color" path reads the RENDER index
  (`exp/primitive_extract.py`), and meshes that came out of a join with that
  still at -1 exported COLOR_0 as flat white. On these materials flat white
  means the raw detail map with no palette tint at all: castle B shipped a
  whole group of interior furniture in pale grey-brown before
  `tests/tidehold_kit_detail.test.ts` caught it.

**Tavern B's end awnings** (`bl_tavern_b.py`) were floating, measured: the
HouseRoof_07 gable was scaled sx 1.5 so its eaves fell at y -0.53 and 4.93
while the two posts stood at y 0.9 and 3.5 to 1.43 kit (2.6 yd) INSIDE each
eave, under the middle of the slope, where the roof underside is z 3.92 against
a post top of 3.0. Every post ended 1.7 yd short of the roof it was meant to
carry, and the only "beams" were two `HouseBase_01` PLINTH MOULDINGS laid on
their sides at z 2.75, joined to neither. The roof keeps its size and pitch
(the silhouette was not the complaint); the posts moved out to the eave corners
and it is a framed lean-to now, wall plate, head beam, an eave beam per side
and knee braces, via the new `timber_box()` / `timber_strut()`. Collision is one
box per post instead of one 3-kit wall across the opening, which used to fence
the awning off.

**Blender 5.1 drift caught on the way**: its glTF importer no longer wires the
atlas alpha into the Principled BSDF, so a rebuilt CartoonTown material exports
OPAQUE and every ivy leaf and plant card ships as a solid quad. There is no
CLIP blend mode left to ask for either, the exporter reads the GRAPH, and a
`Math:ROUND` on the alpha is its alpha-clip pattern. `_restore_cutout_alpha()`
puts that back before every export.

Re-run: `python3 scripts/assets/blender_tidehold/make_kit_detail.py`, then the
usual scratch-copy + bridge build, then
`TIDEHOLD_BL_OUT=<scratch>/out node tmp/tidehold/_install_tidehold_buildings2.mjs <names>`
(both install scripts take that env var now instead of a hardcoded path).
`scripts/assets/blender_tidehold/review_shots.sh <tag> <glb-dir> <out-dir> <names...>` renders the
standard six-view review set for before/after comparison, and
`column_profile.mjs <glb> <x> <z>` casts a vertical ray through a point and
lists the surfaces it crosses, how the awning's floating was measured, and
how the fix was proved (post top 5.36 = beam bottom, beam top 5.92 = roof
underside; before, the post stopped at 5.55 under a roof at ~7.1).

The verification tooling lives HERE rather than in `tmp/tidehold/` with the
install scripts, because `tmp/` is gitignored, the same trap this folder was
rescued from in 2026-08.


## 2026-09-26, the town kit rebuilt from scratch (`bl_town.py`)

SPACEY, with nine WoW references (Stormwind, Kul Tiras, Pandaria): the houses,
taverns, church, shops, market and smithy should read like World of Warcraft,
"more artistic and less basic square", interiors that make sense, collision
that matches, textures with variation and atlases, poly count kept down.

The twelve buildings (`house_a..e`, `tavern`, `tavern_b`, `smithy`, `market`,
`hall` = the church, and the new `shop_a` / `shop_b`) are no longer assembled
from kit walls: `bl_town.py` builds them parametrically with `bl_town_lib.py`
(stepped bell-cast slate roofs, jetties, half-timber, quoins, dressed door
arches, dormers, turrets, chimney breasts), furnished with the
`medieval_village_v2` props (LOD1, LOD2 for clutter). 5-10k tris a house,
7k a shop, 17-39k an enterable building.

- **Run it**: `python3 ~/.claude/tools/blender_bridge.py run
  scripts/assets/blender_tidehold/town_gui.py` builds `PIECES` live in the open
  Blender; `town_install.sh` (headless export -> build_assets -> KTX2 ->
  `town_install.mjs` -> generated tables); `town_place.mjs` re-seats the
  Deepglass map's placements (native scale, each placement's model ORIGIN kept
  where it was, fire emitters rebuilt, stale placement `hitboxes` dropped, two
  market-street houses swapped to the shops, the tavern NPCs re-seated) from
  the pre-rebuild map read from git (`BASE_COMMIT`), so it
  is idempotent; then republish the map (Studio "Publish to Game", or the
  same three calls from a throwaway vitest).
- **Textures**: `town_tex/derive_town_textures.py` (tiling maps from the WOC
  packs in `town_tex/src`, a 2048 detail atlas of windows, doors, signs, rose
  and lancet glass, crest and rune, and `TownAtlas_ORM.png`). Normal maps are
  512: at 1024 their UASTC copies were 4.5 MB of every GLB. `shared_kit_textures.ts`
  dedupes the kit's maps across the twelve GLBs and their twins on the GPU.
- **Glass**: `M_GLASS` samples the same atlas with the ORM map (panes rough
  0.07, dark glass metal 0.32, lead cames matte): the scene's PMREM sky shows
  in it as a cheap reflection. Door and sign cells stay on the matte atlas.
- **Wall planning** (`house()` / `storey_walls()`): every opening, shutter,
  lantern, chimney breast, turret and corner quoin is an along-wall SPAN, and
  windows slide off (or drop) anything they would clash with; shutters only
  where they fold clear; jetty brackets never hang in front of an opening.
  Timber (plaster) walls take square windows between posts with head and sill
  rails (`frame_wall`); a second jamb on a post was the "clipping windows".
- **Doors** are geometry (SPACEY: "should have real geo"): a closed door is one
  arched plank slab in the reveal, an open one two half-arch leaves folded
  back against the inner wall, iron straps, rivets and a ring on them. The
  surround's jambs are flush with its voussoir ring, a proud keystone on top.
- **Z-fighting**: `town_zfight.py` (bridge-run it on a built scene) lists
  same-facing coplanar overlaps that are actually VISIBLE (a ray off the
  overlap escapes to the sky, or crosses open room in an enterable building).
  It found: `beam()` and every `(u, n, up)` frame are left-handed, so boxes were
  inside out (`cuboid` now rewinds a mirrored basis); gable frames on the -A end
  built from the REVERSED triangle (a stray tie beam, one rafter and a corner-
  to-corner "king post"); a storey's full-footprint head course slab (a flat
  stone ceiling inside the church and smithy; now `course_band`); dormer front
  walls facing INTO the roof; members sharing front planes (now staggered 2+ cm).
- **Joins**: the export JOINS each reveal group. A join matches UV and colour
  layers BY NAME: parts carry `UVMap` + corner `Col`, and `_kit_template` strips
  the kit's TEXCOORD_1 / byte colours and adds a white `Col`, or every joined
  prop samples one atlas texel (white furniture in game).
- **Collision**: the sim steps a grounded mover up 1.0 yd, so
  `fit_furniture_boxes()` sets every small furniture box's top to its props'
  real top (a table box under the tabletop was a stair into the table). Each
  Edit-pieces node gets its share of the building's boxes/decks
  (`<tag>.pieces.json`, `town_install.mjs`).
- **Reveal**: the taverns, smithy and market are registered; the church is NOT
  (its eaves stand 9 yd up, and hiding G_H2 there only stripped the trusses
  and left the chandeliers in the sky). Upstairs furniture `G_INT_H1` is a
  child of `G_H1`, so it hides with its storey.

### Textures v2: hand-painted maps, smart materials, prop detail

SPACEY: "make all of the textures aaa qul like worlds of warcraft ... use smart
materials so the textures are unique to the buildings ... back up the current
textures so we can revert". Then: "revert all of the wood textures but insure
it still has the ambient occlusion smart materials", "build out aaa qul
textures for all of the small assets inside the buildings", and of the first
dressed stone: "these stone trim textures ... dont make sense".

- **Backup / revert**: the v1 set and the v1 GLBs are in
  `~/Documents/woc-backups/tidehold-town-textures-v1` (its README says how to
  put them back). `TOWN_TEX=v1 zsh town_install.sh` rebuilds on the original
  pack-derived set in `town_tex/` with no smart layer and no prop pass.
- **The v2 set** (`town_tex_v2/`, numpy only): `forge.py` (periodic noise,
  power-diagram Voronoi with exact edge distance, FFT blur, height -> normal /
  painted key light / cavity / AO, ramps, soft posterize); `paint_town.py`
  (stone, dressed, plaster, roof, flag, gold, cloth), `paint_atlas.py` (the
  2048 atlas: windows, rose, lancets, crest, rune, doors, signs, ORM). Each
  writes a `_preview_*.jpg` beside its maps.
- **Wood stays v1** (SPACEY liked it): `paint_town.py v1wood` copies
  `TownTimber/Floor/Teal/Blue` from `town_tex/`, and the atlas doors and sign
  boards are cut from the same pack sources. The smart layer still applies.
- **Dressed stone is ONE stone, no joints.** Every `M_DRESSED` cuboid (quoin,
  jamb, voussoir, sill, course, step) IS a block, so a coursed-ashlar map
  painted bricks INSIDE each quoin. The map is now a jointless tooled
  limestone: bedding, pitched chisel patches, a few angular chips, pores.
  The block's edges come from the geometry and the mask's edge wear.
- **Cobble walls** (`paint_town.py stone`, SPACEY: "more variation ... more hand
  painted", "make the cobble tile size bigger so it matches wow cartoon
  artstyle"): a power-diagram Voronoi (mixed sizes, no slivers: splitting
  cells shattered them), six calm colour families, the light in soft painted
  bands, per-stone brush strokes, a lit top rim and a cool underside, lichen
  on a few, mortar of varying width. One repeat is now 5.4 yd (`K[M_STONE]`,
  was 3.2): stones about 0.7 yd.
- **Smart materials** (`smart_bake()`, `src/render/assets/town_smart_material.ts`):
  each building (parts AND placed props) is unwrapped into one unique UV set
  (`UVMask`, TEXCOORD_1) and gets its own Cycles-baked mask in the glTF
  occlusion slot: R = two-sided AO, G = grime (ground band, blotches, squared
  cavities), B = convex edge wear. The material extras `townSmart` carry the
  per-material recipe (`SMART` in `bl_town_lib.py`); the shader tints grime,
  puts moss on UP-facing grimy stone and roofs, lights worn edges and paints
  the AO into the diffuse. Uniforms are set at first compile only: to A/B a
  recipe, rebuild, do not mutate `userData` at runtime.
- **Interior props** (`detail_prop_template()`, `town_tex_v2/paint_props.py`):
  the kit props are palette-mapped (flat swatches), so each flat face moves to
  `town_pwood` / `town_pmetal` / `town_pstone` / `town_pcloth` with box UVs in
  the template frame, its swatch carried in `Col` x `PROP_HEADROOM` (1.45).
  The maps are luminance high passes at a linear mean of 1.0 stored / 1.45, so
  the palette is unchanged. Wood is the v1 oak (Wood187_09) with its plank
  seams cut out and the boards cross-faded; iron is hammered with scratches,
  pits and rust (no ORM: the exporter would pack it with the smart mask into
  one per-building image); stone is the dressed limestone high-passed; cloth is
  a slubbed plain weave. Classing: greys are iron except `PROP_STONE`
  (lecterns, the forge, the furnace); the orange-tans in `CLOTH_SWATCH` are
  blankets, tablecloths and sacks, not timber; faces UV'd across the atlas
  (quilts, notices) and `PROP_SKIP` clutter (food, potions, books, cups) stay
  on the atlas. The per-prop tally prints at build time (`prop detail ...`).
  Their smart recipes are a LIGHT touch (edge 0-0.18, AO-in-diffuse 0.3):
  kit props are small and hard-edged, so the mask's bevel test calls most of
  a plank an edge, and a whole room is occluded at the bake's AO reach; at
  the building values the furniture came out pale and grey in game.
  Check a class change with a contact sheet: import the templates through
  `_kit_template` headless with `PREVIEW_VCOL = True` and render EEVEE.

### Curved members: window arches, gables, bargeboards

SPACEY: "make these arch windows trim a solid rounded arch not a bunch of split
rectangles", and of the bell-cast roofs: "patch the gaps on each side and
insure the wood patch doesnt clip through the roof".

- `arch_band()` builds a window's arch frame as ONE continuous band (front,
  extrados, soffit; grain along the curve) springing flush off the jambs.
- `sweep()` sweeps a member section along a polyline, continuous through every
  joint, with a perpendicular or fixed (vertical) section and optional
  per-point depths. Bargeboards and gable rafters use it.
- **The gable holes** were the soffit: one straight eave-to-ridge strip (a
  chord) under a bell-cast, sagging roof, so the gable end's edge strip (which
  follows the curve) stopped short of it and left a crescent hole along each
  rake. The soffit now follows the curve row by row; the gable wall's top is
  the roof's own underside at the wall line (half a slab up into it); the
  rafters are curved sweeps 2 cm under it with a haunched foot landing on the
  wall plate at each corner; each bargeboard is one curved board tucked 3 cm
  into the slab end and tall enough to cap the soffit and the stepped slates.

### Window-box plants

SPACEY: "use flowers from our generated tidehold flowers and shrubs on the
windowsills in place of the old flowers". Each window box is an open planter
(rim, soil flush inside) holding `shrub_bloom` and `shrub_heather` from the
Deepglass undergrowth kit (`scripts/assets/deepglass/bl_dg_shrubs.py`),
scaled to 0.4-0.55 yd and squashed across the box so nothing reaches the sill.
The shipped plant GLBs are meshopt-compressed, which Blender cannot import:
`town_flowers.mjs` decodes them into `tmp/asset_src/tidehold_town/flowers`
(`town_install.sh` runs it; run it by hand before a live `town_gui.py`
build, or the boxes fall back to the old painted blobs). `_flower_template()`
re-links the leaf sheets' cutout alpha (Blender 5.1's importer drops it:
solid quads otherwise), keeps the plants' vertex tint as `Col`, and ships
each sheet at 512 as `TownFlowerBloom` / `TownFlowerUnder`. All the plants on
a building are ONE Edit piece (`P###_flowers`) with no collision.

### Shop signs: placed last, beside the door, never clipped

SPACEY: "make sure the shop signs sit nicely connected near the front door and
doesnt float or get clipped by any other assets". `hanging_sign()` only
records a request (preferred spot on the wall line, the door it belongs to);
`place_signs()` runs after the whole building exists (awnings, porches,
lanterns, props, planters) and walks candidate spots out from the door
surround on both sides, a few heights round the requested one (the board's
foot at least 2.25 yd over the floor), shrinking the board if it must. A
candidate must:

- root on flat WALL: rays at the arm, the strut foot and both plate edges hit
  stone/plaster within 3 cm of the wall line (not a quoin, glass, a shutter);
- touch nothing: no triangle intersection with the building so far, 6 cm of
  air round every vertex off the wall;
- keep a 0.25 yd sideways keep-out clear of anything standing 0.4 yd or more
  off the wall (lanterns, jetty brackets, planters, awnings) from the board's
  foot to the arm, or it reads as overlapping from most of the street.

The bracket and its strut are bolted to an iron wall plate (the old bracket
started 0.2 yd off the wall: floating). The frame's rails, the arm, strut and
chains each have their own section and end INSIDE what they meet (the old rim
was exactly as thick as the board: z-fighting). The inns hang their sign
between the door and the lantern on that side; shop_b's awning stops 0.85 yd
short of its door to leave room. `SIGN_DEBUG = True` (set before exec'ing
bl_town.py) logs why each rejected candidate failed.

### The shops: walked in, stalls on the street, signs to the right

SPACEY: "these external shelfs are floating and dont make sense ... so some1
could fit behind those stalls and it touches the ground ... these 2 shops
need interiors so you can buy stuff there and make the signs on the right
side of the door".

- `house(spec)` takes `enterable=True`: the ground storey gets its inner
  plaster faces, an OPEN door (leaves folded on the inner wall), a plank floor
  deck, a joisted ceiling, wall collision with a door gap (no solid block),
  no dark core; its quoins become L-shaped slabs that stop 3 cm short of the
  inner face (a solid quoin block runs 1.1 yd in: through the wall), and the
  plinth's dressed band narrows to stay inside the 0.45 wall.
- `awning_spans` reserve wall spans the jetty above puts no brackets over
  (the brackets hang 1.3 yd down the wall: into shop_a's awning).
- `street_stall()`: an awning on two timber posts standing on stone pads in
  the street, a ledger on the wall, a counter on legs with its back edge 1.4
  yd off the wall (the stallholder's aisle), a lower shelf, a runner in the
  awning's canvas, a plaque with the shop's icon. `shop_counter()` and
  `wall_shelves()` furnish the room; goods are scaled to clear the board above.
- `prop()` now seats every kit prop on its LOWEST point (except wall-hung
  Shield_ / Weapon_): Box_02's origin is its centre, the cauldron's its rim,
  the chest's is below it, so they sank or floated everywhere they were used.
- The sign spec's `door_side=1` keeps the sign to the RIGHT of the door as
  you face it (+u in the wall frame); the doors moved in from the corners to
  leave room (shop_a -3.0 -> -1.6, shop_b -2.1 -> -0.7).
- The shops register in interior_reveal (`town_install.mjs` ENTERABLE), and
  `town_place.mjs` seats the market's trade-goods factor (Ore-Factor Dunn,
  shop_a) and its apothecary (Wren Fell, shop_b) behind their counters.

### The bank, the auction house, and the vault door

- `bank()` is the one old building rebuilt in the new style (SPACEY: "only the
  1 building needs work"): a stone banking storey under a jettied timber one,
  a teller counter behind an iron grille, pews, pillars, chandeliers.
- `auction_house()` replaces the market hall (`BUILDERS['market']`): a
  32 x 19 hall behind a four-column portico, a coffered ceiling, stone towers,
  a cupola. Five draped booths each have a lectern whose reading slope faces
  the auctioneer standing behind it (`INFO_AH.npcs`: `town_place.mjs` creates
  and seats four `th_auctioneer_*` World Market NPCs beside Factor Coralwake).
  The two banner poles stand free on stone plinths in front of the pediment.
- The vault (`vault_door()` in the lib): a 2.8 x 3.5 bronze leaf in a dressed
  portal, hinges on the left as you face it, the Tidehold crest as a gold star
  and waves on blue enamel (the atlas crest cell's field), a spoked wheel,
  four bolts, a gold-bar plaque above. Behind it a strongroom annex off the
  back wall holds a heap of loose coins (`coin_heap()`, coins only), ingot
  pyramids and chests. A brass rope (`rope_line()`) keeps the swing clear.
- The leaf, wheel and bolts are MOVERS: parts named `G_MOV_*` export as their
  own nodes, origin on the pivot, with their motion as glTF extras
  (`wocMover`). `render/placed_movers.ts` swings them on a click (wheel and
  bolts first, then the leaf; sounds for each stage). It is the viewer's own
  door: the doorway's collision stays closed.
- Kit `Chest_01` is two meshes (box + lid); `_kit_template` joins every mesh of
  the chosen LOD now. Before, every chest in town was a bare lid.

### Rose windows and glass

- Each building has its own rose (`paint_atlas.py` `ROSES`, `CELL['rose_<key>']`,
  picked by the build loop through `ROSE['cell']`): the hall a cathedral rose,
  the auction house a sunburst, the bank an eight-point star, the taverns a
  flower and a hexafoil, house_b a quatrefoil, shop_a a pinwheel, house_e the
  original. Big roses have a full 512 cell; the shop signs and small roses
  moved into 256 quarter cells (a third entry in `CELL`).
- Glass exports ONE-sided: every pane is a street face wearing its cell and,
  1.2 cm behind, an inward face wearing the unlit dark-blue cell
  (`glass_face()`), so windows glow only from outside. Stained glass keeps its
  pattern both ways.

### LOD twins: 200 / 300 / 500 yd

SPACEY: low-poly versions for far range that "look the same", imposters at
300, nothing past 500, no interiors or extras out there.

- While a building is built, its walls, roofs, drums, cones, columns, big
  blocks, jetty soffits, dormer cheeks, spire and cupola record a coarse
  envelope (`ENV`, `env_*` in the lib); interiors, furniture, stalls, awnings,
  flowers and kit props never do (`ENV_NOT`, `with env_off():`).
- `bl_town_lod.py` turns it into a mesh (a few hundred triangles), unwraps it
  and bakes the finished exterior onto it with Cycles (EMIT, selected to
  active, rays from 0.4 yd outside): the albedo exactly as the game draws it,
  smart grime / edges / occlusion / moss included, plus an emission map for
  lit windows. Exported as `tidehold_<name>.lod.glb` -> `models/tidehold/<name>.lod.glb`
  (catalogue and collision bake skip `.lod.glb`).
- Runtime (`placed_batch_core` `TWIN_NEAR` / `TWIN_FAR` / `BUILDING_CULL`): the
  full model to 200 yd, the twin as instances (no shadows) to 300, a sprite
  baked from the twin (128 px cells, its own atlas) to 500, then culled. The
  interior-reveal clones switch too: past 200 the clone hides behind its twin.
- Preview a twin beside its building: `LOD_PREVIEW = True` in a GUI script.
