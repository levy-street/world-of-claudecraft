# Warrior defenses, v25 development checkpoint

The protection trio now has short native activation performances, physical
steel silhouettes, and twelve new material sound takes. This is continuing
work against the approved character guide, not final AAA acceptance.

| Ability | Activation | Held protection |
| --- | --- | --- |
| Raised Guard | Planted shield brace, steel lock at .15s, recovery by .64s | Three broad forged leaves follow the equipped shield for the actual six-second physical damage reduction. They do not promise a guaranteed block. |
| Iron Resolve | Inward compression, armor lock at .20s, recovery by .68s | An open collar of steel leaves lasts only while its real absorption aura survives, up to ten seconds. Leaves diminish with the current reserve and briefly recoil when that reserve takes damage. |
| Die by the Sword | Supported two-handed guard, lock at .15s, controlled recovery by .72s | Two long blade planes follow the main weapon for the actual eight-second damage reduction and dodge window. They do not promise a parry. |

The model keeps its base colors. Steel has inset scored faces, raised spines,
narrow copper bevels, rivets and closed sidewalls. Sparks punctuate the short
assembly; no circle or spherical shell replaces the equipment silhouette.
The existing shared steel texture supplies surface detail. No texture is
created during a cast.

Iron Resolve does not expose its initial absorption capacity to the renderer.
The first visible snapshot can already include damage, so it is unsafe to
infer that capacity from first observation or aura duration. Each visible leaf
instead represents up to thirty current absorption points, capped at six.
This is an absolute reserve indication, not a percentage bar. Concurrent
protection states share the six-leaf budget. Another absorb taking damage
does not flash or diminish Iron Resolve.

## Native movement and sound

The delivered animation file contains sixteen clips. The previous thirteen
retain identical decoded channels and samples. Offline leg solving preserves
planted feet, original bone lengths and root placement. The new sword guard
keeps its support hand on the native blade axis through .075 to .40 seconds,
then releases it during recovery. Tests sample between baked frames and check
the actual equipped buckler and greatblade vertices for floor clearance.

Six new release/lock cues, each with two ElevenLabs takes, distinguish a
shield latch, layered armor compression and taut sword guard. Existing SFX
conformance and manifest tools own their output. One actual cast reserves one
release and one timed lock, independent of available visual slots. The original
flourish event keeps its sound claim through normalization. Cold audio retains
the normal fallback. Three real recorded casts confirm this ownership and the
.15/.20/.15 lock times; paced recordings are not a real-time latency benchmark
or an independent listening approval.

## Cost and lifecycle

One new instanced draw holds at most 96 small 112-triangle plates, six for each
of sixteen solid wearers. It is separate from the eight attack sculpture
slots. Up to 64 wearers retain a primary outline during cold preparation or
solid-pool overflow, with the local player first. Only live matrix/color
prefixes upload. Equipment samplers are cached; invalid attachments retry at
a bounded interval. Iron Resolve alone performs no weapon traversal.

Front and reverse faces both carry inset steel, a raised spine, copper bevels
and four rivets, so the idle shield orientation retains its metal detail.
Existing ribbon capacity remains unchanged. Tests exercise actual Twinstrike
and Red Harvest ribbon output against 64 simultaneous triple-defense wearers
and Bladestorm, preserving every attack vertex. Reduced motion preserves the
full held shape while skipping assembly and recoil. Aura removal, death,
sleep, despawn and clear terminate held state. Disposal releases owned
geometry/material/buffers while preserving the shared steel texture.

The guard material deliberately retains one Standard-material program family
across presets so its prepared and live variants match. A hidden instanced
carrier borrows the actual instance buffers. Separate compile, ready-program
touch and buffer-upload units precede readiness; compilation alone is not
accepted as GPU preparation. The existing hidden attack sculptures bind and explicitly upload shared steel
before boot geometry preparation. A failed earlier boot step now resumes
texture and material dependencies before geometry; a completed texture sweep
retains the shorter geometry-only resume. A regression first reproduced stale
sweep completion across a failed retry, then passed after its correction.

## Matching evidence and remaining work

All matching images use the real Studio cast path, Ultra, a 1400 by 900
viewport, yaw 1.9, pitch .4, distance 18, and identical simulation ticks.
The original baseline has eight casts and 45 stills; the latest trio capture
has three casts and eighteen stills, no errors. The baseline preserves its
reported browser-close timeout rather than rewriting that evidence.

| Ability | Before | After |
| --- | --- | --- |
| Raised Guard, .30s | [Before](../screenshots/v25-warrior-guards/raised_guard-before.png) | [After](../screenshots/v25-warrior-guards/raised_guard-after.png) |
| Iron Resolve, .65s | [Before](../screenshots/v25-warrior-guards/iron_resolve-before.png) | [After](../screenshots/v25-warrior-guards/iron_resolve-after.png) |
| Die by the Sword, .30s | [Before](../screenshots/v25-warrior-guards/die_by_sword-before.png) | [After](../screenshots/v25-warrior-guards/die_by_sword-after.png) |

The focused stress run has six actual primary casts plus one supporting
Priest shield, 38 stills, unchanged source hashes and no errors. It covers
opposite views, the Battlecraft loadout, actual early absorption depletion,
unrelated absorb ownership and actual expiry. Controlled incoming damage
uses the canonical damage resolver after attack resolution; it does not
prove natural melee rolls, block or dodge animation. A separate real Battlecraft cast verifies matching entity, view and visual
equipment IDs plus the actual greatblade mesh signature (544 vertices, 1236
indices), with no visible offhand payload. Its six frames finish without errors.

Current checks: 162 tests in fifteen focused suites and canonical TypeScript
check pass. Eight additional preparation-recovery tests pass; the final
three-suite preparation/guard run has 28 passing tests. The final six-preset
sweep passed eighteen real casts and 108 stills with no errors, including
longer sword rails and detailed reverse faces. The last tiny correction buries
rear rivet bases into the surface; the subsequent matching trio and overflow
captures include it. Shader/material families, scale and lifecycle are unchanged.

The labelled overflow fixture has one real cast and sixteen synthetic aura
wearers. All seventeen retain protection: sixteen solid compositions and one
complete outline, local priority preserved. Six frames finish without errors.
It is a pool test, not proof of seventeen legal casts or a frame-rate benchmark.

Final moving defense, world backgrounds, real avoided/landed hit response,
refresh and all-kit review remain open. The earlier splayed Sword Guard
looked too much like a shield. Longer parallel cutting rails now extend
beyond the tip, preserving the lower reach and increasing their length and
thickness. Final world and moving views remain necessary before accepting
that silhouette. Raised Guard's previously plain reverse face now has metal
facets, copper borders and rivets; fine surface detail still deserves art review.

Evidence directory outside the checkout: studio-contact-pass. Reports:
warrior-state-guards-final-6/report.json,
warrior-guard-stress-focused-final-1/report.json,
warrior-guard-audio-final-1/report.json,
warrior-guards-prior-native-preservation.json,
warrior-guards-final-focused.log, warrior-guards-types-final.log,
warrior-guards-grip-clearance.log,
warrior-guard-stress-quality-final-2/report.json,
warrior-guard-stress-battlecraft-held-final-1/report.json,
warrior-guard-stress-overflow-final-1/report.json,
warrior-guard-partial-prewarm-red.log and warrior-guard-partial-prewarm-green.log.
No public Site deployment at this checkpoint.
