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

Brute now progresses continuously through its post-contact donor phases instead of re-crossing with a rebound. Early Grave and Brute keep their deeper pelvis load while the late upper-body pose keeps the blade clear. Redhand's low chamber also respects the full blade width. New regression coverage checks every corner of the equipped greatblade bounds at 2ms intervals, including blended frames. All40 native-contact/foot/clearance checks pass.

Final focused run:16 suites,205 tests passed (`tmp/warrior-movement-batch1-final-tests.log`). Native TypeScript check passed (`tmp/warrior-movement-types-final.log`). Scoped Biome native process exited0; existing authoring/test style diagnostics remain (`tmp/warrior-movement-lint-native.log`). Exact decoded-track comparison proves only the intended four clips changed and36 remained identical. Asset SHA b9580a84ceda3d1da55b0149cd39c4d73c686e7257543e891e5159de9adf6d0a.

Matching corrected Studio capture: `warrior-final-movement-impact-corrected-sept19`,5/5 real casts,62 frames, no errors/missing assets, unchanged source. Representative matched before/after frames are committed under `docs/screenshots/warrior-movement-impact-v25`. Full outdoor quality and natural repeated-cast checks are recorded separately when complete. This remains a scoped work checkpoint, not a claim that the whole-game gate is green or that every Warrior movement has been reworked.

Outdoor quality report `warrior-final-movement-impact-quality-sept19`:35/35 cases,329 frames, all six presets and five reduced-motion cases, zero errors/console errors/missing assets, source unchanged. Same primary receiving identity retained at Low; final whole-game gate remains open.

Natural outdoor combat report `warrior-natural-crowd-review-movement-batch1-sept19`:2/2 thirty-second takes passed, Battlecraft21 casts/12 normal attacks and Bloodrush19 casts/20 normal attacks. Actual multiple-recipient damage observed in both, no reported coverage gaps, no errors or missing assets, source unchanged. No resource/cooldown/health resets during either take.


## Ironguard movement and receiving impact

Shieldcrack loads behind its held shield, drives forward and recoils into guard. Revenge coils behind its shield, cuts across the front and brakes into recovery. Quaking Blow visibly compresses through the knees and settles after the ground impact. Contact remains at 0.15 seconds and all recover inside 0.7 seconds. No extra sword hit was added to Shieldcrack. Decoded channel comparison against 431a19a7 confirms that only these three clips changed; the other 37 are identical.

Shieldcrack now produces an 8.2-unit cold steel collision with a wider body crease and two opposing jets sharing the original 13 fragments. The short flash lasts 0.075 seconds; the shield remains visible. Revenge has a 6-unit horizontal steel discharge. Quaking Blow combines its existing ground fracture with a 4.1-unit lower-body compression and buckled receiving mark. Ground receiving marks follow their own victim through translation/turning and disappear if it is removed. Reaping Arc and shield-transfer ribbons snapshot their own cast origins so overlapping casts cannot move each other's paths. Pool limits, damage events and gameplay footprints remain unchanged.

The new whole-performance gear test initially exposed a validation defect: the first LoopOnce scan paused the action before the shield scan. Each gear scan now resets the action and asserts the actual sampled time. Its conservative box also included empty corners outside the round shield. The corrected test checks every actual decoded mesh vertex at 2ms intervals, preserving the zero-floor threshold. An independent baseline/candidate scan found no actual surface penetration; Quaking Blow's smallest shield clearance is approximately 0.0193 native units. This is a correction to geometric measurement, not a relaxed tolerance. Shared grip constants retain the renderer's exact existing mounting values.

Focused initial integration: 14 suites, 155 tests passed. Final larger Shieldcrack plus corrected surface-clearance run: 3 suites, 7 tests passed (`tmp/warrior-ironguard-surface-clearance.log`). Type/lint, quality and natural-combat results are appended after completion. The whole-game gate remains open.


Ironguard final native typecheck and scoped Biome pass. Matched before/after evidence: `warrior-final-ironguard-movement-before-sept19`, `warrior-final-ironguard-movement-candidate1-sept19`, with the larger final Shieldcrack in `warrior-final-shieldcrack-impact-candidate2-sept19`. Representative exact-pixel lossless WebP pairs are committed beside the first batch. One post-capture Shieldcrack change is formatting only.

Outdoor review completed all three abilities at presets1 through5, plus Shieldcrack/Quaking at Insane and reduced motion. Revenge's first configuration failed on cold preparation, so its Insane/reduced cases remain open, as does natural combat for this batch. Preserve the failed reports: `warrior-final-ironguard-movement-quality-sept19` (16/21; the stalled browser was closed before reduced cases), `warrior-final-ironguard-insane-fresh-sept19` and `warrior-final-ironguard-reduced-fresh-sept19` (2/3 each). All reported unchanged runtime source, with no console/missing-asset errors. The last two failures were initial configuration timeouts, not completed visual takes.

Preparation diagnostic `warrior-final-ironguard-insane-queue-diagnostic-sept19` records a real45-second selected-kit deadline failure near the120-second transport deadline. World/character/effect compilation was still progressing. Fix and rerun the outstanding cases without raising deadlines, reducing quality or hiding this evidence. This checkpoint is scoped work, not final visual acceptance or publication; public version30 remains unchanged.


## Twinstrike, sweeping strikes and voice movement

Twinstrike now has an opposed reload between its two real blade contacts and a separate second-blade exit. Its inactive blade remains held in guard. Full greatblade bounds clear the floor at 2ms intervals, planted-foot drift remains below the existing tolerance, and the actual contact poses at0.15/0.34 seconds are preserved. Decoded Red Harvest tracks are exactly unchanged; only its receiving spray grows in this batch.

Reaping Arc transfers weight across a horizontal cut and brakes into recovery. Reaver Strike coils, counter-cuts and returns through a braced exit. Bladestorm alternates its body compression and shoulder bank through the existing0.45-second full revolution; the first and last authored poses close exactly. All seven shouts now have distinct breath/load, held projection and recovery timings, with the real release still at0.15 seconds. Raising the weapon-hand loading targets for Emboldening Roar and Intimidating Shout fixed genuine greatblade floor penetration without weakening clearance checks or changing other shout clips.

Decoded comparison against ba77cc4d confirms exactly10 changed contact clips and30 unchanged. Fury asset06d5c6f2 preserves the Red Harvest decoded track hash3d6f7b50. Contact assetc72e7d85 matches its independently validated off-side bake. Focused integration:13 suites130 tests passed; the final wider receiving effects subsequently passed41 targeted tests across5 suites. Repository native typecheck and scoped formatting pass. Reports live in tmp/warrior-sweep-clip-equivalence-final.json, tmp/woc-twinstrike-integrated-report.json and tmp/warrior-sweep-final-tests.log.

The first matched Studio candidate completed13/13 abilities and160 frames, with no console/runtime/missing-asset errors and unchanged recorded source: warrior-final-fury-reaping-movement-before-sept19 and warrior-final-fury-reaping-movement-after-sept19. Visual review found the receiving spray still too narrow. The subsequent candidate widens the existing atlas along the actual cut: Twinstrike1.35/1.45; Harvest1.3/1.4/1.65; sweeping steel1.4 and Bladestorm1.5. It retains the current sprite size/aspect caps, pools, lifetimes and actual contact counts. These later aspect changes require their own final visual/crowd review; do not attribute the earlier images to them.

Twinstrike uses6.6/7.2-unit sprites; Harvest5.8/6.4/8.6, with the greatest width reserved for the final blow. Reaping, Gyre and Bladestorm receive6.4/6.2/7.4-unit steel discharges. Reaver receives6 units. Gyre ribbons now snapshot their own cast origin, with a two-caster/recast regression proving later casts cannot move older paths.

## Historical preparation experiment and intermediate audit

Commit190d279fc1 releases compile admission slots after genuinely synchronous uploads/touches, preserving all asynchronous limits and preparation coverage. Its98 focused tests and fresh read review pass. This correct scheduling change alone did not resolve first cold Insane Revenge loading; that failed evidence remains preserved. A subsequently rejected Studio-only candidate supplied the existing first-paint gate so ordinary world preparation cannot compete with explicit selected-kit preparation before the first draw. Four new runtime tests failed before the wiring fix;61 tests across5 suites and native typecheck pass after it. That candidate was later rejected by browser and dependency-cycle review; see the final disposition below.

The movement audit covers45 active Warrior IDs/86 legal configurations. All have native mappings;18 performances have newly changed in this pass. The other27 are not thereby claimed reworked. Review priority remains Faultline, Breachmaker, Victory Rush and Bloodletting to judge whether their existing distinct movement needs further development. Onrush's planted arrival is preserved, with no ending swing.

Final all-preset/reduced-motion/crowd checks, publication and the broader game gate remain open. Public Site version30 does not yet include these movement checkpoints.


### First-paint experiment rejected; final combat movement integrated

The first-paint scheduling experiment is NOT in the current source. The first real browser test deadlocked during Stage view preparation; a controlled regression reproduced that dependency. A World-only revision preserved Stage boot but still failed the first Insane Revenge configuration, and fresh review identified a form-preparation cycle for Druid/Shaman/Warlock. The task-owned runtime/test changes were archived externally as warrior-first-paint-experiment-not-accepted.patch and removed. Keep the proven190d279fc1 synchronous-slot correction. Cold highest-setting World configuration remains an explicitly open issue; no caps, deadlines, quality or acceptance checks were relaxed.

Final four movement candidate now integrated: Faultline's raised load descends through a deeper shield/body compression; Breachmaker chambers backward, thrusts and distinctly withdraws with its support grip intact; Victory Rush rises from a low cut and brakes in an elevated recovery; Bloodletting coils, cuts once and extracts into a recoil. Real full-weapon checks exposed and corrected pre-existing Victory Rush and Bloodletting floor penetration. These four use denser offline samples to preserve the same interpolated-foot tolerance; no runtime animation sampling budget changes. All36 other decoded contact clips match the immediately precedingc72e7d85 asset.

Final contact asset1c7fd40e matches the validated off-side candidate. Comparison to ba77cc4d shows14 changed and26 unchanged contact clips; adding the earlier seven and Twinstrike makes22 newly developed active-ability performances across this movement pass. The remaining23 retain their existing purposeful native designs pending full visual acceptance. Exact proof: tmp/warrior-complete-movement-clip-equivalence.json and tmp/woc-final-four-report.json. Final native/contact/impact integration has221 passing tests in20 suites. Scoped Biome passes with existing warnings.

The wider blood/steel candidate and final-four before views completed9/9 cases112 frames with unchanged source and no runtime/console/missing-asset errors: warrior-final-final-four-before-and-wider-spray-sept19. Subsequent receiving changes pair the four new motions with their purpose: Breachmaker8.6-unit fracture/aspect1.35; Victory Rush6.6/aspect1.2; Bloodletting7.4/aspect1.4; Faultline5.6-unit lower-body compression and stronger travel for the same8 stone fragments. The ground area remains cast-owned and each real victim receives exactly one owned contact. Final Studio/World/full-kit, quality, and natural crowd evidence is recorded after completion; the previous images remain attributed to their actual versions.


## Final Studio review, 19 September

The final native TypeScript check exited0 (tmp/warrior-complete-movement-types-final.log). All221 focused tests/20 suites pass. The complete Studio/Ultra run covers45 unique active abilities and557 frames, including anticipation, impact, recovery and finite-state expiry: warrior-final-movement-complete-studio-sept19/report.json. It has zero runtime or console errors, zero missing assets and identical start/end source hashes. This is representative-per-ability coverage, not all86 legal configurations.

Matched before/after lossless WebP examples are committed in docs/screenshots/warrior-movement-impact-v25: harvest-width, twinstrike-exit and breach-impact pairs. Every converted screenshot was verified pixel-for-pixel against its original PNG. Earlier native floor, pool, contact-time and ownership tests remain unchanged in strength.

A read-only review of15 full-frame Onrush/Leap/Bladestorm/Die by the Sword/Avatar views found no concrete weapon-loss, floor or persistent-obstruction defect. The Onrush trace returns from arrival brace to Idle by0.60 seconds with no ending attack clip. Stills do not prove continuous-motion quality; World, quality and natural playback checks remain separately required.


Fresh read-only render review found no correctness blocker in the final scoped diff. Larger final Harvest and Bladestorm receiving quads cover approximately3x the prior per-layer area; Twinstrike approximately2.2x. Existing pool limits and lifetimes do not make this performance-neutral. Actual crowded playback and lower-tier visual checks remain required, and automated headless frame intervals are not headed GPU timings. No new shader/material/program key, light or context was introduced. Existing ten-slot pool admission, real-hit/miss/absorb ownership, expiry and tier shedding remain intact.
