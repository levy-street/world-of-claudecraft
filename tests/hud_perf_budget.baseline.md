# HUD per-frame performance baseline

The committed performance floor for the HUD per-frame render path. `hud_perf_budget.test.ts`
reads this file and throws if it is missing, so the numbers below are golden values: a
deliberate change to the per-frame budget updates the rows here in the same commit.

## How the three metrics are compared (read first)

The numbers are not interpreted the same way:

- **`hudHotDomWrites` (the elision-bypass count) is the durable, run-length-independent
  anchor.** It counts the hot-DOM writes that bypassed the write-elision cache (boot plus the
  occasional state-change write). A longer run adds only skips, never new bypass writes once the
  world is steady, so the count does not move with frame count, CPU or GPU speed, or machine
  load: it is byte-identical on desktop, mobile, and every re-run. A collapse of write-elision
  makes it balloon toward the frame count, so the standing gate (ARM 3) asserts the count stays
  at or below the committed anchor on every viewport. This is the number that travels across
  hardware.
- **`hudHotDomSkipRate` (the skip ratio) is derived and frame-count-dependent.** It is
  `skipped / (skipped + bypassed)`; the denominator is the total frame count, which jitters with
  software-WebGL fps and machine load run to run. It is reported for human context and used as a
  hard floor only by ARM 2's deterministic fake-DOM loop (a fixed denominator), never as a
  cross-run hard gate in a real-browser tour.
- **`frameP95` and `inputIntentToFrameP95` are same-machine-relative only.** They are wall-clock
  milliseconds and do not travel across hardware. They were captured under headless Chrome with
  software WebGL (`--use-angle=swiftshader`), which renders at roughly 1 to 2 fps, so the
  absolute values below are dominated by software rasterization, not by HUD cost. Compare them
  only against a fresh same-machine re-run of this baseline, never against the literal
  milliseconds on different hardware or a different renderer.

## Regenerating

perf_tour drives a real browser against the offline client only. It needs `npm run dev` (Vite)
listening on http://localhost:5173 and a Chromium-family browser resolved by
`scripts/browser_path.mjs`, launched headless with
`--use-angle=swiftshader --enable-unsafe-swiftshader`. No server or Postgres is required:
perf_tour boots the offline `Sim` directly (clicks `#btn-offline`, names a character, picks
warrior, clicks `#btn-start-offline`).

```sh
# desktop profile (1600x900, deviceScaleFactor 1, non-touch):
PERF_VIEWPORT=desktop node scripts/perf_tour.mjs
# pin the JSON output path:
PERF_OUT=/path/to/perf-tour-desktop.json PERF_VIEWPORT=desktop node scripts/perf_tour.mjs
```

`PERF_VIEWPORT` selects the profile: `desktop`, `mobile`, or `both` (default). Other relevant
defaults: `GAME_URL=http://localhost:5173`, `PERF_SCENARIO=bench_perf_tour`,
`PERF_STEP_MS=2500`, `PERF_SETTLE_MS=600`, `PERF_BOOT_TIMEOUT_MS=120000`. The mobile profile
boots landscape (844x390): the in-game world is landscape-only on web mobile, so a portrait
viewport hits the `#rotate-device` gate and never boots.

## Capture machine (absolute milliseconds are not portable)

| Field | Value |
|---|---|
| CPU | Apple M4 Max |
| Cores | 16 logical / 16 physical |
| RAM | 128 GB |
| OS | macOS 26.5.1 (arm64) |
| Node | v24.15.0 |
| Browser | Google Chrome 149.0.7827.196, headless, ANGLE swiftshader (software WebGL) |
| Captured | 2026-06-24 |

## Recorded floor

### desktop (1600x900)

| Metric | Value | Role |
|---|---|---|
| **hudHotDomSkipRate** | **0.962** (38 hot writes / 950 skipped, 988 total) | ARM 2 deterministic-loop floor |
| frameP95 | 250 ms | same-machine-relative only |
| inputIntentToFrameP95 | 652.7 ms | same-machine-relative only |
| inputIntentToVisibleP95 | 658.2 ms | same-machine-relative only |
| fps (full / last 10s) | 1.29 / 1.58 | software-WebGL artifact, context only |
| rendererTier | ultra | |
| bootMiB | 68.779 | |
| gltf / textures / views | 150 / 51 / 46 | |
| samples / errors | 6 / 0 | |

### mobile (844x390 landscape)

| Metric | Value | Role |
|---|---|---|
| **hudHotDomSkipRate** | **0.961** | within the boot-write band; the bypass count is identical to desktop |
| hudHotDomWrites | 153 | the durable invariant (the elision-bypass count, byte-identical to desktop) |
| frameP95 | 250 ms | same-machine-relative only |
| fct burst | [64, 64, 64] | FCT pool cap-bounded (FCT_POOL_CAP=64) under the 3x400 AoE waves |
| bootMiB | 55.066 | |

The desktop and mobile skip ratios differ only in the denominator (frame count): the
elision-bypass count `hudHotDomWrites` is 153 on both, so write-elision is invariant across
viewport. The durable per-frame anchor is `hudHotDomWrites`, byte-identical viewport to
viewport; the gate keys on it, not on the frame-count-dependent ratio.

## How the gate uses this

`hud_perf_budget.test.ts` reads three values and throws if any is absent (a deleted or
unregenerated baseline fails the budget instead of silently defaulting):

- the strictest committed `hudHotDomSkipRate` floor, for ARM 2's deterministic fake-DOM loop;
- the canonical `hudHotDomWrites` anchor row, for ARM 3's bypass-count gate (asserted on every viewport);
- the `frameP95` reference, which an operator on other hardware overrides with a fresh
  same-machine re-run via `HUD_PERF_BUDGET_TOUR_FRAME_BASELINE`.
