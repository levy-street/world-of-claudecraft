# MMO Engine Progress

| Phase | Status | Evidence |
|---|---|---|
| Release setup | Complete | Built from `release/v0.32.0` at `31099f09712220e28080f60477ffc843ed10aaf2`; remote rechecked before publication |
| Baseline | Complete | Clean release browser and 80-player crowd captures recorded on the same machine |
| Performance packets | Complete | Bounded tick debt, view deadlines, targeted compile batches, rig caps, finite visual residency, and deterministic nameplate admission |
| Typed RenderWorld and GPU crowd | Complete | Stable typed slots, spatial admission, actionable exemptions, and instanced far-player batches |
| Binary snapshots | Complete | Exact v1 negotiation, strict bounded codec, ordered worker decode, server kill switch, and JSON fallback |
| Runtime partitioning | Complete | Zone and instance route keys, sticky epochs, atomic handoff, stale-output rejection, inline host, and worker-host contract |
| WebGPU backend | Complete | Explicit optional backend with dynamic loading and compatibility fallback to the unchanged WebGL2 path |
| Focused QA | Complete | 29 files and 454 tests passed; typecheck and production build passed |
| Full repository QA | Complete with baseline exceptions | Full gate: 21,187 passed, 124 skipped, and 195 failed; representative failures reproduce on the clean release base |
| Performance validation | Complete | 80-player FPS +17.52%, draw calls -16.12%, triangles -7.93%; single-player FPS +3.16% |
| Local handoff | Complete | Optimized Vite client available at `http://127.0.0.1:5173/` |
| Draft pull request | Ready | Target verified as `release/v0.32.0`; publish as draft only |

## Measured benefits

All browser comparisons below are clean-release versus optimized captures on the same Windows machine and browser configuration.

| Delivery | Scenario | Baseline | Optimized | Measured benefit |
|---|---|---:|---:|---:|
| RenderWorld, budgets, and tick debt | Single-player browser tour | 70.19 FPS | 72.41 FPS | +3.16% FPS |
| RenderWorld, budgets, and tick debt | Input latency | 11.7 ms | 8.7 ms | -25.64% |
| GPU crowd and bounded nameplates | Synthetic 80-player real-GPU crowd | 41.61 FPS | 48.90 FPS | +17.52% FPS |
| GPU crowd and bounded nameplates | Draw calls | 1,278 | 1,072 | -16.12% |
| GPU crowd and bounded nameplates | Triangles | 4,683,014 | 4,311,878 | -7.93% |
| GPU crowd and bounded nameplates | Ordinary nameplate work at 100 candidates | 100 | 36 | -64.00% |
| Versioned binary replication | 100-player snapshot bytes | 12,718 bytes | 5,882 bytes | -53.75% |
| Runtime zones and instances | Correctness and scale-isolation foundation | n/a | n/a | No standalone throughput claim |
| Optional WebGPU backend | Current compatibility scene | WebGL2 | WebGL2 fallback | 0% live gain claimed |

The overall measured performance result is **+17.52% FPS** in the 80-player crowd scenario. Percentages are scenario-specific and are not added together.

The binary codec trades some worker CPU for bandwidth and main-thread isolation: in the deterministic microbenchmark, binary encode and decode are slower than JSON, while the payload is 53.75% smaller and browser decode runs off the main thread.

## Validation limits

- Docker, PostgreSQL, and `psql` were unavailable, so the database-backed 100- and 200-client soak remains a deployment-environment gate.
- The current global deterministic simulation remains in the inline host. The coordinator supplies logical zone and instance routing, epochs, handoff safety, and a worker-host contract without claiming that the live `Sim` is already distributed across processes.
- The current scene uses postprocessing, PMREM, and shader customization that are not yet compatible with the experimental forward WebGPU profile. A WebGPU request therefore falls back safely to WebGL2 instead of silently dropping features.
