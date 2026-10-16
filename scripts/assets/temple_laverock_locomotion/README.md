# Laverock locomotion bank

This keeps the shipped body, textures, Idle, gestures and song in
`public/models/creatures/temple_laverock.glb`. The sibling animation bank replaces
Walk and adds Run on its exact original skeleton. It carries no mesh or texture.
The seven Python support modules are the original Laverock IK builder, with its
proportion warp and arm clearance; no other character's animation is transplanted.

Rebuild with Blender 5.2 installed (set `BLENDER` to its executable if needed):

```sh
node scripts/assets/temple_laverock_locomotion/export.mjs
node scripts/assets/temple_laverock_locomotion/measure.mjs
node scripts/build_media_manifest.mjs generate
```

The bake starts from the checked-in original rig source, without an external
blend file. The exporter refuses any skeleton rest-transform mismatch against
the shipped body. Every source input, the body and the dependency lock contribute
to the bank's source fingerprint.

The measurement reconstructs FK from the shipped animation channels. The body's
skinned Idle bounds give the same height normalization as the renderer. Mid-stance
ankle travel gives each cycle's reference speed; the manifest then matches the
unchanged 3.2 yd/s follow and 7 yd/s catch-up. Tests also require ground contact,
whole-rig loop closure and smooth arm/staff motion. The normal walk has a long
processional stride; the hurry lifts the staff clear of the ground.
