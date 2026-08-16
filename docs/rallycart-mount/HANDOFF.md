# Rallycart RXT: full handoff

Written 2026-08-16. This is the authoritative pickup document. It assumes you
are starting cold.

Everything you need is in this folder, `docs/rallycart-mount/`. Start at
`README.md` for the map. Companion documents, all worth reading:

- `WIRING_AND_AUDIO.md` (same directory): the wiring table, the tuned numbers,
  and the audio design in more detail. Everything there is still current.
- `tooling/avian-mount-handoff.md`: **read this for TOOLING.** It is the
  most complete account of the Tripo to Blender to glTF pipeline, how to drive
  Windows Blender from WSL, and the repository workflow rules. The Rallycart was
  built with the same toolchain and the same conventions.
- `tooling/avian-mount-handoff-session2.md`: the environment traps
  (orphaned Vite servers, ports, rebase discipline) that will otherwise waste
  your time.

Both tooling documents are copies. The originals live at
`/home/jbibbs/avian-mount-handoff.md` and `-session2.md` and are outside the
repo, so they would not survive a clone.

---

## 1. One-line status

The mount is modelled, rigged, animated, exported, wired, audible,
terrain-reactive, steers, squats on landing, spins its wheels off the ground,
pivots on the spot, smokes from four pipes and has lit headlights. It plays.
**The gate has never run.** The work is committed (`2c0f0e1cb5`) but not pushed.
Jamie is considering re-ripping the model from Tripo because parts of the mesh
are sloppy; section 9 covers exactly what that costs.

---

## 1b. What happened in the session after this document was written

Read this before section 8: it is all new since the original handoff, and
several items changed how earlier sections read.

**Built, all verified by tests, none of it seen in a gate run:**

1. **Front wheel steering** with the lock MEASURED off the mesh, not chosen.
   New pure core `vehicle_steering_core.ts`. Measured +25.3/-13.5 degrees for
   the pair, applied at 0.85 of that. Section 8.
2. **Landing squat.** Second-order under-damped spring that carries each wheel
   from its airborne droop up through neutral and into the arch. The first
   version was invisible for a specific reason worth reading. Section 8.
3. **Jump and landing SFX**, nine takes from `E:\finals`, self-selecting per
   mount. One take was 9 dB hot and was attenuated in the file, since the gain
   map is per key and cannot fix one variant. The whole cue then went up 50%.
   Section 8.
4. **Airborne engine pitch bend fixed.** It had never been audible: the table
   was right and the renderer never called it. Trap 8 in section 10.
5. **Rear wheel pivot spin and airborne traction break.** Section 8.
6. **Pivot pitch bend**: turning on the spot takes the reverse lift.
7. **Exhaust VFX** from the four tailpipes, with a launch flame pinned to the
   0.6s transient inside the windup take, on the audio clock. Section 8.
8. **Headlights**: four spheres in the four lamp circles. Section 8.

**Also done to this documentation itself:** it moved from the repo root into
`docs/rallycart-mount/`, gained a README, and gained `reference/`, which holds
the borrowed code from the five unmerged mount branches so a reader can follow
a reference without checking out four more branches. `refresh_reference.sh`
rebuilds it.

**Committed 2026-08-16** as `2c0f0e1cb5`, the branch's first commit: 91 files, the
whole feature as one unit, since splitting it would have produced intermediate
commits that do not typecheck. Verified immediately before committing: tsc
clean, 229 tests green. Not pushed.

**In flight when the session ended:** nothing half-built. The last thing
discussed and NOT done was giving the headlights real illumination via two
`NightLightSite` entries, and adding an in-game UI-hide toggle for recording
(there is none today; the console snippet in section 11 is the workaround).

**Where Jamie's attention is:** he is looking at the mount in motion and tuning
by eye and ear. Expect requests of the form "that reads wrong, here is what I
see". The VFX densities, the flame size, the per-pipe weights and the headlight
brightness are all guesses that have not been through a full pass on screen.

---

## 1c. Session 3: tail light lens and engine audio fixes

### Committed and pushed

- `96ebbd2fea`, tagged **`rallycart-v1`**: the mount through the headlights,
  no tail light work. **This is the fallback if the lens is abandoned.**
- `b0ed7164a6`: three audio fixes, all found by ear in game.

### Audio, all live

1. **Engine transitions follow the car.** The windup and winddown are
   one-shots, so unlike the loops they were never repositioned and stayed where
   the throttle was pressed. `Sfx.moveKeyedVoice` now moves the keyed voice's
   panner every frame; both transitions share one voice key, so one call covers
   them. **No test yet, and this bug class will recur on the next moving
   one-shot: worth pinning.**
2. **The summon click.** The idle used to start on the exact sample the summon
   take ended, and that take does not decay (its last 120ms peaks near
   -15 dBFS). Two discontinuities on one boundary. Now the summon gets a 0.2s
   release and the idle leads in 0.45s under its tail. The underlying asset
   still ends hot; the release is a runtime patch over that, and re-exporting
   the take with a real tail would make it redundant.
3. **`MOUNT_LAND_BOOST` 1.5 -> 1.125.** Mount landing only; jump and the
   rider's own landing untouched.

### The tail light lens: NOT committed, and the state to resume from

Built in Blender, `E:\rallycart_work\scripts\19_taillight_lens.py`, output
`E:\rallycart_work\rallycart-lens.glb`. The repo copy of the model is back to
v1; drop that GLB over `public/models/mounts/rallycart_rxt.glb` to see it. It is
**uncompressed and must not be committed** until it goes through the KTX2 pass.

**Why geometry at all.** The tail lights are PAINT, not geometry. The rear panel
is a continuous smooth curve with no moulded recess (proved by a scanline: z
falls monotonically, no step in and back out), and Tripo shattered the lamp's
UVs into dozens of tiny islands, so the painted boundary is a run of island
seams. Four runtime overlay attempts all failed on that. Real geometry in front,
opaque and emissive, covers it instead of blending with it.

**What the script does, in order.** A companion Node script rasterizes the rear
of the car from the mesh and its texture, classifies the housing, and writes
`reports/taillight_outline.json`. Blender then fits the lens and exports.

**Five things that were each wrong once, and are the traps:**

| trap | symptom | fix |
|---|---|---|
| `matrix_parent_inverse` | lenses floating in space | glTF has no parent-inverse; author in CHASSIS LOCAL space with an identity inverse |
| height field over (x,y) | a piece hanging off the side | the lamp wraps **81 degrees** around the corner; parameterize AROUND it, as angle about a vertical axis inset 85mm, plus height |
| offset along +Y | paint z-fighting through the lens | offset along the SURFACE NORMAL, or the wrap never clears |
| sparse sampling | jagged spiky blob | the outline needs the same density the flat mask had: sample triangle interiors on a barycentric grid (~18k samples), not the ~700 vertices |
| fitting the red PAINT | lens too small, wrong shape | fit the HOUSING (paint plus the dark surround that hugs it, bounded by proximity), and fit a **rounded rectangle**, which is what the part actually is |

That last row is the important one. Fitting a free-form outline to ragged
artwork forced a choice between jagged and blobby; fitting the FORM and taking
only its extents from the data removes the tradeoff entirely.

**Knobs**, all at the top of the script and now independent:
`CORNER_FRAC` roundness, `GROW` overhang into the housing border, `PROUD`
sit-on-top vs clipping, `AXIS_INSET`, `EXTENT_PERCENTILE`.

**Where it was left:** the rounded-rectangle fit had just gone in and Jamie had
not yet seen it. Verify `raysMissed: 0` in the script's report; anything above
zero means vertices fell back to the flat plane and will hang in space.

**Not done:** the twin-lens divider (dropped while fixing the floating and never
restored), reverse white lights (this lens is the natural place: it is a
material we own), and headlights could use the same treatment to retire the four
hand-tuned bowl positions.

### The WRX-2 retexture, parked

`E:\WRX-2-keeper.glb` is the same model retextured with Pack UV on: 42 parts
still separate, 42 materials collapsed to 1, and **geometrically identical to v1
(all 42 parts match within 0.0001)**. So the rig transfers and every measured
constant stays valid. Its texture is 8192x8192 and must come down to 2k;
`E:\rallycart_work\WRX-2-keeper-2k.glb` is a repacked 2k preview. Pack UV
unified the file but NOT the unwrap, so the lamp is still many small islands.

---

## 2. Repository workflow, treat as law

- Read the root `CLAUDE.md` and every `CLAUDE.md` on the path to any directory
  you touch, before touching it. Read `CONTRIBUTING.md` before committing.
- The real pre-merge gate is `node scripts/gate_select.mjs` (or the deeper
  `npm run gate`). **Do not claim the change is gated from a focused test list.**
  Neither has been run on this branch yet.
- `src/render/renderer.ts` is under the monolith ratchet
  (`tests/monolith_budget.test.ts`). Never grow it. New per-frame mount logic
  goes in its own module with only coordinator glue in the renderer. If you must
  add lines, pay them back by extraction and LOWER the ceiling in the same
  change. Raising the ceiling is a maintainer decision, not yours.
- No em dashes, en dashes, or emojis anywhere: code, comments, docs, commits, PR
  text. This is enforced by a `Stop` hook.
- Do not hand-edit generated artifacts (`*.generated.ts`, resolved i18n, the SFX
  manifest). Run the owning generator.
- A new pure `*_core.ts` under `src/render/` MUST be registered in
  `RENDER_PURE_CORES` in `tests/architecture.test.ts` or the guard fails.

---

## 3. Where the work is

- Worktree: `/home/jbibbs/woc-worktrees/rallycart-mount`
  (Windows: `\\wsl.localhost\Ubuntu\home\jbibbs\woc-worktrees\rallycart-mount`)
- Branch: `feature/rallycart-mount`
- **Based on `feature/goblin-rocket-sled`, NOT on a release branch.** This is
  deliberate and load-bearing: the interruptible forward/reverse engine audio
  machinery (`interruptible` in `src/game/sfx.ts`,
  `advanceInterruptibleMountEngine`, the airborne pitch bend) exists ONLY on the
  sled branch. Release v0.39.0 has none of it. **Any PR here depends on the sled
  landing first.** Do not rebase onto a release branch expecting it to work.
- Team policy: **never rebase, use `git merge`** to bring a release branch into a
  feature branch. Rebasing was causing release problems (announced 2026-08-11).
- Dev server: `npm run dev -- --host 0.0.0.0 --port 5200`. Offline play only, no
  game server or Postgres needed. Kill stray Vite processes before starting a new
  one; orphans are the cause of the "ports keep changing" symptom.
- Blender source of truth: `E:\rallycart_work\` (scripts, reports, checkpoint
  `.blend` files).
- Original mesh: `E:\Rallycart+RXT.glb`, md5 `629d67fe5752bffb48c70e2b0bd4ad27`.
  **NEVER modify or overwrite the original.**

Get it in game: `/dev mounts` in chat (dev commands are on automatically under
Vite), then use the ignition key from your bags. Riding is a trained skill, so
grant it in dev if the mount will not summon. Summoning is a CHANNEL; the mount
appears on the completion edge.

---

## 4. Tooling and how to drive it

Full detail is in `tooling/avian-mount-handoff.md`. The short version:

- Blender is the **Windows** build, driven headless from WSL:
  `blender.exe --background --python <windows-path-to-script>`, with script
  arguments after a bare `--`.
- Scripts live in `E:\rallycart_work\` and are numbered in execution order
  (`03_build_rig.py`, `04_build_clips.py`, `05_verify.py`, `12_rider_fit.py`,
  `13_clearance.py`, `15_seat_solve.py`, `16_export.py`, `18_seat_surface.py`).
  Checkpoint `.blend` files sit alongside them so a phase can be re-run without
  redoing the earlier ones.
- Export is glTF with animation mode **`NLA_TRACKS`**. Clips are per-object
  actions pushed into NLA tracks named for the clip; tracks sharing a name merge
  into one animation. This is how four named clips come out of a rigid node rig.
- After export, the GLB is KTX2-compressed by the repo's own asset tooling before
  landing in `public/models/mounts/`. Current file is 1.7 MB.
- Validate with the glTF validator. The current export is **0 errors, 0
  warnings**; the single `NODE_EMPTY` info on `rider_anchor` is correct for a
  socket node.
- Useful trick used repeatedly this session: the GLB's JSON chunk can be read
  directly from Node for structural checks (node tree, animation channels,
  accessor bounds) without loading Three. **Honor `byteStride`** when reading
  vertex data; the buffers here are interleaved at stride 32, and ignoring it
  silently yields normals instead of positions.

---

### Repo skills that cover this work

The worktree ships skills under `.claude/skills/`. Prefer these over improvising:

- **`asset-pipeline`**: the Tripo API asset generation loop. **This is the one to
  use if the model is re-ripped.** It drives generation, preview review,
  orientation fixes, registry wiring and the guard tests.
- **`blender-anim-pipeline`**: authoring GLB animation clips for repo rigs
  without inventing a new dispatch mechanism. Use it before adding a clip.
- **`extract-and-test`**: the module-first and test-first bug-fix workflow. This
  is the discipline the suspension work followed.
- **`qa`**: the end-of-contribution gate. Run it over the diff before claiming
  done.
- **`pr-screenshots`**: required, since this change is visual.
- **`ci-triage`**, **`review-pr`**, **`file-issue`** as needed.

## 5. The rig contract

**This is the part that matters most, because the runtime keys off it.** If the
model is re-ripped, reproduce this exactly and nothing in `src/` needs to change.

```
root
  Chassis                      [the body mesh, 38 primitives]
    rider_anchor               [empty; the seat socket]
    Susp_FL / Susp_FR          [per-corner suspension travel nodes]
      Steer_FL / Steer_FR      [steering nodes, driven at runtime, no clip]
        Wheel_FL / Wheel_FR    [spinning wheel meshes]
    Susp_RL / Susp_RR
      Wheel_RL / Wheel_RR
```

13 nodes, 5 meshes, **`skins: 0`**. A car is rigid parts, so there is no skinning
at all. Precedent: `terrorspark_groundshaker.glb` (the tank) ships the same way.
`BoneMotionAnchor` takes an `Object3D`, not a `Bone`, so a plain named node works
as `rider_anchor`.

Runtime code finds nodes **by name**: `Susp_*` for suspension, `Wheel_*` for the
spin hold. Keep the names.

Orientation: the model faces **-Y in Blender, +Z after glTF export**, +Z up in
Blender becoming +Y. (The dachshund faced -X. Do not assume; verify.)

Clips exported: `Run`, `WalkBackward`, `Idle`, `Jump`.

---

## 6. What was borrowed from your other mount projects

This mount is deliberately assembled from patterns already proven elsewhere in
the repo. When in doubt, go read the original.

**None of those mounts are merged.** Every one lives on its own unmerged
feature branch, so a reference here is not something you can just open. The
borrowed code has therefore been copied into `reference/` inside this folder,
with the source commit recorded in `reference/PROVENANCE.txt`. Read it there
instead of checking out four more branches. `refresh_reference.sh` rebuilds it
if any source branch moves.

| Borrowed | From | Read it here | What it gave us |
|---|---|---|---|
| Rigid node animation, `skins: 0`, static seat | **Terrorspark Groundshaker** (tank), `feature/tank-mount-sfx` | `reference/terrorspark-groundshaker-tank/` | Proof a vehicle needs no skeleton, and the seat/seatFwd spec shape |
| Interruptible forward/reverse engine audio, airborne pitch bend, rider carried rigidly around the vehicle pivot | **Goblin Rocket Sled**, `feature/goblin-rocket-sled` | live in `src/`, and copied to `reference/goblin-rocket-sled/` | `advanceInterruptibleMountEngine`, `applyRocketSledAttitude`, `rocketSledRiderPivot`. This branch is BASED on that branch |
| Summon SFX plumbing, seat-solving discipline, the whole Blender toolchain | **Viridian Valestrider** (avian), `feature/avian-mount` | `reference/viridian-valestrider-avian/` | The summon channel preload/fire pattern, and the warning that `seat` is absolute world units |
| Positional (not topological) skinning, Kabsch residual checks, layer-by-layer rig discipline | **Dachshund mount** | no branch in this repo; method only, see `tooling/avian-mount-handoff.md` | Not used directly (no skinning here) but the same working method and the same script numbering |
| Blender-authored suspension intent | **Rickshaw**, `feature/rickshaw-mount`; **wooden toy train**, `feature/wooden-toy-train` | `reference/rickshaw/`, `reference/wooden-toy-train/` | The habit of authoring a rig whose nodes a runtime system can drive later |

Each `reference/<mount>/` also carries a `WIRING_EXCERPTS.md`: that branch's
records pulled out of every shared registry a mount has to be registered in.
That list is itself the wiring checklist, which is worth reading against the
outstanding content obligations in section 11.

---

## 7. How the player is affixed to the mount

This is the question that burned the most time on the avian, so read carefully.

The rider is **not** parented to the mount. They are two separate scene graph
roots that the renderer keeps in agreement every frame. Three pieces:

1. **`seat` and `seatFwd`** in `src/render/mount_visuals.ts`
   (`spec('mount_rallycart_rxt', 1.06, true, undefined, -0.86, 'exhaust')`).
   These are **ABSOLUTE WORLD UNITS, not fractions of height.** If you change
   `height` in `manifest.ts`, you MUST re-derive both by the same ratio. That is
   the trap that bit the avian, and it bit this mount too.

2. **The seat was solved against real geometry, not by eye.** `15_seat_solve.py`
   and `18_seat_surface.py` place the rider's back on the backrest cushion face
   and the underside of his hips on the real sitting surface. That surface is
   found by filtering to **upward-facing faces**. An earlier pass took the max z
   of a probe box, caught the base of the backrest, and sat him a foot in the
   air. If you re-derive the seat, use the upward-facing-face filter.

3. **Per-frame carry.** `applyRocketSledAttitude` (jump pitch) and then
   `applyVehicleSuspension` (terrain pitch and roll) both write the rider root:
   same rotation as the body, and the seat point swung around the vehicle origin
   so pelvis and cushion stay locked together. The suspension pass builds ONE
   Euler and applies it to both roots, so they cannot drift apart whatever
   Three's rotation order is.

On dismount, every arm must be relaxed (`rotation.x`, `rotation.z`,
`position.x`) or the rider keeps the vehicle's last attitude. That is handled in
`mount_presentation.ts`.

Current values: `height: 2.39`, `seat: 1.06`, `seatFwd: -0.86`.

---

## 8. Systems built here

### Terrain-reactive suspension (the main new system)

- `src/render/vehicle_suspension_core.ts`: pure math, registered in
  `RENDER_PURE_CORES`, 14 tests. The tuning knobs live at the top;
  `SUSPENSION_TILT_BLEND` (0.7) is the one to reach for first.
- `src/render/vehicle_suspension_fx.ts`: the Three side, 17 tests.

The load-bearing idea: **pitch and roll come from the PLANE through the four
contact points** (most of the visible effect, and what you feel cresting a rise
or traversing a hillside), while **per-corner spring travel is only the RESIDUAL
once that plane is removed**. On smooth ground the springs are still; they speak
only when the ground under the car is genuinely uneven.

Travel limits are **MEASURED off the mesh** at rig-create time, never guessed:

| limit | measured against | this model |
|---|---|---|
| bump | tire's curved crown up to the arch above it | 15 to 24% of wheel radius, per corner |
| droop | hub down to underbody level | 32 to 34% of radius |
| pitch down | front bumper vs ground (approach angle) | 13.4 deg |
| pitch up | rear overhang vs ground (departure angle) | 20.3 deg |
| roll | underbody sill vs ground on the low side | 12.2 deg |

Two measuring subtleties, both paid for in bugs:

- Measure the arch gap to the tire's **curved crown**, not its bounding box. A
  box measure catches the fender lip hanging down beside the tire and reports
  near-zero clearance, which gives dead springs.
- Take the ground angles as **per-vertex minima**, not from the single lowest
  point. The part that grounds first is not always the lowest one; a slightly
  higher vertex further past the axle binds sooner.

The system is **self-selecting**: any mount GLB carrying the four `Susp_*` nodes
gets suspension, everything else caches a `null` on first sight and costs one
property read per frame. It is also **fully self-describing**: wheelbase, track,
which way the car faces, which side is its right, and every limit are derived
from the rig and mesh at runtime. There is not one number in it that knows this
model.

### Landing squat

The springs take the impact on touchdown and push back out, to sell the weight
of the landing. `landSuspension` in the core, called from the airborne-to-
grounded edge in the fx pass.

**The spring owns the WHOLE touchdown, and getting that wrong is what made the
first version invisible.** That version left the airborne droop to the ordinary
terrain damper and added a separate squat on top. The two cancelled. On this
model droop is 1.64 times the arch gap, so at the moment the squat peaked the
wheel was still most of the way down through its droop recovery: net travel
never rose past a quarter of the gap, and Jamie's report was that he could
barely tell anything had been done. He was right.

The fix is that `landSuspension` MOVES the wheel's hanging offset out of the
terrain damper and into the spring, leaving travel exactly where it was so
nothing pops, and one spring then carries the wheel up through neutral and into
the arch. The impact adds a velocity kick on top. A velocity, not a position:
setting the compression directly snaps the body down on the touchdown frame,
while shoving the spring and letting it find its own peak is what reads as mass
arriving.

`LANDING_DAMPING` is 0.4, and it is the setting that decides whether any of
this reads at all. Damp it near one and the wheel merely creeps back up to
neutral. Under-damping is what carries it THROUGH neutral and closes the gap.

Measured on the real numbers (droop 0.034, bump 0.0207 model units):

| landing | arch gap at peak | when | squat |
|---|---|---|---|
| hard, 16 u/s | 17% of normal | 100ms | 0.104 world units |
| medium, 9 u/s | 53% | 134ms | 0.059 |
| light, 6 u/s | 58% | 150ms | 0.053 |

Rest again inside about 200ms after the peak.

Advanced by its **closed form**, `(A + Bt)e^(-wt)`, not by stepping the
acceleration. That is not fussiness. The damping term is large (2w dt is about
half a frame at 60fps), so an explicit step bleeds amplitude every frame and the
landing arrives at a little over half the compression it was asked for, with the
shortfall growing as the frame rate drops. Pinned by a test that compares the
peak at 30, 60 and 144fps.

It cannot put a tire through the arch. The terrain response and the squat are
summed and clamped once, in `settle`, against that corner's own measured bump,
so no combination of rough ground and a hard landing gets past it. A landing
harder than the scale allows simply pins at the bump stop, which is what a real
one does.

Impact is normalized 0 to 1 from the peak descent while airborne, between 4.5
and 16 world units per second. Those are deliberately the same numbers the
renderer already uses to pick a landing thud over a footfall and to size the
impact dust: a landing whose sound, dust and squat disagree about how hard it
was reads as three unrelated events rather than one.

Not done, and worth a look on screen: the squat is uniform across all four
corners. A nose-first landing biased toward the front axle would sell it harder,
but the body pitch is already its own pass and the two could fight.

### Wheel spin stop

Two separate problems, both fixed:

- The locomotion clip keeps playing through a crossfade, so the wheels turned on
  after the throttle was released. Fixed with `cutToIdle` on the visual def
  (`manifest.ts`), consumed by `baseTransitionFade` in
  `src/render/characters/visual.ts`: 0.02s instead of 0.22s. Opt-in, so no
  shipped mount changes behavior.
- Three's `AnimationMixer` **restores a property to its original value** once
  the last action animating it reaches zero weight, so the wheels snapped back
  to their authored home angle. Nothing in the content does this; the mixer does
  it on its own (the `Idle` clip has no wheel channels at all). Fixed by holding
  each wheel's quaternion while it turns and writing it back when it stops, in
  the same after-the-mixer slot the suspension owns.

### Front wheel steering

- `src/render/vehicle_steering_core.ts`: pure math, registered in
  `RENDER_PURE_CORES`, 16 tests. Owns both the measurement and the rack.
- The Three side lives in `vehicle_suspension_fx.ts` alongside the suspension,
  because the rig it needs is already built and cached there.

The signal is the entity's own **yaw rate**, not the keyboard. Turning is what
the turn keys do to `facing`, so reading the result rather than the input means
remote riders steer, mouse-look steers, and no input plumbing reaches the render
layer. A held turn key is a yaw rate of exactly `TURN_SPEED`, which is defined
to be full lock.

The sign needs no `frontSign`/`rightSign` correction, unlike everything in the
suspension. The group's yaw is set straight from `facing`, the model's own
`def.yaw` is a Y rotation too, and Y rotations commute, so a positive yaw rate
is a positive angle on the node whichever way the mesh was authored to face.

**The lock is MEASURED, not chosen.** For every point of the tire, how far
around can it turn before the bodywork occupies the same ring. Done in the steer
node's own space, where steering is a rotation about Y through the origin and
every point keeps its radius and height, so a wheel point at (r, y) can only
ever meet body at (r, y). Three things that measurement had to get right:

- Test against body TRIANGLES, not body vertices. A wheel arch is a handful of
  large quads and a vertex test lets the tire swing straight through one.
- Sweep the wheel through its suspension travel. A wheel at full bump is deep
  in the arch with less room than one at rest, and measuring only the rest pose
  ships a car that steers cleanly on flat ground and cuts its own fender on the
  first rise.
- Ignore bodywork BURIED INSIDE the tire. This is the one that mattered here:
  Tripo left hub and axle geometry assigned to the chassis and sitting inside
  the wheels, and a first measurement bound on it and reported one degree of
  lock. See the trap in section 10.

Measured on the current mesh: **FL +25.3 / -25.3 deg, FR +29.2 / -13.5 deg**.
Both wheels turn together so the pair takes the tighter of each, +25.3 / -13.5,
and `STEER_KEEP` (0.85) leaves roughly **+21.5 / -11.5 deg** in game. The
asymmetry is real bodywork on the right front, not noise: it does not move when
the tire exclusion is grown. `tests/rallycart_steer_lock.test.ts` measures the
shipped GLB and fails if a re-rip closes this up.

### Pivot turn and airborne wheel spin

Two more things sharing the after-the-mixer wheel slot in
`vehicle_suspension_fx`, both driven off measured geometry rather than feel
constants.

**Turning on the spot rolls the rear wheels against each other**, tracked
vehicle style: turn right and the right wheel runs backwards while the left
runs forward. A real car cannot do this, which is the point. With the wheels
dead still a pivot reads as the whole vehicle skidding sideways.

The rate is the ground each tire covers, not a dial. Under yaw rate `w` a
contact point at `p` moves at `w * (p.z, -p.x)`, and the part of that a wheel
can actually ROLL is the component along its own forward axis, which reduces to
`w` times the wheel's offset ALONG ITS AXLE, over the radius (`pivotWheelRate`).
The rest is sideways scrub, which is exactly the part a real tire refuses to do.
Offsets are taken from each axle's own midpoint, so the pair is equal and
opposite by construction and cannot drift out of symmetry on a lopsided mesh.

Fronts are left alone: they steer, and they would scrub rather than roll. So is
a pivot in mid air, since there is no ground to roll on.

Sanity check on the real numbers: rear half-track 0.2564 against a 0.106 wheel
radius, so a full 360 of the car turns each rear wheel 2.42 times, and at the
keyboard turn rate that is **7.3 deg/frame**, well under the 20 deg/frame spoke
alias ceiling in section 10. A test pins that headroom.

**Off the ground the wheels run at 1.5x the rate they left at**, so a jump reads
as the tires breaking traction. The reference is what the wheel was really
turning at, read off the clip's own quaternion delta and latched on the takeoff
edge, not a speed value. That is what makes reverse fall out for free: reverse
is a slower gear, so the same multiple of a smaller number is a smaller lift,
and backwards stays backwards. Jumping from a standstill spins nothing up.

The pass adds the DIFFERENCE between that target and whatever the airborne clip
is doing, rather than taking the channel over. Taking it over would snap the
phase on touchdown; adding the difference is continuous.

One thing to know if the model is re-ripped: the axle is read off each wheel's
own LOCAL mesh, since that is also the frame the spin is applied in. A wheel
whose axle lives in a node rotation rather than baked into its geometry would
measure as having no axle. The current export bakes it.

### Exhaust VFX

`fx: 'pipes'` on the visual spec, a NEW kind rather than an edit to
`fx: 'exhaust'`. That one is the Aether Hover Cycle's purple and blue sparkle
trail, which the cart was borrowing and which fitted it badly: one emitter, 1.1
world units behind the entity origin, when the pipes are at 2.9. Editing it
would have retuned a shipped mount.

**The four tailpipes**, two per side under the rear bumper, as model offsets in
`RALLYCART_EXHAUST_PORTS`:

| pipe | model x | tip z | note |
|---|---|---|---|
| outer left | -0.155 | -0.478 | the clean one, right-most seen from behind |
| inner left | -0.121 | -0.488 | |
| inner right | +0.116 | -0.488 | |
| outer right | +0.153 | -0.488 | |

All at y 0.114. Three of the four tubes are rough, so they carry a higher
density weight to break up their outline while the clean one stays visible.
Flatten the weights to 1 if a re-rip produces four good pipes.

**These offsets are the one thing a re-rip does NOT carry forward.** Everything
else on this mount keys off named nodes; the pipes are bare primitives inside
the Chassis mesh with no empties to hang a name on.
`tests/rallycart_exhaust_ports.test.ts` re-finds them independently, by
geometry, and fails if they move, because the alternative is smoke hanging in
the air where the old pipes used to be. If the model is re-exported, adding four
`Exhaust_*` empties would turn this into the same name-based contract the
suspension uses, and is worth doing.

**Ports are resolved through the CHASSIS matrix**, not from position and yaw.
The body now pitches, rolls and squats, so yaw-only placement would visibly
detach the smoke from the pipes on every landing, which is exactly when a rider
is looking at the back of the car.

**One pipe per spawn, chosen by weight**, rather than all four every time. Four
ports cost nothing over one here: `spawn()` is a write into a shared 4096-slot
ring buffer and there are no emitter objects, so the only real cost is particle
COUNT. Emitting from all four each time would have quadrupled that silently.

**The launch flame** fires at `EXHAUST_FLAME_AT` = 0.6s into the windup take,
which is where its acceleration transient lands. That is measured, not felt:
the take's envelope climbs from -22 dB, reaches its plateau at 0.35s and holds
through 0.75s with its loudest window at 0.65s. It is a property of the
recording, so re-cutting the audio moves it.

It is timed off `Sfx.mountEnginePhase`, which reports the phase and its elapsed
time on the AUDIO clock (`ctx.currentTime`), not a frame counter, so the burst
lands on the transient and stays there through a frame hitch. Note the take
runs 3.63s, so this fires early in the launch and NOT at the handoff into the
sustain loop: that handoff is a deliberately smooth join with nothing to
punctuate. A latch makes it one event per launch, re-armed when the engine
leaves the windup.

Rates by phase live in `exhaustSmokeRate`: idle 5/s (the cart idles audibly
from summon, and parked is when the pipes get looked at), starting 13, moving
16, stopping 7. Reverse scales to 0.55 since it is a lower gear and should not
read as a second launch. A pivot scales idle by 1.7: load, going nowhere.

**THE POOL IS ADDITIVE, and that governs everything about how this can look.**
`THREE.AdditiveBlending`, so a particle can only ADD light and can never
occlude. Overlapping puffs SUM, which means three mid-greys at 0.5 clip to
white: the brighter and denser the smoke, the whiter it goes, exactly backwards
from how smoke behaves. The first pass shipped neutral grey at 0.34 to 0.56,
sized to 0.78, at 34/s with a 1.2s life, and read as white blobs. It was four
mistakes compounding, and the pool's own sputter smoke (`0x593126`) had already
shown the right idiom.

Now: soot at 0.11 to 0.20 with a warm tint, size 0.28 to 0.45, lives 0.55 to
0.95s, rates halved. That is roughly an eighth of the previous additive load.
The alpha envelope is the other half of the reasoning: alpha holds at 1 for the
first 75% of a particle's life and only then ramps, so short lives are what stop
puffs stacking at full strength.

**What this can honestly be is a faint sooty haze that lifts off the pipes, not
smoke that hides anything.** Hiding needs darkening and darkening needs a
non-additive pass, which would mean a second `Points` with `NormalBlending` and
a decision about which existing effects migrate to it. That is the real fix if
the haze is not enough, and it would serve every dusty effect in the game rather
than this one mount.

### Engine audio

Full detail in `RALLYCART_HANDOFF.md`. Summary: idle loop runs from summon
onward; reverse is that same idle loop **pitched up at runtime on the live
voice**, so it never re-triggers and the seamless loop stays seamless; direction
changes cut immediately in both directions sharing one voice with a 40 ms
crossfade. Pitch table in `mountEngineBendRate`
(`src/game/mount_engine_state.ts`, unit-tested): reverse +2 semitones, airborne
+3, both +4, deliberately sub-additive. A mount with no idle take (the sled)
keeps its original 1.08 airborne-only bend, so this cannot retune a shipped
mount. Summon fires on the `mountKey` change edge minus dismounts, preloaded
when the summon channel starts.

### Jump and landing audio

Nine hand-authored takes: `mount_jump_rallycart_rxt` (5 variants) and
`mount_land_rallycart_rxt` (4). Sources are `E:\finals\rallycart_jump-00*.mp3`
and `rallycart_land-00*.mp3`; they land as `<key>_1.mp3` upward, which is how
the manifest builder discovers variants, and `Sfx` picks one per play with its
own no-repeat-biased random.

The swap happens in `Sfx.movement`, which now takes the rider's `mountKey` and
resolves `mount_<jump|land>_<mountKey>` when that key exists, falling back to
the rider's own `move_jump` / `move_land`. Resolution is by key existence and
cached, the same shape as `engineClipKeys`, so giving another mount its own
takeoff is files plus a registered key with nothing to wire. Splash and swim
stay the rider's: those are a body meeting water. Both takes are preloaded on
the mountKey edge alongside the engine clips, since a one-shot on a rare event
is exactly what a cold buffer drops.

The rocket sled's existing suppression is untouched: its turbine pitch and
nozzle compression still carry its own jump and landing.

Gains are at the **measured ceiling**: `mount_jump_rallycart_rxt` 2.4 dB,
`mount_land_rallycart_rxt` 1.4 dB. Those are low because the takes are already
hot, not because they were chosen conservatively.
`sfx_gain_ceiling.generated.json` computes the ceiling from each key's
worst-case true peak, and `playback_profile.mjs` fails a build that sets a trim
past it. To move a whole cue, edit `keyTrimDb` in
`scripts/sfx/sfx_gain_map.json` and run `npm run sfx:manifest`.

**A single loud VARIANT cannot be fixed from the gain map**, and this bit
already. `keyTrimDb` is per key and applies to every take of it uniformly. Land
take 1 came in at -11.1 LUFS against -20.0, -21.1 and -18.4 for the other
three, nearly 9 dB hotter, and Jamie heard it immediately. The fix is in the
audio: the file was attenuated 8.9 dB with ffmpeg (`volume=-8.9dB`, re-encoded
at its source 320kbps/44.1k/stereo) to land at -20.0 LUFS, matching take 2
exactly and putting the set inside a 2.7 dB spread, the same spread the five
jump takes already had.

Doing that also RAISED the key's ceiling from 1.0 to 1.4 dB, because the
ceiling is set by the loudest take of the key and take 1 was the one holding it
down. That is the general shape: one hot variant both stands out and steals the
headroom from every other take of its cue.

**The master in `E:\finals\rallycart_land-001.mp3` is untouched.** Re-copying
the takes reintroduces the hot version. Re-apply the attenuation if that
happens.

**The landing cue then went up 50% as a whole**, via `MOUNT_LAND_BOOST` in
`Sfx.movement`, not via the gain map. That distinction matters: `keyTrimDb` is
per KEY and already sits at this cue's measured ceiling, so pushing it further
fails the playback-profile validator. The per-call gain is a separate multiply
downstream, and the output bus has room (`SAMPLE_GAIN` is 0.85), so the cue
lifts without disturbing how the four takes sit against each other. It applies
to a mount's OWN landing only: the rider on foot, the takeoff, the water cues
and any mount without landing takes all keep 0.7.

### Headlights

Four glowing spheres, one in each lamp bowl on the nose, in
`vehicle_headlights.ts`. Tuned on screen with Jamie over several rounds.

**Mount-owned geometry, not particles.** A headlight is always there and never
moves relative to the car, so the spheres are parented into the CHASSIS and
inherit yaw, pitch, roll and the landing squat for free. There is no update
function in that file at all, and no per-frame cost. Same call the sled's
continuous flame makes.

**The four bowls are two per side, SIDE BY SIDE.** An earlier pass called them
concentric pairs (a filled disc with a smaller ring inside it) and that was
wrong twice over, both times by measuring the wrong thing:

- The "disc" at radius 0.045 was not a lamp at all. It was the whole angular
  HOUSING primitive (prim 37/36, 0.112 wide). A sphere sized to it filled each
  housing edge to edge and bloomed past it: two white canteloupes.
- A second pass histogrammed only the frontmost 15mm of the housing. But the
  housing SWEEPS BACK toward its outer edge, so that slice discarded the
  outboard bowl entirely and locked onto the housing's inner edge instead. Both
  lamps ended up crowded inboard and far too small.

Split the housing at its own midpoint and take the front surface of each half:
that survives the sweep and finds both bowls. They are near enough the same
size, and the outboard one sits 18mm further back in z.

The bowls are RECESSED 15 to 21mm behind their rims, so the depth reference is
the dish surface, never the rim. `z` in the table is the dish.

| lamp | model x, y, z (dish) | bowl radius | glow |
|---|---|---|---|
| left inner | -0.153, 0.211, 0.451 | 0.025 | 0.020 |
| left outer | -0.222, 0.215, 0.427 | 0.024 | 0.018 |
| right inner | +0.154, 0.205, 0.452 | 0.025 | 0.020 |
| right outer | +0.223, 0.210, 0.427 | 0.024 | 0.018 |

**Two separate knobs, and they do different jobs.** `glow` is the sphere radius
(size). `SINK` (0.35) is how far its CENTRE sits behind the dish, as a fraction
of that radius, and it controls SHAPE: what the eye gets is the spherical cap in
front of the dish, whose silhouette is `sqrt(1 - SINK^2)`, about 0.94 here, so
the cap is nearly a full hemisphere and reads as the whole bowl lighting up.

The trap that cost a round trip: a fixed small offset in model units instead of
a fraction of the radius. A shallow cap's silhouette is `sqrt(2*r*h - h^2)`,
which at 2mm proud of a 17mm sphere is an 8mm disc inside a 25mm bowl, and the
dish is faceted, so what actually rendered was a ragged crescent rather than a
circle. Raggedness is a SINK problem; size is a `glow` problem.

Brightness is the composer's job, not view-angle maths: additive with an HDR
colour where `GFX.composer` exists, so a lamp blows out as it fills the screen
and settles to an ember at distance. Without a composer the HDR multiplier is
dropped, since there is nothing to bloom into and anything over 1 would only
clip white.

`attachVehicleHeadlights` is idempotent, keyed off a flag on the chassis rather
than off view state, which is what makes it survive a graphics-settings rebuild
handing back a fresh mount visual. Material and geometry are module-level and
shared across every cart; only the meshes are per mount, and they go away with
the chassis, so there is no teardown to plumb through the visual lifecycle.

Like the exhaust ports, these offsets are measured off bare primitives with no
empties to name, so a re-rip invalidates them and
`tests/rallycart_headlights.test.ts` re-finds the circles and fails if they
move. That test describes each nose primitive whole AND split at its own midpoint. It
used to emit one circle per primitive, which meant it structurally could not see
the outboard bowl and rejected a correct position: as written it was silently
guarding only half the lamps, which is the exact re-rip case it exists to catch.

Not done: nothing is lit by them. `NightLightSite` entries would put real light
on the ground after dark, and two sites (one per lamp, not per circle) would be
the right spend, since the field has bounded slots and the concentric pairs are
0.1 world units apart.

### Pivot pitch bend

Turning on the spot takes the REVERSE bend. A pivot works the engine the same
way reverse does, load with no road speed, so `mountEngineBendRate` gained a
`pivoting` input that ORs into the reverse branch rather than inventing a third
value. It does not stack with reverse (one loaded engine, not two), it combines
with airborne exactly as reverse does, and it is inert for a mount with no idle
take, so the tank and the sled cannot be retuned by it.

The signal comes from the suspension rig, which already computes the yaw rate
for steering: `rig.pivoting` is stationary AND grounded AND yawing past
`PIVOT_MIN_YAW`, surfaced to the renderer as `mountPivot` on the view record.
The renderer reads it one frame late, which at 16ms is not worth plumbing
around.

### Extraction

`src/render/mount_presentation.ts` now owns the whole per-frame mount pass (gait
update, body attitude, rider carry, ambient trail). This was extracted to pay
renderer.ts's monolith ceiling back; the ceiling was LOWERED 13652 to 13651 in
the same change, per the ratchet rule.

---

## 9. If the model is re-ripped

Jamie may re-render the mesh from Tripo. **The core systems and behavior do not
change.** Specifically:

**Survives untouched:**

- Every Blender script in `E:\rallycart_work\`.
- All audio, the engine state machine, the summon wiring.
- All repo wiring: mount def, item, manifest entry, visual spec, SFX keys.
- **The entire suspension system**, because it measures the new mesh at runtime.
- The wheel-spin hold and `cutToIdle`, which key off node names.

**Must be re-derived:**

- Which Tripo parts are the wheels (`03_build_rig.py` identifies them by
  position). A 42-part model became 5 meshes; a new rip will differ.
- Wheel radius, spoke count, and the aliasing ceiling (see section 10).
- `height`, `seat`, `seatFwd` via `15_seat_solve.py` and `18_seat_surface.py`.

**The rig contract in section 5 is the interface.** Reproduce the node names and
hierarchy and everything in `src/` keeps working. Budget roughly an hour of
script re-runs, not a rebuild.

Recommended order: keep dialing scale and sound on the current asset, then swap
the mesh in and re-run the seat solve ONCE, rather than tuning twice.

---

## 10. Traps, each one paid for

- **UNITS.** All suspension math runs in the MODEL's own space; sampled world
  terrain heights are divided by `unitScale` on the way in. The first version
  worked in world units and wrote travel straight onto the `Susp_*` node, which
  lives in model space under a 6.046x normalization. Every spring came out 6.2x
  the front arch clearance and the wheels fired up through the fenders. Pinned by
  `tests/vehicle_suspension_fx.test.ts` ("keeps travel inside the measured
  clearance whatever the mount scale").
- **Composing onto another pass's writes.** The suspension writes channels that
  the animation mixer and the jump-attitude pass also write. A naive `+=`
  integrates without bound on any frame those other writers skip (far LOD,
  paused animation). The fix, used in two places: store both the contribution
  and the exact value it produced, and treat a channel still holding
  `lastWritten` bit for bit as "the other writer did not run."
- **SPOKE ALIASING sets the wheel rate, not taste.** The wheel has 9 spokes so it
  looks identical every 40 degrees; past 20 deg/frame the eye pairs each spoke
  with the previous one and the wheel reads BACKWARDS. The first pass ran 30
  deg/frame, which aliases to -10, and Jamie correctly reported the wheels going
  backwards even though the rotation was right. Rules: stay under 20 deg/frame,
  and turn a whole number of SPOKES per cycle (multiples of 40 deg) rather than
  whole revolutions, which still loops seamlessly. Tune via `SPOKES_PER_CYCLE` in
  `04_build_clips.py`; it prints the speed and an alias check. Current Run
  playback can only speed up **1.34x** before it aliases again, which constrains
  `runRef`.
- **`matrix_parent_inverse` reads a STALE `matrix_world`** on freshly positioned
  objects in Blender, so parent offsets get applied once per level (rear wheels
  at double axle height, fronts at triple). Set explicit local offsets instead.
- **Never measure a spinning wheel's ground contact with `bound_box`.** The box
  is axis-aligned in LOCAL space, so it rotates with the wheel and reported 0.04
  of phantom penetration. Use real vertices.
- **Editing the wrong adjacent record.** The three cumulative in-game shrinks
  (7.5%, 7.5%, 10%, cumulative 0.771) were applied to `mount_stalkglider_snail`
  instead of `mount_rallycart_rxt`. They sit adjacent in `manifest.ts` and BOTH
  had height 3.1, so a shipped mount silently shrank 23% while the cart never
  shrank at all. Caught by `tests/mount_visuals.test.ts` (seat above crown).
  Check the record NAME, not just the number.
- **BODYWORK BURIED INSIDE THE WHEEL.** The steering measurement's first run
  reported one degree of lock on the front wheels. The binding contact was at
  radius 0.1033 and height 0.0157, which is inside the tire's own solid: Tripo's
  part separation left hub and axle geometry on the Chassis mesh, sitting inside
  the wheels. It is invisible, no steering angle reveals it, and letting it set
  the lock reports a car that cannot turn. The fix is a tire-solid filter with a
  1.5% skin. The diagnostic that proved it was not just a tuning choice: grow
  the exclusion radius and watch. The left front measures the same 25.3 deg
  anywhere from 1.00 to 1.05, so its limit is real bodywork standing clear. The
  right front jumps from 5.5 to 29.2 deg between 1.00 and 1.01, so its limit was
  junk grazing the tread. Expect this on any automatically separated model.
- **A CORRECT TABLE NOBODY CALLED.** `mountEngineBendRate` computed the
  airborne pitch bend correctly from the day it was written, and it was
  unreachable. The renderer passes `airborne: true` to `mountEngine` only for
  the rocket sled; every other mount holds its engine phase through a jump and
  is never polled, so the cart's loop never lifted off the ground. Jamie caught
  it by ear, and the unit test on the table passed the whole time, because the
  table was right. The renderer's caution was sound in itself: a mount whose
  engine goes quiet when parked would read a hop polled with moving=false as a
  stop and run a spurious winddown and windup. The distinction is not "is it
  the sled" but "does this engine ever go quiet", which is exactly what a
  parked idle take answers, hence `Sfx.mountEngineIdles`. When a feature is
  unit-tested and still inaudible, suspect the caller before the math.
- **`byteStride`.** See section 4.

---

## 11. What is NOT done

- **Not gated, and not pushed.** `node scripts/gate_select.mjs` has never run
  on this branch. The work IS now committed as `2c0f0e1cb5`, a single commit on top
  of `feature/goblin-rocket-sled`, so it no longer lives only in a dirty working
  tree. It has not been pushed to any remote, so the one copy is still this
  machine. Pushing it is the cheapest remaining risk reduction.
- **No UI-hide toggle exists**, which Jamie wants for recording footage. There
  is no command, keybind, URL param or setting; the only UI-hiding code is
  `setIntroUiHidden`, a local closure the spawn cinematic uses. The workaround
  is a DevTools paste, and it must hide THREE layers or nameplates float over
  the shot:

  ```js
  for (const id of ['ui', 'mobile-controls', 'nameplates']) {
    const el = document.getElementById(id);
    if (el) el.style.display = el.style.display === 'none' ? '' : 'none';
  }
  ```

  It holds for the session (nothing else writes those three) but dies on
  reload, and a handful of overlays live on `<body>` outside `#ui` (reconnect
  overlay, perf nudge toast, chat command menu) and would still appear. A real
  keybind was offered and not yet built.
- **Headlights light nothing.** Two `NightLightSite` entries would put real
  light on the ground after dark. Two, one per lamp, not four: the field has
  bounded slots and the concentric pairs are 0.1 world units apart.
- **Content obligations skipped on purpose** and required before a PR: no deed
  (`src/sim/content/deeds.ts`), no Reliquary page, no wiki regen
  (`npm run wiki:content`), no item icon art, no `public/ui/items/mapping.json`
  entry, no asset fingerprint pin. These are PR requirements, not "does it feel
  good" requirements, and pinning a fingerprint before the model is final means
  re-minting it. Dispatch the `content-obligations-reviewer` agent on the diff.
- **Steering is done** (see section 8), but it has never been looked at in
  motion. The numbers are measured and the tests pass; whether +21.5 / -11.5 deg
  reads as a car turning its wheels is a judgement only the screen can make.
- **Reverse tail lights.** Jamie wants reverse to put white light in the tail
  lights. Tripo's part detection for the lights was "a lil goofy," so this may
  need to be done on the surface (emissive material swap) rather than per-part.
- **Exhaust VFX is built** (section 8) but has never been seen in motion. The
  densities, the flame size and the per-pipe weights are all guesses that only
  the screen can settle.
- **`yaw` is unset (0).** If it drives sideways, that is the first thing to fix.
- **No in-engine screenshot.** `scripts/rallycart_shot.mjs` boots the game and
  grants the mount but cannot get through the summon channel headless. Visual
  changes need before/after screenshots for the PR (`pr-screenshots` skill).
- **The SFX catalog debt this branch already carried, now slightly larger.**
  `npm run sfx:check` exits 1 and three catalog tests fail. Two of them
  (`tests/sfx.test.ts`) enumerate `mount_run_*` and are entirely about this
  branch's reverse engine takes having no MOUNT_KEYS entry; the jump and land
  keys do not touch them. The third pins the catalog at 271 keys and now reads
  278: 271 plus this branch's six engine and summon keys, plus jump and land.
  Resolving it properly means deciding what the reverse takes are, so the pin
  was deliberately left alone rather than bumped to hide the question. Verified
  pre-existing by moving the nine new files aside and re-running: still exit 1.
- **The rallycart audio is unconformed.** Every rallycart take, the engine set
  included, fails `sfx:check` at 320kbps against a 192kbps standard and above
  the -6 dBFS peak target. `npm run sfx:conform` fixes it but has no file
  filter, so it would also rewrite the engine takes Jamie tuned by ear, and
  would boost `mount_run_rallycart_rxt_reverse_start` from -16.2 dBFS. That is
  a decision, not a cleanup, so it was left alone. Conforming would also raise
  the jump and land ceilings well above the current 2.4 / 1.0 dB.
- Full test suite has never passed locally; the server tests need
  `npm run db:up` (Postgres) and will fail without it. That is expected and not a
  regression.

---

## 12. Verification

```bash
cd /home/jbibbs/woc-worktrees/rallycart-mount
npx tsc --noEmit                       # about 2 seconds, run liberally
npx vitest run tests/vehicle_suspension_core.test.ts \
               tests/vehicle_suspension_fx.test.ts \
               tests/vehicle_steering_core.test.ts \
               tests/vehicle_wheel_overspin.test.ts \
               tests/vehicle_exhaust_core.test.ts \
               tests/rallycart_steer_lock.test.ts \
               tests/rallycart_exhaust_ports.test.ts \
               tests/rallycart_headlights.test.ts \
               tests/mount_engine_bend.test.ts \
               tests/mount_engine_state.test.ts \
               tests/mount_engine_airborne_poll.test.ts \
               tests/mount_landing_gain.test.ts \
               tests/mount_visuals.test.ts \
               tests/character_clipmaps.test.ts \
               tests/mount_engine_bend.test.ts \
               tests/architecture.test.ts \
               tests/monolith_budget.test.ts
npx @biomejs/biome check --write <only the files you changed>
```

Never run a whole-repo `biome check .`; it is intentionally red with
pre-existing debt. Never run a whole-repo `--write`.

Before calling anything done: run `/qa` (the `qa-checklist` agent) over the diff,
then `node scripts/gate_select.mjs`.

Current state: tsc clean, biome clean on changed files, **229 tests green**
across the suspension, steering, wheel spin, exhaust, headlight, engine audio,
mount, clipmap, architecture and monolith suites.

Two suites are RED and were left that way deliberately, both pre-existing:

- `npm run sfx:check` exits 1, and did so before any of this work. Verified by
  moving the nine new takes aside and re-running.
- Three catalog tests in `tests/sfx.test.ts` and `tests/sfx_manifest.test.ts`.
  Two of them enumerate `mount_run_*` and are entirely about this branch's
  reverse engine takes. The third pins the catalog at 271 keys and now reads
  278. Bumping the pin would hide the reverse-take question rather than answer
  it, so it was left for a deliberate decision. See section 11.
