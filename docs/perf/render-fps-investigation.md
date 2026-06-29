# Render FPS investigation: where the frame time actually goes

Draft / findings only. No code change is proposed here: the investigation concluded
that the obvious crowd lever is already shipped (#1013) and the remaining "fixed
cost" levers are no-ops on the hardware they were tested against. This documents the
measurements so the next person does not re-derive them.

Method: `scripts/profile.mjs` driving the real game headed on a discrete GPU (RTX
3060 Ti), vsync off, 1920x1080, high tier, plus the renderer's own per-phase timing
`renderer.perfStats().phaseMs` (setup / entities / world / nameplates / submit /
total). Crowds are real WS bot clients. A/B comparisons toggle a flag at a FIXED
crowd and use order-alternated paired rounds to cancel GPU warm/cool drift.

## Finding 1: crowds are GPU-bound on the submit phase, not CPU

Per-phase average frame time (ms), solo vs a 50-player crowd in view:

| phase | solo (~4 rigs) | crowd (~90 rigs) | delta |
|---|---|---|---|
| entities (character CPU: anim/skinning) | 0.56 | 1.93 | +1.37 |
| world (terrain/foliage/props CPU) | 0.39 | 0.38 | ~0 |
| nameplates | 0.11 | 0.26 | +0.15 |
| **submit (GPU rasterize + post + shadow)** | **7.86** | **14.22** | **+6.36** |
| total | 8.96 | 16.82 | +7.86 |

80%+ of the crowd's added frame time is **submit**: rasterizing ~50 extra skinned
rigs (~6 draws each) into the main pass and re-rendering the close ones into the
4096 sun shadow map. The CPU character work (animation mixer/skinning) is small
(~2ms even at 90 rigs), so throttling animation harder is NOT the lever on this
class of hardware. The lever is the GPU rig + shadow DRAW load.

## Finding 2: the crowd lever is a crowd-adaptive character LOD (already shipped)

Reducing the count of fully-articulated, shadow-casting rigs under crowd directly
cuts submit. An A/B of exactly this (scale the articulated-shadow and
articulated-LOD ranges down as the visible-rig count climbs) measured, at a fixed
50-player crowd spread across ~70u, drift-canceled over four paired rounds:

- **+8.7 fps (+13.9%)** (mean ~62.7 -> ~71.4), positive in all four rounds
- submit **-0.95 ms**, lower in all four rounds
- 1% low +3.4 (smoother)

This is the design that **#1013 (crowd-adaptive character LOD) already implements**,
now merged into `release/v0.16.0` (`crowdLodScaleSq` + `lastVisibleRigCount` in
`renderer.ts`). A standalone re-implementation (PR #1035) was closed as a duplicate.
The only non-duplicate follow-up would be to split #1013's single `CROWD_LOD_MIN_SCALE`
(0.6) into separate, more-aggressive shadow vs LOD floors (data suggests shadow can
go to ~0.40, LOD ~0.52 while keeping the LOD floor past melee range), for a few
extra percent. Marginal; not pursued here.

## Finding 3: on a discrete GPU the frame is NOT fill-bound, so resolution / post-quality reductions are no-ops

The "fixed" submit cost (~6.8 to 7.8ms even solo) looks like the post chain (N8AO
SSAO, UnrealBloom, grade) plus the base scene. It is tempting to cut it with render
scale or cheaper post. Measured, it does almost nothing on this hardware:

| change (solo, high tier) | canvas | submit | fps |
|---|---|---|---|
| renderScale 1.0 (baseline) | 1920x1080 | 7.77 | 94 |
| **renderScale 0.5 (quarter the pixels)** | **960x540** | **7.72** | 96 |
| renderScale 1.0 (restore) | 1920x1080 | 7.49 | 100 |
| bloom off | 1920x1080 | ~-0.5 vs base | -- |
| shadow map 4096 -> 2048 | -- | ~-0.2 (noise) | -- |

Rendering at a QUARTER of the pixels (960x540) left submit essentially unchanged
(7.77 -> 7.72ms). The scene is therefore **not fragment/fill-bound** on the RTX 3060
Ti at 1080p: the ~7.7ms submit is CPU-side draw-call submission + driver + vertex
work, none of which scales with resolution. N8AO is already half-res on high
(~1ms-class). Bloom is ~0.5ms; shadow-map size is ~noise.

Consequence: render-scale and post-quality reductions yield ~nothing on a discrete
desktop GPU here. They DO pay off on fill-bound hardware (integrated / mobile GPUs,
or very high resolutions), but that is exactly what the existing tier system
(`gfx.ts`) and the adaptive `RenderBudgetGovernor` already manage. Shipping a fixed
desktop reduction would be an unverifiable change for hardware not under test.

## Bottom line

- The renderer is already efficient on discrete desktop GPUs: ~94-117 fps solo, and
  ~60 fps under a 50-player crowd with #1013 active.
- The one real, measured lever (cut the per-crowd character DRAW + shadow load) is
  shipped as #1013.
- The fixed submit cost is draw-call / driver overhead, not pixel fill, so it is not
  reducible by resolution or post quality on this hardware. Reducing draw calls
  further (skinned-mesh instancing, or a nearest-N articulated cap for tight
  clusters #1013's distance LOD does not help) is the only remaining render lever,
  and is a large, separate effort with its own visual trade-offs.
- The live, non-duplicate perf work is the server/network side (PR #1017: WS
  join-path parallelization + the per-IP crowd-test ceiling fix), which also unblocks
  reliable 50+ -player crowd FPS measurement.
