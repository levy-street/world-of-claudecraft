# From a reference image to a performant game GLB

This is the living runbook for turning object references into stylized, game-ready
Three.js GLBs for World of ClaudeCraft. It was written during the banker chest trial and
then proven at scale by the Eastbrook Grand Armoury, the nine-building Eastbrook town kit,
the Ravenpost mailbox, and the noticeboard. The single-asset chapters below keep the
banker chest as the worked example; the wave-scale lessons live in "Scaling to an asset
wave" near the end.

The condensed operating procedure is the repo skill `.claude/skills/image-to-glb/SKILL.md`
(Codex mirror: `.agents/skills/woc-image-to-glb/SKILL.md`). Any agent session should read
that skill, this document, the root `CLAUDE.md`, and the local instructions for each
changed area, plus the
[`img2threejs` version 1.3.0 source](https://github.com/hoainho/img2threejs/tree/7b1c62ccf34957ac5d68b7863718af9eab777c7e)
when the skill is installed (Claude Code: `~/.claude/skills/img2threejs`; Codex:
`~/.codex/skills/img2threejs`).
The skill is an authoring aid, not a repository build dependency. The committed model
factory, exporter, tests, and optimized GLB remain the reproducible source of truth.
Every trial so far used skill version 1.3.0. Re-check the installed skill instructions
before repeating the workflow with another version because its gates can evolve.

## What the workflow produced

The banker chest started from one three-quarter concept image. The finished asset keeps
the reference's arched strongbox silhouette, dark timber, heavy metal bands, paired locks,
gears, and restrained cyan and violet arcane accents. It intentionally omits loose coins,
the floating interface tablet, and unreadable pseudo-text. Those details would add visual
noise, geometry, and expectations of interaction without improving the in-game landmark.

The result is a decorative companion to banker NPCs. It does not replace bank behavior,
join the click-target list, change nameplate height, or add a collider. That boundary made
the first trial low risk while still testing the complete art-to-runtime pipeline.

```text
reference image
  -> admission, provenance, and detail inventory
  -> semantic sculpt specification
  -> procedural Three.js factory
  -> raw binary glTF export and multi-angle previews
  -> project asset optimization
  -> structural and visual validation
  -> renderer integration across graphics tiers
  -> desktop and mobile in-game proof
```

## 1. Admit and understand the reference

Do not begin by generating geometry. First decide whether the input can support the
requested result.

1. Confirm the image is an object reference rather than a full scene, and identify the
   visible view, perspective distortion, occlusion, background contamination, and missing
   sides.
2. Record provenance. Do not commit the reference unless its license permits
   redistribution. A user-provided image is permission to perform the requested trial,
   but it is not proof that the user owns third-party art. Confirm derivative-use rights
   before release and add the shipped asset to `CREDITS.md`.
3. Keep the redistributable reference and transient intake artifacts under `tmp/`. Probe
   dimensions and color, and split the image into inspection zones rather than repeatedly
   judging the whole image from memory. When durable traceability is required, put the
   source hash, source description, rights confirmation, and confirmation date in a safe
   committed metadata or credits record without redistributing restricted source art.
4. Write a detail inventory with three priority levels:

   - Identity-critical: silhouette, proportions, main material families, focal hardware,
     and the color accents that make the object recognizable.
   - Supporting: secondary bands, rivets, plank rhythm, handles, bevel cues, and wear
     variation that survives at gameplay distance.
   - Omit or simplify: tiny lettering, particles, loose clutter, background elements, and
     details that imply unsupported behavior.

For the chest, the `img2threejs` intake and sculpt-spec stages were useful because they
forced explicit evidence, component relationships, material intent, uncertainty, and a
definition of done before code generation. Keep those intermediate JSON reports and
comparison images in `tmp/`; they are working evidence, not shipping assets.

This trial kept its assessment, detail inventory, sculpt spec, strict validation reports,
comparison sheets, and multi-angle diagnostics under `tmp/banker_chest_img2threejs/`. The
important version 1.3.0 skill stages were `probe_image.py`,
`check_reference_admission.py`, `new_pre_spec_assessment.py`,
`build_detail_inventory.py`, `new_sculpt_spec.py`, and
`validate_sculpt_spec.py --strict-quality`, followed by `diagnose_render.py`,
`make_comparison_sheet.py`, and `diagnose_render_multi_angle.py` during visual review.
Run these from the installed skill root and follow that version's complete `SKILL.md` for
arguments, pass locking, and stop conditions.

## 2. Turn the visual inventory into a semantic model

A quality prop is not a pile of primitives. Build it as named visual systems that match
how a player reads the reference:

| System | Banker chest implementation |
|---|---|
| Primary mass | Rectangular body plus a segmented barrel lid |
| Surface rhythm | Individual front boards and lid slats with controlled walnut values |
| Structure | Base rails, corner posts, horizontal rails, and lid bands |
| Focal hardware | Two shield-shaped lock plates, keyholes, gears, and ring handles |
| Secondary detail | Rivets and small bronze ornaments placed only where they remain legible |
| Magic layer | Sparse cyan, violet, and amber inlays with restrained emissive response |

The durable authoring source is `scripts/assets/banker_chest/model.js`. It builds each
part in local space, bakes transforms into geometry, applies vertex color, and merges
geometry into four material buckets:

- `TimberBodyAndLid`
- `IronFrameAndGears`
- `BronzeBandsAndLocks`
- `ArcaneInlays`

This structure is deliberate. Four merged primitives preserve the material read while
avoiding a draw call for every plank, band, rivet, and rune. Vertex colors replace image
textures, so the object keeps authored color variation without UVs, texture downloads,
samplers, or texture memory. The arcane material provides the only emissive response, and
the GLB introduces no point lights.

Center the authored root on X and Z and seat its minimum Y at zero. Give meshes stable
names and calculate bounds. Set `castShadow` and `receiveShadow` for the authoring preview,
but remember that GLTFExporter does not serialize those Three.js runtime flags. The
runtime adapter must reapply them after loading. Avoid adding subdivision or bevel
segments unless a silhouette comparison shows that the extra triangles are visible at
the intended screen size.

## 3. Export and optimize reproducibly

The committed authoring and proof path has four components:

| Path | Responsibility |
|---|---|
| `scripts/assets/banker_chest/model.js` | Deterministic procedural geometry and materials |
| `scripts/assets/banker_chest/export_entry.js` | Browser-side GLTFExporter and preview scene |
| `scripts/assets/banker_chest/export_banker_chest.mjs` | Headless export orchestration and project-pipeline invocation |
| `scripts/assets/banker_chest/capture_ingame.mjs` | Matched desktop and mobile before/after evidence |

Run the complete export from the repository root:

```sh
node scripts/assets/banker_chest/export_banker_chest.mjs
```

The exporter bundles the browser entry with the repository's pinned npm dependencies,
runs it through Puppeteer and a locally discovered Chromium-family browser with software
WebGL, and writes the raw binary glTF under `tmp/asset_src/banker_chest/`. It also captures
front, side, three-quarter, and grazing authoring previews from the live procedural
factory under `tmp/banker_chest_preview/`. Those images do not prove that either serialized
GLB survived its round trip. Browser versions are not pinned, so compare outputs when
moving between machines. Set `BROWSER_PATH` to an absolute browser binary only when normal
discovery cannot find one.

Useful variants are:

```sh
# Rebuild the shipping GLB without recapturing previews.
node scripts/assets/banker_chest/export_banker_chest.mjs --no-preview

# Stop after the raw GLB for authoring inspection.
node scripts/assets/banker_chest/export_banker_chest.mjs --raw-only

# Write only the raw GLB, without previews or the shipping optimization step.
node scripts/assets/banker_chest/export_banker_chest.mjs --raw-only --no-preview

# Re-run only the shared optimization step from an existing raw GLB.
node scripts/assets/build_assets.mjs scripts/assets/specs/banker_chest.json

# Refresh the logical URL to content-hashed production URL mapping.
node scripts/build_media_manifest.mjs generate
```

Unless `--raw-only` is present, the exporter invokes `scripts/assets/build_assets.mjs`
with `scripts/assets/specs/banker_chest.json`. The shared static-asset path applies
animation resampling, pruning, deduplication, and high-level meshopt compression without
geometry simplification. It writes the shipping file to
`public/models/props/banker_chest.glb`.

The raw output stays ignored. Commit the procedural source, exporter, small pipeline spec,
and optimized GLB. Regenerate `src/render/assets/manifest.generated.ts` through the media
manifest build instead of editing it by hand.

The regular test gate does not regenerate this asset. Whenever the model factory, export
entry, exporter, or optimizer spec changes, first review and stage the exact expected GLB
and generated manifest as the comparison baseline. Then rebuild and require no unstaged
shipping binary or manifest diff before committing:

```sh
git add public/models/props/banker_chest.glb \
  src/render/assets/manifest.generated.ts
node scripts/assets/banker_chest/export_banker_chest.mjs --no-preview
node scripts/build_media_manifest.mjs generate
git diff --exit-code -- \
  public/models/props/banker_chest.glb \
  src/render/assets/manifest.generated.ts
git diff --cached -- \
  public/models/props/banker_chest.glb \
  src/render/assets/manifest.generated.ts
```

The final command is an explicit inspection of the staged generated changes. For the
banker chest this freshness check is operator-owned. The Eastbrook-era exporters closed
that gap: they stamp a sha256 source fingerprint over a pinned input list into the GLB
extras, and the contract tests recompute it live, so CI fails whenever any fingerprinted
input changes without a re-export (see "The source-fingerprint contract" below).

## 4. Reject plausible output that is not ship quality

The first generic code-generation scaffold from `img2threejs` was not good enough to
ship. It was useful as a blockout and as proof that the component specification was
machine-readable, but it did not reproduce the reference's proportions, hardware rhythm,
or visual hierarchy closely enough.

The correction was not a larger prompt. The correction was to keep the semantic intake
and replace the generic scaffold with a purpose-built procedural factory. That factory
could express the lid construction, exact band spacing, paired focal locks, and four
material families directly while staying small and deterministic.

Texture experiments were also rejected. At this prop's gameplay size, authored vertex
color produced a cleaner result than projected or generated wood maps, and it removed a
whole performance class from the asset. Treat every generated stage as a candidate, not
as an approval.

## 5. Validate the model from several angles

A single reference view makes it easy to build a convincing cardboard cutout. Review at
least these views before integration:

- The reference-matching three-quarter view for overall likeness.
- Front view for symmetry, lock hierarchy, and plank rhythm.
- Side view for actual depth and lid curvature.
- Low grazing view for floor seating, thickness, and silhouette discontinuities.

Compare the render beside the source, not from memory. Check silhouette, width-to-height
ratio, depth, focal-feature location, material separation, and emissive restraint. Cheap
image diagnostics can flag degenerate geometry and extreme silhouette drift, but visual
approval still requires inspecting the rendered images.

Inspect and render both the raw and shipping GLBs. The shared pipeline can change buffer
layout, quantization, extensions, and fallback data even when the authoring preview looks
identical. The `preview` command below loads the serialized artifact and renders multiple
angles, so it is the round-trip visual gate that the procedural preview is not.

```sh
npx gltf-transform inspect tmp/asset_src/banker_chest/banker_chest.glb
npx gltf-transform validate tmp/asset_src/banker_chest/banker_chest.glb
node scripts/asset_pipeline/pipeline.mjs preview \
  --file tmp/asset_src/banker_chest/banker_chest.glb \
  --out tmp/banker_chest_preview/raw

npx gltf-transform inspect public/models/props/banker_chest.glb
npx gltf-transform validate public/models/props/banker_chest.glb
node scripts/asset_pipeline/pipeline.mjs preview \
  --file public/models/props/banker_chest.glb \
  --out tmp/banker_chest_preview/shipped
node scripts/asset_pipeline/pipeline.mjs validate \
  --file public/models/props/banker_chest.glb --kind prop --height 1.3
```

The manual validator reports height and X/Z centering drift as warnings rather than hard
failures. For this workflow, inspect its output and reject either warning. The parsed GLB
test provides the durable hard gate for floor seating, centering, and the scaled runtime
footprint.

The banker chest's structural contract is pinned in
`tests/render_glb_replacement_assets.test.ts`:

| Property | Required contract |
|---|---|
| Shipping size | No more than 100 KiB |
| Geometry | Exactly 2,048 triangles across four primitives |
| Materials | Exactly four |
| Vertex payload | Every primitive retains `COLOR_0` |
| Textures | None |
| Animation | None |
| Skins | None |
| Bounds | Floor-seated, X/Z centered, and contained by the scaled collision-sampling footprint |
| Compression | `EXT_meshopt_compression` present, Draco absent |

These are acceptance pins, not universal limits for every prop. Choose a budget before
building each new asset, add a parsed GLB test, and update a pin only after consciously
reviewing the performance and visual tradeoff.

For the recorded trial, optimization reduced the raw 225,572-byte GLB to 43,956 bytes,
about 80.5 percent smaller. Treat that as historical evidence rather than a permanent
contract. Recalculate the current artifact with
`wc -c < public/models/props/banker_chest.glb`.

Structural budgets and screenshots do not replace a chest-specific frame-time or GPU
benchmark if a future world intends to instance this prop broadly.

## 6. Integrate through renderer seams

`src/render/banker_chest.ts` owns the complete runtime adapter. Keep model-specific logic
there and leave `src/render/renderer.ts` as a thin composition point.

The adapter follows these rules:

1. Register one unconditional preload for the stable public asset URL. Do not make the
   preload depend on graphics tier or active-world state.
2. Treat the loader cache as immutable. Prepare one template, clone only the transform
   graph for each banker, and share geometry and converted materials.
3. Normalize to the intended world height and re-seat the prepared template from its
   measured bounds. A simple procedural fallback supports non-browser and early
   construction paths, but a missing or invalid deployed GLB still fails the required
   preload gate instead of silently entering the game.
4. Convert imported PBR materials through `surfaceMat`. The current adapter forwards
   vertex color, base map, normal map, roughness map, AO map, scalar roughness and
   metalness, emissive color and intensity, side, and the source flat-shading flag on the
   Standard path. The Lambert path deliberately forces flat shading and cannot use PBR
   roughness, metalness, or their maps. Add conversion logic and assertions before using
   emissive maps, metalness maps, alpha maps, light maps, transparency, or other fields.
   Use `MeshStandardMaterial` whenever `GFX.standardMaterials` is true and the shared
   Lambert path whenever it is false. `tests/gfx.test.ts` pins the tier and native iOS
   memory-profile branches.
5. Classify bankers from the active `NpcDef` record rather than hard-coding only built-in
   banker IDs. Accept explicitly supplied custom-world definitions whose record keys can
   differ from their IDs.
6. Add the chest as a sibling of the character visual before click-target selection. Never
   put it in the click-target array or include it in the NPC's nameplate height.
7. Choose among authored lateral placements by sampling each chest footprint against the
   canonical world colliders. Select the first clear option or the least-blocked fallback,
   then seat the selected center using canonical terrain height. This avoids the inn
   overlap found by the first fixed-offset implementation and also supports custom terrain.
8. Collect accessory shadow casters separately and reuse the existing entity-distance
   shadow gate. A small decorative prop must not keep casting after the character rig has
   left the shadow range.

The chest intentionally has no collider. That is acceptable for this visual trial, but a
large permanent prop that players navigate around should receive an authored simulation
collider in a separate, cross-platform change.

This integration assumes a small number of banker landmarks. Each visible chest still
costs four color-pass primitives and up to four shadow primitives while inside shadow
range. A custom world that adds many bankers should measure frame time and consider
instancing, LOD, or stricter placement. If the model width or depth changes, update the
sampled footprint constants and tests. If every candidate footprint is obstructed, the
resolver can only choose the least-blocked placement, so some overlap can remain.

Derive each sampled half extent from the shipping GLB bounds after applying
`targetHeight / nativeHeight`, then add deliberate clearance. The parsed-GLB regression
must prove that the configured half width and half depth still contain the scaled X/Z
bounds. This prevents a regenerated model from silently outgrowing collision sampling.

## 7. Prove the result in the actual game

Standalone previews answer whether the model is coherent. They do not answer whether it
fits the game's camera, lighting, graphics tiers, nameplates, interaction target, terrain,
or mobile controls.

Run the client, enter the offline world, and inspect at least one shipped placement:

```sh
npm run dev
```

For reproducible before/after evidence, use separate worktrees at the release base and the
feature commit. Start each on a different port, then run the committed capture helper from
the feature worktree. It fixes the offline character, banker, graphics settings, viewport,
camera math, and settling time for both sides:

```sh
# Terminal in the release-base worktree.
npm run dev -- --port 5183

# Terminal in the feature worktree.
npm run dev -- --port 5184

# Commands run from the feature worktree after both clients are ready.
GAME_URL=http://127.0.0.1:5183 SHOT_PREFIX=before EXPECT_CHEST=0 \
  node scripts/assets/banker_chest/capture_ingame.mjs
GAME_URL=http://127.0.0.1:5184 SHOT_PREFIX=after EXPECT_CHEST=1 \
  node scripts/assets/banker_chest/capture_ingame.mjs
```

The helper captures desktop Ultra at 1600 by 900 and mobile Low at 844 by 390. It suppresses
the GPU notice and unrelated hostile nameplates only in the capture page, reports the
resolved banker, camera, chest state, and browser errors, and writes matched files under
`docs/screenshots/banker-chest/` (created on demand by the capture script; treat as
regenerable PR evidence, not permanent tree content). Stop both dev servers after inspection.

Use desktop Ultra and mobile Low as the two ends of the presentation contract. Confirm:

- The banker, nameplate, and controls stay clear.
- The chest is visible and floor-seated from a normal play camera.
- The low-tier material conversion retains vertex color and the main silhouette.
- Arcane accents remain decorative and do not encode gameplay information.
- Nearby buildings do not intersect the selected placement.
- The chest does not become the bank interaction target.
- Shadows stop at the normal entity shadow distance.
- Browser page errors are absent. Separate expected offline API failures from render errors.

The accepted banker chest evidence is regenerable, not kept in-tree after merge. Re-run the
capture commands above (desktop Ultra and mobile Low) when you need before/after shots for
review. The mobile view loses some fine rune definition, which is acceptable because the
chest's silhouette, lock, banding, and role remain clear and no gameplay information depends
on the fine detail.

## 8. Run the contribution gates

During iteration, keep feedback scoped:

```sh
npx vitest run tests/banker_chest.test.ts tests/gfx.test.ts \
  tests/render_glb_replacement_assets.test.ts \
  tests/render_asset_preload.test.ts tests/architecture.test.ts
npm run check:types
```

Before committing, run the complete gate and the aggregate asset report:

```sh
npm run gate
node scripts/asset_budget.mjs --json
```

The individual chest contract passes. The repository's aggregate asset budget was already
above its historical total and props caps before this asset, so the budget command remains
red. Report the exact asset delta separately rather than claiming the global budget passed
or attributing the pre-existing overage to the new model.

For this kind of render-only contribution, request frontend/render and test-coverage
review. Add release-malware review when executable authoring scripts or install behavior
change. Confirm that no simulation, persistence, network, or gameplay-fairness behavior
was introduced accidentally.

## Scaling to an asset wave: lessons from the Eastbrook rebuild

The full Eastbrook Vale rebuild (nine town buildings, the Grand Armoury, the Ravenpost
mailbox, and the noticeboard) turned the single-asset recipe above into a production
pipeline. These are the practices that made the wave fast and are the defaults for the
next one. The complete record lives in `docs/design/eastbrook-vale-rebuild/`.

### Author the wave as one contract table, not N exporters

`scripts/assets/eastbrook_town/` is the wave archetype: one declarative contract table
(`model.js`) maps each asset ID to a build function, dimensions, triangle and byte
ceilings, and sockets; one driver exports every asset, proves a deterministic double
build, and can verify staged bytes (`--verify-staged`). Shared authoring helpers
(`shared.js`: material buckets, architectural systems, a prop kit, and `normalizeBuckets`,
which stretches geometry to exact contract dimensions and remaps sockets through the same
transform) keep per-building modules small. Single props copy the smaller
mailbox/noticeboard archetype. Known debt: the exporter verification kit (fingerprinting,
inspection, contract assertion, optimizer spawn, preview capture) is still copy-pasted per
asset directory; extract it into a shared `scripts/assets/lib/` the next time an exporter
is added, and batch that refactor so every family re-exports exactly once.

### Textures: vertex color is the palette authority, one shared atlas adds grain

Generated references carry baked studio lighting, so their pixels cannot yield honest
albedo, roughness, normal, or AO maps. Do not embed low-confidence PBR extractions. The
shipped alternative that reads well at gameplay distance:

- semantic vertex-color zones carry the palette (timber, stone, roof, parchment, iron);
- exactly one shared 512x512 lossless-WebP grayscale atlas
  (`public/textures/eastbrook_surface_atlas.webp`, 16 named 128px cells) adds restrained
  mid-frequency grain at runtime, bound by `src/render/eastbrook_surface_atlas.ts`;
- roughness, metalness, and emissive stay runtime scalars per material family;
- GLBs embed zero textures, and the Low tier keeps the same value grouping through the
  Lambert path.

The atlas itself is derived deterministically from a full-color source sheet by
`scripts/assets/eastbrook_town/build_surface_atlas.mjs` (per-cell luminance, percentile
normalize, spec-pinned hashes in `scripts/assets/specs/eastbrook_town_surface_atlas.json`);
the full-color source is committed evidence and must never ship as the runtime map. If a
future asset genuinely needs a patterned finish, add a cell to the shared atlas (or a
sibling shared atlas) with the same derivation-and-pin treatment; per-asset embedded
textures remain the last resort and need a fresh performance case.

**The one asset that made that case: the Terrorspark Groundshaker mount.** It is a rideable hero mount the
player looks at from the chase camera for the whole session, so a shared grayscale grain
cell could not carry it: it needs an independent roughness and normal response per material
family, which vertex colors cannot express at all. It embeds six procedurally generated maps
(metal and fabric, each albedo + tangent normal + packed occlusion/roughness/metalness) built
by `scripts/assets/terrorspark_groundshaker/surface_maps.mjs`, plus a baked macro band in `COLOR_0`
(`surface_shading.mjs`: cavity occlusion against the neighbouring parts, ground contact and
grime, settled dust, thinned paint on up-facing bevels and seam darkening on the rest). Read
the shape of that solution before copying it:

- **World-space box projection, not UV islands.** UVs are projected per triangle from the
  dominant face-normal axis, so texel density is fixed in yards and one shared map set serves
  parts of wildly different size. There is no unwrap to maintain.
- **Fold the UVs, then restore the scale.** `quantize()` skips any texcoord outside [0, 1] and
  leaves it float32, which cost more than the rest of the geometry put together. Fold each
  projection group back by whole repeats (free: the maps tile with period 1), normalize into
  the unit range, and hand the discarded scale to `KHR_texture_transform`.
- **Resolution is per channel, not per material.** The albedo carries the scratch and chip
  detail and costs a few KiB; the relief fields are band-limited well below their own Nyquist
  frequency and ship at half resolution.
- **Author every channel from its own field.** Aliasing albedo into roughness or normal is on
  the object-sculpt spec's `mustAvoid` list, and it looks like it.
- **Give the dark families headroom.** The baked darkening bands need somewhere to go: at the
  original blockout values the treads and cannon crushed to flat black, so those palette
  entries were lifted at the same hue.

Cost: 275 KiB to 572 KiB, which sits alongside the other authored mounts (valorsteed 562 KiB,
gobbler 555 KiB) rather than above them, and mounts load lazily per visual key. A prop or a
building still has no case for this; do not read the Terrorspark Groundshaker as a general licence.

### Budgets that held up

Per-asset budgets plus a wave-wide ceiling (town: 30,000 triangles and 1.25 MiB across
nine GLBs) kept the rebuild net-negative on runtime triangles while adding detail. Working
reference points: service buildings 2,300 to 4,400 triangles at 2 primitives / 2
materials; small service props 1,200 to 1,700 triangles; one major landmark may spend
8,000+ triangles and 6 materials, but only one per zone. Merged material buckets (7
semantic buckets folded into 2 shipping materials for town assets) are why draw calls
stayed nearly flat. Measure the wave against the exact baseline tree with matched views
and warmed repeats, report CPU/rAF timing honestly, and never claim GPU time WebGL cannot
provide.

### The source-fingerprint contract

Every Eastbrook-era GLB carries a sha256 fingerprint over a pinned input list
(`scripts/assets/<asset>/source_fingerprint.mjs`): the factory, entry, exporter, spec,
`build_assets.mjs`, the reference turnarounds and shared atlas where applicable, and
`pnpm-lock.yaml`. Contract tests recompute it live and compare it to the stamped GLB. The town family's
polish integrity test instead pins the provenance recorded in capture evidence JSONs
against the frozen values the evidence itself carries (the evidence predates later
rebuilds and is never recaptured); the mailbox and noticeboard families still bind to
live values. Consequences:

- Changing ANY fingerprinted input, including a lockfile-only dependency bump or a release
  merge that touches `pnpm-lock.yaml`, requires re-exporting the affected families
  (`--no-preview` keeps evidence untouched), regenerating the media manifest, and
  re-pinning the sha256 and fingerprint literals in tests, design-doc tables, and evidence
  JSONs in the same change.
- A fingerprint-only re-export must not change byte sizes; only hashes move. If a size
  moves, something else changed, so stop and diff before re-pinning.
- Keep committed evidence lean: full capture matrices are accepted visually, then pruned
  to contact sheets, capture metadata, and matched hero views once the wave settles. The
  integrity tests pin the retained inventories add-and-delete strict.

## Reusable checklist

- [ ] Confirm reference suitability and derivative-use rights.
- [ ] Define identity-critical details and explicit omissions.
- [ ] Set file, triangle, primitive, material, texture, skin, and animation budgets.
- [ ] Keep generated intake and comparisons under `tmp/`.
- [ ] Build named semantic systems, not undifferentiated primitive clutter.
- [ ] Merge by material and prefer vertex color when textures do not add visible value.
- [ ] Center and floor-seat the authored root, then pin shipping bounds against runtime scale.
- [ ] Export raw GLB, then run the shared asset optimizer.
- [ ] Inspect front, side, three-quarter, and grazing views.
- [ ] Parse the shipping GLB in a regression test and pin its real contract.
- [ ] Integrate behind a small render module with shared resources and a fallback.
- [ ] Respect click targets, terrain, collision footprints, graphics tiers, and shadow gates.
- [ ] Capture desktop and mobile in-game evidence.
- [ ] Run focused tests, typecheck, the full gate, and the aggregate asset report.
- [ ] Record provenance in `CREDITS.md`.
- [ ] Stamp a source fingerprint and pin it (plus the shipped sha256) in the contract test.
- [ ] After any fingerprinted-input change, re-export, regen the manifest, and re-pin.
- [ ] Prune capture evidence to contacts, metadata, and hero views once the wave settles.

## Where this approach fits

This workflow is a strong fit for stylized static landmarks, furniture, shrines, stalls,
chests, doors, tools, and environmental storytelling props. It is less direct for organic
characters, deforming objects, or animation-heavy content. Those need topology review,
rigging, animation clips, retargeting, and usually a different performance contract.

The central lesson is simple: use image-to-code tooling to make observation and iteration
more rigorous, not to remove human judgment. High quality came from preserving the
reference's visual hierarchy, rejecting weak generated output, authoring the important
forms directly, and measuring the exact artifact that the game ships.
