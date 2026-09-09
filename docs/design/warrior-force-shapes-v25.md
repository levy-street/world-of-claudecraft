# Warrior force and power shapes ? v25

These are visual review candidates. Warrior has not received final AAA acceptance.

## Attack identity

Brute Swing (`slam`) now has a broad downward compression cut. Redhand (`overpower`) has a returning hook that rises through its counterattack. Early Grave (`execute`) has a larger torn cleaver, with two real breaks in its thick surface. Their existing full-size footprints are retained. A moving highlight and its trailing surface follow the same normalized path, so each strike reads as a cut passing through contact.

Revenge uses three broad returning steel wakes instead of nine small detached panels. It retains the full eight-yard reach and wide gameplay cone. Breachmaker sends its brightest compression along the thrust into the recipient; the lasting vulnerability mark remains a separate effect on the victim.

Blood surfaces retain a substantial crimson body beneath the painted detail. Red Harvest also gathers rage into both weapon grips with reversed fluid sprites and inward ribbons. That anticipation ends within 0.14 seconds, before the first contact; it creates no victim mark, damage or hit feedback. The three existing attack contacts and the large final crossing cut retain their timing and scale.

## Seven commands

Each shout uses a distinct pressure shape, with its existing recipient responses and full gameplay reach:

| Family | Shape and intent |
|---|---|
| Rally | A rising vault that lifts the group. |
| Dread | Heavy sheets pressing downward. |
| Challenge | An outward hooked command. |
| Battle | Broad lifting banners. |
| Embolden | Pointed red prongs. |
| Fear | Five jagged upright sheets. |
| Piercing | Low ankle-level rakes. |

The painted plume is mapped into each shaped sheet, giving the voice body and texture. The prepared geometry and cold-preparation fallback share their paths.

## Lasting power and equipment

Avatar now adds large faceted stone shoulders framing the helmet, alongside its breastplate, bracers and shins. Mineral seams and narrow highlights keep the stone readable against the original character colors. A sampled 176-pose audit found no new shoulder intersections with the head, helmet, arms, hands or reference weapons. This is sampled clearance evidence, not proof for every cosmetic or animation.

Recklessness has a fuller flowing red body on both sides of its flame shapes. It no longer relies on a bright bevel to remain visible from behind.

The three stance highlights sit on actual equipment: warm gold for Battle, red for Berserker, and blue for Guarded. They are stronger at gameplay distance while leaving the model's base colors intact.

Shieldcrack starts its large fracture at the actual equipped buckler face. Two directed compression trails connect that face to the recipient. The fracture's open centre exposes the real shield; its outer extent remains large. The native performance retains its tested planted feet and contact timing. The recipient imprint still follows the actual enemy, independently of the shield's position.

## Verification and remaining review

TypeScript and the production bundle passed after the shield and stance changes. The shape/contact checks included 163 passing tests; the later native-performance and architecture checks passed, followed by 25 passing shield/readiness tests after correcting a test's ribbon selection. Earlier results overlap these suites and should not be added together.

All three specs completed 30 seconds of natural continuous combat: Arms 21 casts and 12 connected auto-attacks, Fury 19 and 20, Protection 18 and 15. These source-frozen takes reported no game errors, console errors or missing assets. The listed proc/combo checks had no gaps; the dummy fixture cannot prove naturally acquired Revenge Free. Screenshot-associated stalls remain in the recorded frame times, so this is not a hitch-free performance claim.

[Selected source-stamped captures](../screenshots/warrior-force-shapes-v25/proof.json) cover the power silhouettes, shield and stance changes. World views are alternate-angle evidence; they are not labelled matched before/after pairs. The [periodic-wound correction](warrior-periodic-wounds-v25.md) has its own matched evidence.

The initial full Ultra review covered 45 active ability IDs in 86 legal configurations. A separate evidence-reader validation resolves Bladestorm's null ability ID without changing simulation events or the original report. Final every-setting visual review, live control/proc cases, sound listening and the shared gate remain open.
