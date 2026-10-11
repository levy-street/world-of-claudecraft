# Human male and female Workshop animation libraries

Sources: Mailer, [Human Male](https://steamcommunity.com/sharedfiles/filedetails/?id=1338373603)
and [Human Female](https://steamcommunity.com/sharedfiles/filedetails/?id=1335166463).
The uploader credits Blizzard Entertainment for the original resources. These
assets are not CC0; this entry records provenance, not a new license grant.

Each library contains the 36 distinct source clips, retargeted onto the respective
WOC body. The source `@` sequences are duplicate action wrappers or Source-specific
driving/reference poses and are excluded. Meshes, textures, facial bones and addon
Lua are not shipped. Archive and MDL checksums are literal pins in the intake
scripts. SourceIO is pinned at `0a835d9676d839b85e291cf1d35855e56d80308b`.

From the repository root, with Blender and a checkout of that SourceIO revision:

```sh
python3 scripts/assets/wow_human/download.py
blender -b --factory-startup --python scripts/assets/wow_human/decode.py -- /path/to/SourceIO
node scripts/assets/wow_human/build.mjs
node scripts/build_media_manifest.mjs generate
npx vitest run tests/woc_wow_animations.test.mjs tests/character_clipmaps.test.ts tests/woc_character.test.ts tests/woc_entry_preload.test.ts --maxWorkers=2
```

The source checkout directory must be named `SourceIO`. Raw archives, decoded
motion, and gait calibration reports remain in `tmp/wow_human`. The shipping
outputs are `public/models/chars/players/woc/wow_anims_male.glb` and
`wow_anims_female.glb`. They contain no textures, so the texture compressor has
nothing to convert. Bone mapping transfers world-space rotation with anatomical
aim correction and scales hip translation. All other target translations and
weapon socket transforms retain the WOC bind pose. Shoulder armor follows the
upper arms; skirt plates follow the thigh delta from their own bind rotation,
with a reduced 40% follow for side tassels. Every authored key is retained;
30 Hz resampling changed short foot contacts and is deliberately avoided.
Walk, run and backpedal timing
is calibrated from planted-foot travel to 2.2, 7 and 4.55 yd/s respectively.

The runtime selects 12 source clips: idle, walk, run, backpedal, swim, tread water,
jump, death, wave, laugh, flex and bow. The remaining source motions
are present by their `WoW_` clip names for animation tools, including crouch,
directional swimming, noclip, talking, agreement and disagreement gestures.
Combat, casting, floor sitting/riding, strafe, landing, climb, stow, other emotes and blade contacts keep
their existing WOC clips because these packs do not supply matching replacements.

All nine player classes and both body fits receive the libraries. NPCs already
using these same class definitions inherit them through the existing manifest.
Both files join the deferred world-entry preload, not the launcher boot preload.

## Classic autoattacks

`node scripts/assets/wow_human/build_autoattacks.mjs` rebuilds the meshless
`wow_autoattacks_male.glb` and `wow_autoattacks_female.glb` libraries and their
`woc_autoattack_contacts.json` timing table. Committed `source/` inputs are the
source-skeleton clips extracted with wow.export from Classic Era 1.15.9.70003,
not Workshop animations. The source manifest records file IDs, hashes and the
pinned exporter revision. The public archive.wow.tools mirror supplied the CASC
files. These remain Blizzard-authored assets (see CREDITS.md).

`autoattack_retarget.mjs` maps the separate male/female M2 skeletons onto the WOC
bind poses, preserves limb lengths and socket transforms, and samples rotations
at 60 Hz. M2Loader already converted the inputs to Y-up; unlike the Workshop
models these use the same facing conversion for bind and animation. The two
single-hand source strikes also provide the dual main/off clips; the combined
clip uses the main strike's body and right arm plus the off strike's left arm.
Dual-wield windups are aligned so separate and same-frame paired strikes use
the same contact time. Contact times use the existing handslot +Y blade proxy
within 15% to 70% of the swing, measured from the final compressed GLBs for
each fit. The build rejects mismatched dual contacts.

Runtime selection is `woc_autoattack_core.ts`. It only replaces plain autoattacks:
ability overrides, wands and release from a held casting pose keep their existing
path. Non-staff two-hand weapons keep the owner's existing single-fist handling;
staves take the two-hand source strike. Ranged autos select bow or rifle by the
displayed skin's handling. `clip_names.ts` registers these clips on each WOC rig.
