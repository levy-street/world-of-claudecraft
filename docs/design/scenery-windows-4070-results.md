# Windows RTX 4070 Laptop scenery results, 15 October 2026

Status: completed historical measurement of commit `c33418ac34895a94ebf0ff7c25f895c2628634a4`.
Published on top of `4cb80dae0bef38b5fe237d2c45d869fc6db59c3e`, which includes a later integration merge. **These results do not measure that merge or the current branch head.**

Low Thornpeak is the only case with an FPS improvement above 10% in both run orders: **+15.90% forward and +12.22% reverse**. Low Palmreach improved by about 7-8%. Medium through Insane did not show a repeatable improvement above that threshold. This supports the Low Thornpeak optimization on this machine, not a general desktop performance claim or a shipping decision.

## Review packet

- [Per-run summary](scenery-windows-4070-2026-10-15/summary.json): 40 rows and 20 comparisons, including timing tails, hitch counts, draw calls, triangles and sampled CPU counters.
- [Compressed original capture](scenery-windows-4070-2026-10-15/results.json.gz): all accepted windows, exclusions, diagnostics and console errors. Decompression restores the original JSON byte for byte.
- [Integrity manifest](scenery-windows-4070-2026-10-15/manifest.json): file sizes and SHA-256 hashes, including the uncompressed capture.
- [Completed audit](scenery-windows-4070-2026-10-15/audit.json) and [build provenance](scenery-windows-4070-2026-10-15/build-provenance.json).
- Archived experiment sources: [4070 runner](scenery-windows-4070-2026-10-15/bench-4070.mjs.txt), [summary calculation](scenery-windows-4070-2026-10-15/summarize.mjs.txt), [audit calculation](scenery-windows-4070-2026-10-15/audit.mjs.txt). These are evidence snapshots, not maintained application tooling.
- All 40 screenshots are in [the screenshot directory](../screenshots/scenery-windows-4070-2026-10-15). Forward pairs are linked below; reverse captures use the same names with `reverse`.

The summary changes only local file/screenshot references to repository-relative paths. Published JSON metadata is formatted for the repository; its values are unchanged. The raw capture, archived experiment sources and screenshots are copied without modification. The audit's source path records the original experiment directory.

For reproduction, use a separate checkout of the tested commit and the original Windows protocol's dependency, generation and build steps. Restore the archived runner as `tmp/scenery-review/bench-4070.mjs`; its imports assume that location. Generate fresh build provenance for that checkout before running it, following the fields and manifest hash in the archived provenance. Do not reuse the historical build hash for a new build. The summary and audit snapshots likewise assume their original `tmp/scenery-review` location and recorded capture-directory name.

To inspect the raw capture from the repository root with Node:

```sh
node --input-type=module -e "import fs from 'node:fs'; import {gunzipSync} from 'node:zlib'; const d=JSON.parse(gunzipSync(fs.readFileSync('docs/design/scenery-windows-4070-2026-10-15/results.json.gz'))); console.log({complete:d.complete,rows:d.rows.length,excluded:d.excluded.length});"
```

## Device and scope

MSI Katana 15 B12VGK; Intel Core i7-12650H (10 cores, 16 threads); 16 GB RAM; Windows 11 Home 10.0.26200; NVIDIA GeForce RTX 4070 Laptop GPU, driver 32.0.16.1062; Chrome 155.0.8059.41; 1920 x 1080 drawing buffer at DPR 1 on a 144 Hz panel. The renderer was ANGLE/NVIDIA/D3D11, checked in every accepted window. WMI's adapter-memory field is not a reliable VRAM capacity measurement.

AC power and 100% battery, Balanced power plan at the start and end. No continuous thermal or power logging. The machine had roughly 14 days of uptime and ordinary background applications were left in place. This is a measurement of normal local conditions, not a controlled cold-boot laboratory run.

Capture: 14 October 2026, 20:00:14.839 to 22:55:24.641 UTC (15 October in New Zealand), about 175 minutes. Node v26.2.0. The research bundle was built from a clean tracked checkout at the tested commit, with offline entry enabled only in the local minified bundle. All 2,146 media hashes were verified; the build manifest hash is in the provenance record. The research bundle is not deployable.

This is an A/B toggle of `sceneryDetail=0` and `sceneryDetail=1` on one commit. It does not measure the complete feature branch against release. The original [Windows protocol](scenery-windows-review.md) expected an RTX 3060. This machine has an RTX 4070 Laptop, so the archived local runner relocates its imports, narrows the GPU guard to the verified device, and adds provenance. Measurement logic was unchanged.

## Method

One visible Chrome browser with normal display pacing; five presets; existing then updated (forward), then updated then existing (reverse). Each arm contains Thornpeak and Palmreach, with two accepted 20-second windows per scene: 40 rows, 80 windows, 127,521 submitted frames. No skipped or multiply-submitted callbacks were accepted.

Thornpeak player position (30, 700), camera yaw 0.5, pitch 0.3, distance 8. Palmreach, named `beach` in the data, uses (-352, 806), yaw 0, pitch 0.5, distance 8. Fixed noon, three-band cel shading, performance governor off, shader-cache warmup off. Low disables FXAA and uses coconut cell size 128 in both arms; other tiers use native settings. Resolution scale stayed 1 and the post-processing rung stayed full.

Each scene settles for 12 seconds and requires three consecutive five-second quiet windows before collection. Changing shader/program or preparation counts invalidate the block. Four blocks were excluded for preparation changes, not for low FPS or hitches. Accepted hitches remain in the data. One fresh browser profile was shared across the matrix; driver caches were not flushed. This is steady-state testing, not cold-start testing.

FPS is total submitted frames divided by total elapsed time across the two windows. p95/p99 use nearest-rank percentiles of their pooled raw frame intervals. A gain above roughly 10% in both orders is the study's practical decision threshold, not a formal statistical significance test. The two orders are not independent multi-day replications.

## Results

Each FPS value combines two 20-second windows. p99 is existing / updated, in milliseconds. Higher FPS and lower p99 are better.

| Preset | Scene | Order | Existing FPS | Updated FPS | Change | p99 ms |
|---|---|---|---:|---:|---:|---:|
| low | Thornpeak | forward | 112.11 | 129.95 | +15.90% | 11.9 / 9.7 |
| low | Thornpeak | reverse | 117.46 | 131.81 | +12.22% | 10.7 / 9.6 |
| low | Palmreach | forward | 124.77 | 134.08 | +7.46% | 10.4 / 9.4 |
| low | Palmreach | reverse | 129.37 | 139.43 | +7.78% | 9.6 / 9.0 |
| medium | Thornpeak | forward | 66.16 | 66.27 | +0.17% | 18.0 / 17.9 |
| medium | Thornpeak | reverse | 63.39 | 65.83 | +3.86% | 18.7 / 17.9 |
| medium | Palmreach | forward | 80.10 | 75.65 | -5.55% | 14.6 / 15.7 |
| medium | Palmreach | reverse | 75.77 | 75.75 | -0.03% | 15.7 / 15.3 |
| high | Thornpeak | forward | 59.65 | 60.97 | +2.21% | 20.3 / 19.4 |
| high | Thornpeak | reverse | 60.84 | 60.58 | -0.42% | 20.2 / 20.7 |
| high | Palmreach | forward | 72.72 | 71.40 | -1.82% | 16.9 / 16.6 |
| high | Palmreach | reverse | 74.05 | 72.08 | -2.67% | 16.6 / 16.6 |
| ultra | Thornpeak | forward | 60.32 | 63.19 | +4.75% | 20.3 / 19.4 |
| ultra | Thornpeak | reverse | 59.87 | 58.91 | -1.60% | 20.4 / 20.2 |
| ultra | Palmreach | forward | 71.43 | 73.92 | +3.48% | 17.5 / 16.6 |
| ultra | Palmreach | reverse | 72.40 | 70.29 | -2.92% | 17.3 / 17.4 |
| insane | Thornpeak | forward | 58.31 | 61.29 | +5.11% | 20.7 / 19.2 |
| insane | Thornpeak | reverse | 63.81 | 61.81 | -3.14% | 19.7 / 20.4 |
| insane | Palmreach | forward | 70.10 | 71.55 | +2.08% | 17.8 / 16.7 |
| insane | Palmreach | reverse | 78.09 | 71.39 | -8.58% | 15.8 / 17.6 |

Low Thornpeak also improved p99 from 11.9 to 9.7 ms forward and 10.7 to 9.6 ms reverse. Low Palmreach's smaller gain is close to the panel's 144 Hz pacing ceiling. Higher-tier individual comparisons range from -8.58% to +5.11%; none meets the two-order improvement or regression threshold. This does not prove the smaller differences are zero.

Ten accepted frame intervals exceeded 50 ms: eight in Low/reverse/existing/Palmreach (maximum 168.8 ms), one in High/reverse/updated/Thornpeak (107.2 ms, with one recorded long task), and one in Ultra/forward/updated/Palmreach (52 ms). Two exceeded 100 ms. The long-task observer is not a complete causal trace; the result does not establish stutter-free play.

## CPU follow-up for the next AI

In every Medium and High scene/order comparison, the median sampled last-frame foliage phase rose from about 0.1 ms existing to 0.7-0.8 ms updated. The median rolling world phase rose from about 1.03-1.08 to 1.69-1.77 ms for Medium and 1.06-1.10 to 1.61-1.76 ms for High. Meanwhile, Medium reduced submitted triangles by about 41-47% and High by about 23-24%, with much smaller draw-call reductions (roughly 0-7%). Inspect the exact counters in the summary before choosing a change.

At the tested commit, `Renderer.sync` includes `updateSceneryDetail` in the foliage phase. In `src/render/scenery_detail.ts`, `SceneryDetailSession.update` scans roughly 3,650 registered entries and checks visibility/material/version state before the unchanged-state early return. In `src/render/scenery_detail_batches.ts`, `SceneryDetailBatches.update` visits children/pools and performs compatibility, visibility and frustum work before the buffer-repack early exit.

Hypothesis: recurring scenery maintenance partly offsets geometry savings on this machine. The counters do not prove a CPU bottleneck or isolate either method's cost. Next, profile these two methods, separating entry scans and compatibility/visibility checks from conditional distance/repack work and render submission. Collect GPU timings before attributing a result to GPU cost. Re-find these symbols on the current branch because the integration merge may have changed the workload.

## Integrity, diagnostics and limits

The final raw-data audit passed the full matrix, stationary locations, scale/post-processing settings, GPU identity, material identity, empty-draw guard and frame accounting. Cross-arm quality settings matched within every preset; sampled camera positions were stable. All 20 forward screenshots were visually reviewed: no missing near terrain or characters was observed, while distant canopies simplify, most visibly on Low. This is not a moving-camera or full-world visual qualification.

There were zero page errors and 341 console errors in three distinct categories: a local API 502 response, a training-dummy model not preloaded (`models/creatures/training_dummy.glb`), and a druid staff model not preloaded (`models/weapons/brasscrown_walking_staff.glb`). These remain in the raw evidence. Do not describe the run as console-clean.

Preparation validation completed before capture: `node --test scripts/scenery_review/checks.test.mjs` passed all five tests; `node scripts/scenery_review/build.mjs` completed and verified all media. The final `node tmp/scenery-review/audit.mjs` passed. A separate read-only review checked the raw arithmetic, settings, cameras and material audits. No application code was changed for this publication, and the benchmark was not rerun after the integration merge.

The earlier [Mac/Redmi study](scenery-distance-rollout.md) is context, not an absolute-FPS baseline: Mac used two uncapped browsers at 1600 x 900, while Redmi used a smaller buffer and different render scale. Redmi's selected Low prototype comparison also differs from this toggle experiment. Compare within-device paired outcomes rather than raw device FPS. This Windows run does not qualify online play, moving cameras, the automatic governor, startup latency, sustained thermals, isolated GPU time or newly integrated town content.

## Forward screenshot pairs

| Preset | Scene | Existing | Updated |
|---|---|---|---|
| low | Thornpeak | [Existing](../screenshots/scenery-windows-4070-2026-10-15/low-forward-existing-thornpeak.webp) | [Updated](../screenshots/scenery-windows-4070-2026-10-15/low-forward-updated-thornpeak.webp) |
| low | Palmreach | [Existing](../screenshots/scenery-windows-4070-2026-10-15/low-forward-existing-beach.webp) | [Updated](../screenshots/scenery-windows-4070-2026-10-15/low-forward-updated-beach.webp) |
| medium | Thornpeak | [Existing](../screenshots/scenery-windows-4070-2026-10-15/medium-forward-existing-thornpeak.webp) | [Updated](../screenshots/scenery-windows-4070-2026-10-15/medium-forward-updated-thornpeak.webp) |
| medium | Palmreach | [Existing](../screenshots/scenery-windows-4070-2026-10-15/medium-forward-existing-beach.webp) | [Updated](../screenshots/scenery-windows-4070-2026-10-15/medium-forward-updated-beach.webp) |
| high | Thornpeak | [Existing](../screenshots/scenery-windows-4070-2026-10-15/high-forward-existing-thornpeak.webp) | [Updated](../screenshots/scenery-windows-4070-2026-10-15/high-forward-updated-thornpeak.webp) |
| high | Palmreach | [Existing](../screenshots/scenery-windows-4070-2026-10-15/high-forward-existing-beach.webp) | [Updated](../screenshots/scenery-windows-4070-2026-10-15/high-forward-updated-beach.webp) |
| ultra | Thornpeak | [Existing](../screenshots/scenery-windows-4070-2026-10-15/ultra-forward-existing-thornpeak.webp) | [Updated](../screenshots/scenery-windows-4070-2026-10-15/ultra-forward-updated-thornpeak.webp) |
| ultra | Palmreach | [Existing](../screenshots/scenery-windows-4070-2026-10-15/ultra-forward-existing-beach.webp) | [Updated](../screenshots/scenery-windows-4070-2026-10-15/ultra-forward-updated-beach.webp) |
| insane | Thornpeak | [Existing](../screenshots/scenery-windows-4070-2026-10-15/insane-forward-existing-thornpeak.webp) | [Updated](../screenshots/scenery-windows-4070-2026-10-15/insane-forward-updated-thornpeak.webp) |
| insane | Palmreach | [Existing](../screenshots/scenery-windows-4070-2026-10-15/insane-forward-existing-beach.webp) | [Updated](../screenshots/scenery-windows-4070-2026-10-15/insane-forward-updated-beach.webp) |
