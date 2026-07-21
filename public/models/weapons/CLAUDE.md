<!-- public/models/weapons/: weapon GLBs. Root CLAUDE.md (asset pipeline
     invariants, manifest generation) already applies; this file is
     directory-local only. -->

# public/models/weapons/

Equippable weapon GLBs, worn by character rigs via
`src/render/characters/assets.ts`.

## Size budget

Category average as of this writing: **~37 KB** (55 files, ~2.0 MB total).
Keep new additions in the 15-60 KB range; a weapon is held close to camera
during combat so it can afford a bit more detail than a background prop, but
should stay well under a full character body's budget.

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

`snake_case`, named after the weapon.

## Wiring

Any file dropped here is picked up automatically by
`node scripts/build_media_manifest.mjs generate` (also runs as part of
`npm run build`); **never hand-edit** `src/render/assets/manifest.generated.ts`.
`src/render/characters/assets.ts` / `manifest.ts` register weapon GLBs
alongside body/hair assets; add the matching item record in
`src/sim/content/items.ts` so the sim knows to equip it.
