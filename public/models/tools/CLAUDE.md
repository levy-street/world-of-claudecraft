<!-- public/models/tools/: gathering/profession tool GLBs. Root CLAUDE.md
     (asset pipeline invariants, manifest generation) already applies; this
     file is directory-local only. -->

# public/models/tools/

Profession/gathering tool GLBs (pickaxes, fishing rods, and similar) referenced
from item content in `src/sim/content/` and rendered via the equipped-item /
icon pipeline.

## Size budget

Category average as of this writing: **~14 KB** (69 files, ~0.9 MB total).
This is the smallest category by average; tools are small held items viewed
at a distance or as an icon base. Keep new additions in the 8-25 KB range.

## Compression pipeline

Use `gltf-transform optimize` (see `public/models/creatures/CLAUDE.md` for
the full flag reference and the iterate-until-under-budget loop):

```
npx gltf-transform optimize <in>.glb <out>.glb \
  --texture-size 32 --texture-compress auto \
  --simplify true --simplify-ratio 0.02 --simplify-error 0.01 \
  --compress draco
```

## Naming convention

`snake_case`, named after the tool.

## Wiring

Any file dropped here is picked up automatically by
`node scripts/build_media_manifest.mjs generate` (also runs as part of
`npm run build`); **never hand-edit** `src/render/assets/manifest.generated.ts`.
Add the matching item record in `src/sim/content/items.ts` (or
`recipes.ts`/`professions.ts` for a crafting tool) referencing the new GLB
path; the render/equip pipeline resolves it from there.
