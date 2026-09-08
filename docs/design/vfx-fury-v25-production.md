# Fury v25 production checkpoint - 8 September 2026

Status: implementation in progress. This checkpoint is not Warrior completion,
AAA visual acceptance, the full gate, or a published-site update.

## Implemented

- Twinstrike and Red Harvest own component-by-component contacts, including
  interleaved secondary victims. Missed components produce no wounds; absorbed
  components show protective contact. Extra component events cannot wrap the mask.
- The main character uses delivered native-rig animation clips with two different
  blade commitments and a separate rising cross-blade finisher. The exporter is
  scripts/build_fury_anims.mjs; both clips recover within 0.75 seconds.
- A lit torn blood sheet supports the strong blade edge. The generic duplicate
  slash composition is removed from the primary victim. Secondary victims retain
  their own timed wounds, without replaying the source performance or camera shake.
- Sequenced contacts are packed in the contact frame. The main slash has protected
  ribbon admission; projectile heads can displace decoration but not hard-control
  tells. Expired crest slots are reclaimed before a new contact is admitted.
- Crest geometry is compiled invisibly, every output program is settled and touched
  in a separate existing scheduling unit, then its real shared geometry is uploaded
  by the existing bounded draw. Failed preparation never declares the blood sheet
  ready. Cleanup attempts every child release even if another callback throws.
- Primitive preparation is extracted from renderer.ts. Its monolith ceiling is
  reduced, not increased.

## Evidence

Typecheck passed. The focused contract run passes 142 tests across 12 suites:
authored Fury clips, component outcomes, physical choreography, real FX frame
packing, hard-control bands, idle behavior, crest preparation, primitive preparation,
ribbon admission, signature clips, texture preparation and monolith budget.

Matching captures use studio-contact-pass/fury-review.mjs, real duel fixtures,
1400x900 viewport, camera distance 10, yaw 0.7 and 1.9, pitch 0.4. The baseline
is fury-resumed-baseline; the current composition is fury-checkpoint-1. Each set
contains 24 PNG frames and a report for four casts with expected two/three positive
components, no captured page errors, and no context loss. These are headless visual
smoke captures, not hardware performance evidence. The intermediate native-authoring
capture did not yet wire the new animation into the character manifest and must
not be cited as evidence for the delivered animation. native-wired does.

Sonnet supplied additional component test drafts. Parent review corrected the
secondary-victim blood expectations and replaced a non-demonstrating zero-bit
mask test with a seventeenth-hit overflow regression. Parent ran the tests. No
acceptance criteria were relaxed to make the implementation pass.

## Remaining before Fury acceptance

- Finish the art and sound review of both attacks; authored clips and larger shapes
  alone do not establish satisfying motion. Review real weapon contact and victim
  imprint from additional angles, at gameplay distance and repeated cadence.
- Exercise all quality settings, reduced motion, multi-enemy sustained overlap,
  contrasting backgrounds, and forced deferred/constrained preparation.
- Record headed, visible, normal-vsync, real-hardware first-use and repeated-cast
  performance. Normal boot screenshots do not establish shader preparation cost.
- Complete all other Warrior abilities, then Rogue and the remaining kits, followed
  by the two requested full visual review cycles and the unresolved full-gate work.

## Wolf production

The first generated Druid wolf candidate is structurally valid but visually too
slim and has placeholder quadruped walk clips reused for attacks. It is NOT applied.
Tripo job creature_druid_primal_wolf_v25_mts8ho0l consumed 90 credits, US$0.90.
A stronger builtin-imagegen concept was saved in the workspace at
studio-contact-pass/wolf-concepts/druid-primal-wolf-v2.png and supplied to a second
Tripo candidate. Final anatomy, rigging and individually authored animal attacks
still require review. The existing ordinary wolf and Shadewolf assets are preserved.
No private handoff or credentials belong in source control or generated public assets.


## Timed sound checkpoint, 8 September

The first art checkpoint was pushed as 3e14d2034b. Seven new Fury cue keys each
have two original ElevenLabs takes: separate blade preparation, first/return cuts,
and Red Harvest's final extraction. Fourteen raw half-second takes were generated
once; public cuts are 0.14-0.23 seconds with measured onset trims and short fades.
The bounded generation and conformance scripts retain provider provenance and
source/output measurements in ignored tmp/fury-audio. No provider price was
reported in response headers; do not invent a dollar total for this sound batch.

An independent 24-recipient presentation-clock queue retains claimed sounds even
if visual slots are reused or a target anchor disappears. Every take must already
be decoded before ordinary HUD/Studio material audio is suppressed. Cold/full/
missing-anchor cases keep the existing fallback. All seven keys preload at
startup, and the readiness path warms the whole missing set together. Misses and
complete absorption do not receive flesh impacts; ordinary block/crit cues remain.
Queue-owned samples have no global per-key cooldown, so simultaneous Warriors do
not silence one another. A regression reproduced coarse-frame visual/audio drift;
later visual beats now retain the authored first-contact origin rather than the
late frame that happened to cross it.

The sound-format check passes for the whole library; its eight advisory warnings
are on pre-existing mob/UI recordings, not these Fury assets. Focused sound,
component, manifest, consumer and loading tests pass; the renderer remains at its
unchanged 13,035-line ceiling. Full gate and auditory/art acceptance remain open.

Live headless WebAudio/canvas recordings are in studio-contact-pass/fury-audio-review.
Twinstrike produced six actual positive hit components and nine accepted recordings
across three casts. The Red Harvest duel ended early: five positive components,
one zero-damage component and seven accepted recordings across two resolved casts.
This is useful routing evidence, not a completed three-cast stress test. Both video
recordings include the actual audio output, with no captured page/context errors.
An initial recording harness imported a second dev-module audio instance and timed
out; the corrected harness records the actual sink installed on the renderer.
No human auditory approval or real-hardware frame-time acceptance is claimed.

The next material pass must replace the straight, sheet-like impression with a
curved blade wake and richer torn blood breakup while retaining the larger span.

Wolf candidate B passed structural QA at US$0.85, bringing Tripo spend to US$1.75.
It is the preferred mesh, still unapplied. Its autogenerated bone names, shoulder
parenting, jaw pivot and placeholder walk-as-attack clips require Blender repair.
Sonnet remained authenticated but a second bounded test request returned no file
before it was stopped after approximately fifteen minutes; parent wrote and
verified the queue tests. No user Claude window was stopped.


## Curved material and Warrior voice development, 8 September

Sound checkpoint 961dc988d8 is pushed. A tougher repeat fixture now resolves all
three casts of both abilities: Twinstrike has six positive components and nine
accepted recordings; Red Harvest has nine positive components and twelve accepted
recordings. Both actual WebAudio/canvas recordings have no cast, page or context
errors (studio-contact-pass/fury-audio-repeat). This supersedes the target-death
limitation above, without claiming human auditory or hardware timing approval.

The blood backing and its bright leading trails now share a curved, peeling
surface. Displacement is pinned at the leading seam throughout the lifetime.
The new gameplay-distance matrix (camera distance 18, pitch .4, yaw 1.9) contains
12 valid casts and 72 stills across all six graphics presets, with every expected
component and no page/context errors: studio-contact-pass/fury-quality-matrix.
Terrain, reduced motion, many-enemy overlap and real hardware performance remain
open. The scale has not been reduced.

Warrior shout concept art is stored outside the delivery assets. The first large
radial pressure-sheet prototype was rejected because it resembled spotted cloth.
The replacement uses tapered swept air streamers and a new Blender volume bake of
low rolling dust. These are in development, not accepted AAA art. Shouts do not
claim damage or repaint bodies. A caster wake is artistic presence, not a finite
buff boundary; Iron Bellow's party buff actually has unlimited range.

Two failing regressions were reproduced and fixed: secondary shout announcements
could enter generic victim-hit fallback, and freshly spawned pressure meshes
could ignore reduced motion for one frame. A third reproduced full-pool case
now lets a physical blood contact replace the oldest decorative pressure backing,
while a later shout cannot replace that contact. Supplemental shout ribbons have
decoration priority. Four broad dust volumes are authored once per cast; two
shouts coexist with two other volumes in the unchanged ten-slot pool, and refused
dust uses pooled smoke particles. Terrain height grids are sampled at spawn only.
Sonnet supplied the two exact native-clip expectation renames; the parent reviewed
the diff and passed the routing and authored-performance tests.


Tony explicitly requested sprite-based animation wherever it benefits the effect.
The Warrior wake already uses a 64-frame Blender-rendered dust sprite sheet,
combined with three-dimensional pressure geometry and pooled grit. Continue this
mixed approach for dirt, smoke, fire, sparks and contact transients across kits;
choose each medium for its actual visual role rather than replacing all effects
with one primitive family.

The second voice prototype (wire-like trails and detached dark puffs) was also
rejected. The current version combines an original generated turbulent-air
luminance texture on curved fans with the Blender dust sprites moving outward.
Dust has its own earthen palette. Its five terrain heights and the fan's 25-sample
height grid are prepared at birth, with no recurring terrain queries. Grid draping
is approximate on abrupt cliffs and requires visual verification.

Dust recipe: scripts/assets/vfx_production/bake_shout_dust.py, 64 frames at
496x496, Cycles 96 samples, then package_shout_dust.py at 248-pixel content plus
four-pixel gutters. Runtime is a 2048x2048 WebP, quality94, 517372 bytes; decoded
alpha exactly matches the lossless master. Both endpoints are transparent and all
frames retain unclipped margins. Source .blend, frames, metadata and lossless atlas
remain in ignored tmp/shout-dust-v25-final. This is an authored procedural volume,
not a Mantaflow simulation. Pressure source is the original generated image
exec-886d5248-a09f-43fc-ae53-4a0e10c46461.png, copied intact into the public asset.

A reproduced texture-ownership regression is fixed: crest materials now bind the
exact shared pressure texture after cloning an empty sampler, avoiding unmanaged
per-slot texture copies. A reproduced invalid-ground baseline case keeps finite
terrain uniforms. These checks supplement, not replace, in-game visual review.


## Active-kit preparation and incoming visual targets

The first world-slope review exposed a real readiness gap: the ordinary ability
entry timed out behind world preparation and the pressure carrier remained cold.
A 600-frame paused pump kept simulation tick zero but still did not reach the
catalogue entry; an independent unpaused run also remained cold after 600 frames.
The saved reports include the manifest, resume ledger and queue, not only a still.
This is delayed preparation, not a failed slow effect or a terrain shader verdict.

The local Warrior recipe now registers explicitly and resumes independently after
the loading manifest through the existing queue. Only blood_cut and three pressure
geometries plus their shared texture receive actionable priority. No loading
budget, pool ceiling, catalogue priority or readiness assertion is increased.
Duplicate compile submissions share the actual in-flight carrier task. Studio
selects the current class even on scene reuse and advances preparation with zero
simulation time and no intermediate presentation before it marks a take ready.
Ordinary gameplay retains three large directed pooled voice trails while the
sculpture is cold or occupied; it never uploads that sculpture from a cast.
This does not claim guaranteed exact first-cast sculpture on every driver.

Tony supplied the first illustrated reference batch in Desktop/123. Parent inspected
all eleven unique images; see [the implementation brief](vfx-reference-123-v25.md).
Treat each relevant image as a close visual target: record its
silhouette, primary/secondary/tertiary shapes, value and colour hierarchy, texture,
scale, material and inferred motion separately. Match the important visible
features in comparable captures, using sprites, particle systems, textured meshes,
lighting, animation and sound as their roles require. Improvements should preserve
or increase spectacle while strengthening the class/spec identity and combat
readability. Do not use the reference merely as a loose mood board, and do not
claim that a still proves timing or impact. The approved character guide and Riot
process checklist continue to govern kit consistency and equal player satisfaction.


The prepared outdoor matrix now contains eight real Piercing Howl casts: uphill
and downhill, two opposite camera angles, normal and reduced motion. All eight
apply the actual slow, cause no damage, and have no page/cast/context errors.
A separate debug take records challenge_pressure ready and active on the first
impact. Matching pressure-before/after and shout-development stills are committed
under docs/screenshots/vfx-v25-warrior-shouts. The shout development comparison
predates the lower mouth attachment and shorter grit streak refinement; its title
is deliberately not a final-acceptance label. Tree occlusion remains present in
some world angles, and the shared pressure vocabulary is not yet sufficiently
distinct for final acceptance of all seven shouts.

The active queue respects the game's shared first-paint boundary. Studio fails
explicitly after 45 seconds of unresolved selected preparation, retaining false
readiness. A pathological never-settling driver link can still hold the existing
renderer shutdown queue; this broader lifecycle limitation predates the active
recipe and is not claimed fixed by the Studio failure bound. Focused verification:
warrior-active-full-tests.log has 155 passes in 16 suites; active-kit-final-tests.log
has 178 passes in eight suites, including the additional policy and terminal-path
cases. These overlap and must not be added together. Full final-tree gate remains
open. Sonnet reached its bounded turn limit without a diff for the manifest test;
parent implemented and verified the factory-metadata inventory without weakening
its order, required/deadline or constrained-policy assertions.
