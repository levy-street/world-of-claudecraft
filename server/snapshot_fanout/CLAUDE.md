# server/snapshot_fanout/

The multi-core snapshot pipeline: the per-session interest scan and ents/keep
assembly of the 20 Hz broadcast run on worker_threads, while the sim, the self
JSON, and every socket write stay on the main thread. At 250+ co-located
players the scan+assembly was ~43% of main-thread CPU; with the fanout the
main thread keeps only O(sessions) work per tick.

## Files
| File | Role |
|---|---|
| `interest_rules.ts` | The interest radii, hysteresis, rate tiers, and record ladder as pure functions. THE single source of truth: the in-thread path in `server/game.ts` and `worker_main.ts` both call these, so the paths cannot drift. |
| `protocol.ts` | SharedArrayBuffer mirror layout (numeric per-entity facts) + message contracts (fragment deltas, session jobs, frame replies). |
| `pool.ts` | Main-thread orchestrator: worker lifecycle (spawn/watchdog/respawn/disable), per-worker fragment ledgers, sharding, dispatch. |
| `worker_main.ts` | Worker entry (own esbuild bundle, `dist-server/snapshot_worker.cjs`): rebuilds a slot grid from the mirror each tick, runs the shared ladder per session, returns joined `ents`/`keep` strings. |

## Invariants
- **Both build paths must stay byte-compatible in CONTENT.** Record ORDER
  inside one snapshot may differ (the client applies ents into a per-id map),
  so the equivalence gate compares canonically:
  `tests/server/snapshot_fanout_equivalence.test.ts` (real workers vs
  in-thread over the golden combat scenario, plus a non-vacuity check that
  frames actually crossed workers). The in-thread path itself is pinned
  byte-exact by `tests/server/broadcast_golden.test.ts`.
- **Never fork the ladder.** Any change to interest radii, tiers, or the
  full/lite/keep decision goes in `interest_rules.ts`, nowhere else.
- **Workers never see a live Entity or the Sim.** Numeric facts ride the
  mirror; strings (wire fragments built by the one serializer,
  `wireCacheFor`) ship as per-worker deltas computed against each worker's
  own ledger at dispatch, so a busy/respawned worker always catches up before
  building. Stealth visibility needs live social state, so it resolves on the
  main thread and ships as per-session denied ids.
- **The mirror is double-buffered with ownership, never torn.** A dispatched
  tick pins its buffer (`pendingBuffer`) until the worker replies; the main
  thread writes only a buffer `acquireMirror()` reports free, and skips the
  fanout tick entirely when every buffer is pinned by slow workers. A worker
  running past a tick boundary therefore always reads the complete,
  unchanged buffer its job named; no atomics needed beyond the postMessage
  happens-before edge.
- **Frame pairing:** self JSON + head are captured at dispatch and paired
  with the worker reply of the SAME tick (`pendingFanoutFrames`); a mismatch
  drops the frame rather than mixing sim states.
- **Degradation order:** busy shard => skip the tick (clients coast on
  interpolation; per-session cadence degrades to worker throughput); dead
  shard => build in-thread; repeated failures => pool disables itself for the
  process and the in-thread path carries everything. Mixing paths per session
  is safe: both only emit current state and only skip when the client's known
  versions already match it.
- **Sizing:** `SNAPSHOT_WORKERS=auto|0|N` (main.ts): auto = `min(6, cores-2)`,
  so a 2-vCPU box disables the pool rather than starving the sim. Bare
  `new GameServer()` (tests) never spawns threads.

## When you touch the wire format
Adding a field to `identityFields`/`dynamicFields` needs NOTHING here (the
fragments are opaque strings). Adding a NEW per-entity fact the interest
logic reads (a new visibility rule, a new always-full-rate condition) needs:
the mirror layout (`protocol.ts`), the mirror write (`broadcastViaFanout` in
game.ts), the worker read (`worker_main.ts`), and the shared rule
(`interest_rules.ts`), in one change, with the equivalence test extended to
exercise it.
