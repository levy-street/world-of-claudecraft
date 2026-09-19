# Warrior movement and receiving-impact pass

Tony authorized this pass after the Onrush/blood-coherence correction. This supersedes the earlier movement-review hold. Public version30 remains the reviewed correction; this document describes new local work until another verified publication.

## Art direction

Put the spectacle where the blade meets the enemy. A narrow collision catch and readable wound anchor a much larger directional discharge. Preserve the enemy silhouette between beats. Steel attacks throw angular silver swarf; Bloodrush uses the same burgundy/scarlet torn blood film, textured spray and fine droplets as Red Harvest. Finishers have the greatest discharge and body commitment; repeatable attacks recover inside the shortest Warrior GCD. No generic white rings, whole-model recolouring, extra implied damage contacts or fake area boundaries.

Movement must distinguish loading, the actual strike, resistance and recovery. Use the existing native Warrior rig and offline planted-foot composition. Preserve Onrush's planted arrival exactly. Check the equipped blade over the entire performance, not just its contact instant. A deeper stance must never bury the sword in the floor.

## First batch

| Ability | Body action | Enemy response |
| --- | --- | --- |
| Redhand | Low compressed chamber, rising countercut, high carried-through exit | Ascending steel discharge; 7-unit atlas with a modest directional stretch |
| Brute Swing | Tall overhead load, vertical hammer stroke, compressed low recovery | Downward steel compression; 6.4-unit discharge |
| Maiming Strike | Opposed shoulder coil, committed diagonal cleave, low lateral exit | Broad oblique fracture; 8-unit discharge stretched along the cut |
| Early Grave | Deepest execution load, prolonged resistance, deliberate extraction | Largest steel receiving fracture; 9-unit atlas with 1.45 directional stretch |
| Bloodletting | Preserve its validated one-hit extraction clip in this batch | Shared torn blood material and palette; 7.4-unit harvest spray, wound-centred film and strong pool-rejection fallback |

Selected local parse samples identify Redhand and Maiming Strike as the most important Battlecraft damage abilities. These are selected fights, not population statistics or casts per minute.

## Subsequent batches

Shieldcrack and the Ironguard strikes need stronger enemy-side compression, shield-led load and distinctive recovery. Reaping Arc needs waist-led horizontal transfer with the opening behind the caster. Reaver Strike and utility weapon actions need compact, clearly different gestures. Twinstrike needs a clearer intermediate reload and second-blade exit while preserving its two real contacts. Red Harvest remains the finisher reference; increase coherent directional spray without returning to branching antlers or blobs. Review spins, shouts, activation gestures and defensive stances for movement clarity and purpose, not gratuitous extra swings.

## Review record

Before: `work/studio-contact-pass/warrior-final-movement-impact-before-sept19/report.json`, baseline game12cc85ad, five real casts and62 frames, no runtime errors/missing assets, source unchanged.

Candidate1: five casts and62 frames, no runtime errors, source unchanged. Not accepted: whole-clip weapon review found Brute Swing and Early Grave tips below ground during follow-through; Brute Swing's rebound also risked reading as a second hit. Fix those poses and add full-performance clearance coverage before acceptance.

Existing native contact/planted-foot tests:36 passed. Initial impact/quality/fallback checks:100 passed. These checks do not replace visual acceptance or the still-open whole-game gate.

Required before handover: corrected blade clearance, unchanged unrelated native tracks, matching before/after casts, repeated casting and movement interruption, both backgrounds, all six quality presets, reduced-motion coverage, focused tests/typecheck/build, scoped committed/pushed checkpoint and verified preview publication. Preserve unrelated work and all prior gate limitations.


### Corrected first-batch candidate

Brute now progresses continuously through its post-contact donor phases instead of re-crossing with a rebound. Early Grave and Brute keep their deeper pelvis load while the late upper-body pose keeps the blade clear. Redhand's low chamber also respects the full blade width. New regression coverage checks every corner of the equipped greatblade bounds at2ms intervals, including blended frames. All40 native-contact/foot/clearance checks pass.

Final focused run:16 suites,205 tests passed (`tmp/warrior-movement-batch1-final-tests.log`). Native TypeScript check passed (`tmp/warrior-movement-types-final.log`). Scoped Biome native process exited0; existing authoring/test style diagnostics remain (`tmp/warrior-movement-lint-native.log`). Exact decoded-track comparison proves only the intended four clips changed and36 remained identical. Asset SHA b9580a84ceda3d1da55b0149cd39c4d73c686e7257543e891e5159de9adf6d0a.

Matching corrected Studio capture: `warrior-final-movement-impact-corrected-sept19`,5/5 real casts,62 frames, no errors/missing assets, unchanged source. Representative matched before/after frames are committed under `docs/screenshots/warrior-movement-impact-v25`. Full outdoor quality and natural repeated-cast checks are recorded separately when complete. This remains a scoped work checkpoint, not a claim that the whole-game gate is green or that every Warrior movement has been reworked.

Outdoor quality report `warrior-final-movement-impact-quality-sept19`:35/35 cases,329 frames, all six presets and five reduced-motion cases, zero errors/console errors/missing assets, source unchanged. Same primary receiving identity retained at Low; final whole-game gate remains open.

Natural outdoor combat report `warrior-natural-crowd-review-movement-batch1-sept19`:2/2 thirty-second takes passed, Battlecraft21 casts/12 normal attacks and Bloodrush19 casts/20 normal attacks. Actual multiple-recipient damage observed in both, no reported coverage gaps, no errors or missing assets, source unchanged. No resource/cooldown/health resets during either take.
