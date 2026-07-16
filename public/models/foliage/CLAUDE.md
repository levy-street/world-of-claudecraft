<!-- public/models/foliage/: tree/rock/grass-dressing GLBs. Root CLAUDE.md
     (asset pipeline invariants, manifest generation) already applies; this
     file is directory-local only. -->

# public/models/foliage/

Trees, rocks, and ground dressing consumed by `src/render/foliage.ts`
(instanced, plus the player-centred grass ring).

## Size budget

Category average as of this writing: **~116 KB** (23 files, ~2.6 MB total).
Trees in particular can run larger than the average given their silhouette
importance at a distance; keep small ground-clutter pieces well under it.

## Compression pipeline

Use `gltf-transform optimize` (see `public/models/creatures/CLAUDE.md` for
the full flag reference and the iterate-until-under-budget loop):

```
npx gltf-transform optimize <in>.glb <out>.glb \
  --texture-size 128 --texture-compress auto \
  --simplify true --simplify-ratio 0.075 --simplify-error 0.01 \
  --compress draco
```

## Naming convention

`snake_case`, named after the plant/rock variant it represents.

## Wiring

Any file dropped here is picked up automatically by
`node scripts/build_media_manifest.mjs generate` (also runs as part of
`npm run build`); **never hand-edit** `src/render/assets/manifest.generated.ts`.
`src/render/foliage.ts`'s `MODEL_URLS` is the one frozen list sourcing BOTH
preload and placement (see the file header there for why that must stay a
single source, not a tier-scoped subset): add a new URL there to wire a piece.
