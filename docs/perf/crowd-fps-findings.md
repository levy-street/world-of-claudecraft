# Crowd FPS: where the frame goes, and the crowd-adaptive character budget

Profiled a 50-player crowd on a discrete GPU (RTX 3060 Ti, high tier, 1920x1080,
vsync off) with `scripts/profile.mjs` and the renderer's own per-phase timing
(`renderer.perfStats().phaseMs`).

## Finding: crowd cost is GPU-bound on the submit phase, not CPU

Per-phase average frame time (ms), solo vs a 50-player crowd in view:

| phase | solo (4 rigs) | crowd (90 rigs) | delta |
|---|---|---|---|
| entities (character CPU: anim/skinning) | 0.56 | 1.93 | +1.37 |
| world (terrain/foliage/props) | 0.39 | 0.38 | ~0 |
| nameplates | 0.11 | 0.26 | +0.15 |
| **submit (GPU rasterize + post + shadow)** | **7.86** | **14.22** | **+6.36** |
| total | 8.96 | 16.82 | +7.86 |

So 80%+ of the crowd's added frame time is the **submit** phase: rasterizing ~50
extra skinned character rigs (~6 draws each) into the main pass and re-rendering the
close ones into the 4096 sun shadow map every frame. The CPU character work
(animation/skinning) is small (~2ms), so throttling animation harder is NOT the
lever on this class of hardware; cutting the GPU rig+shadow load is.

## Optimization: crowd-adaptive shadow + LOD ranges (`src/render/crowd_lod.ts`)

The renderer already collapses a distant rig to a single-draw far-LOD mesh (beyond
58u) and hands its ground shadow to a cheap static proxy (beyond 25u). This change
makes those two ranges **crowd-adaptive**: as the count of visible articulated rigs
climbs past a soft knee (16) toward a hard knee (48), the articulated-shadow and
articulated-LOD ranges shrink toward a floor (~16u shadow, ~42u rig at the hard
knee). A dense crowd therefore collapses its distant bodies to far LOD and proxy
shadow sooner. Below the soft knee nothing changes, so ordinary grouping (a 5-man,
a few passers-by) is never touched. The visible-rig count is read one frame late to
avoid a second pass and any feedback loop.

The knee math is a pure, unit-tested function (`crowdLodSqScale`,
`tests/crowd_lod.test.ts`); the renderer is a thin consumer.

### Gameplay-neutral (docs/design/graphics-settings-fairness.md)

It sheds only COSMETIC richness: animation smoothness and distant per-rig shadow
crispness. It never hides or delays actionable information. Position, the nameplate
(name/HP/debuffs/raid marks), the target unit frame and the cast bar are HUD/sim
state rendered independently of the rig LOD and are untouched. The LOD floor (~42u)
is ~2x melee range and past the 30u nameplate-detail band, so a rig you are
actually fighting or grouped with never collapses; only distant crowd bodies do.
This is the same kind of shedding the existing fixed 58u far-LOD already does, just
scaled by crowd density.

## Measured win (A/B at a fixed 50-player crowd, drift-canceled)

Toggling `renderer.crowdAdaptiveLod` ON vs OFF at the same 50-player crowd spread
across ~70u (a realistic hub spread, not an artificial tight cluster), four
order-alternated paired rounds to cancel GPU warm/cool drift:

- mean FPS: ~62.7 -> ~71.4, **+8.7 fps (+13.9%)**, positive in all four rounds.
- submit phase: **-0.95 ms** mean, lower in all four rounds.
- 1% low: +3.4 fps (smoother under load).

The win scales with how spread the crowd is (a tightly-clustered crowd where every
body is inside the LOD floor sees little, since none collapse; a realistic
town/hub/raid spread sees the full benefit). The toggle defaults ON.
