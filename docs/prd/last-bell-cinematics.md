# The Last Bell cinematic framework (C0 to C6)

The cutscene system rebuild, specced after the owner's 2026-07-28 review of
the first voyage cinematic ("looks like a bug" HUD, camera clipping the map,
shots that show nothing). The ferry crossing is the deliberately simple
proving case: the framework locked here carries every later campaign
cutscene (Q3 raising, Q4 council, Q6 fleet, Q8 seal, Q9 wound, the ending).

Owner requirements, verbatim intent:
1. Cutscene mode hides every HUD element (letterbox alone is not enough).
2. The camera must never clip terrain or props; it has to know the world.
3. The voyage reads as film: leave with the boat moving on the water, a
   sailing shot at sea, arrival at the far dock, the player walking off the
   pier, then a hand-back to the gameplay camera.
4. The build/view/edit/review loop must be systematic, with the cinematic
   craft checkable, not discovered in playtests.

## Principles (the architecture this locks in)

- **A scene is a pure function of time.** World state settles BEFORE the
  scene starts (the fare teleports at pay time), every op is presentation,
  so `t -> camera pose + subject poses` is deterministic and scrubbable.
  Skip stays trivially consistent; this is non-negotiable for every future
  cutscene.
- **Pure evaluators, shared three ways.** The camera-rig and prop-path math
  live in Node-testable pure cores consumed identically by the runtime
  director, the shot linter, and the editor scrubber. The sim never knows
  what a camera is (existing contract, unchanged).
- **The world is queryable without rendering.** `terrainHeight(x, z, seed)`,
  `WATER_LEVEL`, the harbor/ship rects, and prop volumes are pure code, so
  mechanical shot correctness is a Vitest, not an eyeball pass.
- **Three review layers.** (1) Mechanical rubric in CI (the linter).
  (2) Contact-sheet stills for composition/aesthetics (capture script,
  reviewed by the agent and the owner). (3) The owner's in-game walk, last,
  not first.

## Verification policy

Default: targeted vitest while building, then ONE headless-browser pass at
the end (boot, play the scene, contact sheet) before handoff. When the
owner invokes the constrained-machine exception (as in the 2026-07-28
session): reading plus `tsc` only, the owner drives all in-game checks in a
tight loop, and the deferred suites/browser pass run later on their word.

## Phases

Dependency spine: C1 and C2 are the keystone evaluators; C4 consumes them;
C5 consumes everything; C0, C3, and C6a are parallel side tracks.

| Phase | Status |
|---|---|
| C0 | Shipped |
| C1 | Shipped |
| C2 | Shipped |
| C3a and C3b | Shipped |
| C4 | Shipped |
| C5 | Shipped |
| C6a | Shipped |
| C6b | Superseded by P4 of `docs/prd/cinematics-quality-program.md` |

The shipped authoring and review contract now lives in
`docs/design/cinematics-workflow.md`.

### C0. Cinematic mode (HUD hide) - independent, do first

While a scene is active, the HUD enters cinematic mode: everything hides
except the letterbox bars, the subtitle line, and the skip hint. The end op
(watched or skipped) is the unconditional teardown, restoring the HUD in
one step.

- `src/ui/hud/scene/`: the overlay controller toggles a `cinematic-mode`
  class on the HUD root from the existing start/end op handling (the same
  place letterbox state lives; no new event plumbing).
- `src/styles/`: one rule set in the HUD layer hiding the HUD roots under
  `cinematic-mode` (frames, bars, minimap, chat, tracker, action bars,
  buttons); the scene overlay stays visible. Mobile controls included.
- Tests: extend the overlay view/window tests (mode flag on the model) plus
  the styles scan if it pins class inventories.
- Acceptance: during any scene no HUD element is visible; Esc-skip restores
  everything instantly; no flash of HUD between the voyage's spliced halves.

### C1. Pure camera rig evaluators - the keystone

New pure core `src/game/scene_rig_core.ts` (registered in the pure-core
allowlist) evaluating, per time sample:

- `dolly`: camera position on a piecewise cubic (Catmull-Rom) spline
  through authored world points, look-at from its own track (fixed point,
  second spline, or a subject reference), eased time along the spline.
- `attach`: camera posed in a moving prop's local frame (offset + local
  look-at), so a shot rides the ship.
- Output shape stays compatible with the director's `ScenePose` handoff and
  the release ease.

Wire: `SceneWireOp` camera shot union gains `dolly` and `attach` beside
`focus`/`release`; `src/sim/scenes/scenes.ts` passes the data through
untouched (authoring shapes resolve world coords exactly as focus shots do
today). The director (`scene_director_core.ts`) delegates pose evaluation
to the rig core; blending from/to gameplay pose reuses the existing ease.

Tests: rig core unit tests pin continuity (no pose jumps inside a shot),
easing endpoints, attach-frame math, and degenerate inputs (single-point
spline, zero duration).

### C2. Prop path segments (the subject track) - parallel with C1

The prop cue grows from the single cast-off drift into authored pose-to-
pose glides: a cue names a segment (start pose, end pose, duration, ease)
and the ship glides it. Cuts between voyage segments re-pose the ship
freely (each cut is its own segment; the crossing compresses honestly).

- Pure core: generalize `src/render/harbor_cast_off.ts` into
  `prop_path_core` (same allowlist treatment); `harbor.ts` keeps the
  handle registry, the freeze contract (auto-update only while a cue is
  live), and the reset-on-end contract unchanged.
- Wire: the `prop` op's cue payload carries the segment id; segments are
  authored data-as-code beside the scene defs.
- Tests: path core continuity/clamping; the existing cast-off tests fold in.

### C3. The player on the boat and off the pier - two parallel parts

- **C3a deck stand-in (render, client-only).** During sailing cuts the
  renderer poses a stand-in of the local player's character on the ship's
  deck attach point (the character builder already exists; the stand-in is
  pure presentation, torn down on scene end). No sim knowledge.
- **C3b scripted player walk (sim).** New scene op `playerWalk` steering
  the PLAYER entity to a point through the normal movement kernel under
  input lock: authoritative, host-identical, and the skip fast-forward
  places the player at the endpoint (the existing applyOnly arm). Tests in
  the scenes suite: watched walk and skipped walk end identically.

### C4. The shot linter - after C1 + C2

`tests/cinematic_shots.test.ts`: for every registered scene, sample the
rig and prop evaluators at 10 Hz and assert the mechanical rubric:

- Clearance: camera above terrain + clearance margin, above water when at
  sea, outside harbor deck/ship/prop volumes.
- Visibility: the shot's subject unoccluded by terrain along the sight
  line.
- Framing: subject projects inside the frame at a sane size (percent of
  frame height bounds) through the shot.
- Motion: pan rate and dolly speed caps, no pose discontinuity inside a
  shot, position/orientation jumps only under full black (fade state
  tracked from the op list).
- Cut discipline: held-shot duration bounds, letterbox/input-lock/HUD-mode
  bracketing, the final release delta bounded.
- Continuity: the ship's screen direction keeps its sign across cuts
  unless a fade separates them.

Thresholds live as named consts with comments; a failing shot names the
scene, the op, and the offending sample. Every future campaign cutscene
inherits this gate for free.

### C5. The voyage, re-authored - after C1 to C4

The content phase, authored against the linter from the first draft:

1. Cast-off: attach-rig stern shot, the ship gliding out of the bay
   (segment 1), bell toll, harbor ambience.
2. Open water: low attach side shot mid-strait (segment 2), sail creak;
   the deck stand-in visible both cuts.
3. Arrival: bow-quarter attach shot gliding to the far berth (segment 3),
   fade to black at the rail.
4. Fade up on the pier: `playerWalk` a few steps down the gangway under a
   short dolly, then camera release. First crossing splices the Q0 arrival
   beats (statue, toll) after the walk-off; re-rides end at the release.
5. Both directions authored (mainland out, Gullhaven back).

Review: linter green, contact sheet reviewed, then the owner walk.

### C6. Tooling - parallel once C1/C2 exist

- **C6a contact-sheet capture (before C5 review).** A script boots the
  offline world headless, buys the fare (or `/dev`-triggers a scene id),
  captures one still per cut boundary plus one every 2 seconds, and writes
  a folder the owner and the agent both review. This is the default
  final-verification artifact under the policy above.
- **C6b editor Cinematic panel (after C5, lower priority).** The world
  editor viewport gains: scene picker, a time scrubber driving the SAME
  pure evaluators over the real renderer, spline/look-at gizmos, and
  "copy current free-camera pose as a keyframe" for hand-framing shots.
  Scrubbing is exact because scenes are pure functions of time.

## Parallel work plan

| Track | Phases | Can start |
|---|---|---|
| A: presentation frame | C0, then C1, then C4 camera rubric | now |
| B: subject/prop | C2, C3a | now (parallel with A) |
| C: sim | C3b | now (independent) |
| D: content | C5 | after C1+C2+C4 |
| E: tooling | C6a after C1/C2; C6b after C5 | mid-program |

Suggested single-agent order when serial: C0, C1, C2, C4, C3b, C3a, C5,
C6a, C6b. C0 ships alone immediately (the owner sees it next playtest).

## Non-goals

- No depth of field, rack focus, or lens simulation (fov + pose + look-at
  is the whole lens model).
- No real-time WYSIWYG keyframe editing of arbitrary tracks; the editor
  panel scrubs and captures poses, authoring stays data-as-code.
- No walkable moving vessel: the crossing remains a cinematic (the
  standing harbor-program decision).
