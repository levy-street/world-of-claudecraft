<!-- public/models/resources/: gatherable-node and material GLBs. Root
     CLAUDE.md (asset pipeline invariants, manifest generation) already
     applies; this file is directory-local only. -->

# public/models/resources/

Gatherable world-node markers (`src/render/gather_nodes.ts`) and other small
harvestable/crafting-material GLBs.

## Size budget

Category average as of this writing: **~19.6 KB** (133 pre-existing files,
~2.6 MB total). This is the tightest budget of any model category: these are
tiny, distant, often-repeated static props, so keep new additions in the
15-45 KB range where possible. The ore/wood/herb gather-node GLBs land at
60-83 KB, well above that; see the compression note below for why.

## Compression pipeline

Same `gltf-transform optimize` pipeline as `public/models/creatures/`.
**Always compress with `--compress meshopt`, never `draco`** (see
`public/models/creatures/CLAUDE.md` for why: this repo's runtime loader has no
`DRACOLoader`, so a Draco GLB silently fails to load and falls back to the old
procedural geometry):

```
npx gltf-transform optimize <in>.glb <out>.glb \
  --texture-compress webp --compress meshopt
```

The ore/wood/herb gather-node GLBs landed at 60-83 KB from raw ~15 MB Tripo
exports. Meshopt is noticeably less space-efficient than Draco on these small
meshes, and this category's historical ~19.6 KB average was set entirely by
Draco-era or hand-built primitive assets; 60-83 KB is the practical floor this
pipeline reaches for a meshopt-compressed, PBR-textured mesh at this
complexity, not a tuning miss. Iterate `--texture-size 32` or lower first if a
future addition needs to land smaller before accepting a size above budget.

## Naming convention

`snake_case`, prefixed `gather_` for world-node markers
(`gather_ore_vein.glb`, `gather_wood_pile.glb`, `gather_herb_cluster.glb`) to
distinguish them from other resource-category assets.

## Wiring

Any file dropped here is picked up automatically by
`node scripts/build_media_manifest.mjs generate` (also runs as part of
`npm run build`); **never hand-edit** `src/render/assets/manifest.generated.ts`.

`src/render/gather_nodes.ts` maps each `GatherNodeType` (`ore`/`wood`/`herb`,
defined in `src/sim/data.ts`) to a GLB URL in `NODE_ASSET_URL`, preloads all
three via `loadGltf()` + `registerPreload()` at module import time, and clones
the loaded scene per `GATHER_NODES` placement (`src/sim/content/gather_nodes.ts`).
Falls back to the original tiny primitive geometry (`NODE_FALLBACK_GEOMETRY`)
if a GLB has not finished loading yet. `tests/gather_nodes.test.ts` asserts
`gather_nodes_lookup.ts`'s `NODE_GEOMETRY_KEYS` still covers every node type
used in content; `tests/render_glb_replacement_assets.test.ts` asserts every
`NODE_ASSET_URL` entry resolves to a real, manifested file.
