# v0.45.2 local CPU, GPU and shader preparation results

Measured on 2026-10-26. Base: `origin/release/v0.45.2`,
`b88b0753d85b5aa370c6186a497b2cb44ff008cd` (same tree as the v0.45.2 tag).
Changes are in the separate `fix/cpu-gpu-prewarm` worktree. No commit or remote
mutation was made.

## Changes

- Complete desktop preparation waits for finite shader catalogs, links, reflection,
  uploads and remainder work before revealing the world. A watchdog reports failure
  instead of publishing unfinished preparation. Constrained memory and synchronous
  drivers retain the existing streaming path.
- Compact resident meshes retain exact program variants after temporary catalog
  materials are disposed. They survive context loss and participate in restoration;
  terminal renderer disposal releases their resources.
- A blocking arrival promotes its existing zone preparation task, waking an idle
  wait while preserving bounded batches and yielding between them.
- Hidden rigs and inactive Cannon/Bastion effect pools skip unnecessary matrix
  traversal. Scene sampling skips color/depth copies when no consumer can draw.
- The AO-off path preserves beauty/depth capture and image output while avoiding
  unnecessary N8AO work. Existing adaptive quality policy is unchanged.
- Profiling CLI entry points and shader harvest server ownership now work on Windows.
- Placed imposters start with a transparent 1×1 map, so preparing their hidden,
  zero-instance mesh compiles the mapped variant that the lazy atlas will use.
  The atlas remains lazy; the seed texture is retained until owner disposal.
- Boss impostors retain one hidden material owner through departures and reappearances,
  keeping their shader-stage and program identities alive without baking an atlas early.
- Sunken Bastion stages the first hidden buttress slot before the existing attach
  gate, preparing its instanced color and shadow variants before the first entity.
  Kit upgrades release the replaced instance buffers.

## Machine and protocol

Windows, Ryzen 5 5600X, RTX 3060 Ti, 32 GB RAM; Edge 156.0.4314.42,
ANGLE D3D11. Throughput runs use 1280×720, DPR 1, Ultra, an offline character,
30 seconds of settling after entry and 8 seconds before each 10-second window.
Every measured window asserts a rendered world, nonzero draw calls and no loading
cover. CPU sampling is 1 kHz; GPU timings come from the existing GPU timer.
No tests or other benchmark runs ran concurrently with the timed windows.

These are short local observations, not a guarantee for every scene or machine.
The world remains live: NPCs and day/night lighting can vary between runs. In the
fixed-settings pair, night amount was 0.85 to 0.87 before and 0.97 after. The starting
player position, resolution, quality levels, shadow settings and AA pass states match.

## Fixed graphics settings

Both runs use the existing `governor=off&terraindetail=0&postshed=0` controls,
full shadow cadence/extent, full resolution, AO off, and explicitly enabled SMAA
with separate grading. The fused FXAA pass is disabled in both. The harness
checks the actual pass flags and quality receipts before accepting samples.

| Window | FPS before → after | Renderer CPU ms before → after | GPU ms before → after | Frame p99 ms before → after |
|---|---:|---:|---:|---:|
| Spawn idle | 46.4 → 57.8 | 17.29 → 14.30 | 7.874 → 7.957 | 38.0 → 27.7 |
| Spawn moving | 43.1 → 44.5 | 18.80 → 18.01 | 9.003 → 9.057 | 48.3 → 48.8 |

The idle sample gains 24.6% FPS and reduces renderer CPU time by 17.3%. The moving
sample gains 3.2% FPS. GPU time is effectively unchanged in this controlled pair;
these measurements do **not** establish a GPU frame-time reduction at equal settings.

## Existing adaptive Ultra behavior

| Window | FPS before → after | Renderer CPU ms before → after | GPU ms before → after | Frame p99 ms before → after |
|---|---:|---:|---:|---:|
| Spawn idle | 45.4 → 51.0 | 17.74 → 16.22 | 8.330 → 7.959 | 43.6 → 30.8 |
| Vale road idle | 46.8 → 47.7 | 17.41 → 17.08 | 8.939 → 8.945 | 34.7 → 35.6 |
| Open area idle | 44.8 → 47.3 | 17.72 → 17.32 | 10.043 → 9.566 | 38.0 → 36.2 |
| Open area moving | 23.7 → 37.8 | 31.76 → 21.32 | 12.536 → 10.809 | 97.5 → 48.0 |

The last window reduces frames over 50 ms from 60 to 1. This pair measures the
product's adaptive behavior, **not identical graphics work**: the original release
times out `post.initial-frame`, leaving SMAA active; complete preparation enables
the existing FXAA shedding path. The optimized run also retains more terrain detail
(0.32 versus 0) and larger shadow extent (step 1 versus 2). Consequently its 13.8%
lower moving GPU time cannot be attributed solely to the new AO passthrough.

The original release also spent about 90 seconds behind the arrival cover on the
Vale-road teleport, visible in the harness's 10-second polling log. Samples exclude
that cover; the optimized arrival needed one polling interval.

## Shader entry capture

The existing `gpu_hitch_capture.mjs` captured entry plus 30 seconds of gameplay.
Both accepted captures use the same browser, flags, hardware, 1280×720 effective
viewport and disabled browser shader disk cache. Both validate as performance
evidence. The existing comparability referee reports no mismatches after allowing
the intentional source/served build IDs and prewarm pacing change.

| Metric | Release | Optimized |
|---|---:|---:|
| Links after reveal, all contexts | 174 | 8 |
| Newly attributed world program keys after reveal | 172 | 4 |
| Reflection calls racing pending links after reveal | 6 | 0 |
| Time in those calls | 865.0 ms | 0 ms |
| Worst such call | 407.6 ms | 0 ms |
| Initial compile units at reveal | 1 pending, 16 deferred | 49 settled |

Post-reveal links fall by 95.4%. The optimized capture links 767 of 775 programs
under the cover and reports no page errors or context loss. Its finite desktop
preparation takes 35.3 seconds and does not time out. This moves work before play;
it is not evidence of a shorter cold startup.

Eight post-reveal links remain, including background zone/preview work. This is
not a claim that every possible future cosmetic, zone or secondary GL context has
already compiled. The broad shader coverage tour is recorded separately.

## Validation

- Changed non-browser suites: 388 tests passed across 21 files.
- Architecture, Eastbrook provenance/integrity and portrait suites: 170 passed.
- Neighboring preparation/reveal contracts: 387 passed across 17 files, including
  the updated bounded-versus-complete resident sweep contract.
- Final completion coverage: 9 passed, including delayed first paint and failed
  links that have nevertheless settled. These counts overlap other focused runs.
- Imposter regressions: 22 focused tests and two real WebGL tests pass. The latter
  cover both atlas cell sizes, context restoration and first sprite rendering with
  the exact prepared program and zero additional links. Final TypeScript checking passes.
- Boss imposter tests: 34 unit/core tests and one real WebGL test pass, covering
  repeated departures, retained program ownership, context restoration before atlas
  creation and terminal disposal. Populated-atlas recovery is not covered by this test.
- Buttress preparation: two focused unit tests and one real WebGL test pass. The
  browser test upgrades constructor fallback meshes to the shipped GLB and checks
  intact, cracked and broken color/shadow draws without additional links.
- Full browser run: 762 passed, one existing weekly-vault layout failure. The exact
  0.5-pixel failure reproduces on the unchanged release. Real WebGL retention,
  context restoration and postprocessing parity tests pass.
- TypeScript, admin Svelte checking, bot types, environment/server/bot builds and
  the production client build pass. Generation/freshness, SFX and malware gates pass.
- Working-tree Biome checks and `git diff --check` pass; source-contract lint
  warnings remain. Browser-generated unrelated screenshots were restored.

`npm run gate` was attempted and its full Vitest stage interrupted after 43 minutes;
**the full gate is not passing or complete**. Twenty-one Windows audio/path/Linux
handler failures reproduce on the clean release. Of 20 selected failed cases rerun
serially, 17 passed, two unchanged simulation tests still exceeded their 20-second
limits (destruction warlock and ferry), and one resident-sweep source contract was
updated and then passed in the neighboring contract run. The remaining canonical
browser, type and build steps were run separately rather than reported as a green gate.

Eastbrook seals were refreshed with the repository's
`remint_polish_provenance.mjs`. A semantic comparison verified that only provenance
changed: historical images, performance values and frozen town identity are unchanged.

## Reproduction and artifacts

From the optimized worktree, with Vite on 5174:

```powershell
node scripts/gpu_hitch_capture.mjs --url 'http://127.0.0.1:5174/?perf&gfx=ultra&gputimer=1' --mode offline --profile full --duration-ms 30000 --viewport 1280x720 --angle d3d11 --allow-dirty --out tmp/perf-after-gpu.json --cpu-profile tmp/perf-after.cpuprofile
node D:/world-of-claudecraft/tmp/local-perf-run.mjs after 5174
node D:/world-of-claudecraft/tmp/local-perf-locked-run.mjs after-locked 5174
```

The two temporary harness scripts call the project's existing `Profiler` and
entry helpers. The baseline uses the same scripts from the original worktree on
5173 with labels `baseline-repeat` and `baseline-locked`. Its old Windows GPU CLI
guard requires invoking exported `capture(parseArgs(...))` directly.

Primary local artifacts:

- `D:/world-of-claudecraft/tmp/perf-before-repeat-gpu.json` and matching CPU profile.
- `tmp/perf-after-gpu.json`, `tmp/perf-after.cpuprofile`, `tmp/perf-gpu-comparison.json`.
- Both worktrees' `tmp/{baseline-repeat,baseline-locked,after,after-locked}-steady.json`
  files, matching profiles and screenshots (each label lives in its corresponding tree).
- `tmp/cpu-gpu-throughput-comparison.json` and per-window `*-cpu.txt`, generated with
  the existing `cpu_profile_window.mjs` analyzer using page-clock sample bounds.
- `tmp/cpu-gpu-*.log` for gate attempts, focused tests, builds and lint; clean-release
  reproduction logs are in the original worktree's `tmp/`.

The earlier `before-steady` sample rendered only a loading cover and was marked
invalid. `exploratory-after-gpu` has a source-build mismatch. The first valid boot
baseline had a different viewport. None of those artifacts supplies the tables above.

The first broad shader tour was deliberately stopped after confirming the imposter
gap. Its diagnostic-only `tmp/cpu-gpu-harvest-initial-low.json` contains the actual
unmapped boot shaders and the mapped shader first linked at
`zone:eastbrook_vale:poi3`. That partial tour is not a completed coverage receipt.
The throughput tables above precede the final imposter seed fix; that isolated fix
has separate real WebGL regression coverage and does not change the live atlas shader.

The subsequent combined Low/Ultra tour stopped during Low mount skins before it
wrote its corpus. Its log records Low zone, dungeon, raid and battleground steps,
but is not a completed coverage receipt. It exposed the boss-material ownership
and lazy buttress gaps fixed above. Mount skin selection also lacked ownership:
the harvest now grants the offline dev catalog and asserts the requested appearance
and completed visual preparation instead of counting a rejected selection.

The harvest now checkpoints the shader corpus before each tour point, explicitly
marked partial until the final driver readback and report finish. Cold tooling entry
waits for the existing boot ownership event after start-screen listeners are wired.
The corpus/server regression suites pass (14 tests). The interrupted final Low
attempt stopped after Frostveil; its log alone is not a completed coverage receipt.

## Draft PR status, 2026-10-28

The checkpointed Low/Ultra harvest is still running. Completed Low mount, ability,
window, dive, dungeon, raid and battleground steps revealed one additional live
program: Mere Hydra's skinned body in Drowned Temple. That body is constructed
after the TempleFx attachment gate. Its fix is not included in this snapshot.
The four mount skins now select and prepare their actual appearances, but some
recorded no movement, so motion-only effects are not proven by this tour. One
mount also emitted a geometry-merge console error. No claim of universal shader
coverage or final-source zero late links is made. Final boot capture remains pending.

Artifacts: `tmp/cpu-gpu-final-checkpointed/checkpoint.json` (explicitly partial),
its shader files and log; `tmp/drowned-live-shader-evidence.json` identifies the
Hydra mesh, actual shader sources and owner hierarchy. The draft PR deliberately
leaves the full gate and coverage completion unchecked.
