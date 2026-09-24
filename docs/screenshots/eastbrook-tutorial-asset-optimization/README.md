# Eastbrook and Tutorial Island asset optimization

Integration base: `release/v0.44.0`, commit
`0f5f1751214338a5e65399b30811ccc5b8921f5e`.
This includes the earlier scatter-prop optimization batch. All six original
assets below are unchanged from the initial integration and capture base,
`ef8c82526770020da29a4de9c56aebcfdce81d70`.

Six existing GLBs are replaced at their existing URLs. Their combined geometry
falls from 65,528 to 21,506 triangles (67.2%). Combined shipping size falls from
1,905,268 to 1,591,368 bytes (16.5%). These are asset totals, not a measured FPS
gain or a whole-scene triangle reduction.

| Asset under `public/models/` | Before triangles | After triangles | Reduction | Before bytes | After bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| `quest/supply_crate.glb` | 11,470 | 2,311 | 79.9% | 188,688 | 327,884 |
| `quest/weathered_ledger_page.glb` | 22,098 | 4,413 | 80.0% | 265,204 | 107,260 |
| `quest/gravecaller_sigil.glb` | 13,588 | 4,364 | 67.9% | 195,364 | 120,960 |
| `foliage/dead_1.glb` | 6,106 | 3,249 | 46.8% | 417,648 | 343,376 |
| `foliage/dead_2.glb` | 6,507 | 3,625 | 44.3% | 425,648 | 347,272 |
| `foliage/dead_3.glb` | 5,759 | 3,544 | 38.5% | 412,716 | 344,616 |

All embedded textures are 512 by 512 KTX2 with a complete 10-level mip chain.
Geometry uses the existing meshopt pipeline. All six remain single-primitive,
static meshes with their original world-space bounds and material identity.
Dead-tree vertex colors, UVs, bark material name and shared texture payloads
are preserved for the foliage renderer.

The crate has a new color bake and tangent-space normal map to retain relief on
its reduced mesh. That extra texture makes this individual GLB larger and adds
a texture sample on standard-material tiers. Low graphics uses Lambert shading
without the normal map. The ledger, sigil and three trees reuse the original
shipping KTX2 payloads byte-for-byte, avoiding another lossy texture encode.

## Runtime scope

The existing quest-object paths and foliage inventories already select these
files. No loader, simulation, quality setting, particle or character code changes
are required. Existing flowering shrubs, the earlier optimization batch and all
ten field-tree copies remain unchanged.

These are shared assets. Tutorial castaway crates use the supply-crate fallback;
other fallback quest objects can also use it. The ledger is reused by
`highwatch_summons`. Dead-tree variants are selected for marsh tree decorations,
so their savings depend on which decorations are visible and are not present at
every Eastbrook or Tutorial Island viewpoint.

## Authored sources and shipping process

The approved Blender 5.1.2 deliverable is named
`Decimate_Batch_2_Eastbrook_Tutorial_v044_Optimized_Pass_1`. Its
`Batch_2_Optimized.blend` SHA-256 is
`bbabbde64c22ea282eb8ff6f5f1fec155f958f5fd58710ff90f39c9c92fa59c6`.
It contains optimized meshes and original reference scenes. The original asset
lineage and credits are unchanged; the dead trees remain the existing Quaternius
assets. This is an optimization of the existing quest artwork, not new licensed
source artwork.

| Blender-exported input | SHA-256 before shipping compression |
| --- | --- |
| `supply_crate.glb` | `17b239e3dabf0628ee046f4897718f10e48aa3ef9daaa9076c62f013c3a7b8df` |
| `weathered_ledger_page.glb` | `28ce27a6dc44072a63479db476ceec718180c83afd917c794304d1e9d3ecf88b` |
| `gravecaller_sigil.glb` | `99abd0f26131136f4f24c5d5fce1275aa2b03ad072d3ee796dba4f6b0ada73c0` |
| `dead_1.glb` | `f278d8dfc37e33725c13f56030ed87469b159801e22d4323a7762d9fee2caf89` |
| `dead_2.glb` | `50de25aea0e22bf1efbb44b6a908dac7d6587cebb276e6568ed80e4b1fa06565` |
| `dead_3.glb` | `59f6909d23a38c40d928c373b13b888390ccc32191b28bf57c34f81f8f18e61f` |

1. Verify these input hashes. For the five unchanged texture sets, verify the
   input PNGs against the decoded release originals, then restore each original
   KTX2 payload to the corresponding base-color or normal texture slot and mark
   `KHR_texture_basisu` required. Keep the crate's new baked images.
2. Run `scripts/assets/build_assets.mjs` with a six-item specification: each item
   has `src` pointing to its prepared input, the corresponding `out` from the
   table above without `public/`, `type: "static"`, and `keepExtras: true`.
   Use `--output-root` for a staging directory. Omit `maxTex`: the source images
   are already 512px and do not need an intermediate WebP encode.
3. Run `scripts/assets/compress_glb_textures.mjs --jobs 2` with only the six staged
   file paths, using KTX Software 4.4.2. It converts the crate's new textures and
   skips the five files already containing KTX2. Retain meshopt compression.
4. Verify world bounds, primitive counts, attributes and the texture hashes.
   Copy the six outputs to their existing public paths and run
   `node scripts/build_media_manifest.mjs generate`.

The older foliage source specification does not contain these edited Blender
meshes. Rebuilding dead trees from that source would undo the reduction. Use the
pinned optimized masters for future edits; update the reviewed shipping hashes
in `tests/eastbrook_tutorial_optimized_assets.test.ts` only after visual review.

## Validation

The standalone authored exports passed glTF validation and six-angle comparisons
before shipping conversion. The shipping contract test pins exact bytes,
triangle counts, file-size ceilings, original bounds, texture payloads, mip
levels, compression extensions, vertex colors and generated manifest URLs.

The installed glTF validator reports zero errors on all six compressed files.
Its warnings are about unsupported KTX2/meshopt validation; decoded asset checks
and browser loading cover those extensions. Both newly encoded crate KTX2
images pass `ktx validate`.

### Before and after images

[All six Blender comparisons](blender-before-after.jpg)
show the authored meshes before shipping compression. The game captures below
use the actual quest-object loader, fixed camera poses and daytime lighting.
HUD elements are hidden for the captures. Both sides use the initial integration
base above; the later upstream scatter-prop batch is absent from both sides.

The four low/high before/after runtime checks passed on Chrome with the Apple M4
Pro Metal renderer. The optimized crate uses a normal map on high and Lambert
without normal mapping on low. All inspected object views were visible with
compilation settled. Independent visual review found no visible regression in
the crate or sigil. These captures establish appearance compatibility, not FPS
or first-use hitch improvements.

For baseline captures only, intercepting the six original asset responses left
terrain worker jobs pending. The diagnostic used the existing main-thread
terrain fallback in those temporary browser sessions. Both optimized low/high
runs booted through the normal terrain worker path. No production fallback or
loader code was changed. Both versions logged the same unrelated missing
walking-staff/training-dummy preload messages and offline API 502 responses;
no error referenced a replaced asset.

| In-game view | Before | After |
| --- | --- | --- |
| Tutorial crate, high | [Before](tutorial-crate-high-before.jpg) | [After](tutorial-crate-high-after.jpg) |
| Tutorial crate, low | [Before](tutorial-crate-low-before.jpg) | [After](tutorial-crate-low-after.jpg) |
| Eastbrook crate, high | [Before](eastbrook-crate-high-before.jpg) | [After](eastbrook-crate-high-after.jpg) |
| Eastbrook sigil, high | [Before](eastbrook-sigil-high-before.jpg) | [After](eastbrook-sigil-high-after.jpg) |
| Eastbrook ledger, high | [Before](eastbrook-ledger-high-before.jpg) | [After](eastbrook-ledger-high-after.jpg) |

### Check results

- Focused Vitest: 6 files passed, 81 tests passed, 2 existing tests skipped.
  Command: `npx vitest run tests/eastbrook_tutorial_optimized_assets.test.ts tests/glb_texture_compression.test.ts tests/render_glb_replacement_assets.test.ts tests/render_asset_preload.test.ts tests/foliage_field_bark_decimation.test.ts tests/foliage_preload_boot.test.ts`.
- `node scripts/build_media_manifest.mjs generate`: deterministic on repeat;
  exactly the six affected manifest entries change.
- Original character checkout: all 160 captured work files, HEAD, status and
  index hash unchanged. All 54 captured earlier external asset/source files
  unchanged.
- Independent frontend review: no actionable compatibility findings; confirmed
  original hierarchy, texture-slot assignments, material identity and finite
  unit-length normals/tangents after decoding.
- Final pre-PR gate on the current integration base:
  `GATE_SELECT_BASE=origin/release/v0.44.0 GATE_MAX_WORKERS=4 node scripts/gate_select.mjs`,
  with pinned pnpm 10.34.5 on PATH: **all 12 steps passed**. The selected Vitest
  run passed 1,437 files and 27,512 tests, with 28 files and 487 tests skipped.
  This includes regeneration/freshness, security, changed-file checks, browser
  regressions, typechecks and all builds.
- The initial `npm run gate` stopped at the manifest freshness comparison while
  this task's generated changes were unstaged. Its remaining canonical steps
  were run separately, unchanged. Staging the scoped PR files and running the
  complete selective gate above resolved that comparison without changing the
  generator or gate.
- `npm run security:gate` and `npm run ci:changed`: passed.
- `npm test -- --maxWorkers=4` (canonical gate pre-generation environment):
  passed, 4,399 files passed and 36 skipped; 65,100 tests passed, 2 expected
  failures and 552 skipped. This full run preceded the upstream scatter batch;
  the final selective gate above covers the updated integration base.
- Final `npm run test:browser`, inside the selective gate: **50 files and all
  419 tests passed**. An earlier full browser run had 49 files pass and one
  mail/Enter keyboard-focus test hit its 15-second timeout. Its isolated rerun,
  `npm run test:browser -- tests/browser/stale_focus_space.browser.test.ts`,
  passed all 11 tests in 1.04 seconds. No test or application code was changed
  to accommodate the timeout. The final complete browser rerun also passed.
- `./node_modules/.bin/turbo run check:types build:env build:server build:bot --ui=stream`:
  passed, including client TypeScript, admin Svelte and bot type checks.
- `./node_modules/.bin/turbo run build:bundle --ui=stream`: passed, including
  the client bundle, backdrop check and content-addressed media emission.
- `git diff --check`: passed.

Verdict: **READY** for review. The final selective gate is green on the updated
`.44` base. No FPS gain is claimed; physical mobile-device performance was not
measured.
