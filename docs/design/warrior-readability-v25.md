# Warrior readability corrections

The Low-quality world review exposed effects that passed event and geometry checks
but were hard to read against combatants and scenery.

Rallying Cry now uses three separated rising vaults. Its complete outer span and
crown height remain, while the gaps reveal the party. Recklessness has a smoothly
curved closed flame volume, coherent sway and darker broken roots; its flames sit
farther outside the shoulders instead of building a bright cage over the torso.
The existing six-instance silhouette, aura ownership and reduced-motion controls
remain. It still requires the final continuous-motion review.

Jawcrack puts its successful spell-break sprite on the receiving jaw surface.
The previous central anchor buried the sprite inside the skull. Only an actual
school lockout earns that accent; a failed attempt creates no injury. Blood Toll
now has paired short clench sprites beside the hands, with brighter inward
filaments. Neither change repaints the character or invents damage or healing.

The shared ribbon and impact-flipbook shaders now use the same final tone and
colour conversion as the existing baked-volume shader. Low quality renders
without the composer, so missing output conversion previously left these effects
too dark. This shared rendering correction also affects those primitives when
other classes use them; no other class kit has been reworked in this checkpoint.

Matching before/after images and source hashes are in
../screenshots/warrior-readability-v25/evidence.json. Rally's image records its
first geometry correction; the other after images include the later shared
shader correction. These are corrective comparisons, not final acceptance.

Validation: 40 tests pass across seven focused control, power, geometry, material,
sprite and ribbon-admission suites. Earlier Rally/control batch:46 tests across
five suites (overlapping coverage, not additive). Typecheck and canonical client
bundle pass. The eight latest Low-world corrective configurations complete with
no browser errors or missing assets and unchanged source during capture. Full
Low/Ultra configuration reviews and the remaining preset matrix are underway.
