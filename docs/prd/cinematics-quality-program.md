# Cinematics quality program: the AAA authoring workflow

The successor program to `docs/prd/last-bell-cinematics.md` (C0 to C6), specced after
the 2026-07-30 full review of the shipped voyage cinematic. That review confirmed the
architecture (pure evaluators, sim/client split, mechanical linter) and found the gaps
this program closes: two presentation clocks that desync under load, a linter that
validates terrain on the wrong world seed, invisible subtitles, a ship that plows the
pier, a floating ferrykeeper, dead-stop ship motion on camera, and an authoring loop
where problems are discovered at the gate instead of while authoring.

The bar for every phase is AAA: the engine makes bad cinematics hard to author, gives
live feedback while authoring, and the gate exists to catch cross-cutting regressions,
never to be the place an author discovers a mistake.

## Completion note

| Phase | Landed result |
|---|---|
| P0 | One mirrored presentation clock, one shared world seed, shipped subtitle and statue fixes, and scene teardown liveness |
| P1 | Closed cue and directive types, the `buildScene` authoring layer, and the voyage re-authored through it |
| P2 | Collision and support, motion quality, film grammar, reference resolution, lifecycle, and synthetic-control completeness gates |
| P3 | Deck-NPC riding, reduced-motion static compositions, live-pose easing, and development tripwires |
| P4 | Editor Cinematic panel: fixed-tick scene framing, violation gizmos and readout, fade preview, and provenance-bearing camera capture |
| P5 | Deterministic contact sheets and the canonical `docs/design/cinematics-workflow.md` authoring contract |

Every phase has a landed implementation, including both rounds of the P4 editor
panel.

## Resolved decisions

1. **The statue is placed, not retargeted.** Q0's quest text anchors it ("east past
   the harbor steps and the old statue"): a statue-and-plinth fixture goes at the
   `Q0_STATUE_SHOT` look-at point (818, 120) in Gullhaven, using the existing statue
   prop family in `src/render/props.ts`, so the shot, the `lb.q0.scene.plinth` line,
   and the quest log all agree.
2. **Deck-posted NPCs ride the displaced ship.** During a prop cue, any entity whose
   support rect is that ship's `shipDecks` plan gets the ship's render displacement
   applied to its visual transform (nameplate included), exactly like the deck
   stand-in. The ferry crew stays at its post through the whole glide; nothing pops
   out of existence. Hiding is the fallback only if a rider is mid-interaction.
3. **Reduced motion is a static-composition mode, not a broken scene.** The scene
   plays in full (letterbox, subtitles, fades, music, prop motion, timing) but every
   camera shot holds its single most representative pose (the shot evaluated at its
   midpoint) instead of traveling. Fades already bracket every cut, so reduced-motion
   playback is a crossfaded slideshow of the authored compositions. Camera travel is
   the vestibular trigger; object motion inside a static frame is fine. The player's
   rig stays visible whenever the scene camera is inactive.

## The workflow this program builds

1. **Author** scene content through the typed builder (`src/sim/scenes/authoring.ts`)
   with the shot linter open in watch mode. A typo is a `tsc` error; a bad fade or a
   hull clip is a named red test within a second of saving.
2. **Frame** shots in the editor Cinematic panel: scrub the real renderer with the
   same pure evaluators, violations drawn as gizmos, camera poses captured back into
   data. No hand-typed coordinates.
3. **Review** with the deterministic contact sheet (composition, per-still intent
   checklist), then the owner walk.
4. **Gate** in CI with the same checks, guarding against cross-cutting regressions
   (terrain edits, harbor moves, model rescales) that break scenes nobody touched.

Two invariants make every layer trustworthy:

- **One clock.** All scene presentation (camera shots, fades, prop glides, subtitle
  timing) advances on the mirrored sim clock. Wall-clock time never drives a scene.
- **One seed.** The shipping client, the shot linter, and every cinematic tool share
  a single exported world-seed constant.

## Phases

### P0. Foundations

Everything else lies without these. P0.1 to P0.4 are independent and parallelizable.

- **P0.1 One clock.** Move the scene director, scene HUD controller, and harbor cue
  driver off `performance.now()` onto the mirrored world clock (offline `sim.time`,
  online the mirrored server tick time). Wire through the `deps.now` seams in
  `src/game/scene_director.ts`, `src/ui/hud/scene/scene_controller.ts`, and
  `src/render/harbor.ts`. Guard: an architecture-test scan banning wall-clock calls
  in scene presentation modules, plus a fake-clock test asserting ops and eased poses
  stay in lockstep across a simulated multi-second stall.
- **P0.2 One seed.** A single shared world-seed constant imported by `src/main.ts`,
  `tests/cinematic_shots.test.ts`, and `scripts/lib/cinematic_trajectory_report_core.mjs`,
  with a pin test.
- **P0.3 Shipped-bug fixes.**
  - Subtitles: the `.scene-subtitle` stylesheet rule defaults to `display: none`
    while the painter reveals with `setDisplay(el, '')`, which resolves back to the
    stylesheet. Fix the painter/stylesheet pair and add a real-CSS computed-visibility
    test (real stylesheet, not the fake painter host) so the class of bug is gated.
  - Statue: place the fixture per decision 1 and give `Q0_STATUE_SHOT` a `subjectRef`
    once P2 lands it.
- **P0.4 Liveness cluster.**
  - Client teardown watchdog armed from the `start` op's `duration` and the reconnect
    state's `remainingSeconds`; on expiry it runs the same unconditional teardown as
    the `end` op (director and overlay both).
  - Sim-side start-audience tracking: `end` (and terminal teardown ops) go to every
    pid that received `start`, not the live proximity audience.
  - Tests: start-without-end tears down at duration plus margin; a participant who
    leaves the audience box mid-scene still receives `end`.

### P1. Authoring layer: can't-author-it-wrong

- **P1.1 Typed references.** Prop cue ids become
  `keyof typeof LAST_BELL_PROP_PATH_SEGMENTS | typeof LB_PROP_CUE_PARK`; music
  directives become a closed union (sampled set, `silence`, `resume`, and an explicit
  future-phase allowlist). A typo fails `tsc`.
- **P1.2 The builder.** New pure module `src/sim/scenes/authoring.ts`: beat-relative
  timelines, `coveredCut(at, shot)` (fade lead, dur-0 black on the cut tick, fade
  clear), `fadeInTail`, and scene duration derived from the last op. Emits plain
  `SceneDef`s; the registry does not change.
- **P1.3 Re-author the voyage on the builder,** fixing the authored defects in the
  same change: instant black at t=0 before the first cut (the destination-spoiler
  fix), a fade back in at every scene end, real fade slack at all six cuts, and
  constant-way ship eases so the vessel never dead-stops or lurches on camera.

### P2. Linter arms: detection, watch-mode fast

Every arm ships with a synthetic failing control, and the phase closes with the
meta-test: the synthetic-controls table must cover every member of the
`MechanicalCheck` union (this also backfills the missing occlusion and
ship-screen-direction watchmen).

- **Collision and support.**
  - Swept hull vs world: an authored hull footprint box per ship, transformed by
    `propPathPoseAt` at every sample, tested against pier/ramp/deck rects, terrain,
    and water floor.
  - Nothing floats: every scene-space entity is within epsilon of a supporting
    surface in the presentation world (terrain, pier rect, or the ship deck at its
    displaced pose).
  - Rider containment: the deck stand-in, riding NPCs, and the walking player never
    have an air gap or leave the displaced deck bounds.
- **Motion quality.** Prop velocity continuity (no dead stop or lurch on camera,
  nonzero way at fade-in for a vessel under way); minimum visual motion per shot
  (subject screen motion, camera pose delta, or parallax above a floor); first-cut
  bracketing (the gameplay-to-first-shot transition is eased or under black).
- **Film grammar.** Fade slack of at least one tick of full black at every cut; fade
  symmetry (every black has an authored clear before end); every op's `at` falls
  inside the scene duration; release, unlock, and letterbox-off all present.
- **Reference resolution.** Music directives resolve; prop segments and scenes have
  no orphans (registered but never cued or never triggered); opt-in `subjectRef` on
  shots asserts the named subject exists near the look-at; every line key exists in
  the catalog; subtitle read time meets a chars-per-second floor across locales.
- **Lifecycle.** The scene smoke test: play every registered scene headlessly to
  completion and assert exact baseline restoration (HUD, input lock, camera, stand-in
  disposed, fade cleared, music resumed). The skip sweep: for each scene, skip at
  every tick and assert teardown invariants plus watched-identical world state
  (closes the `actorMove` parity gap generically).

### P3. Engine behavior the checks demand

- Deck-NPC riding per decision 2 (render-side, same seam as the deck stand-in).
- Reduced-motion static-composition mode per decision 3, with a pin test that the
  old dead state (hidden HUD, locked input, static camera, invisible rig) cannot
  recur.
- Dolly and attach shots ease from the live camera pose on their first frame, as the
  director's comment already promises (today only focus shots do).
- Dev-build runtime tripwires: warn when an entity's support rect belongs to a
  displaced ship without riding, or a hull box overlaps a collider. Backstop for
  stale pinned model constants; the CI arms remain the guarantee.

### P4. Editor Cinematic panel (C6b)

Built before the next campaign cutscenes are authored; the largest item and the
biggest efficiency payoff. In `src/editor/`: scene picker; a time scrubber driving
the same pure evaluators over the real `Sim` plus `Renderer`; violation gizmos (hull
box, support rays, framing bounds, red on violation, exact because scenes are pure
functions of one clock); copy-current-camera-pose-as-keyframe writing into a marked
generated block with capture provenance (seed, tool, date). Scrubbing is exact by
construction after P0.1.

### P5. Tooling and the canonical workflow doc

- Contact sheet: deterministic after P0.1; fix the tail-cut dead zone and the HMR
  guard in `readSceneRegistry`; wire an npm script; add a smoke test; add the
  per-still intent checklist to the sheet's HTML (named subject visible, expected
  text visible, frame differs from the previous one).
- `docs/design/cinematics-workflow.md`: the canonical description of the four-step
  workflow, the full check taxonomy, and the two invariants. Everything else points
  here.
- PRD hygiene: update `docs/prd/last-bell-cinematics.md` phase statuses; name the
  cinematics gate in `docs/qa-gate.md`.

## Documentation placement: progressive disclosure, no bloat

The rule: **top-level files get one pointer line each; the detail lives next to the
code that needs it and in one canonical workflow doc.** An agent (or human) working
on scenes finds the rules because the directory they are editing carries them.

| Location | Gets exactly | Loaded when |
|---|---|---|
| Root `CLAUDE.md` | One seam bullet under Modularity ("New cinematic/scene: author through `src/sim/scenes/authoring.ts` against the live shot linter; see `docs/design/cinematics-workflow.md`") and the one-clock/one-seed invariant line | Always (kept to two lines total) |
| `src/sim/scenes/CLAUDE.md` (new) | Authoring rules: builder-only, typed cues and directives, `subjectRef`, registry conventions, the local test commands | Editing scene content or the scene system |
| `src/game/CLAUDE.md`, `src/ui/CLAUDE.md`, `src/render/CLAUDE.md` | One line each: scene presentation runs on the sim clock; link to the workflow doc | Editing the director, overlay, or harbor props |
| `tests/CLAUDE.md` | One line: every linter check ships with a synthetic control (enforced by the meta-test) | Editing tests |
| `docs/design/cinematics-workflow.md` | Everything: workflow, taxonomy, invariants, rationale | On demand, via the pointers above |

Doc deltas land in the same PR as the code they describe; the docs never trail the
engine. Anchors follow the repo anchor rule: stable paths, exported symbols, pinned
tests, never line numbers.

## Sequencing, parallelism, delivery

- Order: P0 first (its four tracks in parallel), then P1 and P2 in parallel (they
  meet at P1.3, which is authored against the new arms), P3 behind its P2 arms, P4
  after P0 to P2, P5 riding along per phase plus one closing PR.
- Rough sizing: P0 and P1 are days each; P2 is wide but each arm is small; P4 is the
  long pole.
- Branch strategy: all work lands as a PR series into `feature/last-bell-campaign`
  (the engine exists only there), each PR gated with `npm run gate`, each carrying
  its tests and its doc delta.

## Acceptance for the program as a whole

- The three shipped defect classes (invisible subtitles, hull-through-pier, floating
  deck NPC) each have a failing-then-green check, and the voyage passes all arms.
- A fresh author can build a new cutscene end to end using only the builder, the
  watch-mode linter, and the editor panel, without reading the engine source.
- `vitest watch tests/cinematic_shots.test.ts` gives sub-second feedback on a content
  save.
- The contact sheet is byte-reproducible for the same scene and seed.
- Root `CLAUDE.md` grew by no more than two lines.
