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
  load. The establishing-write floor DOES differ by viewport (the touch HUD builds more
  per-frame elements than the desktop layout) and can jitter by a write or two run to run, so
  the committed anchor is a single canonical row covering the WORST viewport with that jitter
  as headroom. A collapse of write-elision makes the count balloon toward the frame count
  (thousands, far past any viewport delta), so the standing gate (ARM 3) asserts the count
  stays at or below the committed anchor on every viewport. This is the number that travels
  across hardware.
- **`hudHotDomSkipRate` (the skip ratio) is derived and frame-count-dependent.** It is
  `skipped / (skipped + bypassed)`; the denominator is the total frame count, which jitters with
  software-WebGL fps and machine load run to run. It is reported for human context and used as a
  hard floor only by ARM 2's deterministic fake-DOM loop (a fixed denominator), never as a
  cross-run hard gate in a real-browser tour.
- **`frameLong50` (the long-frame count) and `tourMinFrames` (the tour frame floor) are the
  ARM 3 frame gates, captured under `PERF_GPU=1` (headed Chrome on the real GPU).** The retired
  frame-p95 gate was mathematically unfailable: its threshold equaled the PerfMonitor sample
  clamp, so a catastrophically slow run saturated every sample INTO the passing value. The
  replacement pair is failable from both directions: a hitchy run grows the count of frames at
  or over 50 ms past the `frameLong50` anchor, and a saturated (or barely-rendering) run cannot
  reach the `tourMinFrames` floor. Both are same-machine values (wall-clock dependent): an
  operator on other hardware overrides the long-frame anchor with a fresh same-machine capture
  via `HUD_PERF_BUDGET_TOUR_LONG50_BASELINE`. Feed ARM 3 a `PERF_GPU=1` artifact; the headless
  swiftshader mode renders at roughly 1 to 2 fps and cannot meet the frame floor by design.
- **`inputIntentToFrameP95` and the other absolute milliseconds below are same-machine-relative
  only.** They were captured under headless Chrome with software WebGL
  (`--use-angle=swiftshader`), so they are dominated by software rasterization, not by HUD cost.
  Compare them only against a fresh same-machine re-run of this baseline, never against the
  literal milliseconds on different hardware or a different renderer.

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
# real-GPU mode (HEADED, opens a browser window): required for the frameLong50 and
# tourMinFrames rows, which are meaningless under software rasterization:
PERF_GPU=1 PERF_VIEWPORT=both node scripts/perf_tour.mjs
```

`PERF_VIEWPORT` selects the profile: `desktop`, `mobile`, or `both` (default). Other relevant
defaults: `GAME_URL=http://localhost:5173`, `PERF_SCENARIO=bench_perf_tour`,
`PERF_STEP_MS=2500`, `PERF_SETTLE_MS=600`, `PERF_BOOT_TIMEOUT_MS=120000`. The mobile profile
boots landscape (844x390): the in-game world is landscape-only on web mobile, so a portrait
viewport hits the `#rotate-device` gate and never boots.

## Capture machine (absolute milliseconds are not portable)

Both capture modes ran on the same machine; the swiftshader rows and the real-GPU rows
carry their own capture dates and browser modes.

| Field | Value |
|---|---|
| CPU | Apple M4 Max |
| Cores | 16 logical / 16 physical |
| RAM | 128 GB |
| OS | macOS 26.5.2 (arm64) |
| Node (swiftshader rows) | v24.15.0 |
| Browser (swiftshader rows) | Google Chrome 149.0.7827.196, headless, ANGLE swiftshader (software WebGL) |
| Captured (swiftshader rows) | 2026-06-24 |
| Node (real-GPU rows) | v26.5.0 |
| Browser (real-GPU rows) | Google Chrome 150.0.7871.182, HEADED, real GPU (`PERF_GPU=1`) |
| Captured (real-GPU rows) | 2026-07-23; packet-close reconfirm + bypass-anchor re-derivation 2026-07-24 |

## Recorded floor

### desktop (1600x900)

| Metric | Value | Role |
|---|---|---|
| **hudHotDomSkipRate** | **0.962** (38 hot writes / 950 skipped, 988 total) | ARM 2 deterministic-loop floor |
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
| **hudHotDomSkipRate** | **0.961** | within the boot-write band; ARM 2 floor input |
| fct burst | [64, 64, 64] | FCT pool cap-bounded (FCT_POOL_CAP=64) under the 3x400 AoE waves |
| bootMiB | 55.066 | |

The desktop and mobile skip ratios differ only in the denominator (frame count). The durable
per-frame anchor is the elision-bypass count: its canonical row lives in the real-GPU tour
gates section below (a single anchor covering the worst viewport), and the gate keys on it,
not on the frame-count-dependent ratio.

### real-GPU tour gates (PERF_GPU=1, headed, captured 2026-07-23, reconfirmed 2026-07-24)

The ARM 3 frame gates plus the elision-bypass anchor. Captured with
`PERF_GPU=1 PERF_VIEWPORT=both` over two back-to-back runs on the capture machine above
(Chrome 150, headed, real GPU, vsync-paced), and reconfirmed at the packet 0 close with two
more both-viewport runs. Healthy frame captures: desktop 876 and 873 frames with 3 and 7
long frames; mobile 1279 and 1245 frames with 2 and 2 long frames (2026-07-23); the
packet-close runs measured desktop 1586 and 1589 frames, mobile 1531 and 1530, all with 0
long frames. The committed anchor takes the worst healthy long-frame count (7) plus headroom
for run jitter; the committed floor sits between the worst healthy frame count (873) and the
saturation signature (a run whose every frame hits the 250 ms sample clamp renders only
about 60 to 220 frames over this tour, and a half-speed catastrophe about 450), so both
directions keep real failing room. A 60 Hz display halves the 120 Hz-class packet-close
captures to about 765 to 795 frames, still clearing the floor; the 2026-07-23 captures were
not 120 Hz-paced, so do not halve THOSE against the floor. The
packet-close captures sit comfortably inside both rows, so per R13 the rows were KEPT.

The elision-bypass anchor was re-derived at the packet close: the healthy captures measured
desktop 538 and 539 bypass writes and mobile 632 and 632 (the v0.30 HUD growth, with the
deed tracker, yumi strip, party-below-target, tab strip, and mobile action ring all
establishing writes at boot; the touch HUD explains the viewport delta). The committed
anchor covers the worst viewport (632) plus run-jitter headroom; a write-elision collapse
balloons the count toward the frame count (thousands), so the headroom costs no detection.

| Metric | Value | Role |
|---|---|---|
| frameLong50 | 12 | ARM 3 anchor: frames at or over 50 ms in the tour window (worst healthy capture 7) |
| tourMinFrames | 500 | ARM 3 floor: minimum real frames the tour must render (worst healthy capture 873) |
| hudHotDomWrites | 640 | ARM 3 anchor: elision-bypass writes, every viewport (worst healthy capture 632, mobile) |

All rows are single canonical rows valid for every viewport: each committed anchor covers
the worst viewport, the committed floor the slowest one. `frameLong50` is windowed by the
PerfMonitor sample ring (MAX_SAMPLES), which comfortably covers this short tour; do not
lengthen the tour without rechecking that window.

## How the gate uses this

`hud_perf_budget.test.ts` reads four values at collection time and throws if any is absent
(a deleted or unregenerated baseline fails the budget instead of silently defaulting, in
bare `npm test` too, before any env gate is consulted):

- the strictest committed `hudHotDomSkipRate` floor, for ARM 2's deterministic fake-DOM loop;
- the canonical `hudHotDomWrites` anchor row, for ARM 3's bypass-count gate (asserted on every viewport);
- the canonical `frameLong50` anchor row, for ARM 3's long-frame gate; an operator on other
  hardware overrides it with a fresh same-machine `PERF_GPU=1` capture via
  `HUD_PERF_BUDGET_TOUR_LONG50_BASELINE`;
- the canonical `tourMinFrames` floor row, for ARM 3's saturation-killing frame floor.

ARM 3 expects a `PERF_GPU=1` artifact: the headless swiftshader mode renders too few frames
to meet the floor, by design (that slowness is exactly the saturation signature the floor
exists to catch).
