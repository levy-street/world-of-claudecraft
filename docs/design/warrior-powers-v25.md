# Warrior power forms, v25 development work

These four abilities now have their own physical performance, sound and effect
language. They are being reviewed against the approved Warrior guide and
Tony's reference images. This document records implementation and evidence;
it does not declare the kit finished or AAA accepted.

| Ability | Intended experience | Implementation |
| --- | --- | --- |
| Avatar | The Warrior becomes an ancient stone champion. | An open, planted rising performance raises seven fractured slabs and broad animated dust. A shaped breastplate, articulated forearm ridges and shin guards follow the character for the real aura duration and the game's existing size increase. See [the Avatar rework and matching views](warrior-avatar-v25.md). |
| Recklessness | Deliberate restraint tears open into dangerous aggression. | A short opening performance and rising crimson pressure introduce six flowing blood flames. Broken edges, moving tendrils and embers replace the earlier solid red attachment. Battlecraft, Bloodrush and Ironguard retain different arrangements and color accents. |
| Blood Toll | A painful, deliberate payment is drawn inward and clenched into power. | Two inward sprite strands finish with the .15-second clench, followed by contracting vein strokes. The real health cost remains visible in health and combat text, without a second self-hit animation or flinch. |
| Seething Fury | The Warrior expels pressure and releases pent-up rage. | An outward arm performance, broad separated red strands and short tearing strokes give the release an outward direction, distinct from Blood Toll's inward payment. |

The base character colors remain intact. None of these activations substitutes
a plain circular shockwave, spherical barrier or false enemy impact. All four
native performances recover within .74 seconds. Continuous forms follow actual
auras; the two resource releases leave no invented long-duration buff.

## Animation and materials

Four native clips extend the existing animation file from sixteen to twenty.
Every decoded channel in the previous sixteen clips is unchanged. The new
clips use the native skeleton and offline leg solving. The Avatar attachments
sample real bone matrices, including measured model normalization, pose, terrain
tilt and the actual Avatar scale once. They do not infer scale from body height
or capture a single stationary pose as their attachment frame.

Stone has volume on every side, broad mineral facets and a pinched fault band.
Its pieces move with the skeleton rather than orbiting around the waist.
Recklessness uses one shared prepared material with animated deformation,
flowing erosion and additive crimson light. Reduced motion freezes texture
flow and explicitly disables vertex displacement, including while walking.
Additive light avoids the order dependence of alpha-blending unsorted instances.

A new Blender sprite supplies a second scale of detail. Its sixty-four frames
contain three advected, turbulent pressure strands, packed into a 2048-square
atlas with transparent gutters. This is an authored volume rendered in Cycles,
not a Mantaflow simulation. Mirroring, pivot placement, direction and playback
timing differ by ability. The source script and packing checks are retained;
the source scene and lossless master remain in the local authoring folder.

Eight release/climax cues, each with two ElevenLabs takes, add sixteen sounds.
Each actual activation owns one release and one .15-second climax. The existing
conformance, manifest and timed audio queue remain authoritative. Cold audio
retains the normal fallback.

## Runtime limits

The held forms now use four instanced draws: chest, blood crown, forearm ridges
and shins, capped at 16, 96, 32 and 32 instances. Sixteen
wearers receive solid forms; up to 64 retain their full primary outline, with
the local player prioritized. Neither pool borrows attack or shield slots.
Only live matrix and color prefixes upload. Ambient fragments are bounded and
never accumulate catch-up bursts after a slow frame or camera reentry.

The shared ribbon buffer preserves the previous 4096 vertices and adds exactly
768 vertices for both complete power outlines on 64 wearers. A regression test
first reproduced actual Twinstrike and Red Harvest truncation at the old
capacity. The enlarged buffer preserves every attack vertex even with storms,
64 triple-defense wearers and 64 dual-power wearers competing for space.

The large new sprite cannot enter a cast merely because its image is decoded.
It requires this renderer's successful explicit GPU upload. A small boot
dependency also prepares it for players observing a Warrior from another class;
deferred and active-kit preparation retain the same dependency. A cancelled or
failed upload, or a new renderer, stays cold while the core ribbon response
remains available. Tests reproduce both early-cast upload and observer-starvation
bugs before their fixes.

## Review still in progress

Matching real-cast captures have exposed and driven several reworks: flat stone
strips, a bulky waist-mounted stone cluster, rigid red hooks and overly smooth
smoke were rejected. The broad attached stone also intersected the head, hands
and equipment; the [subsequent Avatar rework](warrior-avatar-v25.md) replaces
those blocks with shaped, articulated armor and a larger activation. Its
measured fitting evidence and remaining art concerns are recorded separately.
Recklessness and
the resource releases also remain subject to the full kit visual review.

The initial four-power checkpoint passed 253 focused tests in 22 suites, canonical `check:ts`,
Biome over 38 scoped source files, and `npm run sfx:check` (the library retains
eight existing advisory loudness notices). Actual captures recorded:

- Four matching casts, 22 stills, including real Avatar/Recklessness expiry.
- Twenty-four casts and 132 stills across all six graphics presets; preset 5
  records its actual custom profile. This proves execution, not equal beauty.
- Twenty-two casts and 132 stills across three specializations and opposite
  camera angles. Each wearer moved 16.45 yards through actual movement commands.
  The sampled stone vertices stayed above the real floor; this does not prove
  continuous clearance on every animation or sloping terrain.
- Four actual audio/video recordings, each accepting exactly one release and
  one climax at the authored simulation beat, with no duplicate event. These
  are paced recordings, not independent listening approval or FPS benchmarks.

Every capture run recorded no game errors and frozen source. The quality,
movement and audio runs preceded only an import-order formatting correction;
the final matching run follows that correction. Local evidence lives in
`work/studio-contact-pass/warrior-state-power-checkpoint-final-7`,
`warrior-power-quality-checkpoint-1`, `warrior-power-motion-before-clearance-1`
and `warrior-power-audio-final-1`. The Blender atlas is 462024 bytes with SHA256
`68450efac5cc151da9592de459cf7b0b06994759fb85f2e68b1a3775794684ef`.

The committed pairs use the same camera, Ultra setting and canonical tick:
.30 seconds for Avatar/Recklessness/Seething, .05 seconds for Blood Toll's load.

| Ability | Before | Current development result |
| --- | --- | --- |
| Avatar | [Before](../screenshots/v25-warrior-powers/avatar-before.png) | [After](../screenshots/v25-warrior-powers/avatar-after.png) |
| Recklessness | [Before](../screenshots/v25-warrior-powers/recklessness-before.png) | [After](../screenshots/v25-warrior-powers/recklessness-after.png) |
| Blood Toll | [Before](../screenshots/v25-warrior-powers/bloodrage-before.png) | [After](../screenshots/v25-warrior-powers/bloodrage-after.png) |
| Seething Fury | [Before](../screenshots/v25-warrior-powers/berserker_rage-before.png) | [After](../screenshots/v25-warrior-powers/berserker_rage-after.png) |

Full kit review, world backgrounds, sustained combat and the two complete visual
improvement cycles remain open.

The shared project gate also still has the recorded provenance, historical
platform-test reconciliation and measured-coverage questions. Scoped test and
capture results do not replace those requirements. The public Site remains v24.
