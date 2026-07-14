<!-- public/models/creatures/: mob and ambient-wildlife GLBs. Root CLAUDE.md
     (asset pipeline invariants, manifest generation) already applies; this
     file is directory-local only. -->

# public/models/creatures/

Mob bodies (`src/render/characters/`) plus small ambient-wildlife GLBs
(`src/render/critters.ts`, `src/render/fish.ts`).

## Size budget

Category average as of this writing: **~185 KB** (30 pre-existing files,
~5.6 MB total). Keep new additions within roughly 100-300 KB unless the model
is a raid boss or otherwise a genuine visual centerpiece; small ambient
critters/fish should land well under the average (100-200 KB), not at it.
The rabbit/squirrel/songbird/leaping-fish additions land at 242-312 KB, a bit
above that range: see the compression note below for why.

## Compression pipeline

New GLBs (e.g. Tripo-generated ambient wildlife) are produced raw (10-15 MB,
1M+ vertices, 2K+ textures) and MUST be compressed before committing. **This
repo's runtime loader (`src/render/assets/loader.ts`) only wires up a
`MeshoptDecoder`, not a `DRACOLoader`** (a Draco-compressed GLB parses fine
with offline tools but silently fails `GLTFLoader.load()` in the browser
(`asset load failed: ... (missing file or bad GLB)`) and the renderer falls
back to the old procedural geometry with no visible error to the player).
Always compress with `--compress meshopt`, never `draco`, for anything this
loader will load at runtime:

```
npx gltf-transform optimize <in>.glb <out>.glb \
  --texture-compress webp --compress meshopt
```

Meshopt is somewhat less space-efficient than Draco for these small organic
meshes (roughly 1.4-1.7x larger), which is why this category's new additions
run above the historical average; that is the correct tradeoff given the
loader only supports meshopt. Iterate `--texture-size` down (256 -> 128 -> 64)
if a new addition needs to land smaller. `gltf-transform inspect <file>.glb`
shows the resulting vertex/texture footprint and confirms
`EXT_meshopt_compression` (not `KHR_draco_mesh_compression`) is the extension
actually used.

## Naming convention

`snake_case`, named after the creature (`rabbit_critter.glb`,
`leaping_fish.glb`), matching the existing mob files (`wolf_basic.glb`,
`crabenemy.glb`, ...).

## Wiring

Any file dropped here is picked up automatically by
`node scripts/build_media_manifest.mjs generate` (also runs as part of
`npm run build`); **never hand-edit** `src/render/assets/manifest.generated.ts`.

- Mob bodies: registered in `src/render/characters/assets.ts` /
  `src/render/characters/manifest.ts`.
- Ambient critters (rabbit/squirrel/songbird): `src/render/critters.ts` loads
  each species GLB via `loadGltf()` + `registerPreload()` at module import
  time, clones the loaded scene per pool instance, and falls back to the
  original merged-primitive body if the GLB has not finished loading yet
  (headless/test hosts, or a slow preload race online).
- Ambient fish: `src/render/fish.ts` follows the same load/clone/fallback
  pattern for the single leaping-fish species.

Both preload sets are asserted against the manifest + filesystem by
`tests/render_glb_replacement_assets.test.ts`.
