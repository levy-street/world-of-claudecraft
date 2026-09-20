# Warrior impact light show

20 September 2026. Tony rejected the previous review as a small upgrade and asked for substantially more spectacle at impact. This pass changes the visual role of the collision: a large, animated burst of light is the climax, and the existing blood, steel, dust, wounds and recoil form its physical aftermath.

## Four collision identities

| Material | Primary shape | Secondary detail | Hierarchy |
| --- | --- | --- | --- |
| Steel | Unequal cutting wedge with a white-hot contact centre | Broken silver rays, moving fragments and a brief cross-flare | Early Grave and Maiming Strike exceed frequent weapon attacks; lighter control actions stay shorter |
| Blood rage | Asymmetric crimson rupture around the real wound | Torn luminous rims and outward fragments over the darker physical blood spray | Red Harvest is the largest detonation; Twinstrike has two smaller opposing cuts; Bloodletting is one substantial hit |
| Spirit lightning | Branching angular discharge around the arriving hammer | Secondary forks, fractured inner crown and a blue local light | Storm Bolt remains a thrown hammer and confirmed stun, with its impact as the climax |
| Crushing pressure | Broad angular compression with fractured shoulders | Silver-white rays, broken pressure facets and existing ground debris | Shieldcrack, Quaking Blow, Faultline and Leap have different sizes and orientations |

These are four shapes in one prepared additive carrier, not a white circle applied everywhere. Their detailed silhouettes expand continuously, fragment and fade. The bright centre expires first; the colour and fragments survive briefly. Frequent impacts clear in roughly 0.25-0.32 seconds; heavy collisions use up to 0.42 seconds. Red Harvest retains the two preceding slash effects and its real delayed damage at 0.50 seconds. The new crimson burst occurs with that existing detonation.

The brightness is authored inside the effect rather than by increasing global bloom or tinting the whole character. The light remains visible with bloom disabled. Existing wounds, material sprites, weapon motions, damage values and hit outcomes are preserved. Hamstring, Breachmaker and Onrush receive explicit Warrior-only treatment in the shared contact path; other classes retain their existing sheet selection.

## Integration and limits

The implementation reuses the six existing impact planes, their geometry and prepared materials. It adds no draw pool, new texture download or per-frame object creation. Each receiving hit still requests one main flash. Reusing a slot resets its style, phase and terrain height, so an ordinary spell cannot inherit a Warrior burst.

Light fades above the actual terrain height to avoid a hard floor intersection. Opaque scene depth still occludes it. Reduced motion freezes the new silhouette and expansion while preserving its fade and expiry. It does not add repeated flashes or a new full-screen shake. The existing quality and primitive admission rules remain in effect.

The flashes emphasize confirmed contact; misses and full absorption do not emit the successful strike's spectacle. Area attacks retain their actual footprints and only apply receiving effects to actual victims. A larger contact burst is visual emphasis, not a damage-radius change.

## Review evidence

Matching captures use the same real casts, camera and gameplay-scale view as the previous impact-polish checkpoint. The first prototype exposed smooth lightning tendrils and a hard floor cutoff; the refined version adds angular forks, fragmented detail and terrain blending. Each evidence report records source hashes so intermediate captures are distinguishable from the final runtime.

Focused checks cover hit ownership, hierarchy, reduced motion, pool reuse, terrain binding, expiry and ordinary-effect reuse. Graphics checks and continuous crowd playback are recorded separately from screenshots. Production packaging verifies the exact committed source and served assets. The broader canonical game gate remains an independent open requirement, including a pre-existing renderer line-count failure; this is an art-review checkpoint, not final art approval or whole-game release certification.
