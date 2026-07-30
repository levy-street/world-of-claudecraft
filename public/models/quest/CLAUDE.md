<!-- public/models/quest/: quest-specific object GLBs. Root CLAUDE.md (asset
     pipeline invariants, manifest generation) already applies; this file is
     directory-local only. -->

# public/models/quest/

One-off quest-objective props (`src/render/quest_objects.ts`): things a player
interacts with or collects as part of a specific quest chain.

## Size budget

Category average as of this writing: **~281 KB** (10 files, ~2.7 MB total).
This category runs larger than most because quest objects are often the
visual focus of a scene up close; keep new additions in the 100-400 KB range
unless the object is a genuine quest centerpiece.

## Compression pipeline

Use `gltf-transform optimize` (see `public/models/creatures/CLAUDE.md` for
the full flag reference and the iterate-until-under-budget loop):

```
npx gltf-transform optimize <in>.glb <out>.glb \
  --texture-size 256 --texture-compress auto \
  --simplify true --simplify-ratio 0.15 --simplify-error 0.01 \
  --compress draco
```

## Naming convention

`snake_case`, named after the quest object.

## Wiring

Any file dropped here is picked up automatically by
`node scripts/build_media_manifest.mjs generate` (also runs as part of
`npm run build`); **never hand-edit** `src/render/assets/manifest.generated.ts`.
`src/render/quest_objects.ts` maps quest-object templateIds to GLB URLs; add a
new entry there to wire a new quest prop, and add the matching content record
in `src/sim/content/` (see the root CLAUDE.md's "New game content" seam).
