# Quartered Isle creatures

Builds four of the Quartered Isle's bodies in `public/models/creatures/`:

| GLB | Visual | Texture |
|---|---|---|
| `warden_of_the_quench.glb` | `mob_warden_of_the_quench` | baked (`warden`), cyan core glow |
| `the_glassfield_brute.glb` | `mob_the_glassfield_brute` | Tripo's own, maps resized only |
| `heaved_shardling.glb` | `mob_heaved_shardling` | baked (`shardling`), amber crack glow |
| `veinback_burrower.glb` | `mob_veinback_burrower` | baked (`burrower`), ore vein glow |

Each body is a Tripo image-to-model draft (`--model p2`) from a project concept, auto-rigged
as a biped with the pipeline's eight preset clips (Idle, Walk, Run, Attack, Hit, Death, Cast,
Jump). The rig rests facing +x, so each visual carries `yaw: -Math.PI / 2`.

| File | Job |
|---|---|
| `bake.py` | Blender bake of the base colour (grain, frost, strata or fur strands, AO, edge highlights) and a glow map from the lit colours; one `mode` per creature |
| `apply_bake.mjs` | puts the baked maps on the rigged GLB at 512 px, or with `- -` only resizes Tripo's maps |

## Rebuild

Generate and rig through the pipeline (the concept images live with the job):

```bash
node scripts/asset_pipeline/pipeline.mjs creature --name <key> --image <concept.png> \
  --model p2 --until generate --new-job
node scripts/asset_pipeline/pipeline.mjs creature --name <key> --job <job id> --rig-type biped
```

Then, from the repo root, with Blender 5.x and KTX-Software 4.3+ (`ktx`) on PATH
(`<mode>` is `warden`, `shardling` or `burrower`; the Brute skips the bake):

```bash
j=tmp/asset_pipeline/<job id>; d=tmp/newmobs; s=scripts/assets/quartered_isle_creatures
blender -b --factory-startup --python $s/bake.py -- $j/raw.glb $d/<key>_base.png $d/<key>_em.png <mode>
node $s/apply_bake.mjs $j/<key>.glb $d/<key>_base.png $d/<key>_em.png $d/<key>.glb
# the Brute: node $s/apply_bake.mjs $j/the_glassfield_brute.glb - - $d/the_glassfield_brute.glb
node scripts/assets/compress_glb_textures.mjs $d/<key>.glb
npx gltf-transform resample $d/<key>.glb $d/r.glb
npx gltf-transform meshopt $d/r.glb public/models/creatures/<key>.glb
```

The bake runs on `raw.glb` and its maps go onto the rigged GLB: the rig keeps the mesh's
triangles and UV layout.

Then `node scripts/build_media_manifest.mjs generate`, the wiki (`npm run wiki:content`,
`ONLY=mob_<key> npm run wiki:stills` for the two regular mobs) and the mob portraits
(`scripts/render_finder_portraits.mjs` with `ONLY=<key>`, then
`node scripts/build_mob_portrait_source_manifest.mjs --write --receipt <file>`).
