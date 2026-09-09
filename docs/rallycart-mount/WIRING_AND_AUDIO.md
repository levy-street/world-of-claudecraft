# Rallycart RXT: overnight wiring handoff

Written 2026-08-16, early hours. Everything below is wired and verified; nothing
is committed yet.

## Where things are

- Worktree: `/home/jbibbs/woc-worktrees/rallycart-mount`
- Branch: `feature/rallycart-mount`, based on **`feature/goblin-rocket-sled`**, not
  on a release branch. That is deliberate and important: the fwd/reverse engine
  audio machinery (`interruptible` in `src/game/sfx.ts`, the airborne pitch bend,
  `advanceInterruptibleMountEngine`) exists ONLY on the sled branch. Release
  v0.39.0 has none of it. Any PR here depends on the sled landing first.
- Dev server: **http://localhost:5200** (`npm run dev -- --host 0.0.0.0 --port 5200`).
  Offline play only; no game server or Postgres needed.
- Blender source of truth: `E:\rallycart_work\` (scripts, reports, checkpoint blends).

## Get it in game

Dev commands are on automatically under Vite (`import.meta.env.DEV`). In chat:

    /dev mounts

then use the ignition key from your bags. Riding is a trained skill, so if the
mount will not summon, that is the gate (Marla sells it, or grant it in dev).

Summoning is a CHANNEL, not instant: the mount appears on the completion edge.

## What is wired

| Piece | Where |
|---|---|
| Mount key + def | `src/sim/content/mounts.ts` (`rallycart_rxt`, epic, moveSpeedPct 0.8) |
| Summon item | `src/sim/content/items.ts` (`reins_rallycart_rxt`) |
| Visual + clips | `src/render/characters/manifest.ts` (`mount_rallycart_rxt`, height 2.39) |
| Placement + fx | `src/render/mount_visuals.ts` (seat 1.06, seatFwd -0.86, `fx: 'exhaust'`) |
| Suspension | `src/render/vehicle_suspension_core.ts` + `_fx.ts`, driven from `mount_presentation.ts` |
| Engine audio | `src/game/sfx.ts` (idle loop + pitch-bent reverse), `src/game/mount_engine_state.ts` (`mountEngineBendRate`) |
| SFX keys | `scripts/sfx/sfx_prompts.mjs` (idle, start, loop, stop) |
| Audio files | `public/audio/sfx/mount_run_rallycart_rxt*.mp3` |
| Model | `public/models/mounts/rallycart_rxt.glb` (KTX2 compressed, 1.7 MB) |
| Names | `src/ui/i18n.catalog/hud_chrome.ts`, `items.ts`, `src/ui/mount_labels.ts` |

## Numbers you will want to tune

- **height 2.39**. The rider-fit pass in Blender landed on 3.1 (with a real
  knight at the game's own 2.6 normalization: 2.5 wore him like a costume, 3.7
  lost the joke; reference: rocket sled 2.5, tank 2.8, hover cycle 2.3). Three
  in-game tuning passes then took it down 7.5%, 7.5% and 10%, a cumulative
  0.771, to 2.39.

  CAUTION, this bit me: those shrinks were first applied to the WRONG record.
  `mount_stalkglider_snail` sits directly above the rallycart in
  `manifest.ts` and also had height 3.1, and it absorbed all three, shrinking a
  shipped mount 23% while the cart stayed at full size. Caught by
  `tests/mount_visuals.test.ts` (the snail's seat ended up above its own crown).
  Check the record name, not just the number, when editing that file.
- **seat 1.38 / seatFwd -1.12**. Solved against the car's real geometry: the
  rider's back on the backrest cushion face (model y 0.2495) and the underside
  of his hips on the real sitting surface (model z 0.20). That surface is found
  by filtering to UPWARD-FACING faces; an earlier pass took the max z of a probe
  box, caught the base of the backrest, and sat him a foot in the air at
  seat 2.26. Both are scaled by the same 0.771 as the height above, giving
  1.06 / -0.86. If you change `height`, BOTH must be re-derived by the same
  ratio; `seat` is an absolute world height, not a fraction. That is the trap
  that bit the avian.
- **walkRef 3 / runRef 4.4**, copied from the tank as a starting point. Untested.
- **Wheel aliasing ceiling: 1.34x.** The clip runs 14.93 deg/frame against a
  9-spoke wheel, and anything past 20 deg/frame reads as the wheels spinning
  BACKWARDS. So playback can speed up 1.34x before that happens. If it needs to
  look faster than that, re-author the clip's spoke count; do not fight runRef.
- **yaw is unset (0).** The car faces -Y in Blender, +Z after glTF export. If it
  drives sideways in game, that is the first thing to fix.

## Audio (revised 2026-08-16 after first play test)

The engine is no longer silent when parked, and reverse is no longer a separate
clip. Both were the two things you called out:

- `mount_run_rallycart_rxt_idle` is a persistent loop that runs from summon
  onward, ducking out only while the forward loop owns the engine and easing
  back in after the winddown.
- REVERSE is that same idle loop pitched up at runtime, on the live voice, so it
  never re-triggers and your seamless loop stays seamless.
- The printed `*_reverse*` takes I made are therefore unused. Their keys are
  deregistered; the mp3s are still staged on disk if you want them back.

Direction changes cut immediately, in both directions. `advanceInterruptibleMountEngine`
already allowed it (release mid-windup goes straight to the winddown, press
mid-winddown goes straight back to the windup) and every transition one-shot
shares ONE voice with a 40 ms crossfade, so each cuts the last rather than
stacking. What was missing was the idle scheduling: it now holds UNDER the
winddown, so a stop hands off to idle instead of cutting to silence, and drops
in 60 ms under the windup, which climbs away from it. That predicate is
`mountEngineIdleAudible`, tested alongside the bend table.

Pitch bends use your table, in `mountEngineBendRate` (`src/game/mount_engine_state.ts`,
pure and unit-tested in `tests/mount_engine_bend.test.ts`): reverse +2 semitones,
airborne +3, both +4, deliberately sub-additive. A mount with no idle take (the
rocket sled) keeps its original 1.08 airborne-only bend, so this cannot retune a
shipped mount.

Idle carries a +4.0 dB trim: the take sits 5.4 dB under the driving loop, and a
parked engine should be quieter but not inaudible.

Forward set is yours, straight from `E:\Finals`, untouched:
`rallycart_start_forward` / `loop_forward` / `stop_forward` -> the three
`mount_run_rallycart_rxt*` keys.

Summon IS wired now. `mount_summon_rallycart_rxt` fires on the `mountKey` change
edge (the same edge as the summon shimmer, minus dismounts, since a key going
empty is a put-away and not an appearance), and the take is preloaded when the
summon CHANNEL starts so the fetch and decode are done before the mount appears.
The idle loop is gated behind the summon take's real duration, falling back to
`MOUNT_SUMMON_FALLBACK_SEC` (2.5s, above the take's own 2.30s) on a cold cache;
the earlier 1.2s fallback is what let idle cut into summon on a first play.

## Terrain-reactive suspension (built 2026-08-16)

The car now reads the ground under each of its four wheels and answers with body
pitch, body roll, and per-corner spring travel.

- `src/render/vehicle_suspension_core.ts` is the pure math and holds the tuning
  knobs: `SUSPENSION_TILT_BLEND` 0.7 (how much of the true slope the body takes;
  under 1 because a real car's springs absorb part of every slope and a full
  match reads as a toy glued to the terrain), `SUSPENSION_TILT_MAX` 0.25 rad,
  and the two damping rates. Start here to change the feel.
- The split it makes is the load-bearing idea: PITCH and ROLL come from the
  plane through the four contact points (most of the effect, and what you feel
  cresting a rise or traversing a hillside), while PER-CORNER TRAVEL is only
  what is LEFT OVER once that plane is removed. On smooth ground the springs sit
  still; they speak exactly when the ground under the car is uneven.
- `vehicle_suspension_fx.ts` is the scene-graph half, and it MEASURES the travel
  limits off the mesh at mount-create time rather than guessing them. There is
  not one number in it that knows this model, so a re-export or a resize needs
  no edits here; it re-measures.

  What it measures, and against what:

  | limit | measured against | this model |
  |---|---|---|
  | bump | tire crown up to the arch above it | 0.016 to 0.025 (15 to 24% of wheel radius) |
  | droop | hub down to underbody level | 0.033 to 0.036 (32 to 34% of radius) |
  | pitch down | front bumper vs ground (approach angle) | 13.4 deg |
  | pitch up | rear overhang vs ground (departure angle) | 20.3 deg |
  | roll | underbody sill vs ground on the low side | 12.2 deg |

  Bump is per corner and the front is tighter than the rear, because on this
  model the front tires sit closer to their arches. The gap is measured to the
  tire's CURVED crown, not its bounding box; measuring to the box catches the
  fender lip hanging down beside the tire and reads a near-zero ceiling. The
  angles are per-vertex minima, not derived from the single lowest point, since
  a slightly higher vertex further past the axle grounds first. `CLEARANCE_KEEP`
  (0.85) and `ANGLE_KEEP` (0.8) hold everything just short of contact.

- **UNITS, the trap here.** All the suspension math runs in the MODEL's own
  space, and sampled terrain heights are divided by `unitScale` on the way in.
  The first version worked in world units and wrote travel straight onto the
  node, which lives in model space under a 6.046x normalization: every spring
  came out 6.2x the front arch clearance and fired the wheels through the
  fenders. `tests/vehicle_suspension_fx.test.ts` pins this ("keeps travel inside
  the measured clearance whatever the mount scale").
- It is self-selecting: any mount whose GLB has the four `Susp_*` nodes gets it,
  everything else caches a null on first sight and costs one property read.
- The clip's own authored road bumps (`ROAD_EVENT_SCALE`, currently 0.33) still
  play; terrain response ADDS to them. Drop that scale toward 0 in
  `04_build_clips.py` if the ground now carries enough texture on its own.
- Airborne, the body eases upright and the wheels hang at droop.

## Verified

- glTF validator: **0 errors, 0 warnings** on the export. The one info is
  `NODE_EMPTY` on `rider_anchor`, which is what a socket node should be.
- 4 animations exported with correct names (Run, WalkBackward, Idle, Jump), all
  13 nodes survived including `rider_anchor`, `Susp_*` and `Steer_*`. `skins: 0`.
- `npx tsc --noEmit` clean.
- Focused tests pass: `mount_visuals`, `character_clipmaps`, `character_anim_state`,
  `glb_texture_compression`, `render_glb_replacement_assets` (100 tests).

## NOT done

- Not committed, not gated (`node scripts/gate_select.mjs` never run).
- Content obligations skipped on purpose: no deed, no Reliquary page, no wiki
  regen, no item icon art, no `public/ui/items/mapping.json` entry, no asset
  fingerprint pin. Those are PR requirements, not "does it feel good"
  requirements, and pinning a fingerprint now means re-minting it after tuning.
- `scripts/rallycart_shot.mjs` boots the game and grants the mount but does not
  get through the summon channel headless, so there is no in-engine screenshot.
  The asset serves correctly over HTTP (verified 200s on the GLB and the mp3s).
- Steering is not driven. `Steer_FL` / `Steer_FR` exist, are animated by nothing,
  and no clip touches them, so a runtime steering system can own them outright.
- Steering is still not driven (`Steer_FL`/`Steer_FR` exist, nothing animates
  them), reverse tail lights and exhaust VFX tuning are untouched.
