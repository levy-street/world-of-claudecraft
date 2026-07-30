# Cinematics workflow

This is the canonical authoring, framing, review, and gate contract for
World of ClaudeCraft cinematics. Scene data stays a pure function of the
simulation clock. Runtime presentation, editor scrubbing, the shot linter,
and contact-sheet capture evaluate the same authored definitions and pure
camera and prop math.

Documentation changes land with the code they describe. Cinematic docs must
never trail the engine. Use stable paths, exported symbols, and pinned test
files as anchors, never line numbers or inventory counts.

## Stable system anchors

| Concern | Stable path and exported surface |
|---|---|
| Typed authoring | `src/sim/scenes/authoring.ts`: `buildScene`, `beat`, `coveredCut`, `fadeInTail` |
| Registry and op types | `src/sim/scenes/registry.ts`: `SceneDef`, `SceneOpDef`, `SceneMusicDirective`, `registerScene`, `sceneById`, `registeredSceneIds` |
| Typed prop cues | `src/sim/content/last_bell_cinematics.ts`: `LastBellPropCueId`, `LAST_BELL_PROP_PATH_SEGMENTS`, `LB_PROP_CUE_PARK` |
| Runtime camera evaluation | `src/game/scene_director.ts`: `SceneDirector`; `src/game/scene_director_core.ts`: `applySceneOp`, `scenePose`; `src/game/scene_rig_core.ts`: `sceneRigCameraPosition`, `sceneRigLookAtPosition` |
| Runtime overlay and props | `src/ui/hud/scene/scene_controller.ts`: `SceneHudController`; `src/ui/hud/scene/scene_overlay_view.ts`: `overlayApplyOp`, `sceneOverlayView`; `src/render/harbor.ts`: `buildHarbors`; `src/render/prop_path_core.ts`: `propPathPoseAt` |
| Editor framing | `src/editor/cinematic_panel.ts`: `CinematicPanel`; `src/editor/cinematic_scrub_core.ts`: `evaluateCinematicScrubFrame`; `src/editor/cinematic_capture_core.ts`: `createCinematicCameraCapture` |
| Contact-sheet review | `scripts/lib/cinematic_contact_sheet_plan_core.mjs`: `planContactSheet`; `scripts/lib/cinematic_contact_sheet_html_core.mjs`: `renderContactSheetHtml` |
| Shared clock and seed | `src/world_api/scenes.ts`: `IWorldScenes.presentationTime`; `src/world_seed.mjs`: `WORLD_SEED` |

## The four-step loop

### 1. Author

Author every new or changed scene through `buildScene`. Use a beat map for
named timing, `coveredCut` for a cut protected by full black, and
`fadeInTail` for the final reveal. The builder emits a plain `SceneDef`, so
the runtime registry remains unchanged. Register it with
`registerScene(buildScene(...))`; the shipped voyage definitions in
`src/sim/content/last_bell_campaign.ts` are the reference composition.

Keep prop cues and music directives inside the closed types owned by
`SceneOpDef`. Do not widen a cue or directive to `string`, and do not cast
around a compiler error. Add `subjectRef` when a shot is intended to frame a
named fixture, entity, or ship target. The reference must resolve near the
authored look-at.

Keep the linter open while authoring:

```sh
npx vitest tests/cinematic_shots.test.ts
```

Vitest reruns the same mechanical gate on saves. Run `npx tsc --noEmit` for
the typed authoring surface. A registered production scene also needs a real
campaign trigger, or the orphan check fails.

### 2. Frame

Start the dev client with `npm run dev`, open `/editor`, and use the
Cinematic panel. `CinematicPanel` provides the production scene picker,
playback and fixed-tick scrubber, authored-camera toggle, fade and letterbox
preview, and current-camera capture. `evaluateCinematicScrubFrame` rebuilds
the requested frame from the selected scene and the real editor world.

Capture a useful composition with the panel instead of hand-typing world
coordinates. `createCinematicCameraCapture` records terrain-relative camera
and look-at points plus the shared seed, tool id, and capture date. The dev
save path updates `src/editor/cinematic_captures.generated.ts`, and the
panel also provides paste-ready source.

The current panel does not draw linter violations as viewport gizmos. Keep
the watch-mode shot linter beside the editor and use its named violation,
op, time, threshold, and measurement to drive the framing change.

### 3. Review

With the dev client running, capture one scene or the complete registry:

```sh
npm run cinematic:contact-sheet -- --scene <scene-id>
npm run cinematic:contact-sheet -- --all
```

The default output is `docs/screenshots/cinematics`. `planContactSheet`
selects a deterministic midpoint inside each authored camera window and
uses deterministic filenames. `renderContactSheetHtml` pairs every still
with this intent checklist:

- Named subject visible.
- Expected text visible.
- Frame differs from the previous one.

Review the sheet for composition, staging, readability, and purposeful shot
changes. Then perform the owner walk in the real game, watching the scene
and exercising skip. The owner walk judges the finished experience; the
mechanical defects should already have been found during authoring.

### 4. Gate

Run the focused cinematic gate while iterating:

```sh
npx vitest run tests/cinematic_shots.test.ts tests/scene_lifecycle.test.ts
npx tsc --noEmit
```

Before handoff, run `npm run gate`. The full gate includes the same shot
linter, lifecycle smoke, skip sweep, and synthetic-control meta-test through
the Vitest suite. CI is the backstop for cross-cutting regressions such as a
terrain edit, harbor move, model rescale, registry change, or presentation
teardown change. It is not the first feedback loop for a scene author.

## Mechanical check taxonomy

`tests/cinematic_shots.test.ts` owns the machine-readable check ids,
thresholds, synthetic scenes, shared-seed capture, and the empty legacy
exemption pin. It samples every registered scene against the following
taxonomy.

### Collision and support

- `collision.hull`: the swept authored hull footprint must not penetrate
  pier decks, ramps, terrain, or the water floor.
- `support.entity`: every presentation entity must remain on terrain, a
  pier or ramp, or a displaced ship deck.
- `containment.rider`: the deck stand-in, riding NPCs, and a walking player
  must keep their feet on the displaced deck and remain inside its bounds.

### Motion quality

- `motion.panRate` and `motion.dollySpeed`: camera rotation and travel stay
  below the named comfort limits.
- `motion.poseContinuity`: position and orientation remain continuous
  inside a shot.
- `motion.cutJump`: a large camera jump between shots occurs only under
  full black.
- `motion.propWay`: a vessel under way keeps visible forward motion,
  including when a fade reveals it.
- `motion.propAcceleration`: visible vessel acceleration stays below the
  named lurch limit.
- `motion.visualFloor`: a visible shot has subject motion, camera travel,
  camera rotation, or parallax above the authored floor.
- `prop.segment`: every cue resolves to a pure path segment whose evaluated
  pose remains finite.
- `prop.speed`: ship paths stay below the world-space speed cap.
- `prop.arrivalDirection`: an arrival starts seaward, travels and points
  toward the intended harbor, and finishes at its berth.

### Film grammar

- `clearance.terrain`, `clearance.water`, and `clearance.volume`: the camera
  stays above terrain and water and outside harbor and live ship volumes.
- `visibility.terrain`: terrain does not occlude the subject sight line.
- `framing.size` and `framing.direction`: the subject remains a useful size
  and stays inside the camera field.
- `cut.heldDuration`: each shot is held inside the named duration bounds.
- `cut.bracketing`: cinematic HUD mode, letterbox, and input lock bracket
  the authored camera sequence and are cleared at the end.
- `cut.firstTransition`: the first cut is under full black or eases from the
  live camera pose.
- `cut.finalRelease` and `cut.releaseDelta`: the final camera op releases
  gameplay control without an uncovered position or orientation jump.
- `cut.fadeSlack`: every cut has at least one sim tick of full black.
- `fade.symmetry`: every authored fade to black has a later authored clear
  before scene end.
- `timing.opWithinDuration`: every authored op time lies inside the scene
  duration.
- `cut.teardown`: camera release, input unlock, and letterbox-off ops are
  all authored.
- `continuity.shipScreenDirection`: a moving ship keeps its horizontal
  screen direction across adjacent shots unless full black separates them.
- `continuity.standInHandoff`: the moving deck stand-in hands back to the
  real player only under full black.

### Reference resolution

- `reference.music`: each directive resolves through the director, a
  shipped sampled mapping, or the explicit future-directive allowlist.
- `reference.orphan`: every prop segment is cued, and every registered
  production scene has a classified campaign trigger.
- `reference.subject`: `subjectRef` resolves to a named presentation
  fixture, entity, or ship target near the shot look-at.
- `reference.lineKey`: every subtitle key resolves in the generated
  localization catalog.
- `reference.subtitleReadTime`: every localized subtitle receives enough
  authored time under the readability ceiling.

### Lifecycle

`tests/scene_lifecycle.test.ts` is the registry-wide behavioral gate. Its
watched smoke drives every registered scene through the real `Sim` and the
Node-safe presentation models, then asserts exact restoration of camera,
input lock, overlay, fade, music, scene playback, scripted walking, and deck
stand-ins.

Its skip sweep exercises scene start, scene end, and authored op boundaries.
Each skip must restore the same lifecycle baseline and converge to the
watched quest, campaign, and entity state. This is the generic parity guard
for actor and player movement during teardown.

### Synthetic-control meta-test

Every member of the shot linter's `MechanicalCheck` union ships with a
synthetic failing control in `tests/cinematic_shots.test.ts`. The meta-test
compares the union mirror with those controls and fails when a check has no
control. The main gate then runs every control and requires the expected
named arm to report. A check is not complete when only the production scene
passes; its deliberately bad scene must fail for the intended reason.

## The two invariants

### One clock

All scene presentation reads authoritative simulation seconds through
`IWorldScenes.presentationTime`. Offline this is `Sim.time`; online it is
the latest mirrored server presentation time. `SceneDirector`,
`SceneHudController`, and `buildHarbors` receive that clock, while the pure
evaluators consume explicit scene time.

`tests/architecture.test.ts` scans the named scene-presentation modules and
bans `performance.now()`, `Date.now()`, and an unparameterized `new Date()`.
It also pins each injected presentation clock to
`IWorld.presentationTime`. `tests/scene_presentation_clock.test.ts` proves
the director, overlay, and harbor prop poses remain in lockstep across a
stalled sample.

### One seed

`WORLD_SEED` in `src/world_seed.mjs` is the only shipping cinematic world
seed. The client, shot linter, trajectory report, contact sheet, and editor
camera capture import it instead of copying a literal.

`tests/world_seed.test.ts` pins the exported value and each importing
surface. A new cinematic tool must import `WORLD_SEED` and add itself to
that pin test in the same change.

These invariants make editor frames, linter samples, contact sheets, and
runtime playback comparable. Without one clock, the layers can observe
different poses under load. Without one seed, they can disagree about
terrain, clearance, and the subject's world.
