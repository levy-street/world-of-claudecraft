# scripts/asset_pipeline/armor/ (WIP)

Armor-forge tooling on top of the asset pipeline: generate brand-new, fully
rigged five-slot armor SETS (helm, pauldrons, breastplate, gauntlets, greaves)
from a one-line theme, per-piece TEXTURE variants for existing armor, and "The
Armory", a local picker that previews everything on the character models with
per-slot mix and match, weapons in hand, and wing cosmetics.

Status: WIP demo tooling. All generated artifacts live in the untracked
workspace `tmp/asset_pipeline/armor_picker/` (GLBs, atlases, renders, the
guide); only the scripts and the picker UI are committed. Nothing here touches
the game runtime yet.

## The illustrated guide

The full step-by-step recipe with screenshots, three worked example sets
(Dragonscale, Bonewrought, Stormcrystal), costs, and a troubleshooting table:

- artifact: https://claude.ai/code/artifact/529e8033-11b9-48a0-b715-59b403bf4462
- locally: `python3 scripts/asset_pipeline/armor/build_guide.py` from the
  workspace, then http://localhost:5181/guide.html

## Quickstart

```
# keys in repo-root .env: TRIPO_API_KEY (+ OPENAI_API_KEY for concepts)
node scripts/asset_pipeline/pipeline.mjs balance

# 1. concept image(s): edit the SETS table first
node scripts/asset_pipeline/armor/concepts.mjs mytheme

# 2. generate + segment (about 90 credits, 15 to 25 min; run in background)
node scripts/asset_pipeline/armor/gen_set.mjs \
  tmp/asset_pipeline/armor_picker/work/concept_mytheme.png mytheme

# 3. classify parts into the five slots (Tripo raws face +X, yaw is -90)
node scripts/asset_pipeline/armor/merge_slots.mjs \
  tmp/asset_pipeline/armor_picker/work/mytheme_set_parts.glb \
  tmp/asset_pipeline/armor_picker/work/mytheme_set_raw.glb \
  tmp/asset_pipeline/armor_picker/work/mytheme_rig_input.glb -90

# 4. rig free onto the warrior skeleton, strip root motion, split per slot
node scripts/asset_pipeline/pipeline.mjs rig-manual \
  --raw tmp/asset_pipeline/armor_picker/work/mytheme_rig_input.glb \
  --name mytheme_armor \
  --reference tmp/asset_pipeline/armor_picker/work/warrior_plain.glb --pre-rotated
node scripts/asset_pipeline/armor/strip_root_xz.mjs <job>/mytheme_armor.glb \
  tmp/asset_pipeline/armor_picker/work/mytheme_rigged.glb
node scripts/asset_pipeline/armor/split_by_slots.mjs ...   # see the guide

# 5. fit (helm seat, shrinkwrap against every wearer body) + numeric gates
node scripts/asset_pipeline/armor/adjust_set.mjs ...
node scripts/asset_pipeline/armor/fit_shell.mjs ...
node scripts/asset_pipeline/armor/verify_sets.mjs

# 6. register in build_picker_assets.mjs SETS table, rebuild, view
node scripts/asset_pipeline/armor/build_picker_assets.mjs
node scripts/asset_pipeline/armor/serve.mjs 5181   # http://localhost:5181/
```

The picker needs a one-time three.js bundle in the workspace:
`npx esbuild scripts/asset_pipeline/three_bundle_entry.js --bundle --format=esm
--outfile=tmp/asset_pipeline/armor_picker/three.bundle.js`, and dequantized
base bodies (`work/*_plain.glb`, built from the character sources with
gltf-transform `dequantize()`; the guide covers the bootstrap).

## What is here

| Script | Role |
|---|---|
| `concepts.mjs` | gpt-image-2 armor-set concepts from the mannequin reference |
| `gen_set.mjs` | Tripo image-to-model + v2 mesh_segmentation (accepts v3 task ids) |
| `merge_slots.mjs` | classify segmented micro-parts into the five slots, in place |
| `split_by_slots.mjs` `split_body.mjs` `strip_root_xz.mjs` | rig post-processing |
| `adjust_set.mjs` `fit_shell.mjs` `tuck_body.mjs` | exact per-vertex fit: rest-space nudges, shrinkwrap-outward, body tucks |
| `transplant_head.mjs` | move a head across skeletons (e.g. the KayKit ranger head) |
| `retex.mjs` `batch_retex.mjs` `compose_piece.mjs` `apply_pieces.mjs` | per-piece TEXTURE variants via Tripo UV-preserving repaint |
| `verify_variants.mjs` `verify_sets.mjs` `qa_renders.mjs` `compose_preview.mjs` | exhaustive variant coverage + numeric fit gates + audit renders |
| `build_picker_assets.mjs` | composes atlases and writes the picker manifest |
| `serve.mjs` `index.html` `picker.js` `shot.mjs` | The Armory picker + headless screenshot driver |
| `build_guide.py` | rebuilds the illustrated guide with embedded screenshots |

## Known limitations (the WIP part)

- Forged sets are rigged on the warrior-family (mixamorig) skeleton and equip
  on warrior, paladin, and druid; hunter and shaman (KayKit skeleton) need a
  second free rig-manual pass per set against a KayKit reference.
- The picker is a dev tool; there is no game-runtime integration (SkinCatalog
  is a closed union, see the root CLAUDE.md before wiring anything in-game).
- The character source models come from the maintainer's Character_Assets drop
  and are bootstrapped into the workspace, not committed.
- `rig-manual` gained Mixamo-name aliases in `../lib/manual_rig.mjs` as part of
  this work (KayKit names still take priority).
