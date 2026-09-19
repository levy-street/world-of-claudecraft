# Warrior receiving impact polish

20 September 2026. Art review work on `wip/vfx-studio-v25`.

The goal is a visibly larger and more satisfying collision, with a dense centre, broad material release and fast breakup. Weapon movements, receiving wounds and flying debris have separate jobs. A large impact must remain attached to a confirmed enemy hit and must not suggest a larger damage area.

## Material and scale

Steel strikes use a rebuilt, original Blender sprite: a compressed silver bite, 48 short torn facets and 78 smaller tumbling chips in two unequal broad fans. The white centre expires early; the release decelerates and falls. The first enlarged prototype was rejected because its long continuous white filaments looked like pencils extending above the enemy. The replacement distributes the detail across the wider silhouette. It uses the existing 64-frame 2048px atlas and pool, with reproducible bake and packing scripts.

Early Grave and Maiming Strike throw the largest steel releases. Brute Swing and Redhand have substantial but shorter responses. Area attacks retain their actual footprints and put a separate brief split on each confirmed victim. Shieldcrack has a broad steel crush and unequal exits; Storm Bolt tints the material spirit blue and retains its actual hammer flight. Optional debris yields to occupied pools, while the enemy's wound takes priority.

Twinstrike and Bloodletting use the same authored blood spray and palette as Red Harvest. Their larger sprays remain below the finisher's extent and retain their original hit count and short lifetimes. Red Harvest's approved opening slashes, delayed explosion, sound and native animation are preserved. No simulation or damage numbers change in this pass.

Ground hits add outward dust at the floor and varied chips instead of rock appearing at torso height. Leap admits debris on all four sides within the original 32-slot pool. Faultline's irregular solid plates retain their full footprint and return to the original 18-triangle-per-plate budget, with closed undersides and coherent travel phases.

## Weight and feedback

A confirmed Warrior hit briefly compresses and recoils the enemy's visual body, with ability-specific lean, bank, catch and recovery. The reaction is applied to the pose wrapper, never the simulation position. Repeated contacts coalesce rather than stacking displacement. Reduced motion, death and reset clear it. Red Harvest retains its separate approved reaction.

Primary impacts carry stronger short camera accents. Secondary victims receive their own wounds and material but never duplicate the caster flourish or camera accent. Misses and fully absorbed attacks retain their distinct outcomes.

## Verification

Focused tests cover actual target ownership, misses and absorption, delayed Harvest echoes, fixed pool admission, uneven terrain, short lifetimes, reduced motion, recoil reset, material tint isolation and closed ground geometry. Atlas packaging checks all 64 frames, transparent endpoints, unclipped content, gutters and unchanged alpha after compression.

Matching original and revised captures, rejected prototypes, quality checks and continuous crowd takes are retained under the external `studio-contact-pass` directory. Publication evidence records the exact source and asset hashes and the limitations of each check. The broader canonical game gate is a separate unresolved release requirement; this document does not claim final art approval or whole-game readiness.
