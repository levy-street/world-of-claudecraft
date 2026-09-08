# Avatar: shaped stone and ground-breaking activation

Avatar now opens the Warrior's stance and raises seven fractured stone slabs
behind and beside the character. Larger animated dust plumes, thrown fragments
and two tall mineral seams support that rise. The front stays open so the
character and weapon remain readable. The short activation settles away while
the real Avatar aura owns the worn stone and its duration.

The worn pieces are now a curved breastplate with a neckline opening, two
articulated elbow ridges and two shin guards. These replace the broad shoulder
blocks that crossed the helmet and weapon. The original armor colors remain
intact. The forearm ridges leave the grip side open, and follow the actual
forearm joints through movement.

This is a development milestone, not final AAA acceptance. The continuing worn
state still needs a stronger sense of weight and visibility from behind in dark
scenery. The activation's stone shapes and timing remain open to the full kit
review. Matching captures, including rejected designs, inform that review.

## Evidence

The new Avatar animation preserves all nineteen other decoded animation clips
exactly. All four power performances pass the planted-foot and native-track
checks, and the tested sword and shield remain above the source floor throughout
the sampled clips. The delivered animation SHA256 is
`3cafd8eb57ae64865cc0ad86c4adc8ddf771a3fab1ffbcdb3ca13f25e720a150`.

Independent checks sampled 142 poses across Idle, Running and Avatar. The final
chest and forearm shapes had no detected intersections with the actual head,
helmet, hand regions, tested buckler or tested greatblade. A further 5,396 rays
checked that their primary faces sat outside the skinned body. An earlier flat
chest candidate was rejected because it was buried inside the breastplate,
despite clearing the hands. The integrated vertices match the reviewed proposal
within floating-point precision. These checks cover the stated models and
samples, not every cosmetic, mixer transition or surface point.

Actual game captures cover six casts in the neutral Studio and six outdoors,
each across Battlecraft, Bloodrush and Ironguard from two camera sides. Every
cast starts movement at .65 seconds and has six matching stills through three
seconds. Both runs recorded no game errors and unchanged source. The outdoor
views include Eastbrook's bridge, scenery and different lighting; they are not
proof for every terrain slope or surface.

The shared power pool also completed 24 actual casts and 132 stills across all
six graphics presets, including real Avatar and Recklessness expiry. All four
power abilities were included; preset 5 records its actual custom settings.
The run recorded no game errors and unchanged source. This checks execution
and preservation across settings, not final artistic acceptance.

The focused checkpoint run passes 310 tests in 28 suites, plus canonical
`npm run check:ts`. It includes the authored geometry, actual native clips,
sound ownership, preparation, lifecycle, crowd preservation and architecture
checks. The canonical client build also passes, including generated assets and
backdrop checks. The development server's actual GLB and the production hashed
asset have the same recorded bytes. The broader project gate remains open as
recorded in the pass ledger.

## Runtime ownership

Four prepared instanced draws separately carry the chest, blood crown, forearm
ridges and shin guards. Their limits are 16, 96, 32 and 32 instances. Sixteen
wearers retain solid forms; up to 64 retain complete primary outlines, with
the local player prioritized. Avatar requires all three stone preparations and
all five valid bone anchors together. A missing component retains the complete
outline; it cannot leave half an armor set. Blood preparation stays independent.

The seven activation slabs borrow one existing sculpture slot. Dust and stone
fragments use existing pools. No pool capacity was increased for this milestone.
The taller mineral seams replace the older three streaks. A regression first
reproduced Red Harvest truncation when both versions overlapped; the final
composition preserves the full attack with eight storms, 64 triple-defense
wearers and 64 dual-power wearers. That combined case uses 4,832 of the existing
4,864 ribbon vertices.

The ground slabs use a rotated 5 by 5 height grid spanning eight yards. They
rise, settle and dissolve without implying an enemy hit or a damaging radius.
Cold or full sculpture pools still retain both complete mineral seams at every
sequence tier.

## Matching views

The pairs use the same camera, Ultra setting, Battlecraft loadout and canonical
time. The before images are from the saved power checkpoint, before this pose,
activation and armor rework.

| View | Before | Development result |
| --- | --- | --- |
| Activation, .30 seconds | [Before](../screenshots/v25-warrior-avatar/activation-before.png) | [After](../screenshots/v25-warrior-avatar/activation-after.png) |
| Moving, 1.50 seconds | [Before](../screenshots/v25-warrior-avatar/moving-before.png) | [After](../screenshots/v25-warrior-avatar/moving-after.png) |

[Outdoor activation](../screenshots/v25-warrior-avatar/world-activation.png) and
[outdoor rear movement](../screenshots/v25-warrior-avatar/world-moving.png) add
world-context evidence; these two are not before/after pairs.

Local evidence: `work/studio-contact-pass/warrior-avatar-runtime-shaped-1`,
`warrior-avatar-world-shaped-1`, `avatar-stone-shaped-final-dense-report.md`,
`warrior-power-quality-avatar-shaped-2`,
`warrior-avatar-checkpoint-tests-1.log`, `warrior-avatar-types-2.log` and
`warrior-avatar-crowd-red.log` / `warrior-avatar-crowd-green.log`.
