# Avian Strider Mount Handoff

Updated: 2026-08-14

This note is intentionally exhaustive. Read it before changing the asset or the
current worktree. The user and Codex developed the model, rig cleanup,
animations, and first in-game integration interactively. The mount is visually
close enough for live tuning, but the rider is not yet convincingly attached to
the animated saddle. That is the immediate problem to solve.

## Non-negotiable repository workflow

The user explicitly requires every applicable Markdown instruction file to be
treated as law. Before touching a directory, read the `CLAUDE.md` files at the
repository root and every parent level of that directory. Read
`CONTRIBUTING.md` before preparing a commit. Do not claim the mount is gated
from a focused test list. The real pre-merge gate is
`node scripts/gate_select.mjs`, or the deeper `npm run gate`, and it can take a
long time. The user does not want that full gate burned during visual iteration.

Do not hand-edit generated i18n or guide artifacts. Run their owning generators.
Do not grow `src/render/renderer.ts`; it is under the monolith ratchet. New
per-frame mount logic should live in a small module, with only coordinator glue
in `renderer.ts`.

No commit or push has been made for this mount. The current worktree is dirty
and contains the complete in-progress change.

## Worktree and branch

- Repository worktree: `/home/jbibbs/woc-worktrees/avian-mount`
- Windows-accessible path:
  `\\wsl.localhost\Ubuntu\home\jbibbs\woc-worktrees\avian-mount`
- Branch: `feature/avian-mount`
- Target project version: v0.38.0
- Do not work from `/home/jbibbs` as if it were the repository. Use the worktree.

Start by running:

```bash
cd /home/jbibbs/woc-worktrees/avian-mount
git status --short
git diff --stat
```

At handoff time there were 44 modified or untracked repo files. They include the
mount GLB, content wiring, icon, provenance mapping, generated i18n/guide/media
artifacts, tests, and the unfinished rider-anchor experiment. Preserve them.

## Blender installation and invocation

Blender is the Windows Blender 5.0 installation, invoked from WSL:

```text
/mnt/c/Program Files/Blender Foundation/Blender 5.0/blender.exe
```

Version check:

```bash
'/mnt/c/Program Files/Blender Foundation/Blender 5.0/blender.exe' --version
```

Background Python execution uses a Windows-readable UNC path for the script.
Example:

```bash
'/mnt/c/Program Files/Blender Foundation/Blender 5.0/blender.exe' \
  --background \
  --python '\\wsl.localhost\Ubuntu\home\jbibbs\avian-animation-working\build_avian_long_idle.py'
```

Codex usually generated or updated a `bpy` Python script, then ran Blender in
background mode. This is much more repeatable than editing hundreds of keys by
hand. The scripts inspect the actual rest pose and local bone axes, create or
replace Blender Actions, insert pose-bone quaternion/location keys, set
interpolation, configure frame ranges, preserve the other actions, save a new
`.blend`, and export a GLB. The source master was never overwritten.

For interactive review, open this approved latest working file in Blender:

```text
E:\avianmount-animation-test-long-idle-v9.blend
```

Equivalent WSL path:

```text
/mnt/e/avianmount-animation-test-long-idle-v9.blend
```

In Blender, select the armature, switch to the Animation workspace, change the
Dope Sheet editor to Action Editor, and choose `Idle`, `Run`, `WalkBackward`, or
`Jump`. For the one-second clips, preview frames 1 through 24. Frame 25 is the
duplicate seam pose and should not be included as an extra playback frame in a
24 fps preview. Use Material Preview to see textures while posing.

## Persistent animation scripts

The durable authoring scripts are here:

```text
/home/jbibbs/avian-animation-working/
```

Files:

- `build_avian_forward_run.py`: the iterated forward run authoring logic.
- `build_walk_backward_final.py`: the accepted reverse gait and head look-back.
- `build_backward_gait_reference.py`: earlier gait source and useful bone logic.
- `build_avian_jump.py`: the accepted stylized bird-hop jump.
- `build_avian_long_idle.py`: current 20-second v9 idle authoring.
- `export_avian_long_idle_v9.py`: exports the approved v9 blend to GLB.
- `inspect_avian_long_idle.py`: action inspection helper.
- `BACKWARD_GAIT_NOTES.md`: notes from the gait work.

Some earlier one-off versions also exist under `/tmp`, but the persistent
directory above is the source to continue from. Do not casually rerun an older
script against the approved v9 blend without checking its input and output
constants first.

## Asset lineage

All of these are on `E:` and should be preserved:

1. `/mnt/e/avianmount.glb`
   - Original approved textured static model.
   - Never overwrite it.
2. `/mnt/e/avianmount-sanitized.glb`
   - Minimum sanitation of the original after Khronos validation/import
     diagnosis.
   - This copy passed Tripo's free rig-check.
3. `/mnt/e/avianmount-avian-rigged.glb`
   - Tripo v3 Auto Rig result, forced to `rig_type: avian`.
   - 53-joint Tripo skeleton.
4. `/mnt/e/avianmount-avian-rigged-clean.glb`
   - Cleaned rigged master.
   - Blender cleanup removed wing-chain influence from tack and narrowed
     `bone_18` contamination while preserving geometry, topology, UVs,
     materials, textures, hierarchy, bind pose, and bone locations.
5. `/mnt/e/avianmount-animation-test.blend` and `.glb`
   - Earlier accepted short-animation working set.
6. `/mnt/e/avianmount-animation-test-long-idle-v2.blend` through `v9.blend`
   - Iterative long-idle backups.
7. `/mnt/e/avianmount-animation-test-long-idle-v9.blend` and `.glb`
   - Current approved authoring file and exported source used for shipping.

The shipped repo asset is:

```text
/home/jbibbs/woc-worktrees/avian-mount/public/models/mounts/avian_strider.glb
```

It was built from the v9 exported GLB through the repository asset pipeline and
KTX2 texture compression. It is approximately 2.74 MiB and carries meshopt plus
ETC1S/KTX2 textures.

## Tripo work already completed

The Tripo API key is in a gitignored `.env`. Never print, log, expose, or modify
it. Do not call Tripo again unless the user explicitly asks, because rigging
spends credits.

Work already performed with the official current v3 API:

- File Upload API for the sanitized GLB.
- Free `/v3/animations/rig-check` polling.
- Rig-check returned `riggable: true`, recommended `biped`.
- Paid Auto Rig was deliberately forced to:
  - `model: v2.5-20260210`
  - `rig_type: avian`
  - `spec: tripo`
  - `out_format: glb`
- The result was downloaded and Khronos-validated.
- No Tripo animation generation was used. All animation work was local Blender
  Python.

Useful historical API/validation scripts remain under `/tmp`:

- `/tmp/avian_rig_check.mjs`
- `/tmp/check_sanitized_avian.mjs`
- `/tmp/rig_sanitized_avian.mjs`
- `/tmp/validate_clean_avian.mjs`
- `/tmp/verify_avian_glb_delta.mjs`
- `/tmp/capture_avian_bind.mjs`
- `/tmp/capture_avian_poses.mjs`

Do not rerun paid scripts merely to inspect metadata.

## Rig inspection and weight cleanup

Diagnostics are under:

```text
/mnt/e/avian-rig-diagnostics/
```

Important reports include:

- `blender-inspection.json`
- `bone-weight-report.json`
- `weight-cleanup-report.json`
- `after/khronos-validation.json`
- `after/pose-deformation-report.json`
- `animation/bone-axis-audit.json`
- `animation/forward-run-authoring-report.json`
- `animation/jump-authoring-report.json`
- `animation/long-idle-v9-authoring-report.json`
- `animation/master-preservation-check.json`

The forced avian rig was judged usable after targeted cleanup. Both legs,
neck/head, wings, and tail have useful controls. The tack previously inherited
bad wing weights and `bone_18` was too broad. Those known defects were cleaned.
The reins were acceptable and deliberately left alone. The glTF warning
`NODE_SKINNED_MESH_NON_ROOT` was left unchanged; the agreed integration plan
was to handle overall placement and scaling with an outer Three.js Group unless
it becomes a real runtime problem.

## Animation set and collaborative decisions

The current exported GLB contains exactly these named clips:

- `Idle`: 20 seconds.
- `Run`: 1 second.
- `WalkBackward`: 1 second.
- `Jump`: 1 second.

The project runs at 24 fps for authoring. The one-second clips use 24 unique
frames. Avoid previewing the duplicated seam frame as an extra 25th frame.

### Run

The user wanted a mount gait, not a humanoid walk. The run was iterated against
`E:\ostrich stride...` and `E:\ostrichstride2.png` references. Changes made
together included:

- Stronger forward/back leg travel.
- Real knee folding and extension.
- Ankle and toe articulation rather than rigid feet.
- Toe-driven contact and push-off, avoiding heel-first motion that made the
  creature read as moving backward.
- More upright, narrower front-view stance, closer to `| |` than `/ \\`.
- Body rise/fall and a heavy, slightly stompy pulse.
- Neck/head counter-motion, then a whole-neck forward/down extension closer to
  the shoulders.
- Tail-feather downward response on heavy contacts.
- Mild folded-wing balance motion.
- The heavier left landing around frame 15 was reduced.

The authored forward clip is intentionally mapped to both game `walk` and
`run`, because this mount only runs forward. Its in-game playback was recently
made about 20 percent faster by changing `runRef` from 12.6 to 10.5.

### WalkBackward

An attempted forward gait looked so convincingly backward that the user chose
to preserve it as the reverse animation. It received a deliberate head turn to
look behind the bird and was accepted as golden. Preserve its upper-body
language.

Its in-game playback was just changed to 25 percent slower. Because runtime
time scale is `speed / walkRef`, `walkRef` changed from 4.5 to 6.0, which yields
75 percent of the previous cadence.

### Jump

The accepted jump is a stylized powerful flightless-bird hop:

- Crouched anticipation with a narrower stance.
- Near-simultaneous toe-driven launch.
- Legs tucked rather than a horse/deer hurdle split.
- Two wing beats, one around takeoff and one in the airborne/apex region.
- A single quick squat only on the second flap where requested.
- Head and whole neck tilt/reach upward for the leap, sustained slightly longer
  after review.
- Partial wing hold around apex.
- Landing preparation with feet down/forward.
- Cushioned landing, small pelvis roll, neck dip, and tail response.
- Body pitch kept modest to protect rider readability.

### Idle v9

The short idle looked too repetitive, so it became a 20-second ambient loop.
The user approved v9. It includes:

- Continuous subtle breathing/body life between events, not a statue.
- Calm periods long enough that gestures do not immediately repeat.
- A dramatic, quick right-foot lift and stamp.
- The lifted foot points its toes down naturally.
- A quick supporting/toe response in the other foot.
- Body weight transfer associated with the foot event.
- Faster, larger, birdlike head checks rather than slow mammalian turns.
- A fast double-tap wing flick.
- Tail response during the wing event.
- One quick squat on the second wing flap only.

The prior versions remain as backups if v9 needs comparison.

## In-game content and render integration

Key repo additions/modifications include:

- `public/models/mounts/avian_strider.glb`
- `public/ui/items/reins_avian_strider.webp`
- `public/ui/items/mapping.json`
- `scripts/assets/specs/avian_strider.json`
- `src/sim/content/items.ts`
- `src/sim/content/mounts.ts`
- `src/sim/content/reliquary.ts`
- `src/render/characters/manifest.ts`
- `src/render/mount_visuals.ts`
- `src/ui/mount_labels.ts`
- English i18n catalog changes and generated outputs
- guide/wiki generated content
- media manifest generated content
- focused content, Reliquary, profile, SFX, clip-map, and mount-visual tests

Current important render values:

```text
Visual key: mount_avian_strider
Mount key: avian_strider
Normalized height: 4.32
Yaw: Math.PI / 2
Seat height: 2.62
Seat forward offset: 0.32
walkRef: 6.0
runRef: 10.5
Idle clip: Idle
Forward walk clip: Run
Forward run clip: Run
Reverse clip: WalkBackward
Jump clip: Jump
```

The model was first tried at height 3.6, then enlarged by 20 percent to 4.32
because the player looked oversized. The rider was moved forward to stop them
from sitting over the tail. The rider height was later lowered from 2.82 to
2.62 because the static fit looked above the saddle.

The washed-out in-game appearance was associated with lighting/material and
possibly low-detail presentation. No broad texture repaint was performed during
the final animation phase.

There is currently no authored audio integration for this mount. The user may
hand sound and final PR work to another session after motion and rider fit are
solid.

## Asset build and validation commands used

From the worktree:

```bash
node scripts/assets/build_assets.mjs scripts/assets/specs/avian_strider.json
```

Mandatory texture compression was run with the local KTX toolchain:

```bash
PATH=/home/jbibbs/.local/ktx-4.4.2/bin:$PATH \
  node scripts/assets/compress_glb_textures.mjs \
  --dir public/models/mounts \
  --jobs 1
```

Media manifest generation was also run through the repository's owning script.
Inspect `package.json` and current generated-file instructions before repeating
it.

Focused checks used during iteration:

```bash
npx vitest run tests/mount_visuals.test.ts
npx vitest run tests/character_anim_state.test.ts
npx vitest run tests/character_clipmaps.test.ts
npx vitest run tests/glb_texture_compression.test.ts
npx vitest run tests/render_glb_replacement_assets.test.ts
npx tsc --noEmit
```

The latest local check after the socket experiment was:

```text
3 focused files passed
65 tests passed
TypeScript passed
```

This is not the real gate and must not be described as one.

Khronos glTF Validator was used as the source of truth for GLB validity. glTF
Transform and local Node scripts were used to inspect structure and sanitize or
compress assets without remeshing, decimating, retopologizing, or changing the
approved geometry. Blender background scripts were used for rig inspection,
weight edits, diagnostic poses, Actions, `.blend` saves, and GLB exports.
Playwright/Puppeteer scripts were used earlier for game and diagnostic captures,
but the user intentionally stopped screenshot iteration near the end to conserve
compute. Prefer live in-game review now.

## Dev server

At handoff, a Vite process was started in the worktree with:

```bash
npm run dev -- --host 0.0.0.0 --port 5191
```

Port 5191 was already occupied, so that process selected:

```text
http://localhost:5192
```

Do not assume it will survive session handoff. Check the port, stop only a
confirmed stale process, and start one clean instance. The repeated changing
ports earlier came from starting new Vite processes without owning the older
process.

## Immediate blocker: rider does not follow the saddle

This is the current problem. The mount and player are siblings under the same
entity group. The bird's skeleton animates inside `mountVisual.root`, while the
player root is placed at one static mount-relative coordinate. Therefore the
saddle/body can breathe, crouch, stamp, run, and jump underneath a player who
appears to float.

Current placement path:

- `src/render/renderer.ts` sets `v.visual.root.position`.
- `src/render/mount_visuals.ts` owns the static `seat` and `seatFwd` values.
- `CharacterVisual.update()` advances the mount mixer and bones independently.

### The last attempted fix and why it apparently did nothing

The worktree currently contains an unfinished virtual-anchor experiment:

- New `src/render/characters/bone_motion_anchor.ts`.
- `CharacterVisual.createBoneMotionAnchor()` in
  `src/render/characters/visual.ts`.
- `riderBone: 'tripo::Spine_0'` for the avian in
  `src/render/mount_visuals.ts`.
- `EntityView.mountRiderAnchor` and per-frame sampling in
  `src/render/renderer.ts`.
- New `tests/bone_motion_anchor.test.ts`.

The code captures the rest position of the `Spine_0` bone origin, then adds the
animated displacement of that origin to the static seat coordinates. The test
proves translation and ancestor-scale behavior.

The user reports that this had no visible effect. The likely reason is precise:
most relevant animation is bone rotation, and rotating a bone does not move the
bone's own origin. Sampling `(0, 0, 0)` at `Spine_0` cannot follow a saddle point
that sits some distance away from the bone origin. It also follows no animated
orientation. The code is structurally useful but samples the wrong point.

Do not tell the user the socket works until verified visually in game.

### Recommended solution

There are two good approaches. Prefer the first if it can be implemented and
validated cleanly without changing the approved skeleton contract.

#### Approach A: runtime virtual saddle point with a bone-local offset

1. Determine which existing bone actually carries the saddle/tack most
   convincingly. Candidates are `tripo::Spine_0` and `bone_52`; consult the
   weight reports and inspect both under Run, Idle, and Jump.
2. At rest, define the desired saddle point in `mountVisual.root` space using
   the approved static seat point `(x=0, y=2.62, z=0.32)`.
3. Transform that rest saddle point into the chosen bone's local space. This is
   the crucial missing step.
4. Each frame after `mountVisual.update()`, transform that nonzero bone-local
   saddle point back into mount-root space.
5. Place the rider at that sampled point. Do not add the bone-origin delta to
   the seat a second time if the sampled point is already absolute root-local.
6. Sample the bone's relative orientation too. Apply yaw if useful and only a
   restrained, damped fraction of pitch/roll. Clamp it so the rider follows
   heavy motion without whipping or leaning like a rigid statue glued to the
   bird.
7. Ensure dismount and non-avian mounts restore rider root position and
   rotation exactly.
8. Keep all scratch vectors, matrices, quaternions, and Euler objects retained.
   Do not allocate in the frame loop.

The existing `BoneMotionAnchor` can be evolved to accept a local point:

```ts
new BoneMotionAnchor(visualRoot, bone, boneLocalSeatPoint)
```

Its sampler should use something equivalent to:

```ts
target.copy(boneLocalSeatPoint);
bone.localToWorld(target);
visualRoot.worldToLocal(target);
```

Capture the rest orientation and compute the current delta in visual-root
space. Do not directly copy a Tripo bone quaternion onto the humanoid rider;
the bone's bind axes are not rider axes.

This approach avoids changing the GLB and means all four clips automatically
carry the rider.

#### Approach B: author a real Socket_Rider child in Blender

1. Open the v9 blend.
2. Inspect which torso/stabilizer bone follows the cleaned saddle weights.
3. Add a non-deforming child bone named `Socket_Rider` at the exact saddle
   anchor and orient it in the mount's intended forward/up frame.
4. Do not change parent bones, bind pose, skin weights, or existing animation
   keys.
5. Export a new candidate GLB, run Khronos validation, run the asset pipeline
   and KTX2 compression, and pin the node name in the asset contract test.
6. Runtime-sample that explicit socket after mixer update.

This is more artist-friendly and supplies a clean orientation, but it changes
the shipped skeleton/node contract and requires a full asset rebuild. Keep it
only if the virtual point on an existing bone cannot be made stable.

### Additional rider-anchor concerns Claude should verify

- The saddle/tack is skinned across torso/stabilizer influences. One bone may
  not exactly match its visual center during all clips. Compare `Spine_0` and
  `bone_52`; a weighted blend of two anchors is possible but should be a last
  resort.
- `modelWrap` applies normalization scale, y offset, and `Math.PI / 2` yaw. Any
  anchor calculation must include that wrapper exactly once.
- `v.group.scale` carries entity scale. Keeping rider and mount under the same
  entity group should prevent double scaling.
- The mount mixer can update at reduced crowd cadence for remote players. The
  anchor should sample the same resulting bone matrices, not run a second
  animation clock.
- The local player and actionable poses animate every frame. Remote riders may
  legitimately update at their mount's LOD cadence.
- The player's seated Action remains independent. The goal is to move the
  player's root with the saddle, not to keyframe the humanoid per mount frame.
- Nameplate/click-proxy height uses `mountLift`. If the rider receives animated
  vertical displacement, decide whether overhead UI should follow that small
  delta or retain the stable static lift. Stable UI is probably preferable.
- Avoid inheriting large neck or leg motion. Anchor to the saddle-bearing torso.
- Test Idle, Run, WalkBackward, Jump, landing, mount summon, live mount swap,
  dismount, and far-LOD transitions.

## Recommended next-session order

1. Read all applicable `CLAUDE.md` files and this handoff.
2. Inspect `git status` and preserve the existing dirty worktree.
3. Open v9 in Blender and identify whether `Spine_0` or `bone_52` best follows
   the saddle center across all four Actions.
4. Repair the virtual anchor to sample a nonzero saddle point, or add an
   explicit socket only if justified.
5. Run focused unit tests and `npx tsc --noEmit`.
6. Start one clean Vite server and have the user inspect live in game. Do not
   burn screenshot analysis unless a geometry-space problem cannot be reasoned
   about otherwise.
7. Tune static seat/Fwd and rotation damping by eye only after the rider visibly
   follows the saddle.
8. Feel out Run and WalkBackward speeds in game. Current values are 10.5 and
   6.0, respectively.
9. Evaluate Jump in game. The rider should follow the jump pose without violent
   pitch or clipping.
10. Add audio only after the physical illusion is approved, unless the user
    explicitly changes priorities.
11. Review all content, provenance, generated-file obligations, and shared-file
    changes.
12. Run the real gate only when the user is ready for the long QA phase.
13. Prepare a conventional commit with a body and a complete PR handoff. Do not
    claim hand-picked tests equal the gate.

## Final status in plain language

The bird model, forced avian rig, targeted skin-weight cleanup, four authored
animation clips, long idle, icon, mount/item content, and first game wiring are
all present. The user likes the animations enough to proceed. Forward and
reverse playback have initial in-game tuning. Static rider scale and
forward/vertical placement have been adjusted.

The major unresolved visual defect is that the rider still appears to float
while the animated saddle moves. The first runtime socket attempt exists in the
worktree but samples a rotating bone's origin, so it is not sufficient. Fix the
socket to track a real saddle point and restrained orientation, verify it live,
then finish polish, audio, full QA, and PR preparation.
