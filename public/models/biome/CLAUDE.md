<!-- public/models/biome/: terrain/zone-decoration GLBs. Root CLAUDE.md
     (asset pipeline invariants, manifest generation) already applies; this
     file is directory-local only. -->

# public/models/biome/

Zone-specific terrain decoration (rocks, ground clutter, biome-flavored
dressing) consumed by `src/render/terrain.ts` and related zone-dressing
modules.

## Size budget

Category average as of this writing: **~34 KB** (116 files, ~3.9 MB total).
These are small, densely-instanced decoration pieces; keep new additions in
the 15-60 KB range.

## Compression pipeline

Use `gltf-transform optimize` (see `public/models/creatures/CLAUDE.md` for
the full flag reference and the iterate-until-under-budget loop):

```
npx gltf-transform optimize <in>.glb <out>.glb \
  --texture-size 64 --texture-compress auto \
  --simplify true --simplify-ratio 0.0375 --simplify-error 0.01 \
  --compress draco
```

## Naming convention

`snake_case`, named after the biome feature it dresses.

## Wiring

Any file dropped here is picked up automatically by
`node scripts/build_media_manifest.mjs generate` (also runs as part of
`npm run build`); **never hand-edit** `src/render/assets/manifest.generated.ts`.
Consumers resolve the manifested URL by path convention; check
`src/render/terrain.ts` and sibling zone-dressing modules for the current
lookup pattern before adding a new biome asset.
