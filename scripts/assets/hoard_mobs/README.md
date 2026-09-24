# Hoard room mobs

The rank and file of the Buried Hoard boss rooms, remade to belong to their rooms
(`docs/design/boss-rooms/README.md`). A pure look change: the sim records in
`src/sim/content/rift/mobs.ts` are untouched, only `MOB_KEYS` and `VISUALS` in
`src/render/characters/manifest.ts` point at the new bodies.

Every body starts as a concept image, becomes a Tripo model
(`node scripts/asset_pipeline/pipeline.mjs creature --name hoard_<mob> --image <png> --until generate`),
and then takes one of two roads:

- **Humanoids** (a strict T-pose concept): `pipeline.mjs rig-manual --raw <raw.glb> --name hoard_<mob>`
  fits them to the shared KayKit skeleton, so they carry its whole clip vocabulary.
  A short body can trip the in-place check by a hair on the KayKit death and slice
  clips (the limit scales with body height); the GLB is still written and the clips
  are the ones every player model already ships.
- **Creatures** (four legs): `quadruped_rig.py` rigs and animates them in Blender from
  a small bone spec (`specs/<mob>.json`), then `assemble.mjs` merges the per-clip GLBs:

  ```
  blender --background --python scripts/assets/hoard_mobs/quadruped_rig.py -- <raw.glb> <dir> --spec scripts/assets/hoard_mobs/specs/<mob>.json
  node scripts/assets/hoard_mobs/assemble.mjs <mob> <dir> public/models/creatures/hoard_<mob>.glb
  ```

  The generated model faces +X, so its `VISUALS` row carries `yaw: -Math.PI / 2`.

  Tripo does not always lay a creature along +X: look at it from above first and set
  the spec's `rotateZ` so it does. Limbs that stand OUT from the body instead of under
  it go in the spec's `sideLimbs` and walk the creature instead of the four legs: the
  Rime Elemental's two arms are written by hand, and a spider's eight legs are FOUND
  (`spider_spec.py` welds the mesh, drops the body, and takes each long thin piece
  that is left as a leg: hub end, knee, tip):

  ```
  blender --background --python scripts/assets/hoard_mobs/spider_spec.py -- <raw.glb> scripts/assets/hoard_mobs/specs/<mob>.json --name Name --key <mob> --rotate-z 90
  ```

- **Ice, glass, anything translucent** comes out of Tripo as polished metal, which the
  game lights as dark steel. `node scripts/assets/hoard_mobs/matte.mjs <model.glb>`
  makes the shipped body matte; a `tint: 'entity'` on its `VISUALS` row brings the colour back.

After shipping a body: re-render its portrait
(`PORTRAIT_RECEIPT=tmp/portrait-receipt.json ONLY=<mob ids> node scripts/render_finder_portraits.mjs`,
then `node scripts/build_mob_portrait_source_manifest.mjs --write --receipt tmp/portrait-receipt.json`)
and regenerate the media manifest (`node scripts/build_media_manifest.mjs`).
