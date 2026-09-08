# Redhand and Brute Swing development, 8 September 2026

Redhand now lifts a greatblade through the enemy; Brute Swing drives it down.
Both have separate native Knight performances, substantial forged steel wakes,
target contact and compact sound identities. This is a development checkpoint,
not final AAA acceptance.

## Mechanics and visual hierarchy

Redhand currently costs 15 rage, stores two rechargeable uses, and grants a
separate empowerment stack for the next Maiming Strike. The empowerment lasts
15 seconds, stacks twice and is consumed in full by the next Maiming Strike
attempt. One or two copper glints now follow the real weapon. They read the
live aura, including replicated stacks, and clear on consumption or death.
They do not recolor the model or create a floor circle. An armed Reaver Strike
keeps its separate cue.

Brute Swing is the free Battlecraft builder, generating eight rage with a
four-second cooldown. Its descending steel cut has short baked dust sprites
and stone chips at ground contact. Redhand instead throws split metal splinters
upward. Both remain below the execution scale of Early Grave and Red Harvest.
Historical usage ranks their investment, but does not establish current balance.

## Performance and material work

Both clips contact at 0.15 seconds. Brute returns at 0.64 seconds and Redhand at
0.62 seconds. Offline foot locking preserves the original rig dimensions and
planted feet while the hips transfer weight. Actual greatblade geometry was
sampled across the transitions: the proposed Brute follow-through originally
hit the floor, and was corrected before export. The shipped blade segments
cross the forward torso region at contact.

Side-view captures exposed a thin steel wake. Its broad face now curls behind
the cutting edge, retaining depth without adding another white outline. This
shared steel improvement also affects Maiming Strike, Early Grave and Victory
Rush; their visual regression captures are retained separately.

Four new sound cues have two takes each. Eight half-second ElevenLabs outputs
were trimmed and conformed through the existing pipeline. The presentation
queue times their contact with the native pose and retains cold fallback.
Routing tests distinguish hit, absorption and avoidance. Listening acceptance
is pending because this environment cannot listen to audio input.

## Evidence and remaining review

The builder matrix has 12 real casts and 72 stills across requested preset
values 0 through 5, with one positive hit per cast and no page, cast or context
errors. Review found that these are not all six supported settings: Low is 1
and Insane is 6. The original matrix missed Insane. The 9 September backfill
now verifies the resolved Insane profile before and after nine real Warrior
casts, including both builders, with 54 stills and no errors. Its retained
report is `studio-contact-pass/warrior-insane-backfill-final-1/report.json`.
Matching images use preset 4, yaw 1.9, pitch 0.4, camera distance 18 and tick 4.

| Ability | Before | Current development |
| --- | --- | --- |
| Redhand | [Before](../screenshots/vfx-v25-warrior-builders/overpower-before.png) | [After](../screenshots/vfx-v25-warrior-builders/overpower-after.png) |
| Brute Swing | [Before](../screenshots/vfx-v25-warrior-builders/slam-before.png) | [After](../screenshots/vfx-v25-warrior-builders/slam-after.png) |

The focused integration groups pass 244 tests in 14 files. These include native
track preservation, foot locking, actual blade contact, aura-driven count and
cleanup, independent queued cues, audio ownership, geometry, pool admission,
primary/secondary outcomes and the unchanged renderer size ceiling. Types and
scoped formatting checks pass. A stale crest-position assertion was corrected
to the already-authored 0.65-yard offset toward the caster; admission, expiry
and same-frame visibility assertions remain intact.

Further review still includes sustained rotations, moving and multiple enemies,
terrain/background variation, first-cast timing and auditory judgement. The
charge cue shares the existing three-per-entity/24-global held-band budget;
it has no new admission priority under crowd contention. No pool cap or test
threshold was weakened. The full v25 gate and all-kit visual cycles remain open.
