<!-- scripts/profiler/ - shared core for the game performance profiler.
     Node ESM (.mjs), run via scripts/profile.mjs. See scripts/CLAUDE.md. -->

# scripts/profiler/ - performance profiler core

The reusable core behind `scripts/profile.mjs` (the CLI). Built so an MCP server
can wrap the same `Profiler` later without duplicating logic. Drives the REAL game
headed on the real GPU (vsync off) and turns a scenario into rich, structured
metrics. Needs `npm run dev` (:5173); the `crowd` scenario also needs
`ALLOW_DEV_COMMANDS=1 npm run server` (:8787).

## Files
- `metrics.mjs` - **pure** metric math (no DOM/puppeteer), unit-tested in
  `tests/profiler_metrics.test.mjs`:
  - `frameStats(deltasMs, targetFps)` - mean/median FPS, **1%/0.1% lows**,
    p50/p95/p99/p99.9/max, stdev (smoothness), jank %, long-frame + stutter counts.
    The lows are computed from the raw per-frame array, not the perf overlay's
    pre-summarised percentiles, so they reflect true perceived smoothness.
  - `attributeFreezes(samples)` - **freeze attribution**: each hitch frame is
    tagged `shader-compile` (WebGL program count rose), `view-build` (a rig was
    created), `asset-upload` (texture/geometry streamed to the GPU), `long-task`
    (JS/GC), or `other`. Turns "a 1.8s hitch" into "it compiled 2 shaders". The
    sample also reports `newPrograms` (the exact shader cacheKeys that linked
    during the window) so a residual compile is identifiable - i.e. what to prewarm.
  - `normalizeReport(report)` - flatten `window.__game.perf.report()` to a stable
    comparable set. `diffMetrics(before, after)` - A/B delta + better/worse verdict.
- `harness.mjs` - the `Profiler` class: browser/session lifecycle + scenario
  primitives (`enter` offline/online, `teleport`, `setMove`, `tour`, `spawnCrowd`
  /`despawnCrowd`, `combat`, `setTier`, `screenshot`) and the rich `sample({ms})`.
  `sample` injects a rAF collector (`window.__prof`) that records per-frame
  `{dt, programs, views, longTaskMs}`, then folds report + `frameStats` +
  `attributeFreezes`. Online crowds are WS bots with a unique `X-Forwarded-For`
  per bot to clear the 20/min/IP register limit (load-test only).

## Conventions
- Reads the world only through `window.__game` (sim/world/renderer/input/perf) +
  `renderer.webgl.info` / `renderer.views` for the collector. Never mutates sim
  state beyond dev teleports / movement intent.
- Keep `metrics.mjs` PURE (it is the tested seam); orchestration/DOM lives in
  `harness.mjs`. Add a new metric to `metrics.mjs` with a test; add a new scenario
  to `scripts/profile.mjs` (the `SCENARIOS` map), not here.
- Node-only deps (`ws`, `puppeteer-core`) like the rest of `scripts/`.
