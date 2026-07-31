# Eastbrook Grand Armoury

The Eastbrook Grand Armoury is an embedded-texture-free procedural Three.js landmark that
replaced the old southeast inn lot. It originally inherited that lot's rested-XP role as a
closed garrison. The complete Eastbrook rebuild preserves the landmark geometry and shipping
GLB, classifies it as a non-rest `house`, and moves the rested-XP contract to the new
purpose-built inn while retaining the Armoury's civic silhouette, original blue-and-gold
identity, and readable approach. At runtime it shares the town's one external surface atlas,
so embedded-texture-free does not mean visually untextured.

## Site and scale

The old inn at `(12, -6)` was the best replacement candidate because its southeast edge
location has room to grow east without covering the square, banker, chapel, quest anchors,
or town paths. Moving the landmark center to `(17.5, -5.5)` leaves the west-facing entrance
on the old town-facing edge. The nearby Card Master remains outside collision and the
toolworks stays reachable; only one conflicting toolworks crate moves within its existing
cluster.

| Contract | Value |
|---|---:|
| World lot | 13 by 9 yards, rotation `-PI / 2` |
| Native model bounds | 13 by 16.35 by 9 units |
| Runtime scale | 1 model unit per world yard |
| Integral foundation | 1.35 yards below the entrance grade |
| Terrain adaptation | 0.5-yard deterministic footprint envelope plus a runtime stone skirt when needed |
| Above-grade roofline | 15 yards |
| Footprint | 117 square yards |
| Typical Eastbrook-house comparison | 3.25 times the average of the two house lots |
| Humanoid comparison | 5.77 times the 2.6-yard humanoid render height above grade |

The full rectangular collider deliberately keeps the recessed doors decorative: the
building does not promise an explorable interior. The broad stairs, landing, lamps,
noticeboard, and equipment rack are all modeled at normal player scale.

Placement is entrance-seated rather than center-seated. On the shipping seed the integral
foundation reaches the sampled lot minimum and the adaptive skirt is absent, so it adds no
geometry or draw. Supported alternate seeds and localized custom-terrain edits retain the
same entrance grade while a solid skirt extends to the deterministic footprint minimum;
seed `4717`, for example, requires a `0.9766606569`-yard extension. Camera collision derives
its roof height from the same terrain envelope. Online admission uses layout epoch `3` and
the strict `auth-world-3` discriminator so clients and servers with different footprint data
fail before credentials or world admission.

## Visual and production contract

The user-provided reference is a complete town scene, not an isolatable single-object
turntable. The img2threejs admission check therefore rejected exact reconstruction. It was
used only to establish feature hierarchy: multi-level stone and timber massing, deep-blue
pitched roofs, varied towers and dormers, ceremonial stairs, warm windows, arcane lamps,
and civic approach props. The result uses an original Eastbrook crest and omits source
logos, pseudo-text, and unsupported interaction cues. The reference and comparison sheets
remain under `tmp/` and are not redistributed.

The accepted budget was chosen against shipped Eastbrook buildings. The old inn costs
7,756 triangles and seven color plus seven shadow draws; the composed chapel costs 14,823
triangles and fifteen color plus fifteen shadow draws. The final armoury costs 8,226
triangles across six merged material primitives, with only its four non-emissive primitives
casting shadows. Its 137,012-byte compressed GLB is below the pinned 160 KiB ceiling. No
LOD is justified at this topology and submission cost.

The six embedded-texture-free vertex-color families are masonry, Eastbrook blue, timber,
metal and gold trim, warm emissive windows and lanterns, and cyan emissive crystals. The
shipping GLB contains no textures, animation, skins, or punctual lights. Runtime conversion
synthesizes semantic UVs on cloned loader-owned geometry and binds the same one external
`512 x 512` high-key grayscale atlas used by the new town kit and banker chest. `COLOR_0`
remains the palette authority, while the atlas adds mid-frequency stone, timber, metal, roof,
and painted-surface detail without another GLB material or draw. The shared graphics-tier
material seam applies it to both the Standard path and the Lambert-compatible Low and
native-iOS path without per-frame model work or dynamic point lights.

| Shipping contract | Result |
|---|---:|
| Serialized size | 137,012 bytes |
| Raw authoring GLB | 894,960 bytes |
| Triangles | 8,226 |
| Primitives / materials | 6 / 6 |
| Embedded textures / animations / skins | 0 / 0 / 0 |
| Low color pass | 6 draws, 8,226 triangles |
| Ultra color + shadow passes | 10 draws, 15,844 triangles |
| Embedded texture GPU memory | 0 bytes |
| Shared runtime atlas | One town-wide `512 x 512` lossless WebP, 141,666 transfer bytes |
| Compression | `EXT_meshopt_compression` plus `KHR_mesh_quantization` |

The optimized artifact SHA-256 is
`c696bcd12c19ed1b697491f474a685435a4f2439daf81cf45f8f6d8a817373af`; its deterministic
source fingerprint is
`1fe95569e0592f850c9fd77c30900e7c93fb42738694f557f3d28aae73f48134`.
The shared runtime atlas SHA-256 is
`d66f2fab603aa83e6c73c6fc4bdde2d545a6d8c1a0d4a58d42a3fb227e5a3f9b`. Its source image,
derivation, comparison evidence, and separate asset rights are recorded in
`docs/design/eastbrook-vale-rebuild/imagegen-provenance.md` and `CREDITS.md`.

## Rebuild and validate

Run the deterministic authoring export and project optimizer from the repository root:

```sh
node scripts/assets/eastbrook_grand_armoury/export_eastbrook_grand_armoury.mjs --stage final
node scripts/assets/eastbrook_town/build_surface_atlas.mjs --check
node scripts/build_media_manifest.mjs generate
```

Inspect both serialized stages rather than trusting only the procedural preview:

```sh
npx gltf-transform inspect tmp/asset_src/eastbrook_grand_armoury/eastbrook_grand_armoury-final.glb
npx gltf-transform validate tmp/asset_src/eastbrook_grand_armoury/eastbrook_grand_armoury-final.glb
node scripts/asset_pipeline/pipeline.mjs preview \
  --file tmp/asset_src/eastbrook_grand_armoury/eastbrook_grand_armoury-final.glb \
  --out tmp/eastbrook_grand_armoury_preview/final/raw

npx gltf-transform inspect public/models/props/eastbrook_grand_armoury.glb
npx gltf-transform validate public/models/props/eastbrook_grand_armoury.glb
node scripts/asset_pipeline/pipeline.mjs preview \
  --file public/models/props/eastbrook_grand_armoury.glb \
  --out tmp/eastbrook_grand_armoury_preview/final/shipped
```

`tests/render_glb_replacement_assets.test.ts` parses the optimized artifact and pins its
real bounds, topology, material and texture policy, compression extensions, and source
fingerprint. The fingerprint hashes the model factory, browser export entry, exporter,
optimizer spec, fingerprint helper, build orchestrator, and locked optimizer dependency
graph in a stable order. Before committing a regeneration, stage the accepted GLB and
manifest, rebuild, regenerate the manifest, and require no unstaged difference in either
file. `tests/eastbrook_surface_atlas.test.ts` and
`tests/eastbrook_surface_atlas_preload.test.ts` pin the shared resource, semantic UV
containment, single-texture reuse, both graphics material paths, and preload coverage.

## Matched in-game evidence

Run the exact release base and feature worktrees on separate ports, then use the committed
helper. It fixes seed `20061`, character, player location, editor camera, viewport, graphics
settings, and disabled governor for both sides.
The player anchor `(8, 2)` sits on the town plateau outside both the old inn rest footprint
and the replacement garrison halo, preventing a release-only rested-XP toast from skewing
the matched UI state.

```sh
# Exact release/v0.30.0 worktree.
npm run dev -- --port 5183

# feature/banker-chest-glb worktree.
npm run dev -- --port 5184

GAME_URL=http://127.0.0.1:5183 SHOT_PREFIX=before EXPECT_ARMOURY=0 \
  node scripts/assets/eastbrook_grand_armoury/capture_ingame.mjs
GAME_URL=http://127.0.0.1:5184 SHOT_PREFIX=after EXPECT_ARMOURY=1 \
  node scripts/assets/eastbrook_grand_armoury/capture_ingame.mjs
```

The helper captures matched wide, close, and side-rear views in desktop Ultra and mobile
Low. Its optional `MEASURE_PERF=1` mode records actual-game visible/hidden blocks, isolates
the six color submissions from the four configured shadow submissions with paired immediate
engine renders, and labels longer CPU/rAF samples separately from GPU timing. It also proves
that the base side contains the exact old inn record while the feature side contains the
exact replacement lot. Browser GL vendor and renderer strings are included in the JSON so
software-renderer measurements cannot be mistaken for native-GPU results.

The original accepted Armoury run used native ANGLE Metal on an Apple M4 Max. Exact paired
attribution was six calls / 8,226 triangles without shadows and ten calls / 15,844 triangles
with shadows; the four-call shadow pass contains 7,618 triangles. Those measurements predate
the shared surface atlas and remain the geometry and draw baseline, which the atlas does not
change. The preserved GLB itself still creates no embedded texture allocation. The completed
town runtime loads one scene-level atlas for the town kit, Armoury, and banker chest, so its
decoded memory is reported once at town scope rather than attributed three times. The full
loaded feature scene in that original run reported ten more geometry resources than the
release-base scene (`291` versus `281`), which includes GLB runtime support objects rather than
draw submissions.

The matched full-scene Ultra samples recorded release-base p95 frame intervals of `16.5 ms`
with shadows and `16.0 ms` without, versus `17.3 ms` and `16.5 ms` with the armoury visible.
Median CPU submit was `5.30 / 3.30 ms` on the base and `5.40 / 3.30 ms` on the feature.
Within the feature run, hiding the landmark measured `5.85 / 3.25 ms`, so the short timing
sample shows no consistent positive landmark cost beyond the exact submission delta; one
visible block also contained a `148.1 ms` unrelated long task. These are uncapped rAF and
CPU-submit observations, not GPU timing.

Accepted screenshots and measured performance are stored under
`docs/screenshots/eastbrook-grand-armoury/`. The source reference and any comparison image
that embeds it must remain under `tmp/`.

- `before-*` and `after-*` are the twelve matched desktop-Ultra/mobile-Low wide, close, and
  side-rear screenshots.
- `asset-previews/shipped/` contains the optimized shipping-GLB turntable. The staged
  procedural and raw-GLB review sheets were inspected during authoring and pruned after
  acceptance; regenerate them on demand with the exporter's preview mode.
- `before-performance.json` and `after-performance.json` contain the full matched settings,
  lot identity, renderer, resources, exact paired attribution, and timing samples.
