# Wolf rig

Owns the skeletons, skin weights and clips of `public/models/creatures/wolf_basic.glb`
(the pack wolves, the beast-family fallback and the shaman Shadewolf form) and
`greyjaw.glb` (Old Greyjaw and the first Stampede beast). The mesh, UVs and texture are
the shipped ones, untouched; only the rig and the motion are built here. The rebuild
recipe and every same-change step after it (media manifest, sizing, wiki, portraits)
are in `README.md`.

- `contract.mjs` is the contract: clip names, joint names, loops, the hit react cap, the
  floor tolerance and each wolf's on-screen scale. `ship.mjs` refuses a build that
  drifts from it and `tests/wolf_rig.test.ts` checks the shipped files against it.
  Clip names are the game's (WOLF_BAKED in `src/render/characters/manifest.ts`, which
  Greyjaw plays too).
- Greyjaw has no attack of his own any more: the art lead dropped the old one (a
  sit-down howl into a lunge, pose-blended from his Howl) because a wolf that sits to
  howl mid-fight reads wrong. Do not bring a sitting pose into a combat clip.
- The motion source is the old dog-rig files at `e201d764db`, never the shipped
  rebuild: rebuilding from a rebuilt file compounds every change.
- Judge a shipped (meshopt, quantized) file with `skin_pose.mjs` / `clip_check.mjs`.
  Blender's importer misreads quantized skinned GLBs (gltf-transform folds the
  position dequantization into the inverse bind matrices), so a shipped file looks
  distorted in Blender even when it is right; Blender only ever reads `to_blender.mjs`
  copies.
- A fast gait shows big single joint steps (the gallop's wrist snaps up at each
  lift-off); read a step against its neighbours before calling it a flick.
