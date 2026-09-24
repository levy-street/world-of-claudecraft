# Orbital Lightning shipping components

Original project art authored procedurally in Blender from the user's spell brief.
No third-party mesh, texture, or reference image is incorporated. The editable
authoring files and approved component exports live beside this document.

Rebuild from the repository root:

```sh
node scripts/assets/orbital_lightning/build.mjs
node scripts/assets/compress_glb_textures.mjs public/vfx/orbital-lightning/orb.glb public/vfx/orbital-lightning/impact.glb
node scripts/build_media_manifest.mjs generate
pnpm exec vitest run tests/orbital_lightning_assets.test.ts
```

The texture compression step reports both files skipped because they contain no
textures. The geometry stage uses the repository's glTF Transform and Meshoptimizer
versions, preserving each named layer without joining or flattening. Source exports,
builder and lockfile are fingerprinted into each asset. Tests pin shipping hashes,
triangle counts, named components, ground/center pivots and deterministic rebuilds.

Only `public/vfx/orbital-lightning/orb.glb` and `impact.glb` are runtime assets.
They contain no boss, player, ground, lights, cameras or baked combat animations.
The native Blender preview is an art reference, not a combat implementation.

The orb layers are Core, LocalArcs, OuterEnergy and Sparks. The impact layers are
Crown, GroundArcs, ImpactCore, RadialBurst and Sparks. Geometry is Y-up. Orb center
is the origin; the nominal energy shell radius is about 0.48 units, with sparse
sparks reaching 0.91. Impact ground arcs extend about 1.05 units from the origin,
at Y 0.006 to 0.044. ImpactCore intentionally crosses below Y zero.

Meshopt quantization adds node transforms: when extracting a component geometry,
apply its full world matrix before installing runtime position/rotation/scale.
Do not mutate the cached loaded prototype. Share immutable geometry across instances,
use pooled material/instance state, and dispose only resources owned by the effect.
Runtime emission, orbit, anticipation, discharge and fades are recreated by the
renderer against the authoritative cue timeline; geometry does not decide damage.

All layers together cost 1,988 triangles per orb and 1,484 per impact. Six orbs
remain under 12,000 triangles, but draw calls and additive overdraw matter more:
pool components, shed purely cosmetic sparks first, and keep gameplay warnings on
every quality preset. Avoid individual dynamic lights for each orb.
