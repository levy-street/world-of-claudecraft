# Warrior spectacle and movement follow-up, 19 September 2026

This follows Tony's review of version31: Warrior should carry the same visual satisfaction as the spellcasters, with much stronger and more varied physical performances. The current work concentrates on Stormbolt, Widening Arc, Avatar and Quaking Blow, plus the shared stone treatment used by Faultline and Heroic Leap. Other classes remain outside this change.

## Direction and implemented behavior

Stormbolt is a body-driven spirit-hammer throw. The hips coil back, the arm releases forward and the torso follows through before braking. A prepared three-dimensional hammer has a bevelled head, luminous face details, wrapped handle and pommel. It rotates forward from its own launch time, leaving a blue-silver trail and a larger directional metal discharge at the real impact. The original projectile speed and instant launch remain authoritative; there is no invented contact during the throw.

Widening Arc is a broad sweeping preparation with a deep counter-coil, committed cut and separate braking pose. Open steel crests and layered edge wakes describe the expanded sweep. Its later copied melee hits each receive one owned steel contact on the actual recipient. The activation does not invent damage, and misses and absorbed blows preserve their distinct outcomes.

Quaking Blow raises its right foot, drives it down and compresses the body on the real150ms contact. The supporting foot stays planted. Stone plates translate upward as rigid pieces rather than stretching into soft shapes. Irregular roofs, shoulders and fracture shapes break up the repeated silhouette. Faultline shares that stone language while keeping its directed footprint; Heroic Leap receives the varied fragment families.

Avatar sinks into a deeper crouch, throws its upper body and arms outward, then settles into a powerful stance. Its held greatblade stays above ground. Unequal fractured slabs, angular rupture seams, two short dust bursts and varied stone debris support the release. Existing world-rock texture supplies the surface detail for the slabs and armor pieces, without generating a new asset or recoloring the whole character.

Warrior's authored entry poses now blend in quickly enough to be visible before the release. Stormbolt uses12ms and other authored Warrior/Signature actions35ms, instead of the previous generic100ms fade. Onrush retains its explicit planted-arrival blend and still has no ending swing. Other classes keep the existing transition behavior. This changes presentation, not damage, movement authority, cooldowns or attack reach.

## Production and limits

Four native contact clips were rebaked;36 other decoded clips remain byte-equivalent at the track level. Peak stomp lift is0.16 native units. The full contact asset SHA256 is99d8367c0a30dcceb8deea16db7e3dfbd73d5c4f3fa005029683ade1bbcf449f. Offline sampling checks full weapon corners every2ms, exact recovery, normalized tracks, fixed contact times and the original strict support-foot tolerances. The deliberate moving foot is measured against its intended path, then against the original planted target from150ms onward.

The spirit hammer has eight prepared instances and one shared material, with a prepared sprite fallback. It follows the existing projectile lifetime and does not create a second flight authority. Instance buffers, geometry, material and preparation resources dispose once. Rocks use the existing Rock051 texture with prepared upload and stable shader configuration. Existing ribbon, crest and fragment pools retain their capacities; the new hammer pool is capped at eight heads. Quality limits and fragment counts are unchanged; larger coverage still requires visual and crowded-playback review and is not assumed performance-neutral.

The broad Warrior test run initially had12 failing suites: timeouts under concurrent work, four Avatar fallback-lifetime assertions, and two stale Twinstrike sprite-size assertions for sizes already present in HEAD. Avatar's retained fallback lifetime was restored, and the Twinstrike test expectations now match the existing6.6/7.2 sizes. All12 formerly failing suites plus four directly affected suites passed in the serial rerun:134 tests in16 suites. No timeout, assertion strength, pool limit or quality criterion was relaxed. The original failed log is preserved.

Read-only review found and resolved omitted InstancedMesh disposal and global-time hammer rotation. Final visual, quality, crowd and committed-build evidence is appended below when complete. The historical whole-game canonical gate is still open; focused green checks do not certify the entire game or establish Tony's final aesthetic approval.


## Composition review refinement

The first complete42-case Studio matrix ran every preset plus reduced motion without runtime, asset or source-change errors. Its art review identified Faultline occlusion and a blown-out hammer endcap; this successful runtime report is retained as an intermediate candidate, not final visual approval. Faultline now moves its inner stone pieces outward to leave a clear2.1-unit caster opening while retaining the full8-unit outer reach and3.54-unit peak. Its walls have additional nonuniform fracture facets within the original1000-triangle ceiling. Darker stone sides and a shaded hammer endcap preserve surface detail around the bright edges. Three focused suites passed18 tests, and the added opening/reach/peak regression passes separately. Native TypeScript exits0 after these changes.


## Matched visual evidence

Five before/after pairs are committed under `docs/screenshots/warrior-spectacle-v25`: hammer-face, stomp-load, widening-sweep, faultline-opening and avatar-release. All ten images preserve the original PNG pixels exactly through lossless WebP conversion. The final refined Studio run covers6 abilities and77 frames with identical start/end source hashes and no runtime, console or missing-asset errors. The final all-setting outdoor and whole-kit transition reviews remain pending at this checkpoint.


## Final current-source review

The full Warrior Studio/Ultra run completed all45 unique abilities and557 frames with no runtime or console errors, no missing assets and unchanged source. The final outdoor matrix completed41/42 cases and396 frames; the first Ultra Avatar preparation timed out. A separate warm follow-up captured Avatar successfully, while its first Heroic Leap preparation also timed out. Heroic Leap already passed the original matrix. The source-identical successful cases therefore cover all six graphics choices and actual reduced motion, while BOTH original reports retain their failures. `warrior-spectacle-quality-coverage-sept19.json` records this composite visual coverage explicitly; it is not a cold-loading pass.

Natural World/Ultra combat produced a complete30-second take for each specialisation, with58 casts and47 connected auto-attacks in total. Arms demonstrated the real extra-recipient Widening Arc contacts; Fury and Protection hit all five training targets. No health, resources, cooldowns or aura timers were reset during a take. Initial cold preparation failed for the first spec in each capture process, so the three successful takes are combined from two recorded runs. The original failures and all source hashes remain in `warrior-spectacle-crowd-coverage-sept19.json`. Headless frame intervals include capture/automation stalls, including large outliers; this evidence does not establish a headed performance benchmark.

Read-only source review resolved instance-buffer disposal and global-clock hammer rotation. Bounded final visual review found no blocking composition defect after the refinement. Avatar's bright rising accents remain a subjective hierarchy note, and Quaking Blow briefly covers its lower legs with impact debris. The stomp load and exact plant have separate native and timing-frame evidence. Tony's hands-on aesthetic approval remains necessary before calling the result final AAA quality.

Game checkpointb910fddfefeedd6491f643f82d4e6de33554ef29 is pushed. Its unchanged push checks passed156 tests with3 inherited skips and the typecheck. The hook's changed-file formatter selected0 files; actual changed-file formatting is covered by the explicit scoped Biome and refinement runs. The final production-asset preparation checks also pass. The historical whole-game canonical gate remains OPEN; this is an art-review delivery, not release or merge certification.

Matched examples: [hammer before](../screenshots/warrior-spectacle-v25/hammer-face-before.webp), [hammer after](../screenshots/warrior-spectacle-v25/hammer-face-after.webp), [stomp before](../screenshots/warrior-spectacle-v25/stomp-load-before.webp), [stomp after](../screenshots/warrior-spectacle-v25/stomp-load-after.webp), [Faultline before](../screenshots/warrior-spectacle-v25/faultline-opening-before.webp), [Faultline after](../screenshots/warrior-spectacle-v25/faultline-opening-after.webp).
