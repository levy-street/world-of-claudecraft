# Ferry fidelity program: the boat is real

Successor to docs/prd/cinematics-quality-program.md, specced from the owner
playtest of 2026-07-31 (the first walk of the rebuilt voyage). That walk confirmed
the cinematic engine and found the next layer of gaps: the ferry's physical
representation is a hand-measured sketch that disagrees with its drawn mesh, the
berthing choreography snaps instead of arriving, the cut pacing reads as dizzying,
and the dock dressing collides with the hull.

The bar for this program: **what the player sees is what the player collides
with.** The ship's visual mesh and its collision plan come from one definition, so
they cannot disagree; arrivals end where the ship parks; transitions dissolve
instead of cutting.

## The owner findings this program closes (traceability)

1. Island approach angle still wrong (F2).
2. Ship magically spins to park parallel at the island wharf; should park
   perpendicular, bow-in, like the mainland (F2).
3. Both docks have fence dressing across the berth footprint causing collisions
   (F2).
4. Return leg heads straight at the mainland dock then teleports to the
   perpendicular parked pose (F2).
5. Camera cuts are dizzying; prefer fades in and out, with the vessel already
   under way at fade-in (F3).
6. Docks are janky: ramps do not mate with the hull (you fall in the gap), there
   is no opening in the rail where you board (you walk through the handrail), the
   stern and hull are walk-through, collisions do not match the drawn boat (F1).
7. Ferryman Ewald faces away from the boarding entry (F4).
8. Use one ferryman shared by both ends (F4, owner decision 2026-07-31).

## Resolved decisions

1. **The ferry becomes a procedural asset.** grand_ferry_ship (a one-shot Tripo
   generated mesh, see CREDITS.md) is rebuilt as a procedural factory plus
   deterministic exporter under scripts/assets/, following the image-to-glb
   pipeline (.claude/skills/image-to-glb/SKILL.md,
   docs/image-to-glb-asset-workflow.md). The Tripo mesh retires.
2. **One definition emits both worlds.** The factory that builds the visual mesh
   (hull, deck, bulwarks and rails, the gangway opening, gangplank mating
   geometry) also emits the collision plan (shipDecks, shipRails including the
   gangway gap, hull volume blockers, ramp mating edges) as generated data. The
   hand-measured rects in src/sim/harbor_layout.ts are replaced by that generated
   plan. A contract test pins plan against mesh; divergence is a red test, never a
   playtest discovery.
3. **The gangway opening is real in both worlds.** A visible gap in the rail mesh
   AND the collider gap, from the same definition. Boarding happens through it and
   only through it.
4. **Both berths park perpendicular, bow-in.** The island berth pose is
   re-authored to match the mainland convention, and every approach or departure
   glide ends exactly at (or starts exactly from) the parked pose: no snap, no
   spin, no teleport.
5. **Dissolves, not cuts.** The film-grammar floor of one tick of black satisfied
   the letter and missed the intent: a 0.05 second black is still a hard cut.
   Scene transitions get a perceptual fade floor. The motion rule that a vessel is
   already under way at fade-in stands unchanged.
6. **No new engine features are required for solidity.** src/sim/player_motion.ts
   (swept collision, step-up, ledge snap-down, the climb gate) and the existing
   collider forms (walkable rects, thin OBB rails, ramp rects, blocking volumes)
   already support everything this program needs. The sim ferry remains static in
   the world model (voyage motion stays render-only presentation), so no moving
   platform physics is in scope.
7. **One ferryman stands at both ends.** Ferryman Ewald is the same visible
   character at the mainland and Gullhaven posts. He keeps his canonical Q0 giver
   link on the mainland template. No deck-rider work is in scope.

## Owner decision (2026-07-31)

- **One ferryman (finding 8).** The same Ferryman Ewald stands at both ends,
  following the classic MMO convention that he crosses with his boat. This is not
  the riding-keeper option, so no deck-rider work is required.

## Phases

### F1. The procedural ferry (the engineering phase, the long pole)

- **F1.1 Factory, exporter, contract.** A procedural ship factory and
  deterministic exporter under scripts/assets/ producing grand_ferry_ship.glb
  (same asset id and render binding in src/render/props.ts): hull, deck at the
  established boarding height, bulwark and rail runs with an authored gangway
  opening on the boarding side, gangplank mating geometry. Optimizer spec, media
  manifest regen, and a parsed-GLB contract test with source fingerprint pins,
  all per the image-to-glb workflow. Visual parity goal: silhouette and
  proportions close to the current ship (the owner approved its look, not its
  physics); deck height, hull length, and draft stay compatible with the authored
  harbor berths unless F2 moves them deliberately.
- **F1.2 The generated plan.** The same factory definition emits the collision
  plan consumed by src/sim/harbor_layout.ts: shipDecks walkable rects, shipRails
  as the full rail perimeter MINUS the gangway opening, hull volume blockers so
  bow, stern, and superstructure cannot be walked through, and ramp mating edges
  shared flush with the gangplank rects (no gap). The hand-measured shipDecks and
  shipRails entries are deleted in the same change. sim purity holds: the sim
  consumes generated DATA (a generated .ts module or equivalent), never the GLB.
  Contract test: the plan values equal the exporter's measured mesh dimensions
  within named epsilons.
- **F1.3 The boarding walk.** End-to-end walk tests in the established multi-seed
  pattern: a player walks the pier, up the gangplank through the opening, around
  the full deck perimeter; cannot pass any rail run, the stern, or the hull from
  any side; cannot fall between ramp and deck; can leave only back through the
  opening. Keeper posts sit consistent with the opening. The cinematic linter's
  hull sweep and rider containment arms read the generated plan (replacing any
  test-local bounds source) so the linter and the world agree on one hull.

### F2. Berthing choreography

- **F2.1 Perpendicular berths, continuous glides.** Re-author the island berth
  pose bow-in perpendicular to the wharf, and re-author all four glide segments
  (out and back, depart and arrive) so each arrival segment ENDS at the parked
  pose and each departure segment STARTS from it. Watching the ship arrive and
  watching it park are one continuous motion.
- **F2.2 Clear the berth footprints.** Gap or move the dock fence dressing (both
  harbors) clear of the hull's parked footprint and its approach sweep.
- **F2.3 Linter arm: berth pose continuity.** A mechanical check that the first
  and last samples of every prop glide segment equal the parked pose the world
  renders outside the cue, within named position and yaw epsilons, plus a
  synthetic failing control. This retro-catches findings 2 and 4 as a class.

### F3. Cinematic pacing

- **F3.1 A perceptual fade floor.** Replace the one-tick full-black floor with a
  named perceptual constant for minimum fade duration at every transition, wired
  through the authoring builder (coveredCut and fadeInTail defaults in
  src/sim/scenes/authoring.ts) and enforced by the film-grammar arm with an
  updated synthetic control. The exact value is a named literal the owner can
  tune after a walk.
- **F3.2 Re-author the voyage to dissolve pacing.** Fewer, softer transitions on
  the builder; every fade-in reveals a vessel already under way
  (motion.propWay unchanged); all linter arms green with zero exemptions; a fresh
  contact sheet for review.

### F4. Staging

- **F4.1 Keeper facing.** Ferryman Ewald faces the boarding entry at both posts;
  pinned by the fixture tests.
- **F4.2 One ferryman.** Use the same Ewald identity at both posts while keeping
  the canonical Q0 giver link on `ferryman_ewald`. Retire the second keeper and
  reuse Ewald's visible identity, localization, and voice.

## Sequencing, parallelism, delivery

- F1 is the long pole; start it first. F1.1 and F1.2 share the factory definition
  and land together or in sequenced rounds in one worktree; F1.3 follows them.
- F2.1 and F2.2 are content and can run parallel to F1, EXCEPT that final hull
  clearance validation depends on F1's hull plan; re-run the linter after both
  merge.
- Only ONE task at a time may edit tests/cinematic_shots.test.ts (F2.3, F3.1;
  the lesson of the last program). F3.2 follows F3.1 and F2.1.
- F4.1 is independent and small. F4.2 follows the owner decision above.
- Delivery matches the cinematics program: each task in its own scratch worktree
  off feature/last-bell-campaign, committed with Conventional Commits, reviewed
  against this PRD, merged locally (no push, no PR), targeted suites plus tsc at
  each merge, full gate at the end measured against the documented pre-existing
  failure set (see docs/prd/cinematics-progress.md, Final verification).
  Progress board: docs/prd/ferry-progress.md.
- Expect the parity goldens and the Eastbrook provenance seals to need their
  established re-mints if renderer.ts or world content shifts (recipes:
  tests/parity/CLAUDE.md UPDATE_PARITY flow;
  tests/eastbrook_polish_artifact_integrity.test.ts recipe comment).

## Acceptance for the program as a whole

- The owner walk: board through a VISIBLE gangway opening; cannot walk through
  any rail, the stern, or the hull anywhere on the ship; no gap between ramp and
  deck; both arrivals park perpendicular bow-in with no spin and no teleport; the
  berth fences no longer collide; transitions are dissolves; the vessel is under
  way at every fade-in.
- One definition provably emits both the mesh and the plan: the contract test
  fails if either side changes alone.
- The cinematic linter runs green with the LEGACY_EXEMPTIONS table still empty,
  every new check covered by a synthetic control (the MechanicalCheck meta-test
  enforces this automatically).
- The hand-measured shipDecks and shipRails entries no longer exist in
  src/sim/harbor_layout.ts.
