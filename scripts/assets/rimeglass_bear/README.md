# Rimeglass Bear

Builds `public/models/creatures/rimeglass_bear.glb` (`mob_rimeglass_bear`, the Hoarshelf's
Rimeglass Bear on the Quartered Isle). The body is a Tripo text-to-model draft, re-textured
here, fitted to the wolf rig (`scripts/assets/wolf_rig/`) on a skeleton measured off the
bear, and given its own Idle and Attack. It plays the wolf clip names (`WOLF_BAKED` in
`src/render/characters/manifest.ts`).

| File | Job |
|---|---|
| `bake.py` | Blender bake of the base colour: frosted coat, fur strands and flecks, AO, ice edges, and a roughness map (matte fur, glossy ice) |
| `frame.py` | turns the baked body into the wolf rig's frame (muzzle -Y, 2.6x, floor at -0.553) and prints its leg columns and profile |
| `bear_anatomy.py` | the bear's joint table (wolf bone names), its stride scale and its tail stub |
| `build_rig.py` | registers the bear with the wolf rig and runs the wolf rig's `build.py` |
| `clips.py` | confines the ear weights to the ear lobes, then authors the bear's Idle and Attack over the carried set and exports |

## Source

Tripo text-to-model, model `P2-20260801`, face limit 6000, task
`1a5f551e-a5d5-4ff3-b0b0-48624b171f26` (draft B). Prompt: a massive frost bear on all fours,
matted white and pale blue fur, rime-glass shards scattered across its back and forelegs.
Download the task's `model_url` to `tmp/rimeglass_bear/raw_b.glb` (Tripo links expire:
re-fetch the task for a fresh one).

## Rebuild

From the repo root, Blender 5.x and KTX-Software 4.3+ (`ktx`) on PATH:

```bash
d=tmp/rimeglass_bear
blender --background --python scripts/assets/rimeglass_bear/bake.py -- \
  $d/raw_b.glb $d/baked_b.glb $d/baked_b_basecolor.png 1.0
blender -b --python scripts/assets/rimeglass_bear/frame.py -- $d/baked_b.glb $d/bear_body.glb
# the wolf's motion source, as in scripts/assets/wolf_rig/README.md
git show e201d764db:public/models/creatures/wolf_basic.glb > tmp/wolf_rig/wolf_basic_dogrig.glb
node scripts/assets/wolf_rig/to_blender.mjs tmp/wolf_rig/wolf_basic_view.glb tmp/wolf_rig/wolf_basic_dogrig.glb
blender -b --factory-startup --python scripts/assets/rimeglass_bear/build_rig.py -- \
  --model rimeglass_bear --body $d/bear_body.glb --ref tmp/wolf_rig/wolf_basic_view.glb \
  --out $d/bear_raw.glb --blend $d/bear.blend
blender -b $d/bear.blend --python scripts/assets/rimeglass_bear/clips.py -- --out $d/bear_clips.glb
```

Ship it like the other generated creatures: resample, the normal and roughness maps down to
512 px (the colour stays 1024), KTX2 textures, then meshopt:

```bash
npx gltf-transform resample $d/bear_clips.glb $d/a.glb
npx gltf-transform resize $d/a.glb $d/b1.glb --width 512 --height 512 --pattern "NormalGL*"
npx gltf-transform resize $d/b1.glb $d/rimeglass_bear.glb --width 512 --height 512 --pattern "*_rough"
node scripts/assets/compress_glb_textures.mjs $d/rimeglass_bear.glb
npx gltf-transform meshopt $d/rimeglass_bear.glb public/models/creatures/rimeglass_bear.glb
```

Then `node scripts/build_media_manifest.mjs generate`, the wiki (`npm run wiki:content`,
`ONLY=mob_rimeglass_bear npm run wiki:stills`) and the mob portrait
(`scripts/render_finder_portraits.mjs` with `ONLY=rimeglass_bear`, then
`node scripts/build_mob_portrait_source_manifest.mjs --write --receipt <file>`).

## What to know

- The bear stands mid-stride (its right paws sit back), so the right legs' joints are
  offset in `bear_anatomy.py`. That leg pair carries the set's biggest single-frame steps
  (Death about 88 degrees at the right hind ankle), which do not read at game speed.
- `stride_scale` (0.65, the bear's foreleg against the wolf's) shrinks the wolf's paw
  travel, lift and swing; at 1.0 the Gallop flailed (145 degree steps). Both wolves keep 1.0.
- Bone heat gave each ear over 1,500 corners reaching the jaw, so an ear flick dragged the
  face. `clips.py` keeps ear weight within 7 cm of each lobe (none past 14 cm or below the
  base) and hands the rest to Head.
- Check a clip with `node scripts/assets/wolf_rig/clip_check.mjs <glb> <Clip>`.
