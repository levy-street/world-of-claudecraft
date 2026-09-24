# Hoard boss bodies

Five Buried Hoard (and rift) bosses have a body of their own instead of their
family's shared model. Each was generated with the asset pipeline
(`scripts/asset_pipeline/pipeline.mjs creature ... --until texture`) and then
finished here. The shipped files are `public/models/creatures/hoard_*.glb`; the
visuals are the `mob_hoard_*` entries of `src/render/characters/manifest.ts`.

Everything below runs headless:
`blender --background --python <script> -- <args>`. The raw generated models
face +X with +Z up and are normalized to roughly one unit.

| Boss | Rig | Finishing |
|---|---|---|
| Abyssal Maw | authored here | `maw_rig.py`: a hand-placed skeleton (jaw, tail, chin tentacles, lure), distance weights, and seven procedural clips. Tripo's quadruped auto-rig folded his head under his chest and ships one walk preset, so none of it is used. |
| Hoarfrost Warden | Tripo biped | `frost_fix.py` per retargeted preset: the arm twist chains and the hand are folded into their parent bone and sharpened (the gauntlets are rigid ice, not rubber), every arm rotation is relaxed toward his generated arms-at-his-sides pose, and four clips are authored whole (`--author`): the two-fisted slam (Attack), the held Ice Age channel, its blast, and the Whiteout Gust frontal. He is too top-heavy for the local KayKit rig. |
| Emberforge Tyrant | local KayKit (`rig-manual`) | `ember_mix.py` keeps the original glowing texture and takes only the hands and feet from an iron repaint; `ember_gauntlets.py` removes the generated hands (one welded shell each) and models rigid black-iron forge gauntlets in their place, on three swatches painted into free atlas room; `rigid_hands.mjs` then gives each gauntlet to its hand joint alone. |
| Archon Nyxaris | local KayKit (`rig-manual`) | `nyx_fix.py` removes the generated legs and shoes from under the robe: he floats (`hover` in the manifest). `rigid_head.mjs` makes the hood move as one piece. |
| Tempest Vharok | local KayKit (`rig-manual`) | `reshape.py vharok` lengthens the arms: the bare upper arm stretches, the bracer and hand ride out, and the pauldrons, wings and studs (separate welded shells) keep their shape. Rigged with `--center-torso` (his tail drags the bounds off the body), then `rigid_head.mjs`. |

## Rebuild

```
# Maw
blender --background --python scripts/assets/hoard_bosses/maw_rig.py -- <raw.glb> <dir> [--blend maw.blend]
node scripts/assets/hoard_bosses/assemble.mjs maw <dir> public/models/creatures/hoard_abyssal_maw.glb

# Warden (one call per preset; idle first, the slam starts from its first frame)
blender --background --python scripts/assets/hoard_bosses/frost_fix.py -- <preset.glb> <fixed/preset.glb> <relax>
blender --background --python scripts/assets/hoard_bosses/frost_fix.py -- <slash.glb> <fixed/slash.glb> 0 --attack <fixed/idle.glb>
node scripts/assets/hoard_bosses/assemble.mjs frost <fixed dir> public/models/creatures/hoard_hoarfrost_warden.glb

# Ember, Vharok, Nyxaris: reshape or fix the raw, rig it locally (free), then
# harden what must not bend (rig-manual weights by distance, which drags a chibi
# face or a modelled fist like jelly)
blender --background --python scripts/assets/hoard_bosses/reshape.py -- <ember|vharok> <in.glb> <out.glb>
blender --background --python scripts/assets/hoard_bosses/ember_gauntlets.py -- <in.glb> <out.glb>
node scripts/asset_pipeline/pipeline.mjs rig-manual --raw <out.glb> --name <hoard_key> [--center-torso]
node scripts/assets/hoard_bosses/rigid_head.mjs <rigged.glb> <shipped.glb> --neck <y> ...   # --probe prints the space
node scripts/assets/hoard_bosses/rigid_hands.mjs <rigged.glb> <shipped.glb> --wrist <x>
```

Shipped values: Nyxaris `--neck 0.18 --band 0.06 --radius 1.3` (the face jiggled at 0.9); Vharok `--neck 0.0
--band 0.1 --radius 1.35 --width 0.62 --behind -0.3 --lateral 0.4 --above 0.62`;
Emberforge `--wrist 1.62 --band 0.05 --joint wrist`.

The relax shares used for the Warden: idle 0.8, walk 0.7, run 0.65, hit 0.6,
jump 0.5, cast 0.45, death 0.35.

`rig-manual` needs a T-pose and scales the mesh so its arm line meets the
reference wrist height, so it only suits roughly human proportions.
