# Warrior heavy contact development, 8 September 2026

The supplied Warrior board is the material target: forged steel with copper
bevels for Battlecraft, torn crimson enamel for Bloodrush, and substantial
segmented shields for Ironguard. This checkpoint develops those shapes and
their physical performances. It does not mark Warrior or v25 AAA-complete.

## Native performance

Maiming Strike, Early Grave, Bloodletting and Victory Rush now have separate
native Knight performances with distinct preparation, contact, hold and
recovery. Each lands at 0.15 seconds and returns within 0.75 seconds. Offline
180 Hz foot locking transfers weight through the hips without moving either
foot or adding a runtime solver. Shieldcrack retains the same exported family.

The review found that hand positions alone were misleading. A hand could be
forward while its actual sword pointed backward or below the victim. The new
regression loads the shipped animations and the real greatblade's geometry
bounds, applies the actual grip transform, and checks blade segments through
a representative forward torso region. This is a presentation check, not a
new simulation hitbox.

Twinstrike's first blade now contacts during the native cutting phase. Red
Harvest's last strike no longer holds both swords behind the Warrior: it loads
both low, drives them through the forward body region and recovers upward.
The torso and arms use coherent native donors. Numerical sword-mesh samples
across the final transitions clear the ground; body silhouette and clipping
still require continued visual review.

## Materials and scale

The new solid steel crescent has a dark forged face, narrow raised bevels,
front/back thickness and a curved cutting seam. Maiming Strike cleaves
diagonally, Early Grave has the largest descending steel cut, and Victory Rush
has an ascending cut. Bloodletting uses torn blood material and a hooked cut.
All use the existing bounded pools and share the previously generated maps.

Twinstrike's two cuts are enlarged. Red Harvest finishes with two much larger
opposed rising crimson wakes, red fragments and a short baked ground-dust
sprite animation. The body contact remains on the victim; the curved surface
sits on the receiving side so the model does not hide most of it. Both final
cutting seams remain at reduced detail. The active Warrior recipe now has
three shared texture uploads and six geometry preparations, 27 scheduled units.

Fully absorbed secondary victims now receive an absorb collision instead of
the former generic blood burst. They never create a second caster sculpture.
The tests exercise primary and secondary hit, absorb, miss, dodge and parry.

## Sound ownership

Five contact identities each have a new preparation and impact recording, with
two takes per cue: Maiming Strike, Early Grave, Bloodletting, Victory Rush and
Shieldcrack. Twenty half-second ElevenLabs generations were retained locally,
onsets trimmed and the short results conformed through the existing pipeline.
Prompts are in `scripts/sfx/warrior_contact_sfx.mjs`; private raw outputs and
the generation ledger remain under ignored `tmp/warrior-contact-audio/`.
The generation API was checked against the [official documentation](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert).

The retained presentation-clock queue now owns their recorded preparation and
0.15-second contact. Ready sounds suppress the immediate damage-event copies
in both the game HUD and Studio. A cold or unavailable queue leaves those
fallbacks available, including Early Grave. Misses and fully absorbed hits
do not play the flesh-impact recording; existing avoidance/block feedback stays.

The browser recording contains 15 real casts: 12 positive hits produce exactly
12 accepted impact cues, and three dodges produce no flesh impacts. All 15
preparations play. The initial Maiming Strike recording has a wall-clock hitch;
these recordings do not prove first-cast latency acceptance. The current agent
environment cannot listen to audio input, so waveform/conformance and routing
checks are not presented as an auditory quality review.

## Matching visual evidence

The original matrix requested values 0 through 5 and completed 36 real casts
and 216 stills with the expected positive-hit counts and no page/cast/context
errors. A later review found that Low is 1 and Insane is 6, so this original
matrix missed Insane. The 9 September backfill verifies resolved Insane before
and after nine real Warrior casts, including all six attacks below and
Shieldcrack, with 54 stills and no errors. Its retained report is
`studio-contact-pass/warrior-insane-backfill-final-1/report.json`. The focused native,
material, routing and audio suites pass 165 tests in 15 files. Five additional
integration suites pass after updating the exact catalogue and two-wake
composition expectations; their 122 tests cover the sound manifest/runtime
pack, combat sound helpers, physical compositions and shader-domain guards.

All pairs use preset 4, yaw 1.9, pitch 0.4, distance 18 and matching contact ticks.
The four new heavy clips compare with the earlier Warrior baseline. Fury
compares with the previous pushed material checkpoint.

| Ability | Before | Current development |
| --- | --- | --- |
| Twinstrike | [Before](../screenshots/vfx-v25-warrior-heavy/raging_gale-before.png) | [After](../screenshots/vfx-v25-warrior-heavy/raging_gale-after.png) |
| Red Harvest | [Before](../screenshots/vfx-v25-warrior-heavy/red_harvest-before.png) | [After](../screenshots/vfx-v25-warrior-heavy/red_harvest-after.png) |
| Maiming Strike | [Before](../screenshots/vfx-v25-warrior-heavy/mortal_strike-before.png) | [After](../screenshots/vfx-v25-warrior-heavy/mortal_strike-after.png) |
| Early Grave | [Before](../screenshots/vfx-v25-warrior-heavy/execute-before.png) | [After](../screenshots/vfx-v25-warrior-heavy/execute-after.png) |
| Bloodletting | [Before](../screenshots/vfx-v25-warrior-heavy/bloodthirst-before.png) | [After](../screenshots/vfx-v25-warrior-heavy/bloodthirst-after.png) |
| Victory Rush | [Before](../screenshots/vfx-v25-warrior-heavy/victory_rush-before.png) | [After](../screenshots/vfx-v25-warrior-heavy/victory_rush-after.png) |

Further work includes edge-on readability, first-cast performance, sustained
rotations, moving and multiple victims, terrain/background variation, reduced
motion, every quality setting, remaining Warrior states and attacks, all other
kits, and two complete visual improvement cycles. The full contribution gate
remains separate and open.
