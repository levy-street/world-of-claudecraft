# J5 to J9: voyage polish round two (owner playthrough, 2026-08-02)

Owner verdict on J3/J4 AS PLAYED: "we're getting really close", but seven
defects remain. The J3/J4 lesson repeats with a sharper point: the
mechanical gate was green with zero exemptions and the defects shipped
anyway, because the linter EXEMPTS exactly the samples where the worst one
lives (the rig entry ease). Investigate first, decide the cause, then fix;
the leads below are hypotheses with code anchors, not confirmed diagnoses,
except where marked CONFIRMED IN CODE.

The owner's words, verbatim in substance:

1. Still not a complete railing along that last stretch of boardwalk. There
   needs to be a way to confirm this in code; the system we built should
   confirm this.
2. The rope on the gangway is gone, but there is still a hole in the ground
   not matching the edge of the boat; slightly more flooring is needed
   there (screenshot committed at
   docs/screenshots/last-bell-j5/owner-bridge-corner-hole.png).
3. The transitions between shots are still horrible. Wanted: fade out, then
   fade INTO the new shot, without showing how the camera got from the old
   shot to the new one. All of that travel must happen during the black;
   the fade-in should reveal the boat already sailing in the new shot.
4. The ferryman disappears on the middle shot.
5. The boat should come into the dock from a wider angle; today it does an
   unrealistic parking manoeuvre.
6. Same returning to the mainland: the boat should slowly pull into the
   dock left to right, not look like it is doing a u-turn.
7. A weird teleport at the start: the camera seemingly starts at the
   destination, then slingshots back to the mainland to begin the journey.

## J5: railing completeness, and the audit the owner expects (issue 1)

Find the stretch first: walk the mainland boardwalk end to end in npm run
dev (/dev tp 213 -48) and screenshot where the rail run stops. Candidate
causes, in likelihood order:

1. buildRail draws a rail at ONE height sampled at the run's center
   (src/render/harbor.ts, buildRail's deckY parameter comes from
   harborSurfaceHeight at rail.x/rail.z). The outer-pier rails at the
   mainland (x 215, hw 9.5) span the seam ramp (x 219 to 224.5) whose
   surface climbs from -0.2 to the berth-head height; a rail drawn level at
   the center height runs UNDER the rising walk surface near the ramp top,
   which reads as a missing railing on exactly "the last stretch". The
   collider (harbor_layout rails) has the same single-height semantics.
2. An authored gap: the berth-head south run deliberately stops at the
   split-deck corner for the hull's arrival sweep
   (src/sim/harbor_layout.ts, the berth-head rails comments). If the owner
   is pointing at that stretch, the fix is a design decision (close it and
   re-check the arrival sweep clearance), not a bug.

The REAL deliverable is the audit the owner asked for: a Node test (or a
lint arm in tests/ferry_berth_clearance.test.ts's family) that derives,
from HarborDef alone, every walkable deck-edge segment whose far side is
open water (no abutting deck or ramp within a small step at matching
height) and asserts each such segment is covered by a rail collider,
except an explicit allowlist of authored openings (the bridge gangway gap,
ramp seams, entry ramps, the arrival-sweep corner). Rails that dive under
a rising ramp surface must fail the audit too (compare rail height + post
height against harborSurfaceHeight along the run, not just at its center).
This is the same measure-do-not-assume culture as the ship plan: the data
to check is all in src/sim/harbor_layout.ts.

## J6: the bridge-to-hull corner hole (issue 2)

CONFIRMED GEOMETRY in the owner screenshot: the J4 overlap
(BRIDGE_HULL_VISUAL_OVERLAP_YARDS = 0.6 in
src/render/harbor_boarding_junction_core.ts) extends the bridge planks
straight ahead into the hull, but the hull edge at the gangway station is
NOT parallel to the bridge end: the hull tapers (the silhouette stations in
the ship plan), so a rectangular extension leaves a dark water wedge at one
corner of the opening, right where the player stands. Fix direction: give
the bridge's hull end an apron wider than the bridge itself (extend
laterally as well as forward, e.g. an extra half-yard of boards and
underslab each side at the hull end, tucked under the hull side wall which
occludes any overshoot), or derive the apron's reach per side from the
plan's silhouette (GRAND_FERRY_SHIP_PLAN + berth transform, same math as
generatedBoardingBridge's skin line). Render-only; the walkable rects in
src/sim/harbor_layout.ts must not change. Re-pin
tests/harbor_boarding_junction_core.test.ts (boards-inside-rect assertions
will need the apron rect added to the owner set).

## J7: cuts must not show the travel (issues 3 and 7, one root cause)

CONFIRMED IN CODE. Two interacting mechanisms:

1. Every dolly/attach shot EASES from the previous camera pose over
   SCENE_RIG_ENTRY_SEC = 0.8 s (src/game/scene_director_core.ts, the
   rigEaseFrom handoff into evaluateSceneRigPose in scene_rig_core.ts).
2. A coveredCut reaches full black only from cut-0.25 s to cut+0.25 s
   (VOYAGE_HOLD_SECONDS 0.5 split around the cut) and fades back in over
   0.8 s starting at cut+0.25 (src/sim/scenes/authoring.ts
   expandCoveredCut; VOYAGE_CUT in src/sim/content/last_bell_campaign.ts).

So from cut+0.25 to cut+0.8 the fade-in is revealing a camera that is
STILL TRAVELING from the previous shot's pose to the new one: a visible
half-second sweep across the strait on every cut. That is exactly "showing
how you got from the old shot to the new shot". Issue 7 is the same bug at
the scene opening: the fare handler teleports the rider to the DESTINATION
ship before the scene starts (see the header comment in
tests/last_bell_scenes.test.ts), so the pre-scene live camera is at the
destination; the first shot's entry ease then sweeps from the destination
back to the departure harbor while the opening fade-in reveals it: the
"slingshot".

Why the gate missed it: the linter deliberately skips entry-ease samples
(rigEntryEase / entryEase in tests/cinematic_shots.test.ts, the
`if (rigEntryEase) continue` in the sample loop and the entryEase guards
in lintShipScreenDirection and lintMinimumVisualMotion). The exemption was
authored for shots that take the camera VISIBLY (where easing is right);
covered cuts inherit it and hide the sweep from every check.

Fix direction (decide, then implement one):

- PREFERRED: snap instead of ease when the cut is covered. The authoring
  layer knows which camera ops are covered (expandCoveredCut emits them);
  mark those ops (e.g. an `entry: 'snap'` field on the wire camera op, or
  on the shot def) and have the director skip the rig entry ease for them
  (scene_director_core applySceneOp / evaluateActiveShot). The fade-in then
  reveals the new shot already holding frame, which is the owner's exact
  ask. Visible non-covered shots (none in the voyage today) keep the ease.
- Alternative (blunter): hold black across the whole ease (raise
  VOYAGE_HOLD_SECONDS so fadeClearAt >= cut + SCENE_RIG_ENTRY_SEC). Slower
  feel, keeps the hidden sweep, and the opening slingshot would need the
  same treatment via the open cut's hold.

Whichever lands, CLOSE THE LINTER HOLE in the same change: during any
window where fade opacity is below full black, camera motion must satisfy
the pan/dolly/pose-continuity caps with NO entry-ease exemption (i.e. the
exemption may only apply while the overlay is at full black). Add a
synthetic failing control that fades in over an easing camera and prove it
fires; then the real scenes prove the fix. Re-pin last_bell_scenes if op
shapes change. Watched AND skipped paths both matter (the release path
already snaps under black; verify with the wrapper test pattern in
tests/scene_lifecycle.test.ts).

## J8: the ferryman disappears mid-crossing (issue 4)

Hypothesis, unconfirmed: renderer entity-visual culling by distance from
the player. Offline, the rider's real entity is already AT the destination
during the voyage (teleported at pay time), so mid-strait the departure
ship is roughly 250+ yd from the player entity; if character visuals cull
against a draw radius (src/render/renderer.ts entity retention around the
harborDeckRiderActive arm in src/render/harbor.ts), Ewald's visual drops
exactly on the middle leg and pops back for the arrival ship (whose keeper
stands at the destination, near the player). Investigate: find the visual
retention radius, confirm harborDeckRiderActive is consulted by that
culling path and not only by parked-entity retention, and check the
nameplate path too. Fix: while a harbor ship cue is live, deck riders
resolved onto that ship must bypass distance culling (they are rigidly
attached to a prop the camera is attached to; their world distance is
irrelevant). A Node test can pin resolveHarborDeckRider retention; the
visual-culling arm may need a browser check via the editor scrubber or a
watch capture at the open-water beat.

## J9: the docking approach reads as a u-turn (issues 5 and 6)

The arrival glide segments (LAST_BELL_PROP_PATH_SEGMENTS in
src/sim/content/last_bell_cinematics.ts) start at local (-40, -13/+13,
yaw -1.4/+1.4) and swing 80 degrees in 7 seconds while covering 42 yd:
with the camera rigidly attached, the whole world pivots 80 degrees around
the viewer, which reads as a hard parking manoeuvre at both docks. Owner
direction: a long shallow approach, the boat sliding into the berth
left-to-right, from a wider angle out.

Authorable fix: re-author both arrival segments to start further out along
the hull's parked axis with a SMALL yaw offset (order 0.2 to 0.4 rad, not
1.4), decaying to 0 at the berth: mostly-straight bow-first glide. The
constraints inherited from J2/J3 all still bind:

- prop.arrivalDirection (tests/cinematic_shots.test.ts): seaward start of
  at least 12 yd, travel and bow dots at least 0.95, end within 0.5 yd of
  the berth. A straighter approach RAISES the dots; this check gets easier.
- continuity.berthPose: the segment must end exactly at the parked pose.
- The swept hull envelope must stay in carved water: a longer, straighter
  approach line changes the sweep at both harbors; extend the carved
  basins (HARBOR_TERRAIN_EDITS in src/sim/harbor_layout.ts) if the
  envelope grounds, and expect the gap-chunk digest re-mint
  (tests/terrain_chunk_geometry.test.ts, in-rect Eastbrook pin must not
  move). The mainland approach from the north (along the hull axis) runs
  over the already-carved berth basin chain; check the gullhaven line.
- prop.speed cap 12 yd/s world-space: a longer path needs a longer
  duration; the seaArrival-to-park beat window is 7.05 s today, so either
  keep the glide inside it or move the beats and re-pin durations
  (tests/last_bell_scenes.test.ts, tests/prop_path_core.test.ts).
- motion.propWay: she must still be moving when the park cut reaches full
  black (segment end no earlier than the fade-out's black point).
- Pose positions rotate by the COMBINED yaw in
  composeHarborShipAttachFrame: author world coordinates first, invert.

Verify ON WATCH from the attach camera: the berth should drift into frame
and grow, the horizon staying put, no world-pivot.

## Watch loop and acceptance

Same as J3: author against npx vitest run tests/cinematic_shots.test.ts in
watch mode, then ACTUALLY WATCH full crossings both directions in npm run
dev (pay Ewald's fare; /dev tp 213 -48 mainland, /dev tp 745 116
gullhaven), inspect the boarding junction and the boardwalk rails on foot
at both docks, then contact sheets and the committed voyage preview last
(npm run cinematic:contact-sheet with the dev server on :5173). The gate
being green is necessary and never sufficient; J7's linter hole is the
third instance of that lesson, so land the new mechanical checks WITH the
fixes, not after.

## State when this was written

Branch feature/last-bell-campaign, worktree
/Users/chrisherrmann/Code/woc-last-bell, tip after the J3/J4 round (J3
6c63cf2d3, J4 875f391cd, review closure 05e0c3f19, re-mints 99ffe8f40 and
the media-manifest chore). Gate state: tsc, biome (changed), malware, sfx,
and all five builds green; full vitest green except the 8 documented
pre-existing branch-debt files (28 tests: the WebSocket-in-Node family,
the Intl midnight pair, prod_cpu_monitor) plus load-flakes that pass
standalone. cinematic_shots runs with LEGACY_EXEMPTIONS pinned empty and
two synthetic controls on cut.releaseSightLine. J1 (level crossing) and
the J4 seam fixes are owner-accepted except the corner hole above; the J3
journey framing and the landing dollies are accepted; the cut transitions,
the opening slingshot, the docking approach, the mid-shot ferryman, and
the boardwalk railing are the open set, J5 to J9 above.

## Outcome (implemented 2026-08-02, J5 to J9 all landed)

- J5: cause was BOTH leads. buildRail drew each run at one center-sampled
  height (rails dove under the seam ramps at both harbors), and each
  berth-head corridor kept a 2.4 yard authored opening past the split-deck
  corner. Rails now follow the surface they protect
  (src/render/harbor_rail_profile_core.ts, level runs byte-identical), the
  corridor openings are closed with rails the clearance suite proves the
  sweep misses, and the audit the owner asked for is
  src/sim/harbor_rail_audit.ts + tests/harbor_rail_audit.test.ts (deck-edge
  coverage arm and drawn-profile arm, failing controls on both). The audit
  immediately caught two shipped Gullhaven defects, both fixed: a 3 yard
  open-water channel between the outer run (ended x 750) and the pier head
  (starts x 753), and the head seam ramp buried so deep under the lower
  pier the walkway stepped down two sheer yards.
- J6: silhouette-derived apron (bridgeApronRects): a wing past each side
  rail and a forward strip, each clamped one groove shy of the measured
  ship deck section it fronts (HarborDef.shipDecks IS the transformed
  silhouette), so the boards meet the receding hull and never co-plane
  with the ship floor. Junction test pins the pieces.
- J7: covered cuts author entry 'snap' on their camera op; the director
  holds the new shot's frame from its first tick. The linter's entry-ease
  exemption now applies only under full black and never to snap shots; a
  synthetic control (scn_test_lint_covered_cut_ease_bad) proves a fade-in
  over an easing camera trips the motion caps, with a snap twin green.
  The opening slingshot was the same ease from the destination live pose.
- J8: every culling arm measured the ferryman's PARKED coordinates while
  his rig rode the ship. The character frustum cull now centers on the
  group's live position, and deck riders on a live cue keep the near
  articulated rig with a real shadow (no far-LOD swap). Renderer-loop
  change; verify on watch at the open-water beat.
- J9: the towardBerth lint metric (travel toward the shore line at 0.95
  with the bow pinned to travel) mathematically forced the 1.4 rad swing;
  it is re-derived as a yaw-swing cap (0.45 rad) with the over-swing
  synthetic control authored in the old parking shape. New glides run down
  each hull's parked axis (mainland from the north strait side, Gullhaven
  from the north bay), 0.3 rad decaying to 0, seaward lateral bias keeping
  the swept hull clear of every rail; two new mid-sea basin stamps carve
  the stern-reach water (gap digest re-minted, Eastbrook pin unmoved).

Gate state: tsc, biome (changed files), and every touched suite green
(cinematic_shots with the closed exemption and new controls, ferry berth
clearance, harbor rail audit, boarding junction, scenes, harbors, fare,
Q0, terrain chunks, farshore, trajectory reports). Heavy sim suites still
flake under full-parallel load and pass in bounded batches, as documented
in the J3/J4 state note. Still owed to close the loop: the watch pass
(full crossings both directions), on-foot rail inspection at both docks,
and fresh contact sheets; the mechanical gate is necessary, never
sufficient.
