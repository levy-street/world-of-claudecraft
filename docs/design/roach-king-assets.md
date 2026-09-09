# Roach King asset authoring

Four original creature bodies were generated from single-subject references derived
from the supplied Asmon / Roach King concept. Tripo model `P2-20260801`
produced every mesh; Tripo supplied the bind rigs. Blender 5.2 LTS authored all
40 animation clips locally, plus the hermit's crooked amethyst broomstaff and
the tribute beetle's missing middle-right leg chain and skin weights.

`scripts/assets/specs/roach_king.provenance.json` records the generation and rig
task IDs, source hashes, final asset hashes, skeleton/clip inventory, and the
pipeline QA scorecards. It contains no credentials or expiring download URLs.
The four generation jobs used 540 Tripo credits, priced by the pipeline at $5.40.
Built-in reference image generation did not return priced usage and is excluded.

## Art and motion

- `asmon_hermit`: gaunt long-haired bearded recluse, thorn crown, ragged shorts,
  bare feet, junk-filled belt and crooked staff. Hunched breathing, small head
  twitches, asymmetric gestures, staff-led attacks and a curled coronation pose.
- `roach_king`: crowned black and bronze six-legged sovereign, purple eyes,
  layered carapace and long antennae. Tripod gait, shell breathing, antenna and
  mandible movement, rearing decrees, spit, ground slam and collapse.
- `roachling`: small brown striped royal pest with quick alternating leg work,
  antenna motion, lunges and a separate death pose.
- `garbage_beetle`: squat tribute carrier with discarded cups, papers and bottles
  on its back. Heavy six-legged gait, shell bob and distinct cast/attack motions.

Every body has Idle, Walk, Run, Attack, Hit, Death, Cast and Jump. Both boss forms
also have Transform, Decree, Spit and Stomp. Idle/Walk/Run loop endpoints match;
the exported animation values were checked for non-finite samples. Locomotion
stays in place so simulation movement owns world travel.

## Reproduce locally

Source references, raw meshes, bind rigs, editable `.blend` masters and preview
frames remain under `tmp/asset_pipeline/roach_<name>_p2/`. Raw authoring sources
are intentionally local; only optimized shipping assets enter `public/`.

For each of `asmon_hermit`, `roach_king`, `roachling`, and `garbage_beetle`:

```sh
node --env-file=<private-env-file> scripts/roach_king_assets.mjs <name> <concept.png>
blender --background --factory-startup --python-exit-code 1 --python scripts/assets/animate_roach_king.py -- <name>
node scripts/asset_pipeline/pipeline.mjs preview --file tmp/asset_pipeline/roach_<name>_p2/<name>_blender.glb --out tmp/asset_pipeline/roach_<name>_p2/preview
```

The generation runner stores paid task IDs before polling. Resume the same job
after an observation timeout; do not create a new job to retry an existing task.

```sh
node scripts/assets/build_assets.mjs scripts/assets/specs/roach_king.json --output-root tmp/roach_king_candidate
node scripts/assets/compress_glb_textures.mjs --dir tmp/roach_king_candidate/models/creatures --jobs 2
```

The final compression needs Khronos `ktx` on PATH or its directory in `KTX_BIN`.
Copy each candidate to its job's `<name>.glb`, then run the owning QA command:

```sh
node --env-file=<private-env-file> scripts/asset_pipeline/pipeline.mjs qa --job roach_<name>_p2
```

Review the hero, every animation preview and the in-game model before copying
the candidate into `public/models/creatures/`. Rebuild the media manifest and
portrait receipts through their existing generators. Refresh the provenance
record after any asset revision; source screenshots alone do not prove the
compressed shipping output renders correctly.

Both adds pass the category asset checks. The boss forms intentionally retain
1024-pixel textures for readable close-up detail; this produces category-norm
warnings, within the 1024 hard cap. The crowned body also exceeds the generic
1536 KB category norm at about 1.8 MB. All embedded textures remain KTX2 and all four
models use meshopt geometry compression.

## Animation revision 2

The king's donor rig blended distal feet with other legs and antennae. Authoring
now assigns each distal foot to its nearest leg chain, removes unrelated
appendage influences, and preserves the joint blends within that chain. Shell
vertices formerly attached to the stationary root follow the thorax. Death rolls
the complete skeleton and tilts the crowned head up as the abdomen lands,
before matching the normalized idle floor. Shell-only contact excludes the head
and crown, which otherwise prop the body up. No body scaling fakes the collapse.

Frame-zero authoring removes the repeated stationary sample at loop boundaries
without changing the existing clip durations. Motion uses quintic easing for anticipation and recovery, eased foot lifts,
smaller idle leg adjustments, and a slower, tapered coronation tremor. Asmon's
cast and hit poses return to the same hunched base pose, with coordinated hip
sway during locomotion. These local revisions incur no additional generation
cost; the recorded original cost remains $1.35 per model.
