<!-- public/models/dungeon/: KayKit dungeon-interior kit GLBs. Root CLAUDE.md
     (asset pipeline invariants, manifest generation) already applies; this
     file is directory-local only. -->

# public/models/dungeon/

The instanced KayKit dungeon-interior kit consumed by `src/render/dungeon.ts`
(module/pack asset scanning + `buildDungeonPropMesh()`), plus dungeon-specific
props referenced from `src/render/props.ts` and `src/render/quest_objects.ts`
(e.g. `delve_entrance_2.glb`).

## Size budget

Category average as of this writing: **~16 KB** (379 files, ~5.8 MB total).
This is a large, densely-instanced kit; individual pieces are small (walls,
floor tiles, furniture). Keep new kit pieces in the 8-30 KB range.

## Compression pipeline

Use `gltf-transform optimize` (see `public/models/creatures/CLAUDE.md` for
the full flag reference):

```
npx gltf-transform optimize <in>.glb <out>.glb \
  --texture-size 32 --texture-compress auto \
  --simplify true --simplify-ratio 0.02 --simplify-error 0.01 \
  --compress draco
```

## Naming convention

`snake_case`, matching the source kit's piece names (wall/floor/door/prop
segments) or `delve_*` for delve-specific landmark pieces.

## Wiring

Any file dropped here is picked up automatically by
`node scripts/build_media_manifest.mjs generate` (also runs as part of
`npm run build`); **never hand-edit** `src/render/assets/manifest.generated.ts`.
New kit pieces must also be registered in `src/render/dungeon.ts`'s module/pack
asset table (`moduleAssets`) to be reachable via `buildDungeonPropMesh(kind)`;
see the file header there for the pack-scanning contract before adding a piece.
