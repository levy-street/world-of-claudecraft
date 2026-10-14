# Deepglass arena art kit

Procedural Blender authoring for the Deepglass models: the cradle pylon, the
goal gate, the powerup station, the boost vent, and the thrustpack's burner
plume. Everything is generated from these scripts, there is no hand-modelled
`.blend` to keep in sync, so a change to a profile or a bake setting is a re-run,
not a remodel.

Output lands in `tmp/asset_src/deepglass/`, which is exactly what
`scripts/assets/specs/deepglass.json` reads.

## Running

Blender must be **open** with the BlenderMCP addon's server started (sidebar
`N` → BlenderMCP → Connect); the bridge is a plain socket on `127.0.0.1:9876`
and cannot run under `blender --background`. Then, per asset:

```
python3 ~/.claude/tools/blender_bridge.py run scripts/assets/deepglass/dg_pylon.py
```

`dg_lib.py` is not run directly, each asset script `exec()`s it, because the
addon gives every call a fresh namespace and nothing persists between them.

## The full loop

```
# 1. author + bake (one call per asset, ~2 min each on CPU Cycles)
python3 ~/.claude/tools/blender_bridge.py run scripts/assets/deepglass/dg_pylon.py
python3 ~/.claude/tools/blender_bridge.py run scripts/assets/deepglass/dg_gate.py
python3 ~/.claude/tools/blender_bridge.py run scripts/assets/deepglass/dg_station.py
python3 ~/.claude/tools/blender_bridge.py run scripts/assets/deepglass/dg_vent.py
python3 ~/.claude/tools/blender_bridge.py run scripts/assets/deepglass/dg_plume.py

# 2. optimise into public/
node scripts/assets/build_assets_fork.mjs scripts/assets/specs/deepglass.json  (the fork copy: honours keepAttributes)

# 3. MANDATORY: KTX2/Basis, or the assets ship as webp and the
#    glb_texture_compression test goes red (needs `ktx` 4.3+ on PATH)
node scripts/assets/compress_glb_textures.mjs \
  public/models/deepglass/cradle_pylon.glb \
  public/models/deepglass/goal_gate.glb \
  public/models/deepglass/powerup_station.glb \
  public/models/deepglass/boost_vent.glb

# 4. manifests: runtime media + the editor's placeable-asset catalogue
node scripts/build_media_manifest.mjs generate
node scripts/gen_asset_catalog.mjs
```

## The plume is a different kind of asset

`dg_plume.py` has no textures and no bake, it is pure geometry whose UVs are
DATA, read straight by `src/render/jet_fire.ts`:

| channel | meaning |
| --- | --- |
| `UVMap.x` | where the vertex sits AROUND the plume, 0..1 |
| `UVMap.y` | how far ALONG it, 0 at the nozzle mouth, 1 at the veil tip, past 1 out on the tail |
| `UVData.x` | how far ACROSS a ribbon, 0 on the spine and 1 at the edge |
| `UVData.y` | a per-ribbon seed, so the three do not wobble in lockstep |

Two things in the pipeline will quietly destroy that, and both are handled:

- **`prune` strips vertex attributes no material reads.** Correct for a
  downloaded pack, fatal here, nothing in the GLB references these UVs. The
  spec entry carries `"keepAttributes": true`.
- **`meshopt` quantises positions into a normalised box** and puts the offset
  and scale back on the node, and glTF's V axis runs the other way from
  Blender's. `preparePlumeGeometry` in `jet_fire.ts` bakes the node transform
  back down and un-flips V at load, so object space is the space this script
  authored in, which the shader depends on, because it stretches the plume by
  scaling object-space Y and that only means "out of the nozzle" while the
  mesh's own origin IS the nozzle.

## Things that will bite you again

- **Bake base colour through EMIT, never the DIFFUSE pass.** A metal has no
  diffuse albedo, so a Cycles DIFFUSE bake writes every brass texel near-black
  and the whole kit ships looking like cast iron. `bake_asset` routes the
  Base Color socket through an Emission shader instead.
- **Never assign `image.colorspace_settings` after baking.** On a *generated*
  image that re-runs the generator and silently throws the bake away, you get
  correct-looking bake logs and uniformly black PNGs. Colour space is fixed at
  creation in `_img(is_data=...)`.
- **Cycles on CPU.** The Metal backend crashes Blender 5.1 inside
  `MetalKernelPipeline::compile` while serialising its binary archive.
  `reset_scene()` pins `cycles.device = 'CPU'`.
- **Previews render through EEVEE.** `render_preview()` draws offscreen with
  `draw_view3d` because an uncomposited Blender window never redraws its
  viewport; `RENDERED` shading under Cycles would return before the async
  viewport render produced a pixel, so it swaps the engine for the shot.
- **The window-less context.** Every `bpy.ops` call that reads
  active/selected objects needs `ctx_override()`.

## Scale and orientation contract

The runtime reads all four through `src/render/deepglass_kit.ts`, and the sim
positions come from `src/sim/deepglass/layout.ts`. If you change a dimension
here, that module's placement constants have to move with it.

| model | authored size | origin | axis |
| --- | --- | --- | --- |
| `pylon` | 8.7 yd tall | base of the plinth | +Z up |
| `goal_gate` | 39 yd mouth, 8.2 yd deep | ON the scoring plane | +X = deeper into the goal |
| `powerup_station` | 9 yd tall, 6.6 yd wide | the orb's centre | symmetric top/bottom |
| `boost_vent` | 3.5 yd across | ring centre | +Z through the ring |

The gate is authored around +Z and rotated to +X in `dg_gate.py` before export,
so the GLB's own axis already matches the sim's ring planes at x = ±30.

Node names matter: `deepglass_kit.ts` looks up `vent_cowl` / `vent_rotor` and
`station_frame` / `station_ring_a|b|c` by name so it can spin them
independently. Renaming a Blender object breaks that silently, the part just
stops appearing.

## Editor

All four are in the Studio asset browser under the **deepglass** category
(`gen_asset_catalog.mjs` picks up anything under `public/models/`). Note that
the editor normalises a placed asset to ~2.2 yd at scale 1, so the pylon wants
roughly scale 4 to match the size it is authored at.

## Arena kit v2 (`bl_dg_arena.py` → `arena_*.glb`, `bell_frame.glb`)

Rebuilt 2026-09-25 (SPACEY: "the entrance is blocked and doesnt make alot of
sense make it way more epic and the glass center bit way more epic and fitting
for the rest of the city with the gold trim and glowing blue walls ... insure
all of the collision fits neatly the textures look slick").

```
# build + install everything (headless export, meshopt, KTX2, manifests,
# authored collision, pins src/render/asset_scale.ts), or PIECES="gatehouse floor"
scripts/assets/deepglass/arena_install.sh
# Cycles previews of single pieces (no export)
ARENA_PREVIEW=gate_out,gate_in,hall,floor,bell /Applications/Blender.app/Contents/MacOS/Blender -b \
  --python scripts/assets/deepglass/bl_dg_arena.py
# lay (or re-lay) the kit into a map doc, then publish it from Studio
node scripts/assets/deepglass/place_arena.mjs <in.map.json> <out.map.json>
```

| piece | what | frame |
| --- | --- | --- |
| `arena_stand`, `arena_stand_vom` | one 22.5° wedge of the bowl; the vom's tunnel runs from the floor under the rake THROUGH to the ambulatory | origin at r 81.4 on its centre line, +X out |
| `arena_gatehouse` | the Tide Gate: terrace at the bridge deck (y 6) with beacons, open great arch, vaulted hall at y 6, 18-riser stair down to the floor between two seating blocks | same wedge frame |
| `arena_floor` + `arena_floor_core` | the paved floor at y 0.40, bell axis to stands: gold rings, teal pylon band with gold sockets, cyan tide ring and ley lines, gold star under the bell | wedge origin at r 33.7; core at the axis |
| `arena_canopy` | slate-blue awning with gold battens and struts | origin at r 90.5 |
| `bell_frame` | gold collar the pylons grip, eight ribs on the odd sixteenths (clear of both goal holes), crown ring, fins and crystal | origin at the bell's CENTRE; loaded by `render/deepglass_kit.ts`, not placed |

**Tiling textures, not a bake.** Every face gets world-yard UVs in the arena's
POLAR frame (`apply_uvs`): walls facing the centre take (arc length, height),
radial walls (radius, height), floors (arc length, radius). The arc repeat is
snapped per face so a whole number of tiles spans a wedge, which is what keeps
the courses continuous across the seams. Maps live in `arena_tex/` and are
derived by `arena_tex/derive_arena_textures.py`; dyes go into the IMAGE (the
glTF exporter drops Blender tint nodes).

**Emissive is calibrated for the game's tone mapping**: deep cyan `0x1cb6ea` at
strength 1.6 for lines, 0.45 for panels. The paler Tidehold rune hex at 4 read
as flat white on every panel.

**Collision.** Authored boxes + walkable `ramps` per piece, as v1. The stair is
a nosing-line ramp from 64.26 (floor) to 84.86 (hall floor), flush with the
forecourt and hall decks; the seating blocks reuse the stand's rake decks
clipped to the canyon; the canyon walls step with the rows (tops at each band's
highest row + 1.1, so the seats can never step over into the canyon). Pinned by
`tests/deepglass_arena_kit.test.ts` (an unbroken walking line floor→bridge, a
clear centre line, the vom through to the ambulatory, the floor at one height).

**v3, after a review pass (same day).** Rune TRACERY (thin lit lines over a
dark sea-slate backing, gold mullions) replaced the flat cyan cards; gold is a
brushed metal with a wide-range albedo and a faint warm emissive floor; the rows
are cut limestone (`ArenaDressed`) with Tidehold-blue seats; roofs wear a
painted scalloped slate; turned parts (towers, cones, beacons, braziers) take
cylindrical UVs about their own axis (`cyl_uv`). The gate gained flanking
towers over the water with banners, 14-yd beacons, traced canyon arches, a
two-flight stair round a landing (braziers placed there), lit hall coffers and
a runner down the axis; the floor a real tide channel (water 0.30, bed 0.15,
gold kerbs; `src/render/arena_water.ts` puts moving caustics on `arena_tide`)
and, on the gate's wedge (`arena_floor_gate`), a bridge over it; the bell frame
tapered ribs, latitude rings at ±30° and a crown to match; the bridge modules
the same tiling set (`dg_bridge.py`, `BRIDGE_BAKE=1` for the old bake).

**Seat collision follows the ring.** v1/v2 laid STRAIGHT decks along each
wedge's centre line, which read the rake at the wrong radius off it: a body at
a seam stood a yard inside the seats. Each run of rows is now three decks
rotated about the arena centre (±15°, 0), on the line through the middle of
every tread (`rake_mid`), the gangway a riser above. Pinned by the seam sweep in
`tests/deepglass_arena_kit.test.ts` (mean error < 0.12 yd); a live walk across
a seam measured ±0.1. The canyon walls are sloped boxes (MapHitbox ridge with
`fall`) on the coping line; `install_authored.mjs` carries slope fields now.

**Shared textures.** Every kit GLB embeds its own copy of the maps; the loader
swaps each for the first byte-identical one loaded
(`src/render/assets/shared_kit_textures.ts`, kit URLs only): 31 unique
textures on the GPU for the whole kit instead of ~135.

Things that bit this pass:
- **Place the kit DETACHED at groundY 0.** A grounded placement seats on the
  terrain under its CENTRE (`colliders.ts`), and the gate's centre stood on the
  old ramp's stamps: the whole gate rode 1.1 yd high and its forecourt was a
  wall. `place_arena.mjs` anchors every piece and sheds the old ramp stamps
  (level stamps along x ±9, z 78 to 106) and the old stair's rail boxes.
- **`_spans` must sort its openings.** v1 declared the gate's arch before its
  niches, the cursor walked backwards, and a wall span was laid across the arch.
- **Probe with the app's own module instances.** In the dev server the game
  imports `/src/sim/*.ts?t=...`; a bare `import('/src/sim/colliders.ts')` in a
  harness is a SECOND instance on the built-in overworld. Import the URL the
  page already loaded: `performance.getEntriesByType('resource')` lists it.

## Warden wharf kit (Tidehold's harbour docks)

`dg_wharf.py` builds WoW-style timber docks in the Warden wall's language:
hand-painted plank decks on rope-wrapped, brass-collared piles and X-braced
trestles, octagonal Warden masonry pier heads, cyan rune glass. Unlike the
baked arena kit above it ships **tiling textures** (`wharf_tex/`, derived by
`wharf_tex/derive_wharf_textures.py` from SPACEY's Planks85/Wood182/Wood189 packs
and the Tidehold stone, brass and slate): placed props are GPU-instanced per
(asset, sub-mesh), so a few materials per piece cost a few draws in total.

| piece | what | frame |
| --- | --- | --- |
| `deck`, `deck_rail`, `deck_rails` | 8 x 8 pier module, 0/1/2 rope rails | pile feet at z 0, planks at 36 |
| `quay`, `quay_rail` | boardwalk SECTOR fitted to the ring quay (r 277..293, 0.04 rad) | origin at r 285 on its bearing |
| `quay_wide`, `quay_wide_rail` | the sector for docks laid out 1.5x: built for a ring of 1/1.5 the radius (0.06 rad), so at plan scale 1.5 it tiles r 276.5..300.5 | origin at r 288.5 when placed |
| `bastion` | octagonal Warden pier head, parapet on the seaward faces | pile feet at 0, deck 36 |
| `bastion_open` | the same head with its straight seaward face open between the corner piers: a wharf's end | pile feet at 0, deck 36 |
| `berth` | the ship connector: plank gangway on piles, Warden gateway (rune sign, lanterns) at the pier edge, rope rails, open seaward end | pier edge at x 0, gangway out along +X |
| `stairs` | landing + flight that runs INTO the water (swimmers walk out) | pile feet at 0, deck 36 |
| `crane`, `mast`, `lamp`, `bollard`, `rail`, `shed` | dressing that stands ON a deck | base at z 0 |

Pile-borne pieces are placed detached at `groundY = 6.08 - 36` (planks 8 cm over
the Low Wards cobbles); dressing at `groundY = 6.08`. Scale 1 is authored yards
(`WHARF_KIT_MAX_DIM` in `src/render/asset_scale.ts`). Each build writes a
collision sidecar: blocking `boxes` and walkable `ramps`, both with an optional
yaw `ry`. The octagon is four face-to-face slabs, each one face wide: their
union is the octagon (two overlapped squares made an eight-point star whose
floor and walls reached 3 yd past every face). Stair flights are nosing-line
ramps (32 risers, the landing the last step) so feet ride the tread edges.

Tidehold's docks are laid out 50% larger than the kit (`wharf_layout.py`):
pile-borne pieces at `scaleX = scaleZ = 1.5` with height scale 1, so the plan
grows while the planks stay at 6.08 and the rails, parapets and tide band keep
their walking and waterline heights; dressing at a uniform 1.5; cargo and boats
1.5x. Each main wharf ends in `bastion_open` with a `berth` out of its open face;
the layout re-berths the galleon already in the harbour across that end, its
landing on the gangway and its main deck level with the planks.

```
# preview (Cycles camera shots, no export) / build every piece headless
PIECES="deck quay bastion" scripts/assets/deepglass/wharf_build.sh
PREVIEW=0 scripts/assets/deepglass/wharf_build.sh
# optimise + catalogue + collision (pins asset_scale.ts from the sidecars)
scripts/assets/deepglass/wharf_install.sh
# lay both harbours onto a map doc (re-runnable: drops the previous wharf and
# its dressing, re-berths the ships, declares harbour lakes so the sculpted
# basins are swimmable)
python3 scripts/assets/deepglass/wharf_layout.py <in.map.json> <out.map.json>
```

`bl_wharf_showcase.py` is the BlenderMCP-bridge scene: it instances the east
harbour of a laid-out map in the Blender GUI and renders a hero shot (export
still runs headless; glTF export over the bridge crashes Blender 5.1).
Guarded by `tests/warden_wharf_kit.test.ts`.

## Tidehold galleon (a walkable three-master for the harbours)

`dg_galleon.py` builds `wharf_galleon`, a WoW-scale galleon players walk
(hull 36 yd, 49 yd with bowsprit and spanker boom, masts to 32 yd, 15k tris),
and its `wharf_gangplank`. It shares the wharf materials and adds its own
textures in `ship_tex/` (`make_ship_textures.py`): painted sail canvas with seams
and reef bands, the Tidehold crest sail (the main course), an alpha-clipped
rope net for the fore and mizzen shrouds, Planks85 hull strakes and a
Warden-blue board band. The hull is lofted from station/level functions
(`half_beam`, `keel_z`, `top_z`, `breadth`, `rake`), so changing those
constants reshapes the planking, wales, decks, walls and the collision together.

Frame: bow +X, port +Y, keel bottom at z 0; design waterline `Z_WL` = 1.72, and
decks at `D_MAIN` 9.8, `D_Q` 12.7 (quarterdeck), `D_P` 15.4 (poop), `D_F` 12.1
(forecastle) and the crow's nest at 20.36.

The underwater body is drawn like a shipwright's profile. `keel_z(x)` is the
bottom of the PLANKING: a long flat of floor amidships, the run sweeping up aft
into the tuck under the counter and the entry lifting forward into the stem.
The backbone below it is one lofted strip (`spine`) whose top always meets that
planking and whose bottom is the flat keel line until the stem's curve takes it
up at the forefoot - keel amidships, deadwood filling the wedge at each end,
stem forward - with a shoe under the keel, a raked sternpost out of its heel and
the rudder hung on that with iron straps. Before this the keel was a straight
bar at a fixed height, so it (and the rudder) hung in the air under the risen
planking at both ends - clearly visible from below. Floated on the -2 harbour the main
deck and the two boarding landings (plank platforms overhanging each gangway
port, open at the outer end) sit at world 6.08, level with a Warden pier.
The main mast carries a ladder up its aft face to the nest (a `ladders` entry
in the sidecar, climbed by `src/sim/ladders.ts`); the anchors hang on catheads
clear of the bow. The waist ports are PLANKED OVER (no guns), and each boarding
landing juts 1.55 yd proud of the planking on bearers that start inside the
skin and knees that land on its fascia; its lanterns sit ON the end posts, and
the berth's gateway carries no sign board or hanging lanterns, so nothing
crosses the gap a player steps over. The square sails are deep (nearly as tall
as they are wide) - the first cut was half that and read as squashed bands.

**Wind.** The sails and pennants move (the gate uniform `uSwayPlayer` is
written by renderer.ts each frame - it had no caller at all, which froze this
AND the placed-tree sway): `src/render/ship_wind.ts` patches the
kit's canvas materials (`ship_sail`, `ship_sail_crest`, `ship_cloth`,
`wharf_cloth`) on the shared GLB template, the same way `tree_sway.ts` patches
foliage, one program, no per-frame JS, and an in-shader gate on the player's
distance so nothing animates past 100 yards. The per-vertex weight is the
mesh's own UV (sails: zero along all four bolt ropes, one mid-canvas, displaced
along the normal; pennants: zero at the hoist, one at the fly, displaced in the
model frame so both skins move together). That is why the pennant cloth is a TEXTURED material (the canvas dyed
Warden blue, `ShipPennant_Color.jpg`): an untextured material loses its
TEXCOORD_0 in the glTF export, and with it the weight. Dye the IMAGE, never a
Blender multiply-tint node - the exporter drops those and ships the raw canvas.
Each pennant's UV v is its own phase seed (authored on sixteenths, snapped in
the shader), so the three mastheads never snap in unison - and every vertex of
one flag shares exactly one seed, or the edges drift onto different rates and
wring the cloth out of shape over a few minutes.

The Studio floats it: dropped over water, `src/editor/float_on_water_core.ts`
seats it detached at its waterline (`groundY = water - 1.72` at scale 1). A
galleon placed larger sinks further until its main deck still meets the pier
level (`groundY = water + 8.08 - 9.8 * scale`); the gangplank lies at pier
height, `water + 8.08`, at any scale.

Collision is sized for the Studio's Collision Master, which keeps 64 boxes
and 16 decks per placement (60 boxes, 16 decks, 1 ladder):
- Walkable ramp decks cover the main deck, the landings (reaching inboard
  over the main deck so the ports have no seam), the forecastle, the nest and
  the five stair flights (nosing-line ramps). The deck slices are short where
  the hull tapers, and at the bow they are mapped through `rake()` like the slabs.
- Raised decks (forecastle, quarterdeck, poop) run out to the hull's outer skin
  at each slice's narrowest point, into the wall boxes: placed several times
  larger in plan, a body gets within a hand of the walls, and a slice sized to
  the inner skin left strips to fall through. A breastwork box closes the raked
  stem ahead of the forecastle's last slice.
- The quarterdeck and poop roof the two cabins, so they are standable SLABS
  (boxes), not ramp decks. A ramp deck is raised ground with no underside:
  a hop in the cabin below would land on it through the ceiling, and the
  wall standoff reads its edge as a cliff at the cabin door.
- Bulkhead boxes stop a yard under the deck above, so a climber's body clears
  them at the head of a flight.
- Yawed side walls follow the inner skin at the deck they rim.
- The hull is boxed along the swim band, so a swimmer meets the planks; its
  tops sit a hair under the main deck, a floor wherever a body passes a deck's
  edge (so a placement stretched tall has no step at the ports).
- The gangway ports (both sides) are open to the landings.

```
# design renders over the BlenderMCP bridge (GUI; prepend SHOTS='hero,side,...')
python3 ~/.claude/tools/blender_bridge.py run scripts/assets/deepglass/dg_galleon.py
# export headless (glTF export over the bridge crashes 5.1), then install
GALLEON_EXPORT=1 /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/assets/deepglass/dg_galleon.py
GALLEON_EXPORT=1 GALLEON_PIECE=gangplank /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/assets/deepglass/dg_galleon.py
scripts/assets/deepglass/wharf_install.sh
```

Guarded by `tests/warden_galleon.test.ts`. It walks the real movement kernel
up every flight and through both cabin doors, hops in both cabins, checks the
walls, the gangway ports and a swimmer at the hull, and climbs the ladder to the
nest and back in a live Sim (`tests/ladder_climb.test.ts` covers the controls).

## Foliage v2: trees, shrubs, grass (`paint_foliage.py` → `bl_dg_trees.py` / `bl_dg_shrubs.py`)

Rebuilt 2026-09-24 (SPACEY: "another pass on the trees bush's and grass ... the
base of the branches should always be closest to the tree ... some trees with
purple flowers or pollen ... make the frosted ones a bit more snowy ... have
some of the trees be thick in the middle"), graded asset by asset by a harsh
review pass against WoW references until each reached 8/10.

```
python3 scripts/assets/deepglass/paint_foliage.py [--preview] [--only=<sheet>]
B=/Applications/Blender.app/Contents/MacOS/Blender
$B -b --python scripts/assets/deepglass/bl_dg_trees.py  -- tmp/foliage_build [name ...]
$B -b --python scripts/assets/deepglass/bl_dg_shrubs.py -- tmp/foliage_build [name ...]
node scripts/assets/deepglass/finish_dg_trees.mjs  tmp/foliage_build
node scripts/assets/deepglass/finish_dg_shrubs.mjs tmp/foliage_build
python3 scripts/assets/deepglass/pin_foliage_scale.py   # re-pins DG_TREE/SHRUB_MAX_DIM
node scripts/gen_asset_catalog.mjs && node scripts/build_media_manifest.mjs generate
```
`DG_QA_OUT=<dir>` on either finisher writes the GLBs there and installs
nothing (no `public/`, no collision, no kit record), the review loop.

**Sheets** (`tree_tex/foliage/`, one per family so a GLB embeds only its own):
`dg_fol_pine` (pines, root giants, pollen pines), `dg_fol_snow` (snow
conifers), `dg_fol_bloom` (violet-blossom trees and shrub), `dg_fol_under`
(leafy/berry/heather/juniper/moss/snow shrubs), `dg_fol_grass` (grass, fern).
The painter composes SPACEY's generated boughs and fronds
(`tree_tex/src/leaves`, `tree_tex/src/fronds`) and paints the rest (clumps,
panicle blossom, wisteria, catkins, heather, grass, snow) procedurally.

**Source art is checked in** (`tree_tex/src/`): those boughs and fronds, and the
trunk bark (`tree_tex/src/bark`: SPACEY's hand-painted `bark_pine` / `bark_root`
plus the `_color` / `_normal` / `_orm` maps `derive_pbr.py` makes from them).
They used to live in gitignored `tmp/`, so any other checkout repainted
different sheets and silently fell back to other bark. From a clean clone,
`paint_foliage.py` then the two Blender builders and finishers reproduce every
shipped sheet and all 36 kit GLBs byte for byte (checked 2026-09-24).

**The anchor contract** (SPACEY's bug). Every cell records where its wood
ENTERS (`anchor`) and which way it grows (`axis`: `right` side-view bough,
`down` plan-view bough / raceme, `up` crown / grass, `centre` stemless clump);
the builders put that exact point on the branch. `check_wood()` fails the paint
if woody pixels sit away from the anchor. v1 fed side-view art (woody base at
the top LEFT) to cards that assumed a top-centre anchor, and flipped a bough
upside down for the crown, woody ends out at the tips of cards.

**Both faces are real geometry.** Blender's glTF export deletes a face that
shares its vertex set with another, so v1's "both windings" shipped ONE and
every card was invisible from behind. `dg_foliage_lib.py` emits front and back
on separate vertices; a face that points DOWN shows its cell's `back` twin
(snow boughs have green half-size twins: snow lies on top of a branch) and is
darker. The finishers only add twins to a build not marked `two_sided`.

**Shape language.** A pine tier = a vertical side-view card (the drooping
silhouette) + a near-horizontal plan-view card on one trunk anchor, jittered
in spacing/length/droop/yaw; `dense` adds darker filler boughs between them.
Root giants carry domed cloud pads (spokes, a rising cap, a hanging rim, a
belly) on limbs, over a lobed trunk whose buttress ridges run into flattened
roots tapered to a point underground. Blossom trees put blossom cells on the
up-facing clump cards and leaves on the flanks and belly. Card normals come
from the canopy's own volume; vertex colour runs cool/dark at the skirt to
warm/bright at the crown, with per-bough warm/cool tints.

**Edge fade.** `src/render/assets/foliage_edge_fade.ts` fades `Leaves_dg_*`
cards as they turn edge-on (screen-space face normal vs view), so a card never
reads as a bright sliver; the placed-asset sway chains it.

Budgets: trees < 2000 GPU triangles, undergrowth < 300 (both faces counted).
Gates: `tests/dg_tree_kit.test.ts`, `tests/dg_shrub_kit.test.ts`,
`tests/foliage_edge_fade.test.ts`.

## Ice (`bl_dg_ice.py`)

Eight faceted ice pieces for the fjord, three bergs, two floes, a glacier face
and two spires, 128 to 900 triangles each:

```
/Applications/Blender.app/Contents/MacOS/Blender -b --python \
    scripts/assets/deepglass/bl_dg_ice.py -- tmp/tidehold/work/ice [preview.png]
node scripts/assets/deepglass/finish_dg_ice.mjs tmp/tidehold/work/ice
```

Ice reads as ice through SHADING, not albedo: a cool blue body, a white crust
painted into the vertex colours on everything facing up, flat shading so each
facet catches its own light, and a hard specular. The surface is derived from
the repository's painted `Snow002` the same way the bark is. Bergs carry a keel
below the waterline and darken under it, so they float instead of sitting on the
water; their collision box starts at the waterline so a swimmer is not blocked
by the draft. Paste the `DG_ICE_MAX_DIM` table the finish script prints into
`src/render/asset_scale.ts` whenever a piece changes size.

## Ring-city stair flights (baked stone steps + flagstone rails)

`dg_stair_flights.py` builds the nine Deepglass ring-city flights as GLBs:
`stair_flight_38` (38 steps, rise 14), `stair_flight_43` (43 steps, rise 16)
and `stair_flight_16` (the arena gate: 16 deep treads, narrow rails). Each is
the flight, both side rails with their end posts and a landing at the foot and
the head, at the citadel stairBlock frame (origin 0.5 under the foot plaza,
+z climbs), so a flight swaps in at the old placement's x, z, rotY and groundY.

Two texture sets are baked from real high-poly stone (Cycles, CPU):

- `stair_steps`: a course atlas (2048x1024, 7 rows). Each row is one riser and
  tread strip baked on a real staircase, so it carries its own block joints,
  the AO in them, the shadow under the nosing and at the back of the tread.
  Rows are periodic over the 16 yd width; every step picks a row, a shift and
  a mirror that keep its joints staggered against the step below.
- `stair_flag`: a seamless 7.5 yd tile of irregular flagstones for the rails,
  posts and landings.

Colour is the EMIT base with the AO, a worn edge highlight (from a shape
normal bake with the chisel bump off) and a soft sky light bake folded in.

```
# bake the two texture sets (~6 min), then build + preview the flights
STAGE=bake  /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/assets/deepglass/dg_stair_flights.py
STAGE=build /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/assets/deepglass/dg_stair_flights.py
# optimise, KTX2, manifests
node scripts/assets/build_assets.mjs scripts/assets/specs/deepglass_stairs.json
PATH="$HOME/.local/ktx-software/bin:$PATH" node scripts/assets/compress_glb_textures.mjs public/models/deepglass/stair_flight_*.glb
node scripts/build_media_manifest.mjs generate && node scripts/gen_asset_catalog.mjs
# swap a map's flights for the GLBs and (re)write their rail and landing collision
node scripts/assets/deepglass/stair_trim.mjs <in.map.json> <out.map.json>
```

The flights are placed `collide: false`; walking uses the map's own colliders
(the sloped plane under each flight, plus the rail boxes and landing planes
`stair_trim_core.mjs` writes). `asset_collision.generated.ts` carries an
explicit empty entry for each flight. Do not re-run the whole
`bake_collision.mjs` to produce it: on this tree it also drops the Tidehold
buildings' boxes and its auto ramp misreads a flight. `asset_scale.ts` keeps
scale 1 as built and seats the kit by its origin (`authoredGroundLine`),
because the rails dive 4 yd under the nosing into the terrace.
