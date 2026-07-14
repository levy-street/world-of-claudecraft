<!-- public/models/chars/: player/enemy character rig GLBs. Root CLAUDE.md
     (asset pipeline invariants, manifest generation) already applies; this
     file is directory-local only. Applies to chars/enemies/ and
     chars/players/ (and the Mech/ subtree) below it. -->

# public/models/chars/

Full character body rigs: player races/classes (`chars/players/`) and enemy
mob bodies (`chars/enemies/`), consumed by `src/render/characters/` (see that
directory's own module split for the rig-merge/skinning pipeline referenced
in the root CLAUDE.md's perf note, "merge skinned rig parts so a remote player
costs one draw, not nine").

## Size budget

Category averages as of this writing:
- `chars/enemies/`: **~1120 KB** (7 files, ~7.7 MB total)
- `chars/players/`: **~1233 KB** (9 files, ~10.8 MB total, plus the
  `Mech/characters/CombatMech.glb` outlier at ~1.7 MB)

These are full skinned character rigs (skeleton + multiple material slots),
by far the largest single-file budget in `public/models/`. Keep new player
race/class or mob-body rigs in the 800 KB - 1.8 MB range; do not compress a
character rig down to prop-tier sizes, rig detail and animation fidelity
matter far more here than for a static prop.

## Compression pipeline

Use `gltf-transform optimize`, but with a MUCH lighter touch than the smaller
categories: preserve the skeleton/skin weights (do not simplify past a light
ratio) and keep textures at a resolution that still reads at close range:

```
npx gltf-transform optimize <in>.glb <out>.glb \
  --texture-size 1024 --texture-compress auto \
  --simplify true --simplify-ratio 0.5 --simplify-error 0.001 \
  --compress draco
```

Verify with `npx gltf-transform inspect <file>.glb` that skinning
(`JOINTS_0`/`WEIGHTS_0`) and any animation clips survived the pass before
committing; a rig that loses its skin is a functional regression, not just a
size win.

## Naming convention

`snake_case` or `PascalCase` matching the existing files (mixed casing is
already present, e.g. `demonalt.glb` vs `CombatMech.glb`); match whichever
convention the adjacent kit already uses rather than introducing a third.

## Wiring

Any file dropped here is picked up automatically by
`node scripts/build_media_manifest.mjs generate` (also runs as part of
`npm run build`); **never hand-edit** `src/render/assets/manifest.generated.ts`.
`src/render/characters/manifest.ts` (`manifestUrlsForGraphics`,
`characterPreloadUrls`) is the tier-independent preload source; add a new
race/class/mob body there. `tests/render_asset_preload.test.ts` guards the
v0.16.0 "Could not start the renderer" class of bug (a tier-scoped preload
that omits an asset the live tier then places): keep preload
tier-independent for any new entry.
