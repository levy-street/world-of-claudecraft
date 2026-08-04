# Far-foliage sprite impostors

The far field used to hand every tree to a deliberately illegible stand-in (a
cone for pines, a blob for oaks) that a fog-blend law had to keep buried in
murk. In the open realms that pushed the real-model radius out to roughly 500
units of full geometry and still left ghostly pyramids standing in the haze;
near-fill trees vanished outright at their density cap, rocks and bushes hard
popped at their numeric culls in clear air. This document describes the sprite
impostor system that replaced all of that, and the laws it runs on.

## What ships

At world build, `src/render/foliage_impostor.ts` bakes every foliage archetype
into one texture atlas by rendering the REAL extracted GLB parts offscreen
under a neutral hemisphere rig: each tree species variant from 12 yaw angles,
each rock colorway variant from 6, each bush kind from 8. The far field then
draws one InstancedMesh of camera-facing unit quads per (bucket, category).
Each instance:

- picks the two atlas views bracketing its camera bearing, offset by its own
  placement yaw (`instanceMatrix` carries it), and blends them, so orbiting
  the camera never snaps a silhouette;
- reconstructs its billboard offsets through the inverse of its instance
  rotation and scale, so the stock instancing chunks (projection, fog, world
  position) run unchanged;
- carries the exact placement, scale, height jitter and softened biome tint
  of its real twin, so the handoff moves nothing and recolors nothing;
- lights through the live standard-material pipeline over an up normal, the
  ground plane's response including the realm IBL irradiance, so day-night
  grades, realm light levels and fog land on the sprite exactly as they
  land on the terrain under it (verified in the Nightbloom's dimmed violet
  grade);
- sways with the same travelling gust, phase and amplitude the real
  canopies ride (the sway direction is world-fixed where the real mesh sways
  in its rotated model frame: sub-pixel at every sprite distance).

The atlas layout is pure math (`src/render/foliage_impostor_core.ts`,
registered in `RENDER_PURE_CORES`): a deterministic shelf packer that throws
when a grown kit cannot fit `IMPOSTOR_ATLAS_MAX`, pinned by
`tests/foliage_impostor_core.test.ts`.

## The handoff

Both sides of every swap evaluate the same per-instance hash
(`IMPOSTOR_JITTER_GLSL`, one source of truth in the pure core): the real
geometry collapses each instance at `swap - fade * jitter`
(`src/render/foliage_collapse.ts`) and the sprite begins it at the same
distance. The boundary is therefore never a front that sweeps the forest;
each tree trades representations alone, in one frame, between two pictures
sized and tinted to match. Bucket-level tests stay the coarse pre-filter
(`bucketVisible` in `src/render/foliage_lod.ts`, sprite rows keyed on their
category swap and dying at the LIVE fog wall rather than the model-quality
trimmed cull).

## Swap laws

Sprites are legible in clear air, so the sprite arm's real-model radius
follows the BUDGET again (`spriteSwapDistance` in the pure core):

- open realms: the budgeted radius itself (about 300u rested, 216u starved),
  where the old blend law forced ~506u of full geometry;
- a clear-air floor (`SPRITE_SWAP_MIN`) keeps a flat picture from standing
  closer than 150u in clear air, yielding to the 50 percent blend line in the
  murk realms, where parallax flatness is already mush;
- short-fog realms keep a guaranteed sprite band before the cull
  (`IMPOSTOR_MIN_BAND`, scaled down with a tight cull);
- a residency fog wall parks the handoff ON the wall: real trees to the
  wall, no sprites in the camera's lap while a zone streams in.

Near-fill trees need no law of their own: the swap never exceeds
`base * distanceScale`, which sits under the near-fill numeric cap at every
quality, so every near-fill instance hands off to its sprite before its
bucket cap can matter, and the sprite carries its density to the fog wall
(the old build-time vanish at `treeFillFar` was a visible density pop).

Rocks and bushes take the same treatment at their own swaps (`rockFar` and
`dressFar` times the budget scale, clamped to the foliage cull; enforced per
instance, with the bucket rows culled radius-aware against the same swap so
a slab crossing its cap no longer drops its still-near members).
Ferns and mushrooms are sub-pixel long before their cull and keep the plain
window. The sprite arm is decided by `farFieldPolicy` (far_terrain_core):
no standard materials, `GFX.leanFoliage`, or a constrained memory ceiling
ships NO impostors, exactly as the cone era's lean arm did, and keeps the
old fog-blend law (`treeDetailDistance`), whose pins remain in
`tests/foliage_lod.test.ts`.

## Cost model

A sprite is 2 triangles, and every category in a bucket is one draw call,
against the old per-species cone meshes (28 to 80 triangles per instance, up
to 8 draws per bucket, half of them registered on windows that could never
open). Above all, the budget no longer draws real geometry between the swap
and the fog wall. Measured at the fixed probe spots
(`docs/screenshots/far-foliage-impostors/`, high tier, offline seed):

- cliff vista: foliage draws 302 to 162; the old impostors cost 138 draws
  and 52k triangles, the sprites 56 draws and 7.9k;
- submitted foliage triangles fall 0.5M to 1.2M per scene (garden north:
  2.94M to 1.74M), with the vertex shader additionally collapsing every
  instance past its swap before raster;
- the atlas bakes once per world build (a few hundred cell renders during
  the loading screen) into ONE mip-mapped 2048px texture, an enforced
  budget: `packImpostorAtlas(shippedImpostorInventory())` is pinned to
  exactly 2048 (a ~21 MiB resident chain where 4096 would hold 85 MiB),
  `registerArchetype` throws past its category's row budget, and every
  view renders through a small reusable cell-sized MSAA scratch target, so
  peak transient GPU memory is the final chain plus under a MiB (never a
  full-size multisampled color/depth pair). Constrained-memory profiles do
  not bake at all (`farFieldPolicy`).

## The fog-free vista (second stage)

The outdoor fog is REMOVED on the vista tiers (medium and up, memory
permitting): the whole world renders from anywhere, and scene fog is
repurposed as the horizon-only haze band (`horizonHazePlan`, third stage
below) that occludes nothing a player interacts with while its color keeps
feeding the sky tint. What makes that affordable:

- a whole-world far-terrain layer (`src/render/far_terrain.ts` +
  `far_terrain_core.ts`, ported from the shelved far-render branch): about
  a dozen static standard-material vertex-color tiles (IBL-lit like the
  near terrain), built once across idle slots from the same heightfield
  and the shared `terrain_palette.ts`, with crest-preserving sampling
  (`farVertexHeight`, a half-cell max) so ridge silhouettes stay truthful
  and trees behind a crest stay hidden. The vista arms hold the CLASSIC
  fogged renderer until every planned tile is attached
  (`Renderer.vistaLive`): an unbuilt direction past the detail horizon
  would otherwise read as void, and Safari's timer-paced idle fallback can
  take seconds per tile;
- the sprites run to the whole-world envelope, merged into ONE
  InstancedMesh per category (4 draws with the buildings, ~6k quads
  world-wide): per-instance windows do the culling, and past the detail
  envelope each sprite eases down by its precomputed shortfall against the
  far-mesh surface (plus a small settle) so bases stay planted on the
  coarse ground;
- every detail subsystem culls at `FOGLESS_DETAIL_FAR` (700, exactly the
  widest cull the fogged clear realms ever ran, residency-eased as
  before), so no subsystem draws farther than it ever did; the camera far
  plane and the water apron grow with the tier plan.

One capability decision drives all of it: `farFieldPolicy` in
`far_terrain_core.ts` (sprites require standard materials, the full
foliage kit and an unconstrained memory ceiling; the vista requires
sprites), consumed by the session, the renderer, the water apron and the
shortfall sampler alike. The lean arm (low tier, weak-iGPU medium) and
every constrained-memory profile keep classic fog byte-for-byte with no
vista and no atlas. Interior and rift fogs are untouched everywhere
(enclosed-space mood, no draw distance behind them). The murk realms lose
their fog walls by design here: realm mood now lives in light grades and
sky alone.

Measured (fixed probe spots, high tier, draw calls and submitted
triangles from `renderer.info`; the timed record with real rAF
frame-interval percentiles, raw samples, GPU/browser/SHA provenance is
`docs/screenshots/far-foliage-impostors/stats-review-round.json`, an
Apple M4 Pro under headless Chromium at 1600x900: frame p50 spans 8.3 to
11.9 ms across the 11 vantages, worst p95 16.8 ms): the light coastal
vantages sit within a few percent of the fogged game; the densest
mid-strip vantage (the old marsh wall at 165u) draws the whole strip at
about 660 calls and 5.7M submitted triangles at 11.7 ms p50. The far
layer itself costs about 12 tile draws plus 4 sprite draws and ~12k
sprite triangles for the entire world. The earlier stats-*.json records
carry draw/triangle data only (their frame-time fields were never validly
captured and are removed).

## The aesthetic pass (third stage)

With the whole world visible, two more facades plus a closing atmosphere
pass finish the picture, all on the vista arm and all measured at perf
parity or better:

- Mountains: the far tiles light as MeshStandardMaterial now (the Lambert
  layer missed the realm IBL irradiance the near terrain gets, crushing
  shaded faces to black), high ground takes build-time crag relief and
  crevice/warm strata inside `farVertexHeight`/`farGroundColor`, the
  fog-era near-solid rim wash became a light altitude-gated aerial tint,
  and the margin band beyond the world rim settles to open seabed (raw
  procedural noise out there read as random cone hills once the fog
  stopped hiding it).
- Buildings: village houses, inns, bell towers and skyline decor (windmills,
  moored ships) bake into the atlas as a fourth sprite category
  (`collectBuildingImpostors` in props.ts computes placements with the SAME
  pools and scale rules the real placement loop uses), so civilization
  shows past the detail horizon at one extra draw call.
- Horizon haze (`horizonHazePlan` in `far_terrain_core.ts`): with the fog
  gone the sea met the sky as a razor line. The vista arm now eases the
  scene fog to a band anchored on the vista envelope (near at 0.62x, far
  at 1.6x), so gameplay range and the detail horizon stay crystal clear,
  the last stretch of far tiles picks up a light aerial wash, and open
  water dissolves into the sky instead of cutting against it. The fog
  color keeps feeding the sky-dome horizon band, so the haze tint always
  matches the sky it melts into.

One facade was built here and then removed by design decision: an ambient
life layer (deterministic bird flocks and campfire smoke columns, two
GPU-animated draws). The vista reads better without the extra motion, so
it was cut after playtesting. The fairness rationale that shaped it still
governs this whole feature: online snapshots carry no distant entities and
the fairness invariant forbids tier-gated actionable information, so any
distant "life" can only ever be cosmetic, never real mobs or characters.

## Known tradeoffs

- One sprite covers bark and canopy, so the whole picture takes the dominant
  tint family (`SpeciesSpec.spriteTint`: leaf, or trunk for the bare dead
  trees), the same rule the cones used.
- Rock sprites fold the placement tilt into the baked views; at the rock
  swap range a boulder is a handful of pixels and the approximation does not
  read.
- Sprites neither cast nor receive shadows; the shadow pass keeps its
  build-time radius, inside every sprite band.
- Fog-free extras: zone features and props still cull at the detail horizon
  (a building pops at 700u, about 15px, exactly where the old clear-realm
  fog swallowed it); the sun and moon sprites draw depth-free and can burn
  through the far ridge line near the horizon; the far mesh drops sub-cell
  features (roads, hub discs), so distant ground reads as pure biome color.
