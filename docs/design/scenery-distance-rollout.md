# Scenery distance rollout, October 2026

Completed follow-up: [Windows RTX 4070 Laptop results](scenery-windows-4070-results.md)
measure the pre-integration commit `c33418ac348`, not the later merged head.

Status: implementation and Mac/Redmi study complete, ready for Windows review.
The final Low build measured **38.74 FPS in Thornpeak and 29.73 FPS in Palmreach**
after the loading route. It preserves the selected aggressive configuration.
Medium and higher retain native materials and lighting, but the Mac results do
not establish a gain. This is a testing candidate, not a shipping approval.
Reuben authorized remote feature-branch publication with this report. Merging this
feature into integration/release and deployment remain unauthorized.

## Integration merge, 15 October 2026

Reuben authorized merging `feature/v045-integration` at `78c350c8d55`
into this branch after the study at `c33418ac348`. The earlier FPS numbers,
screenshots and frozen build hashes describe the pre-merge candidate. They
have not been remeasured on the merged Studio/town content. Use the Windows
review harness to collect fresh paired measurements before judging this head.
This authorization is for the feature-branch sync; deployment and merging
this feature into integration/release remain separate decisions.

The merge preserves the scenery bands and incoming Studio zone isolation,
promoted-scenery gates, rebuilt towns and set-piece resource cleanup. A new
`zone_feature_sweep.test.ts` case exercises per-group scenery horizons together
with Studio isolation. The graphics byte guard retains the integration hashes,
normalizing only its config version to v21 while separately pinning the cel
branch's v22 marker and four added knobs. Direct comparison against incoming
`gfx.ts` found no other setting differences. The coordinator size pins use
exact merged sizes under the existing release-sync rule; no runtime extraction
or policy retune was added.

Focused validation: 26 suites, 370 tests passed and 3 skipped; TypeScript and the
minified Vite bundle passed. The bundle check omitted copying public assets to
avoid duplicating them on a nearly full disk. The canonical selective gate also
passed generated-artifact freshness, malware scanning and changed-file Biome.
The full-suite fallback was stopped after failures, so the overall gate is not
green and its later browser/build stages did not run. Two failures were reproduced
as missing evidence in the existing sparse checkout (`ci_workflow.test.ts` and
`eastbrook_polish_artifact_integrity.test.ts`). The professions maximal-blob test
also reproduced a 249939 versus 246084 byte pin failure; that test and the entire
simulation tree are identical to the incoming integration parent. No unrelated
baseline fixes were made. Audit verdict: CLEAN WITH FOLLOW-UP, with full-checkout
validation and fresh hardware measurements still required.

Commands: `node_modules/.bin/tsc --noEmit`; `node scripts/gate_select.mjs`;
`node node_modules/vitest/vitest.mjs run tests/scenery*.test.ts tests/zone_feature_sweep.test.ts tests/jungle_feature_cells.test.ts tests/renderer_resource_lifecycle.test.ts tests/gfx_override_core.test.ts tests/monolith_budget.test.ts tests/architecture.test.ts tests/cel_shading_core.test.ts tests/studio_render_builtin_gates.test.ts tests/set_piece_occluders.test.ts tests/placed_texture_tier_core.test.ts tests/localization_fixes.test.ts --maxWorkers=2`.
The bundle used Vite's `build` API with `copyPublicDir: false` and output under
`tmp/integration-merge-build`. Detailed local logs are `/tmp/woc-cel-merge-*.log`.

## Selected policy

Distances are camera distances in yards. Whole placement bounds keep multipart
trees together. Near scenery stays native. Actors, gameplay and collision are
outside this change.

| Preset | 0-60 yd | 60-120 yd | 120-240 yd | 240-480 yd | Beyond 480 yd |
| --- | --- | --- | --- | --- | --- |
| Low | Full | Strong | Very simple | Minimum | Minimum to 560 yd |
| Medium | Full | Fuller | Strong | Very simple | Minimum to native horizon |
| High | Full | Full | Fuller | Strong | Very simple to native horizon |
| Ultra | Full | Full | Light | Fuller | Strong to native horizon |
| Insane | Full | Full | Full | Light | Fuller to native horizon |

Targets per source part are 2048 triangles for Light, 1024 for Fuller, 512 for
Strong, 32 for Very simple and 12 for Minimum. Palmreach trees use 512 for Fuller
and 256 for Strong. Silhouette constraints can retain more geometry; these are
not hard caps per whole tree. Eligible small static dressing stops beyond the
full-detail edge plus a four-yard placement margin.

Low retains the measured Lambert replacement materials, source maps and alpha
cutouts, plus giant-tree sprites between 64 and 560 yards. Its fog is capped at
320 yards near and 560 yards far without extending shorter native fog. Medium
through Insane retain exact source materials, texture maps, lighting, AO, native
horizon and original shadow geometry. Their giant trees remain lit 3D geometry.

The earlier geometry-only pilot kept too much distant native scenery and was not
the selected aggressive configuration. A subsequent port also kept extra source
shader effects on Low replacements. Restoring the selected replacement material
policy recovered the chosen Low throughput.

## Loading and ownership

Low prepares replacement populations through the existing GPU scheduler and gates.
Covered roots keep their prepared bands while newly streamed garden/jungle roots
retain native geometry and native zone-sweep distance until covered. Source reveal
gates still control when a root enters that sweep. A new field-foliage owner keeps
the global native fallback so old replacements cannot duplicate the new field.
Travelling beyond the prepared coverage window also retains the native fallback.

Higher tiers partition source instances into distance levels and pool compatible
colour draws. Source roots retain visibility and reveal ownership; source material
objects remain shared. Native counts and geometry are restored for shadow passes.
Late preparation after terminal disposal cannot reattach retired batches.

## Measured Low recovery

These are aggregate submitted-frame FPS values. Compare within a row only.
The reference is the selected aggressive prototype, not stock graphics.

| Redmi scene | Order | Selected prototype | Corrected Low |
| --- | --- | ---: | ---: |
| Thornpeak | Forward | 35.8 | 38.9 |
| Thornpeak | Reverse | 38.5 | 36.4 |
| Palmreach | Forward | 29.9 | 30.0 |
| Palmreach | Reverse | 29.8 | 30.1 |

This establishes parity within roughly 10% run noise, not an additional gain over
the prototype. Both the lower reverse window and the incomplete earlier USB-reset
attempt are retained. It does not establish 60 FPS on the Redmi.

## Higher-tier comparison results

The final handoff-v6 candidate includes the Low loading correction and skips empty
owned source submissions before shader setup. Medium Redmi improves in both
orders: Thornpeak changes from 5.9 to 8.8 FPS forward and 5.8 to 8.8 reverse;
Palmreach changes from 7.0 to 9.4 and 6.9 to 9.5 FPS respectively. These gains
exceed the noise threshold in both orders, but remain far below the 60 FPS target.

Completed Mac comparisons show no confirmed gain. Values below are existing to
updated FPS; compare within each order only.

| Preset | Scene | Existing first | Updated first |
| --- | --- | ---: | ---: |
| Medium | Thornpeak | 63.8 to 61.1 | 54.2 to 49.8 |
| Medium | Palmreach | 84.5 to 77.5 | 85.8 to 74.9 |
| High | Thornpeak | 54.5 to 51.1 | 53.6 to 50.7 |
| High | Palmreach | 69.7 to 63.4 | 55.9 to 51.0 |
| Ultra | Thornpeak | 48.1 to 48.2 | 43.9 to 43.3 |
| Ultra | Palmreach | 58.5 to 58.4 | 58.7 to 57.6 |
| Insane | Thornpeak | 42.1 to 41.0 | 50.4 to 49.0 |
| Insane | Palmreach | 57.4 to 57.3 | 57.6 to 55.4 |

The Mac matrix is complete. None of the four higher presets establishes a gain
above noise in both orders. Medium Palmreach's reverse loss exceeds the noise
threshold. Ultra and Insane are effectively at parity in both orders. The Redmi
matrix is also complete, with no rejected timing windows or page errors. Its
interruptions are disclosed below; bounded loading-route checks also completed.

In the completed Mac Medium forward Thornpeak comparison, submitted geometry
falls from 4.23 million to 2.24 million triangles and draw calls from 841 to 783.
The sampled world-update CPU phase rises from 1.10 to 1.79 ms, while the submit
phase stays near 12.5 ms. This shows the geometry saving and accompanying CPU cost;
it does not isolate GPU time or prove the exact cause of the FPS result. The report
includes the same measurements for every Mac preset.

The phone gains and Mac results are consistent with different bottlenecks. Cheaper
geometry may relieve GPU pressure on the Redmi while additional CPU bookkeeping
offsets the saving on the Mac. This is an inference, not an isolated GPU measurement.
A single-window Mac comparison with CPU profiling and supported GPU timing would
help separate GPU work, driver stalls and two-browser CPU contention before further
desktop changes are selected.

High Redmi now also improves in both orders: Thornpeak changes from about 4.3 to
5.2 FPS and Palmreach from 4.6-4.7 to 5.7-5.8 FPS. The High reverse reference was
measured after USB debugging reconnected to the surviving game document. No timing
window was in flight during the interruption, but the order crossed that break.
A later local preview-server failure stopped Ultra before measurement; its restart
uses the identical frozen build. Both interruptions and original failures are
preserved in the raw evidence and compact measurement record.

Ultra Redmi Thornpeak changes from 3.50 to 3.95 FPS forward and 3.51 to
3.87 FPS reverse. The reverse gain is only 10.1%, essentially at the roughly
10% noise reference. This is borderline evidence, not a clear performance win.
Palmreach changes from 3.57 to 4.02 FPS forward and 3.66 to 3.86 FPS reverse;
the reverse gain is within noise. Ultra therefore has no clear both-order win
in either scene. Insane also has no clear gain: Thornpeak changes from 3.48 to
3.81 FPS forward and 3.46 to 3.70 reverse; Palmreach changes from 3.43 to 3.59
and 3.62 to 3.81 FPS. All Insane differences remain within the noise reference.

Complete Redmi results, existing to updated FPS within each order:

| Preset | Scene | Existing first | Updated first |
| --- | --- | ---: | ---: |
| Medium | Thornpeak | 5.88 to 8.81 | 5.84 to 8.75 |
| Medium | Palmreach | 6.98 to 9.41 | 6.91 to 9.50 |
| High | Thornpeak | 4.28 to 5.19 | 4.32 to 5.20 |
| High | Palmreach | 4.68 to 5.66 | 4.61 to 5.77 |
| Ultra | Thornpeak | 3.50 to 3.95 | 3.51 to 3.87 |
| Ultra | Palmreach | 3.57 to 4.02 | 3.66 to 3.86 |
| Insane | Thornpeak | 3.48 to 3.81 | 3.46 to 3.70 |
| Insane | Palmreach | 3.43 to 3.59 | 3.62 to 3.81 |

The earlier higher-v4 build also failed to establish a Mac gain. Its High
Palmreach comparison fell from 65.1 to 57.7 FPS forward and 72.4 to 64.4 FPS
reverse, exceeding the noise threshold in both orders. This is retained as
development evidence, not mixed with the final candidate. Reduced triangle
counts alone do not qualify the rollout.

All 16 v6 higher-preset pairs on Mac and Redmi have been inspected. They retain nearby character,
terrain and source-texture readability. Distant giant-tree leaf clusters are
visibly coarser, with Ultra retaining a fuller distant silhouette than Medium.
Animated particles and mist are not pixel-aligned between independent clients.
Insane changes are subtle in these fixed views. The final Low captures and phone
loading-route captures were also inspected.

## Windows desktop validation next

Reuben has an RTX 3060 Windows machine available at work for the morning review.
Desktop recommendations remain provisional until that device is tested. The
[Windows review instructions](scenery-windows-review.md) include a repeatable
local build and single-window comparison harness. Record
its CPU, GPU identity (including laptop/desktop variant), driver, browser version,
resolution, uptime and power state. Availability is confirmed; no Windows results
have been collected yet.

Build the same candidate application source with the supplied diagnostic entry,
using matched Thornpeak and Palmreach cameras and 1920
by 1080 drawing buffers. Compare existing and updated scenery at all five presets,
first in one game window to represent normal desktop play. Repeat both setting
orders, retain individual frame-time windows and screenshot pairs, and apply the
same preparation and quality checks. Compare within this Windows run only; do not
compare its absolute FPS with the two-browser Mac run. Preserve the selected Low
policy and native higher-tier materials, lighting and texture settings.

If FPS is capped at the display rate, report parity at that cap and use frame-time
and supported GPU timing evidence rather than claiming a hidden speedup. CPU
profiles are separate diagnostic captures after the timed blocks. A second,
matched two-browser diagnostic is optional if needed to distinguish concurrency
from device-specific rendering costs. This test does not require publishing or
deploying the branch.

## Evidence and acceptance method

Mac comparisons use two simultaneous uncapped ANGLE Metal browsers at 1600 by 900,
with launch order reversed. These are throughput comparisons under two-browser
load, not expected single-client play FPS. Redmi comparisons use the owned Chrome page in both
setting orders with 0.68 requested render scale (measured 899 by 394 draw buffer
at 894 by 392 CSS pixels in the completed Low, Medium and High captures). Both arms keep the same three-band cel look
and native tier settings, with the adaptive governor and shader-cache warmup
disabled for controlled comparisons. These stationary timings do not establish
normal adaptive-play or sustained movement FPS. Two 20-second windows count submitted frames. Accepted
windows must have stable buffer/quality and no preparation or new shader programs.
Uptime is recorded per run. Comparisons between separate runs are not causal proof.
These measurements use the Mac and Redmi only. The RTX 3060 Windows review is
planned; no iPhone evidence is available.

The phone harness also waits for native background cosmetic and preview work to
finish. On the slow higher presets, frame-based deferrals make that preparation
take many minutes. This waiting period is excluded from the FPS samples and is
not a measurement of loading-screen duration or time until the game becomes visible.

The frozen handoff-v6 build contains 2146 content-hash-verified media assets with
none missing. All TypeScript files recorded in that candidate match its source hashes. Later
Windows harness additions and a test-only lint correction do not alter the frozen
application code.
Raw evidence and the local HTML report are under `tmp/scenery-recovery/`:
`paired-phone-v4b.json`, `paired-mac-v4.json`, `higher-mac-v6.json`,
`higher-phone-v6.json`, and `graphics-loading-report.html`. Failed and excluded
attempts remain alongside them. These local artifacts are not deployed. A compact
[measurement record](scenery-distance-measurements.json) preserves individual
window frame counts, durations, buffers and source-evidence hashes for review.

The final High Mac route covered 176.4 yards across 90 checks with no source-material
identity failures, pending scenery work or page errors. Three route screenshots were
inspected; nearby scenery and terrain remained visible. This is a route smoke check,
not proof against every omission or a sustained movement FPS measurement.

The final Medium phone route covered 175.3 yards across 90 checks, with no
source-material identity failures, pending scenery work or page errors. Its three
captures were inspected; the boundary capture includes a zone banner obscuring
part of the upper view. These are bounded loading checks.

The final Low phone route covered 176.1 yards with the cheap bands active in all
90 checks, zero detected near omissions and zero placement errors. The earlier
build fell back to native scenery in 15 of 90 checks; this corrected handoff keeps
covered bands active while streamed roots prepare. The final absolute-FPS check
then measured Thornpeak **38.74 FPS** (38.51 and 38.97 in its two windows) and
Palmreach **29.73 FPS** (29.06 and 30.39). These checks have no paired reference
and do not establish a new improvement or sustained movement FPS.

The combined handoff-v6 candidate passes 233 focused tests, TypeScript, task-file
lint and its minified build. One settings-byte pin fails identically with the HEAD
source and HEAD test; a separate structural comparison proves sceneryDetail is the
only changed setting across all preset profiles. The baseline hash failure remains
recorded rather than repinned. The real-sweep loading reproducer fails without the
fix and passes with it. The final `node scripts/gate_select.mjs` passes generated
freshness and security, then stops on two existing Biome errors: formatting in
`src/sim/content/pvp_honor.ts:888` and callback return in
`tests/static_instance_cells.test.ts:46`. Both files were byte-identical to HEAD at that check. Later gate stages did not
run. After publication was authorized, the callback in the earlier Low coconut
test was corrected because it belongs to this graphics branch. Its three tests
pass. Lint against the actual user-specified integration base passes for 473
tracked files, with existing warnings retained. An explicit staged-source check
passed for 50 files with 55 warnings retained. Publication checks also pass
TypeScript and 163 architecture/localization tests (three skipped); tracked and
untracked copy-rule scans report no findings. Final staged diff and copy checks
are recorded with the publication evidence. The unrelated PvP formatting is untouched. The phone matrix, bounded loading checks, final Low sanity checks and planned
fixed-view visual review are complete. The Windows hardware review and a fully
green merge gate remain open.

## Visual and performance decision

Keep the recovered Low configuration as the performance reference for Windows
review. Near scenery remains readable in the inspected views, but the aggressive
far-field treatment is conspicuous: sparse dressing, very coarse crowns and pale
giant-tree sprites through Thornpeak fog. It still needs visual polish; it should
not be described as finished art or a demonstrated improvement in every view.

Medium through Insane preserve the requested source textures and lighting. Their
distant silhouettes become coarser, especially on Medium and High. The phone gains
on Medium and High do not make those presets playable on this Redmi. Combined
with the lack of a Mac speed win, this does not support an all-device performance
approval. Use the RTX 3060 test before choosing the desktop direction. No merge,
deployment or engine change follows from this report.

<!-- SCENERY SCREENSHOT EVIDENCE -->
## Screenshot pairs

Low pairs compare the selected prototype with the corrected implementation.
Higher pairs compare existing scenery with handoff-v6.
All planned fixed-view pairs are included.

| Device | Preset | Scene | Before | After |
|---|---|---|---|---|
| Mac | medium | Thornpeak | [Existing](../screenshots/scenery-distance-rollout/higher-v6-medium-thornpeak-stock.webp) | [Updated](../screenshots/scenery-distance-rollout/higher-v6-medium-thornpeak-detail.webp) |
| Redmi | medium | Thornpeak | [Existing](../screenshots/scenery-distance-rollout/higher-phone-v6-medium-forward-stock-thornpeak.webp) | [Updated](../screenshots/scenery-distance-rollout/higher-phone-v6-medium-forward-detail-thornpeak.webp) |
| Mac | medium | Palmreach | [Existing](../screenshots/scenery-distance-rollout/higher-v6-medium-beach-stock.webp) | [Updated](../screenshots/scenery-distance-rollout/higher-v6-medium-beach-detail.webp) |
| Redmi | medium | Palmreach | [Existing](../screenshots/scenery-distance-rollout/higher-phone-v6-medium-forward-stock-beach.webp) | [Updated](../screenshots/scenery-distance-rollout/higher-phone-v6-medium-forward-detail-beach.webp) |
| Mac | high | Thornpeak | [Existing](../screenshots/scenery-distance-rollout/higher-v6-high-thornpeak-stock.webp) | [Updated](../screenshots/scenery-distance-rollout/higher-v6-high-thornpeak-detail.webp) |
| Redmi | high | Thornpeak | [Existing](../screenshots/scenery-distance-rollout/higher-phone-v6-high-forward-stock-thornpeak.webp) | [Updated](../screenshots/scenery-distance-rollout/higher-phone-v6-high-forward-detail-thornpeak.webp) |
| Mac | high | Palmreach | [Existing](../screenshots/scenery-distance-rollout/higher-v6-high-beach-stock.webp) | [Updated](../screenshots/scenery-distance-rollout/higher-v6-high-beach-detail.webp) |
| Redmi | high | Palmreach | [Existing](../screenshots/scenery-distance-rollout/higher-phone-v6-high-forward-stock-beach.webp) | [Updated](../screenshots/scenery-distance-rollout/higher-phone-v6-high-forward-detail-beach.webp) |
| Mac | ultra | Thornpeak | [Existing](../screenshots/scenery-distance-rollout/higher-v6-ultra-thornpeak-stock.webp) | [Updated](../screenshots/scenery-distance-rollout/higher-v6-ultra-thornpeak-detail.webp) |
| Redmi | ultra | Thornpeak | [Existing](../screenshots/scenery-distance-rollout/higher-phone-v6-ultra-forward-stock-thornpeak.webp) | [Updated](../screenshots/scenery-distance-rollout/higher-phone-v6-ultra-forward-detail-thornpeak.webp) |
| Mac | ultra | Palmreach | [Existing](../screenshots/scenery-distance-rollout/higher-v6-ultra-beach-stock.webp) | [Updated](../screenshots/scenery-distance-rollout/higher-v6-ultra-beach-detail.webp) |
| Redmi | ultra | Palmreach | [Existing](../screenshots/scenery-distance-rollout/higher-phone-v6-ultra-forward-stock-beach.webp) | [Updated](../screenshots/scenery-distance-rollout/higher-phone-v6-ultra-forward-detail-beach.webp) |
| Mac | insane | Thornpeak | [Existing](../screenshots/scenery-distance-rollout/higher-v6-insane-thornpeak-stock.webp) | [Updated](../screenshots/scenery-distance-rollout/higher-v6-insane-thornpeak-detail.webp) |
| Redmi | insane | Thornpeak | [Existing](../screenshots/scenery-distance-rollout/higher-phone-v6-insane-forward-stock-thornpeak.webp) | [Updated](../screenshots/scenery-distance-rollout/higher-phone-v6-insane-forward-detail-thornpeak.webp) |
| Mac | insane | Palmreach | [Existing](../screenshots/scenery-distance-rollout/higher-v6-insane-beach-stock.webp) | [Updated](../screenshots/scenery-distance-rollout/higher-v6-insane-beach-detail.webp) |
| Redmi | insane | Palmreach | [Existing](../screenshots/scenery-distance-rollout/higher-phone-v6-insane-forward-stock-beach.webp) | [Updated](../screenshots/scenery-distance-rollout/higher-phone-v6-insane-forward-detail-beach.webp) |
| Mac | low | Thornpeak | [Selected](../screenshots/scenery-distance-rollout/paired-mac-v4-forward-reference-thornpeak.webp) | [Corrected](../screenshots/scenery-distance-rollout/paired-mac-v4-forward-port-thornpeak.webp) |
| Redmi | low | Thornpeak | [Selected](../screenshots/scenery-distance-rollout/paired-v4b-forward-reference-thornpeak.webp) | [Corrected](../screenshots/scenery-distance-rollout/paired-v4b-forward-port-thornpeak.webp) |
| Mac | low | Palmreach | [Selected](../screenshots/scenery-distance-rollout/paired-mac-v4-forward-reference-beach.webp) | [Corrected](../screenshots/scenery-distance-rollout/paired-mac-v4-forward-port-beach.webp) |
| Redmi | low | Palmreach | [Selected](../screenshots/scenery-distance-rollout/paired-v4b-forward-reference-beach.webp) | [Corrected](../screenshots/scenery-distance-rollout/paired-v4b-forward-port-beach.webp) |

### Final-build supplementary captures

These are final-build checks, not additional paired comparisons.

- [Final Low thornpeak absolute-FPS check; no paired reference](../screenshots/scenery-distance-rollout/low-v6-final-thornpeak.webp)
- [Final Low beach absolute-FPS check; no paired reference](../screenshots/scenery-distance-rollout/low-v6-final-beach.webp)
- [Final Low streamed-root route endpoint](../screenshots/scenery-distance-rollout/movement-phone-handoff-v6-end.webp)
- [Higher-setting mac loading route, step 14](../screenshots/scenery-distance-rollout/movement-higher-v6-mac-14.webp)
- [Higher-setting mac loading route, step 44](../screenshots/scenery-distance-rollout/movement-higher-v6-mac-44.webp)
- [Higher-setting mac loading route, step 89](../screenshots/scenery-distance-rollout/movement-higher-v6-mac-89.webp)
- [Higher-setting phone loading route, step 14](../screenshots/scenery-distance-rollout/movement-higher-v6-phone-14.webp)
- [Higher-setting phone loading route, step 44](../screenshots/scenery-distance-rollout/movement-higher-v6-phone-44.webp)
- [Higher-setting phone loading route, step 89](../screenshots/scenery-distance-rollout/movement-higher-v6-phone-89.webp)
