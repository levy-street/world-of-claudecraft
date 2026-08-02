# J3/J4: the voyage is not watchable yet (owner inspection, 2026-08-02)

Owner verdict on the J2 voyage AS WATCHED IN GAME: rejected. The mechanical
shot gate (tests/cinematic_shots.test.ts) is green with zero exemptions and
the contact sheets look fine as stills, but the moving experience fails.
LESSON FOR EVERY FUTURE CAMERA CHANGE: the linter and the contact sheets are
necessary, never sufficient. Watch the scene in motion (npm run dev, pay the
fare; or the editor Cinematic panel scrubber) before calling camera work done.

The owner's words, verbatim in substance:

- The camera is still zooming into the boat and the changes between screens
  are choppy, "as if you haven't watched it".
- After the last scene the mast blocks the character when controls return.
- The angles and perspectives make no sense; the journey is unwatchable.
- Arriving back at the mainland is fine, but the whole journey has stupid
  angles.
- Direction: the shots need to be FURTHER AWAY. Show the WHOLE boat. Think a
  movie. The angles cannot keep chopping and changing. The screens need to
  fade in showing the boat on its journey, not teleport from one scene to
  another "as if it's moving to a new boat".

## J3: re-author the voyage camera language (the big one)

What is wrong today, translated to authorable terms:

1. Framing is too close. The beam attach sits 11 yd off the hull and the
   opening jib starts 14 yd from the hull line, so the ship fills or
   overfills the frame and reads as a wall of planks. Every journey shot
   must frame the ENTIRE ship (hull, masts, sails) with generous water and
   sky around her. Think an establishing/wide vocabulary throughout the
   crossing, not deck-level closeups.
2. The cuts read as teleports. Each covered cut moves the ship to a new
   stretch of sea AND changes the camera side, height, and bearing at the
   same time, so every fade-in reads as a different boat somewhere else.
   The dissolves must read as ONE continuous journey: keep the ship in the
   same part of the frame, at a similar size, with the SAME screen heading
   across every fade pair. Fade out on her mid-frame, fade in on her
   mid-frame further along. Position, scale, and direction continuity
   across the dissolve is the whole trick.
3. One angle family for the whole journey. Pick a consistent side and
   general height for the crossing legs and keep it; the current mix (low
   stern-quarter jib, tight abeam, high bow-quarter) chops and changes.
   Variation belongs INSIDE a shot (slow drift, slow push), not between
   shots.
4. The release hand-back is broken at the destination: after the final
   scene the restored gameplay camera sits so the mast blocks the
   character. The release must return a camera with a clear line to the
   player. Note cut.releaseDelta only checks pose deltas, not occlusion;
   nothing mechanical guards this today, which is why it shipped.
5. The mainland ARRIVAL (docking + walk-off) is accepted by the owner as
   fine. Do not churn the landing dollies; the journey legs are the
   problem (opening, open water, and the transitions between them).

Mechanical constraints the next agent inherits (all learned the hard way,
all enforced by tests/cinematic_shots.test.ts):

- Every camera cut must occur at full black (cut.fadeSlack has no
  exemptions). Slower fades and real black holds are already available via
  coveredCut's CoveredCutOptions in src/sim/scenes/authoring.ts; the voyage
  currently uses fade 0.8 with hold 0.5 (VOYAGE_CUT in
  src/sim/content/last_bell_campaign.ts).
- continuity.shipScreenDirection fails any camera that PACES the ship:
  translation parallel to her course cancels her screen drift and the
  direction dot flips sign near zero. A camera position that holds its spot
  (or moves across/away from her course) with a gaze panning SLOWER than
  her angular rate is the robust grammar. Wider framing makes this easier,
  not harder: at 40 to 60 yd the angular rates drop and the margins widen.
- motion.propWay and motion.propAcceleration fail any vessel that stops or
  lurches on camera. Glides must keep moving until the covering fade
  reaches full black (castOff runs 5 s, openWater 5.5 s for this reason).
  If a leg gets longer on screen, lengthen the segment, never let her
  coast to a stop while visible.
- Segment pose positions rotate by the COMBINED yaw (baseRot plus pose.yaw)
  in composeHarborShipAttachFrame. Author world coordinates first, then
  invert that transform; never assume baseRot alone.
- The open-water track (360,-8) to (470,34) has a carved deep channel
  under it (the three crossing-channel stamps in HARBOR_TERRAIN_EDITS,
  src/sim/harbor_layout.ts). The swept hull envelope must stay inside
  carved water: the natural shelf grounds the hull (bottom -7.0 against a
  -5.7 to -6.9 floor, sea level -4.5). Widening or moving the legs may
  need the channel extended and the gap-chunk digest re-minted
  (tests/terrain_chunk_geometry.test.ts, in-rect Eastbrook pin must not
  move).
- Attach shots (rigid with the ship) pass shipScreenDirection via the
  screen-velocity floor and give free parallax; they are the cheapest way
  to hold a wide, steady journey frame. Dollies buy drift inside a shot
  but re-enter the pacing minefield.
- Re-pin after authoring: tests/last_bell_scenes.test.ts (durations, camera
  times, shot tables, walk and fade pins) and
  tests/prop_path_core.test.ts (cast-off segment pin).

Suggested watch loop: author, run npx vitest tests/cinematic_shots.test.ts
in watch mode, then ACTUALLY WATCH via npm run dev (pay Ewald's 10 c fare;
/dev tp 213 -48 mainland, /dev tp 745 116 gullhaven) or the editor panel
scrubber, then contact sheets last (npm run cinematic:contact-sheet with
the dev server on :5173).

## J4: boarding seam and ship art defects (owner screenshots, 2026-08-02)

From the owner's three inspection screenshots at the boarding bridge:

1. Stretched sliver geometry on the ship near the gangway/bulwark:
   long thin wooden spikes stab from the ship's rail across the deck and
   the boarding route, and near-wireframe-thin strands run the length of
   the deck through the gangway opening where the player stands. Almost
   certainly degenerate triangles left by the gangway cut
   (removeTrianglesInBox in scripts/assets/grand_ferry_ship/build.mjs)
   surviving or being created by the optimizer pass. The player visibly
   walks through them.
2. The bridge does not visually seat against the hull: seen from above
   there is a slice of open water between the bridge's ship end and the
   hull side, plus a pale translucent sliver hovering in the gap
   (z-fighting or a stray plane). Collision is tight; the visuals are not.
3. The mast bases render as flat dead-black slabs (reads as holes in the
   ship, worst behind Ewald's post).
4. A bridge rail cap overhangs its last post toward the hull and ends
   floating in mid-air (buildRail caps extend past the post run by design;
   at the hull end that overhang is naked).
5. The deck junction reads as patchwork from above: bridge, corridor, and
   the split berth-head rects meet as three plank fields with different
   board directions and visible seam shading, and the narrow bridge strip
   sits visually off-center against the wide corridor. Cosmetic, but it is
   the first thing the eye lands on.

Relevant seams: ship art and cut in scripts/assets/grand_ferry_ship/
(build.mjs, verify.mjs, committed source GLB, contract test
tests/grand_ferry_ship_asset.test.ts with the byte-for-byte
--verify-staged arm); bridge and rails authored in
src/sim/harbor_layout.ts (generatedBoardingBridge) and drawn by
src/render/harbor.ts (buildDeck with withPilings false, buildRail).

## State when this was written

Branch feature/last-bell-campaign, tip 399e4f1d6, worktree
/Users/chrisherrmann/Code/woc-last-bell. J1 (level crossing) is accepted
in stills; J2 (voyage) is mechanically green but rejected on watch. All
suites green on the tip: tsc, cinematic_shots (zero exemptions),
scene_lifecycle, last_bell_* suites, ferry walks and clearance, parity
191, terrain digests. Dev server for this worktree runs on :5173.
