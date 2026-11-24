# Heatsworn Ember

Builds `public/models/creatures/heatsworn_ember.glb` (`mob_heatsworn_ember`, the Quartered
Isle's Heatsworn Ember). It is the Emberkin body (`emberkin.glb`) with the same mesh, rig
and clips, recoloured: the lit fel-green pockets become fire red, the dark rock loses its
green cast, and the lit pockets also feed a red emissive (glow) map.

| File | Job |
|---|---|
| `recolor.mjs` | reads the Emberkin base colour, writes the red base colour and the glow map |
| `extract_color.mjs` | writes the Emberkin base colour out as PNG |
| `build.mjs` | swaps the base colour, adds the glow as the emissive map, keeps meshopt |

## Rebuild

From the repo root, with KTX-Software 4.3+ (`ktx`) on PATH:

```bash
d=tmp/heatsworn && mkdir -p $d
s=scripts/assets/heatsworn_ember
node $s/extract_color.mjs public/models/creatures/emberkin.glb $d/color.png
node $s/recolor.mjs $d/color.png $d/color_red.png $d/emissive_red.png
node $s/build.mjs public/models/creatures/emberkin.glb $d/color_red.png $d/emissive_red.png \
  $d/heatsworn_ember.glb
node scripts/assets/compress_glb_textures.mjs $d/heatsworn_ember.glb
cp $d/heatsworn_ember.glb public/models/creatures/heatsworn_ember.glb
```

Then `node scripts/build_media_manifest.mjs generate`, the wiki (`npm run wiki:content`,
`ONLY=mob_heatsworn_ember npm run wiki:stills`) and the mob portrait
(`scripts/render_finder_portraits.mjs` with `ONLY=heatsworn_ember`, then
`node scripts/build_mob_portrait_source_manifest.mjs --write --receipt <file>`).
