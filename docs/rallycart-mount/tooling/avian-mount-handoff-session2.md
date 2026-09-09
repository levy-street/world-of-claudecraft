# Viridian Valestrider: session 2 handoff

Written 2026-08-14, end of the Claude session that followed Codex's.
Supersedes `avian-mount-handoff.md` where the two disagree; that file is still
the authority on the ASSET LINEAGE, the Tripo work, the Blender authoring
scripts, and the animation-by-animation decision history. Read it for anything
about how the model and clips were made. Read THIS for the current code state.

## One-line status

The mount is finished and pushed. The rider is glued to the saddle, the summon
sound is wired, cadence is tuned. **The PR has not been opened yet** and that is
the only outstanding deliverable.

## Where the work is

- Worktree: `/home/jbibbs/woc-worktrees/avian-mount`
  (Windows: `\\wsl.localhost\Ubuntu\home\jbibbs\woc-worktrees\avian-mount`)
- Branch: `feature/avian-mount`, commit `cc795ead60`
- **Pushed** to `origin` (jamiecypher fork). The working tree is clean; nothing
  is stranded locally.
- Based on `upstream/release/v0.38.0` (rebased onto the live tip, 81 commits
  absorbed). The one rebase conflict was `src/ui/i18n.resolved.generated/pending.ts`,
  resolved by taking upstream and re-running the generator, never by hand.
- Dev server was `npm run dev -- --host 0.0.0.0 --port 5190`. It does not
  survive a reboot. Kill strays before starting a new one: five orphaned Vite
  servers against this worktree were found at the start of this session, which
  is where the "ports keep changing" symptom came from.

## The environment, which is the thing that will waste your time

This work is in **WSL**, not native Windows. That contradicts older notes.

1. **Non-interactive bash skips `.bashrc`, so nvm never loads** and `node`
   resolves to the WINDOWS install through interop. Symptoms range from
   `ENOENT C:\Windows\package.json` to `Cannot find module 'C:\Windows\scripts\...'`.
   There is a wrapper at `/home/jbibbs/.claude-run.sh` that sources nvm, cds to
   the worktree, and execs its arguments. Use it for everything:

   ```
   wsl.exe -d Ubuntu -- bash /home/jbibbs/.claude-run.sh npm test
   wsl.exe -d Ubuntu -- bash /home/jbibbs/.claude-run.sh git push
   ```

   Linux node is nvm v24.18.0. Running `git push` WITHOUT this wrapper makes the
   pre-push hook fail to execute at all, and it then reports tsc, guard tests,
   and lint as all failing when none of them actually ran.

2. **`origin/main` (the fork's main) is far behind upstream.** `biome.json` sets
   `vcs.defaultBranch: "origin/main"`, so "changed files" resolves to ~3567
   files, and the lint step then trips on the repo's deferred lint debt (17
   errors in files this branch never touched). Fix by passing the branch's real
   base:

   ```
   GATE_SELECT_BASE=upstream/release/v0.38.0 npm run --silent ci:changed
   ```

   That env var is the sanctioned override (`scripts/lib/gate_discovery.mjs`)
   and the hook inherits it, so the push above went green legitimately rather
   than with `--no-verify`. **Syncing the fork's `main` to upstream would retire
   this whole class of false failure permanently.**

3. Jamie's house style: **no em dashes**. The pre-push hook enforces it on the
   push diff and will block. Parenthetical asides or a comma work.

## What changed, and why (the parts worth not re-deriving)

### The rider is pinned to `bone_52`, not a spine joint

Codex's first attempt anchored the rider to `tripo::Spine_0` and sampled the
BONE ORIGIN. Two independent problems: this rig is animated almost entirely by
rotation and rotating a bone does not move its own origin; and Spine_0 is not
what drives the saddle anyway.

Measured, not guessed (`~/avian-animation-working/analyze_saddle_motion.py` and
`verify_saddle_rigidity.py`, reports in `E:\avian-rig-diagnostics\animation\`):

- Seat surface is driven **58% bone_52, 40% tripo::Root, 1% Spine_0**.
- `bone_52` is unkeyed and parented straight to the root, so the whole saddle is
  RIGID relative to it. It sits at model y 0.607; the seat is at 0.606. Tripo
  placed a saddle bone there and nobody had used it.
- Worst-case rider drift across every frame of all four clips:
  **0.0007 world units on bone_52, 0.09 on Spine_0.** The latter was the float.

`BoneMotionAnchor` (`src/render/characters/bone_motion_anchor.ts`) converts the
authored seat point into the bone's local frame once at rest and converts it
back each frame. It also reports the bone's rotation delta, and `riderTilt: 1`
welds the rider to it so they stay square through twist and jump.

**Do not "simplify" this back to sampling a bone origin.** The test
`tests/bone_motion_anchor.test.ts` has a rotation case that fails if you do.

### Two shared-code changes, both opt-in and off everywhere else

Deliberately scoped so a mount PR cannot regress other rigs:

- `walkTimeScaleMax` / `runTimeScaleMax` on `VisualDef` (default 1.8 / 1.6). A
  mount travels at ONE fixed speed, so its time scale is a constant and the
  CEILING binds, not the walk/run reference. Past that point lowering a
  reference does nothing, which reads as a dead knob. This cost two rounds of
  tuning before it was spotted.
- `gaitWindDown` on `VisualDef` (default off). Brakes an outgoing locomotion
  clip to a HOLD in the first 20% of its crossfade, so the rest of the fade
  blends a still stride pose into idle. Without it the outgoing clip keeps its
  last cadence for the whole fade and a stop reads as the cycle racing to
  finish. Only `mount_avian_strider` sets it.

### Current tuned values

`src/render/characters/manifest.ts` → `VISUALS.mount_avian_strider`:

```
height: 4.32   yaw: Math.PI / 2
walkRef: 5.52  runRef: 7.16
walkTimeScaleMax: 2.0   runTimeScaleMax: 2.0
gaitWindDown: true
clips: Idle / Run (both forward bands) / WalkBackward / Jump
```

`src/render/mount_visuals.ts` → `avian_strider`:

```
seat: 2.62   seatFwd: 0.20   riderBone: 'bone_52'   riderTilt: 1
```

Real speeds, for computing any further tuning:
forward `RUN_SPEED 7 * (1 + moveSpeedPct 0.8) = 12.6` yd/s,
reverse `* BACKPEDAL_MULT 0.65 = 8.19`. Time scale is `speed / ref`, so a LOWER
ref is FASTER. Forward currently 12.6/7.16 = 1.76; reverse 8.19/5.52 = 1.48.
Both under the raised 2.0 ceilings, so roughly 13% of forward headroom remains.

### Audio

`mount_summon_avian_strider`, from `E:\finals\valestrider_mount.mp3`. Conformed
to the house standard (192kbps, 44.1, mono, true peak <= -6dBFS, loudness
preserved as authored). Gain trim **+7 dB** in `scripts/sfx/sfx_gain_map.json`,
which is exactly its measured ceiling (peak -8 dBFS targeting -1). It is maxed;
there is nothing left on that lever. More perceived loudness now needs a denser
master (crest factor), not a bigger number.

Fires on the summon channel's COMPLETION edge in `renderer.ts` (never on
dismount, never for a rider already mounted when they come into view) and
preloads on the channel's START edge. **The player's own summon plays
non-spatially** via `playUi`: the audio listener is the CAMERA, which trails the
player past `REF_DISTANCE` 5, so a positional source at your own feet is already
attenuating. Other players' summons stay spatial.

Gotcha found: `build_sfx_manifest.mjs` writes the manifest BEFORE the gain
ceilings, so a brand-new key ships gain 1 on the first run and its real ceiling
only on a second. **Run `npm run sfx:manifest` twice when adding a key.**

## Immediate next step: open the PR

1. Re-run the gate with the corrected base:
   `GATE_SELECT_BASE=upstream/release/v0.38.0 node scripts/gate_select.mjs`
   (via the nvm wrapper). Without the base it fails at "biome (changed files)"
   on pre-existing repo debt, which is NOT this branch's doing.
2. PR from `jamiecypher:feature/avian-mount` into upstream. Fill
   `.github/PULL_REQUEST_TEMPLATE.md`. Note in the body that two VisualDef
   options are added and are off for every existing rig.
3. `gh pr list --author jamiecypher` to find it afterwards; the repo has 200+
   open PRs.

Known non-blocking: a 1651-file `vitest related` run had 10 failures across 9
files, the visible one a 20s TIMEOUT in `tests/parity/coverage_c.test.ts`
(druid coverage, unrelated to mounts) under heavy parallel load. Re-run on a
quiet machine before treating any of it as real.

## Still open, in Jamie's words

- **Mount size vs player, and where the rider sits.** Still being dialled. The
  trap: `seat` is an ABSOLUTE world height, not a fraction of `height`, so
  changing the mount's size sinks the rider into the bird until `seat` is
  re-tuned by the same ratio. Offered but not built: making `seat` a fraction so
  size becomes one knob, and a dev-only live tuner (adjust height/seat/seatFwd
  in-game, print the final values to paste back).
- **Bird footprint decals** that appear and fade while running. Jamie will supply
  a silhouette. Investigated: `src/render/ability_vfx/decals.ts` already drapes
  over terrain and dissolves, and the stride accumulator in `renderer.ts` already
  fires per footfall with left/right alternation. Real caveats: the decal pool is
  12 slots shared globally and would need its own pool, and the scope question
  (this mount only, all mounts, or on foot) is unanswered. Existing decal
  textures are drawn procedurally into a canvas rather than loaded as images.
- No mount audio beyond the summon call (no gait cue authored).
