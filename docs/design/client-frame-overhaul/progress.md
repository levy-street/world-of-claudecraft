# Client frame-cost overhaul: program progress

Program source of truth: [plan.md](./plan.md). Cadence: one PR per numbered step, each
from its own worktree off the latest release branch, gated by `node scripts/gate_select.mjs`
and `/qa` before it is called done.

| Step | Scope | Track | Depends on | Status |
|---|---|---|---|---|
| 0 | Measure: frame attribution, scene-graph census, trace capture and analyzer, desktop and phone captures, decision gate | first | none | PENDING |
| 1A0 | `RenderWorld` / `RenderEntity` type narrowing across `src/render` | A | 0 | PENDING |
| 1A1 | Columnar entity table pilot (shadow mode, parity and cost) | A | 1A0 | PENDING |
| 1D | Feed record and replay bench, synthetic town fixture | A | 1A1 | PENDING |
| 1A2 | Facet codecs, event sequence, module-state inventory | A | 1A1 | PENDING |
| 1B | RenderPort, camera mirror, pick mirror, audio and haptic queue, contact answers | A | 1A2 | PENDING |
| 1C | RenderEnv and the canvas factory | A | none | PENDING |
| 2A | Batched far bodies | B | 0 | PENDING |
| 2B | GPU-animated crowd tier (runtime-baked bone-matrix textures) | B | 0 (1D for measurement) | PENDING |
| 2C | Static world node and walk reduction | B | 0 | PENDING |
| 2D | GPU nameplates and chat bubbles | A | 1A2, 1B | PENDING |
| 2E | Frame-system registry | B | 0 | PENDING |
| 2F | Version-gated view diffs | A | 1A1 | PENDING |
| 3 | Renderer in a worker via OffscreenCanvas (spike first) | A | Phase 1, 2D | PENDING |
| 4A | Governor retarget and Low runtime resolution | B | 0 | PENDING |
| 4B | Deterministic CI frame budgets from feed replay | A | 1D | PENDING |
| 4C | Release-tier real-GPU budget run and the frame-budget rule | close-out | 4B | PENDING |
