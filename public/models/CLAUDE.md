# public/models/ (all GLB categories)

Shared rules for every model category under this directory. Two subdirectories keep a
local CLAUDE.md on top of this file: `props/` (dense per-consumer wiring contracts) and
`chars/` (rig-specific rules).

## Compression truth (applies to every committed GLB)

- **Geometry: always meshopt, never Draco.** The runtime loader
  (`src/render/assets/loader.ts`) wires only a `MeshoptDecoder`, no `DRACOLoader`. A
  Draco-compressed GLB parses fine in offline tools but silently fails
  `GLTFLoader.load()` in the browser (`asset load failed: ... (missing file or bad
  GLB)`) and the renderer falls back to the old procedural geometry with no visible
  error to the player. `npx gltf-transform inspect <file>.glb` must show
  `EXT_meshopt_compression`, not `KHR_draco_mesh_compression`.
- **Textures: every embedded texture must be KTX2/Basis (`KHR_texture_basisu`).** The
  loader attaches a KTX2 transcoder and `tests/glb_texture_compression.test.ts` walks
  ALL of `public/models` and fails on any other embedded format (WebP decode
  amplification was the bulk of the WKWebView footprint that got the native iOS client
  jetsam-killed at world entry). The mandatory final step after ANY exporter or
  optimize run is:

  ```
  node scripts/assets/compress_glb_textures.mjs && node scripts/build_media_manifest.mjs generate
  ```

  It needs the `ktx` tool (KhronosGroup/KTX-Software 4.3+) on PATH, re-applies meshopt
  where the source used it, and aborts a file if skins/animations/meshes do not
  survive the transform. The one sanctioned exception is the `WEAPON_VFX` skin set
  (see the weapons row below).
- **Never simplify a skinned rig.** `scripts/assets/build_assets.mjs` treats the
  `character` type as geometry-safe for exactly this reason (simplify corrupts skin
  weights); see `public/models/chars/CLAUDE.md`.

New assets come from the sanctioned pipelines, not ad-hoc `gltf-transform` runs:
`scripts/assets/build_assets.mjs` driven by `scripts/assets/specs/*.json` (see
`scripts/assets/CLAUDE.md`), the `asset-pipeline` skill
(`scripts/asset_pipeline/pipeline.mjs`, Tripo generation plus auto-wiring and guard
tests), and the `image-to-glb` skill (`docs/image-to-glb-asset-workflow.md`:
deterministic exporters with source-fingerprint pins). New animation clips on shipped
rigs come from the `blender-anim-pipeline` skill.

## Manifest and preload rules

- Any file dropped anywhere under `models/` is picked up automatically by
  `node scripts/build_media_manifest.mjs generate` (runs inside `npm run build`);
  **never hand-edit** `src/render/assets/manifest.generated.ts`.
- **Every preload set must be tier-INDEPENDENT** (a superset of every graphics tier's
  placement). `tests/render_asset_preload.test.ts` guards the v0.16.0 "Could not start
  the renderer" bug class, where a tier-scoped preload omitted an asset the live tier
  then placed.
- `tests/render_glb_replacement_assets.test.ts` asserts every registered preload URL
  resolves to a real, manifested file; a new GLB-replacement asset joins it.

## Size guidance (qualitative; never trust a stale byte figure)

Skinned character rigs are by far the largest per-file budget; densely instanced kit
pieces (dungeon, biome) are the smallest. Do not compress a rig down to prop-tier
sizes, and iterate texture size down before accepting an oversized static prop.

## Naming

`snake_case`, named after the object; `resources/` world-node markers carry the
`gather_` prefix; `chars/` matches whichever casing the adjacent kit already uses.

## Category wiring (one row per category)

- **creatures/**: mob bodies register as `VISUALS` entries in
  `src/render/characters/manifest.ts` and are preloaded/assembled by
  `characters/assets.ts`; the ambient fish (`src/render/fish.ts`) loads
  `leaping_fish.glb` with a procedural fallback. Rig rules in
  `public/models/chars/CLAUDE.md` apply to creature rigs too.
- **resources/**: gatherable world-node markers (`gather_` prefix). `NODE_ASSET_URL`
  in `src/render/gather_nodes.ts` is keyed by `GatherNodeType` (`src/sim/types.ts`)
  with placements from `src/sim/content/gather_nodes.ts` and primitive fallbacks; a
  new node type also needs a `gather_nodes_lookup.ts` entry, and
  `tests/gather_nodes.test.ts` pins `NODE_GEOMETRY_KEYS` coverage.
- **dungeon/**: the instanced interior kit. A new kit piece must also be added to the
  `KIT_MODELS` or `BITS_MODELS` list in `src/render/dungeon.ts` (each name loads
  `models/dungeon/<name>.glb` into the shared `moduleAssets`/atlas-material registry)
  to be reachable via `buildDungeonPropMesh(kind)`; read the "Module assets" comment
  block there first.
- **weapons/**: held weapons resolve via `ITEM_WEAPON_VARIANTS`
  (`src/ui/weapon_variants.ts`) to `models/weapons/<key>.glb`
  (`itemWeaponModelUrl` in `src/render/characters/manifest.ts`), attached to the rig
  by `src/render/characters/assets.ts`; a new base weapon needs the matching item
  record in `src/sim/content/items.ts` plus its painted item art
  (`public/ui/items/<item-id>.webp`) in the same change. EXCEPTION: the `WEAPON_VFX`
  skin GLBs (keys in `src/render/weapon_vfx.ts`) must keep drawable WebP textures,
  never KTX2, because their emissive derivation reads the texture pixels;
  `compress_glb_textures.mjs` auto-excludes them and
  `tests/glb_texture_compression.test.ts` pins the exclusion set.
- **quest/**: `QUEST_OBJECT_URLS` in `src/render/quest_objects.ts` maps quest-object
  templateIds to GLB URLs; a new quest prop needs that entry plus the matching content
  record in `src/sim/content/` (root CLAUDE.md's "New game content" seam).
- **biome/**: consumed by `src/render/props.ts` (the `khex` kit entries in
  `PROP_ASSET_DEFS`), `src/render/gale_features.ts`, and
  `src/render/jungle_features.ts`. NOT by `src/render/terrain.ts`, which loads only
  textures.
- **foliage/**: `src/render/foliage.ts` selects `FOLIAGE_MODEL_URLS_HIGH` or
  `FOLIAGE_MODEL_URLS_LOW` by `GFX.leanFoliage`; preload and placement must stay
  sourced from that one list family, with preload covering the full HIGH union LOW
  set (`tests/render_asset_preload.test.ts` and `tests/foliage_preload_boot.test.ts`
  pin it). Read the `foliage.ts` header before touching the lists.
- **tools/**: manifested but consumed by NO runtime code path today. Crafting
  stations use `models/props/anvil.glb` via `PROP_ASSET_DEFS`, and the only repo
  reference is `scripts/assets/specs/asset_bits.json`, whose `outDir`
  (`models/tools_bits`) does not exist. There is no equipped-tool render pipeline: do
  not wire a new tool asset to one; adding a tool asset means building its consumer
  first.

Dirs with no local coverage: `mounts/` (`lazyPreload` `VISUALS` entries in
`src/render/characters/manifest.ts`, fetched on first sight of a mounted player;
`src/render/mount_visuals.ts` is the pure sim-MountKey-to-VISUALS-key map),
`battleground/` (rune GLBs, `src/render/battleground_rune_model.ts`), `city/`,
`medieval_village_v2/`.
