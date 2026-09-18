# Druid cat source and animation workflow

This asset uses the maintainer-provided `Druid_Cat_form` mesh and its packed
Tripo texture. The original mesh, UVs and texture are preserved. The editable
Blender file is delivered outside the repository; the game loads only
`public/models/creatures/druid_cat_form.glb`.

Author in Blender 5.1 with Rigify enabled, through Blender MCP. Save a separate
copy of the unrigged source before running the authoring modules. Add this
directory to Blender Python's module path, then run `rig.py`, `weights.py` and
`animate.py` in order. They save the current working copy. `rig.py` expects the
unrigged object named `Druid_Cat_form`; it deliberately refuses an existing rig.
To revise animation on the saved rig, reload `motion` and `poses`, then rerun
`animate.py`. Do not run `weights.py` against a posed rig.

The saved file opens in the original straight-legged neutral pose with no active
action. Choose an action in the Action Editor to preview it. Reset only animator
controls: Rigify's `MCH-front_foot_parent` bones contain generated heel corrections
that must remain intact. Clearing mechanism transforms bends the neutral legs.
These static corrections are also keyed in every action because Blender's glTF
exporter resets unkeyed pose transforms during sampling. The shipped asset is
the v15 compact export (the v14 animation revision with nine clips retired, see
below); the local asset and playback references are kept together for
verification.

The generated `DruidCat_Rig` has animal front/rear paw IK, shoulder, torso,
head, ear, jaw and tail controls. Select it and use the Action Editor to select
an action. Actions start at frame 1 at 30 fps. `DruidCat_Metarig` and
`DruidCat_WeightProxy` remain hidden as editable authoring sources. The proxy
solves disconnected UV-seam heat weighting without remeshing the visible cat.
All source vertices have at most four normalized skin influences. IK stretching
is disabled. Deformation bones use linear skinning so the Blender preview
matches glTF; the controls remain editable.

The 26 authored game actions are (the shipped GLB carries the 17 of the
compact set below):

| Group | Actions |
| --- | --- |
| Rest and movement | Idle, Idle_Look, CombatIdle, Walk, WalkBack, Run |
| Stealth | ProwlIdle, ProwlWalk |
| Air | Jump, Fall, Land |
| Combat | Attack_Left, Attack_Right, Bite, Pounce, Finisher, Hit_Left, Hit_Right |
| Rest and recovery | SitDown, Sit, Death, Rise |
| Water | Wade, Swim, SwimSurface, SwimIdle |

Locomotion and jumps are in place. The simulation owns movement and the jump
arc. Jump ends in a held, extended pose; Land starts from that pose and plays on
touchdown. Combat anticipation, strike and recovery are authored separately.
Pounce does not invent a movement mechanic for the existing stun ability.

## The compact 17-clip set

v15 retired nine clips to shrink the shipped file: Idle, CombatIdle, SwimIdle,
SwimSurface, Sit, SitDown, Rise, Wade and Hit_Right. Idle_Look is the idle,
Swim is the one water clip and Hit_Left the one flinch; combat idle, sitting,
wading and the flourish fall back to the base machine's idle / walk. The clip
map, the ship spec's keepClips, the asset and runtime pins and the acceptance
drive all name exactly these 17.

## Revision lineage and the stalk crouch

The shipped clips come from the Codex revision chain v3 to v11 over the same rig
(`exaggerated_motion.py` / `previous_motion.py` / `revision_motion.py`, built by
`build_revision.py` and measured by `measure_revision.py`, `check_acceptance.py`,
`check_paw_rotation.py`): v3 to v5 gave the gaits a restrained trunk and pelvis
motion, v4 to v11 re-authored the swipes (outward windup, inward wrist roll,
a small hind-leg rise) and the Finisher; v12 to v14 rebuilt the Run against a
gallop reference (restrained hind-leg travel, then a whole-body rise over planted
legs with high hindquarters, then a front-impact chest pitch). Paw trajectories
were kept, so the measured runtime references did not move. The chain never lowered the stalk,
so `prowl_crouch.py` is applied to the baked ProwlIdle / ProwlWalk actions
AFTER the revision build and BEFORE export: it sets the torso's mean height
to the crouch depth (through the paw IK, so the legs fold with the paws
planted) and pitches the neck and head. Set the rig object's scale to 1 before
exporting: the editable file carries a 1.5437 object scale that the glTF
exporter bakes into the mesh but not the bones.

Export from the reviewed scene using `export.export_cat(path)`, with `path`
pointing to `tmp/asset_src/druid_cat_form.glb` in the task checkout. The exporter
bakes evaluated deformation at 30 fps and flattens the 49 deformation joints.
Flattening is necessary because Rigify's stretched spine otherwise produces
parent shear that glTF local translation/rotation/scale cannot preserve in Sit.
No Rigify control, mechanism, widget or weight-proxy geometry is exported.

Then run the existing shipping pipeline:

```sh
node scripts/assets/build_assets.mjs scripts/assets/specs/druid_cat.json
node scripts/assets/compress_glb_textures.mjs public/models/creatures/druid_cat_form.glb
node scripts/build_media_manifest.mjs generate
npx vitest run tests/druid_cat_asset.test.ts tests/druid_cat_animation.test.ts
```

The texture step is `encode_ktx2.mjs` in this directory (needs Khronos `ktx`,
see `compress_glb_textures.mjs` for the install) rather than the shared
compressor: the shared script's Tripo rule picks UASTC, which costs 1.19 MB at
1024, while ETC1S holds the fur at 169 KB and keeps the whole 17-clip GLB at
888 KB. Never ship the intermediate webp-textured GLB or simplify this skinned
mesh.

At normalized height 1.92 (a fifth above the world wolves; measured at 1.1 and
scaled by 1.92/1.1), planted-paw measurements give Walk 2.78992, WalkBack
4.82101, Run 9.13075 and ProwlWalk 5.47846 game units/second. Wade is not in the
compact set, so it carries no reference: a fording cat walks at the dry refs.
Preview cycles are Walk 0.9 seconds, Run 0.6 seconds, and backward/prowl
1 second. The cat clamps against the shared rate ceilings with no per-rig
overrides: every shipped gait sits under them except Dash over a stalk
(7 x 0.95 x 1.5 = 9.975 units/second on the 5.47846 prowl ref is 1.82 against
the 1.8 prowl ceiling), a clip of about 1% that is not worth its own knob.
At 3 units/second Walk cycles about 1.19 times/second; Run at 7 cycles about 1.28.
The asset tests measure these
contacts from the compressed GLB and pin the runtime manifest to them. They
also check finite normalized rotations/weights, exact clip coverage, loop
closure and the Jump/Fall/Land pose boundary.

`review.review_cat(report_path)` checks every Blender action for finite skinning,
loop closure, original standing leg positions, neutral resets and attack chest
travel. `validate.validate_cat(raw_path, report_path)` also rejects an exporter
that alters the source neutral stance before comparing the imported skin.

The ability is Cat Form across gameplay content, tooltips, errors and the guide
(the ids stay `cat_form` and `form_cat`). Shaman Shadewolf retains
`wolf_basic.glb` through its separate `form_ghost_wolf` visual key.

Before accepting a new export, re-import it in Blender and compare representative
poses, then run `GAME_URL=http://127.0.0.1:5187 node scripts/druid_cat_game_check.mjs`
against a local Vite server. Inspect the resulting desktop/mobile screenshots
and playback evidence. Automated checks do not replace the maintainer's animation
review. No commit or push is part of this workflow.
