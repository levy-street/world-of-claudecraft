# Ironguard impacts and Breachmaker, v25 development

This is a development checkpoint in the approved character guide. It is not
AAA acceptance. Tony's Warrior reference calls for segmented iron, bright
bevels, cool pressure and grounded physical weight. Battlecraft keeps a warmer
copper edge. The character's base colors remain stable throughout these actions.

## Four distinct performances

| Ability | Character performance | Effect and gameplay read |
| --- | --- | --- |
| Revenge | Shield-braced sword counter, contact at .15, brief hold, recovery by .66 | Nine broken forged blades sweep through the actual broad frontal eight-yard sector. Receiving enemies get their own delayed cuts or absorb contact. |
| Quaking Blow | Planted compression behind a driving shield, contact at .15, recovery by .68 | Twelve broken radial ridges, raised fragments, ground contact and baked sprite dust cover the full eight-yard area. Its actual attack-speed burden wears a small cool iron mark. |
| Faultline | Deeper shield load and stronger forward drive, contact held through .205, recovery by .72 | Branching raised fractures and a taller central ridge describe the frontal eight-yard area. Actual stun auras retain their existing readable control marker for their real duration. |
| Breachmaker | Two-handed chamber, straight drive, held contact and recoil by .68 | A forged piercing wedge, outward armor splinters and a recipient puncture. The source-owned vulnerability wears a split armor seam for the player who benefits from it. |

Revenge and Faultline use the simulation's 2.2-radian half-angle, approximately
252 degrees in total. Every Faultline vertex is clipped to that sector; this
is deliberately broader than a conventional narrow cinematic cone. Quaking
Blow affects attack speed, not movement speed. Breachmaker's vulnerability is
independent of its weapon hit, so its mark follows the actual aura even if the
hit misses or is fully absorbed. Faultline's control follows the actual stun,
including diminished PvP duration and boss exclusion.

Successive render comparisons exposed overly shiny continuous strips, then
thin crystal-like facets. The current composition has substantial grounded
sidewalls, scored faces and narrow bevels. Quake uses warmer broken stone;
Faultline uses taller cold iron ridges. Revenge carries a moving leading edge
and broad eroding steel wake over its full frontal footprint, including on
its cold-crest ribbon fallback. Reduced motion retains a stationary full shape.
No ability uses a plain expanding white circle. Primary silhouettes remain
at eight yards in reduced detail; garnish thins.

## Native animation and physical proof

The shared Warrior animation asset now contains thirteen complete native clips.
The offline baker locks feet without root motion. Breachmaker additionally
solves the supporting arm against a point .15 behind the right sword socket,
preserving native bone lengths, socket offsets and the right hand's authority.
The grip is held from .085 through .34 and blends away during recovery.

The first actual-mesh audit caught the equipped buckler below the floor during
Quaking Blow and Faultline. Contact and recovery torso bends were corrected;
deep hip compression was retained. Re-exported candidates sampled every .005
seconds clear the ground by at least .0196 and .0138 native units respectively.
The permanent test samples the real equipped shield vertices over the complete
delivered clips and requires clearance greater than .01. Tests also preserve
all native animation tracks through both preparation stages and verify planted
feet, the held support-hand grip and forward travel of the striking hand.

## Ownership and bounded cost

One cast owns the area composition. Actual receiving hits own imprints at .15;
absorption earns a ward collision, while avoidance creates no body wound. A
recipient never restarts the caster or sounds another area impact. Cold or
full crest pools retain terrain-sampled ribbon silhouettes. Recipient ribbons
cannot evict those primary paths. A real-pool regression exercises twelve
Quaking Blow paths against nine receiving contacts without available crests.

The four new prepared geometries borrow the existing eight sculpture slots.
The active Warrior preparation list has twelve shapes plus three textures,
for 51 separately scheduled preparation units. No pool, buffer, graphics
fairness threshold or monolith ceiling was increased. Ground sculptures use
the existing 25-sample terrain uniform; their primary paths sample the terrain
directly. Each worn mark uses one authored sprite in the existing overlay
batch: split armor leaves for vulnerability, descending weights for attack
speed. The shared atlas grows from 128 square to 192 square, adding 80 KiB of
RGBA storage; the existing preparation and compile lane owns it. All four
legacy 64-pixel cells compare pixel-for-pixel exactly against the old atlas.
No glyph is painted or uploaded on cast. Actual-mesh ray inspection caught
five of the former six spark centers buried inside the mage. The current
camera-facing offset clears the visible surface with normal depth testing
retained. Aura scans and frame stamps own lifetime and cleanup.

## Material sound

Sixteen new ElevenLabs takes provide two versions each of release and impact
for these four abilities. They distinguish a shearing counter, shield-on-stone
compression, branching bedrock fracture and armor puncture. The existing
conformance tooling trims onset, applies short fades and normalizes format and
level. Previously curated recordings are retained.

Area sound is reserved once on the actual cast event and lands at .15 even if
the visual sequence is crowded out. Receiving damage events share that cast's
claim, preventing nine enemies from producing nine overlapping area sounds.
The HUD and Studio retain their ordinary sound fallback when the authored
recordings are not ready. Successful Breachmaker contact also has one owner,
preventing immediate generic feedback before the authored thrust lands.

## Evidence and remaining review

The matching baseline and first development review each contain four real
casts and 36 stills at Ultra, yaw1.9, pitch0.4 and distance18. Both complete
without page, shader, cast or context errors. They include native clip and
hand/foot observations, full events and frozen-source hashes.

The first review was not accepted: its shiny ground strips and small
Breachmaker read prompted a second composition. Four additional regressions
first reproduced duplicate contact, lost area paths, an oversized frontal
footprint and excessive mark sprites; all four pass after fixes. Three sound
regressions likewise first reproduced an immediate generic nova sound over
the retained cast; the shared sound resolver now honors that ownership.

The first stress matrix completed 31 fixtures, 33 actual casts and 297 stills
without errors or context loss, covering genuine settings 1 through 6 and
crowded world scenes. Its source remained frozen. Revenge and Faultline hit
all 12 measured eligible recipients; Quake hit all 13. Three successive real
Revenge casts at 0, 1.5 and 3 seconds retained the footprint without resource
refill. That matrix exposed the unreadable marks and crystal-like facets;
it is not acceptance of the later revisions.

The third comparison completed four casts and 36 stills without errors. A
separate real Breachmaker cast proved the new glyph is submitted, clears the
actual target mesh at its center, remains at 1.5 seconds and disappears with
its actual aura by 8.1 seconds. The fourth matching comparison again completed
four casts and 36 stills without errors; lower torso placement and grounded
sidewalls were inspected. The final glyph diagnostic repeated the true expiry
and unobstructed centre-ray checks. The fifth comparison completed four casts
and 36 stills with shader diagnostics enabled and no errors. It corrected
upper-face winding and added closed undersides; material coordinates now vary
across vertical surfaces rather than stretching one texel column downward.
Only Quake/Faultline use the three-axis material projection and backface rule.
Continuous mirrored texture coordinates avoid hard tile-boundary jumps. The
solid ground geometry uses fewer triangles while keeping reach and height.
The final focused material check completed two real casts and 18 stills with
shader diagnostics enabled, no errors and no obvious new texture seams.
The shared atlas regression found zero differing
pixels or channels in the four old cells. A saturated full-absorb regression
also first failed, then passed after preserving Breachmaker's ward collision.

Checkpoint validation: 250 tests across 15 focused suites pass, including
actual native equipped-mesh clearance, real ribbon buffers and slot reuse,
reduced motion, control-marker fairness, audio ownership and contact outcomes.
Type checking and scoped formatting pass. Four browser recordings retain three
actual cast attempts each. The first three abilities each play three releases
and three impacts; Breachmaker plays three releases and two impacts because
its second attempt is actually dodged. No recorded sound call is rejected.
The recording harness originally assumed six sounds unconditionally and
reported that dodge as a failure; the unchanged raw evidence is retained.
A separate outcome-aware validation of those recordings passes and identifies
the initial assertion error. It is explicitly not a new recording run.

Matching gameplay-distance images:

| Ability | Before | Current checkpoint |
| --- | --- | --- |
| Revenge | [Before](../screenshots/v25-warrior-ironguard/revenge-before.png) | [After](../screenshots/v25-warrior-ironguard/revenge-after.png) |
| Quaking Blow | [Before](../screenshots/v25-warrior-ironguard/thunder_clap-before.png) | [After](../screenshots/v25-warrior-ironguard/thunder_clap-after.png) |
| Faultline | [Before](../screenshots/v25-warrior-ironguard/faultline-before.png) | [After](../screenshots/v25-warrior-ironguard/faultline-after.png) |
| Breachmaker | [Before](../screenshots/v25-warrior-ironguard/breachmaker-before.png) | [After](../screenshots/v25-warrior-ironguard/breachmaker-after.png) |

[Actual worn vulnerability](../screenshots/v25-warrior-ironguard/breachmaker-worn.png)
and [actual expired state](../screenshots/v25-warrior-ironguard/breachmaker-expired.png).

Whole-kit crowded review, alternate cameras, real-time pacing and the two
complete full-kit review cycles remain part of acceptance. Stepped stills
do not establish auditory quality. The latest material review resolves hollow
ground pieces and dominant uniform rims in the captured view, but the later
material revisions still need renewed crowd coverage. Revenge's outer perimeter and Breachmaker's regular
piercing outline still need further composition review. No complete
class or final AAA verdict is claimed here.
