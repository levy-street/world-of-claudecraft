# MMO Engine Performance Program

Base: `release/v0.32.0`

Branch: `agent/mmo-engine-v1`

## Goal

Build an MMO-focused runtime around the existing deterministic simulation and Three.js
renderer without changing gameplay authority or the one-sim contract. The work must improve
crowd rendering, entry hitches, snapshot bandwidth, main-thread decode cost, and overloaded
server behavior while keeping WebGL2 and the JSON protocol as rollback paths.

## Verified baseline and result

The clean release and optimized branch were captured back-to-back on the same Windows
machine. The release single-player tour recorded 70.19 FPS, 21 ms frame p95, 655 steady
draw calls, 3,235,214 steady triangles, 61 active views, and 11.7 ms input latency. The
optimized tour recorded 72.41 FPS, the same 21 ms p95, 657 steady draw calls, 3,242,557
steady triangles, 61 active views, and 8.7 ms input latency.

The synthetic 80-player real-GPU crowd comparison recorded:

| Metric | Clean release | Optimized | Change |
|---|---:|---:|---:|
| FPS | 41.61 | 48.90 | +17.52% |
| Draw calls | 1,278 | 1,072 | -16.12% |
| Triangles | 4,683,014 | 4,311,878 | -7.93% |

The deterministic 100-player snapshot fixture recorded 12,718 JSON bytes and 5,882
binary bytes, a 53.75% reduction. Binary encode and decode use more CPU than JSON in the
microbenchmark; the benefit is lower network bandwidth plus decode work moved off the
browser main thread.

Docker and PostgreSQL are not installed on the validation machine. Unit, browser, and
DB-free gates ran locally. The database-backed 100- and 200-client soaks remain required
when a PostgreSQL service is available.

## Invariants

- `src/sim/` stays deterministic and browser-free.
- The server remains authoritative.
- Render and UI read only through `IWorld`.
- Performance shedding never hides actionable information.
- Existing JSON snapshots and WebGL2 remain supported rollback paths.
- No unbounded catch-up loop, pool, worker queue, or decoded payload.
- New logic lands in small modules with paired tests.

## Architecture decisions

### Rendering

Use a typed `RenderWorld` as a hot-path presentation cache rather than replacing
`IWorld`. It owns stable dense slots, typed transforms and flags, and preallocated
candidate buffers. The renderer remains the scene owner.

Batch only nonactionable remote-player far proxies. Self, target, party or raid members,
hostile players, casters, combatants, and telegraph-bearing entities retain articulated
rigs and DOM nameplates.

Keep actionable nameplates in the existing accessible DOM path. Cap ordinary friendly
plates deterministically and use a GPU atlas only for cosmetic overflow after the cap is
proven.

### Replication

Negotiate binary snapshots independently from the world-layout epoch. Auth, commands,
events, social frames, and errors stay JSON. Old clients and unknown versions receive
byte-identical JSON snapshots.

The binary frame uses a fixed entity core plus bounded generic extensions and self data.
The browser decodes snapshots in an ordered worker pipeline. Worker failure reconnects
once without the binary capability.

### Authoritative runtime

Assign logical overworld zone and portal-instance route keys without splitting the
current global simulation. The simulation has one global RNG and cross-zone systems, so
moving it across process boundaries before the transfer envelope is complete would
change behavior.

The runtime gateway, sticky route epochs, inline host, and handoff state machine provide
the safe partitioning boundary. The inline host remains byte-identical. The worker host
is a lifecycle and transport contract; it does not claim that the live global `Sim` is
already distributed.

### WebGPU

WebGL2 remains the complete default backend. Add a backend contract and an explicit
experimental WebGPU forward profile. If WebGPU is unavailable or the scene requests an
unsupported feature, selection falls back to WebGL2 before scene construction.

## Phase 1: Pending performance packets

Outcome:

- Hard articulated-rig ceiling with actionable exemptions.
- Finite character visual residency.
- Live view creation limited by count and elapsed milliseconds.
- One compile batch per frame.
- Friendly nameplate cap.
- Four-tick server catch-up ceiling with dropped-debt telemetry.

Primary seams:

- `src/render/crowd_lod.ts`
- `src/render/render_budget.ts`
- `src/render/view_create_budget_core.ts`
- `src/render/compile_batch.ts`
- `src/render/characters/visual_pool.ts`
- `src/render/nameplate_budget_core.ts`
- `server/tick_debt.ts`

Exit criteria:

- Ordinary scenes retain current fidelity.
- Actionable entities are never frozen, batched, or capped.
- A two-second stall runs no more than four simulation ticks in one callback.
- Targeted render and server tests pass.

## Phase 2: Typed RenderWorld and GPU crowd path

Outcome:

- Stable typed slots for renderable entities.
- Aura and actionability classification runs once per world revision.
- Nonactionable remote far players render through instanced batches.
- Full rigs remain pooled for bounded promotion back to near range.
- Render diagnostics report articulated, batched, and capped counts.

Primary seams:

- `src/render/runtime/`
- `src/render/characters/crowd_batch.ts`
- `src/render/renderer.ts` as a thin consumer

Exit criteria:

- Slot reuse and stale generations are test-pinned.
- Far crowd groups render in a bounded number of draw calls.
- Selection, hostile telegraphs, party state, and cast bars remain unchanged.
- The crowd browser benchmark improves draw calls and frame p95.

## Phase 3: Versioned binary snapshots

Outcome:

- Exact capability negotiation and server kill switch.
- Compact binary entity records with bounded extensions.
- Ordered worker decode with generation-safe reconnect behavior.
- JSON fallback remains byte-identical.
- Transport, decode, queue, and apply metrics are visible.

Primary seams:

- `server/snapshot_binary.ts`
- `server/snapshot_transport.ts`
- `src/net/snapshot_binary.ts`
- `src/net/snapshot_decode_worker.ts`
- `src/net/snapshot_transport.ts`
- `src/net/online.ts` and `server/game.ts` as thin integrations

Exit criteria:

- Binary decode deep-equals the JSON snapshot.
- Malformed or oversized frames fail closed.
- Worker results cannot overtake later frames.
- Steady crowd bytes materially improve over the 127.8 KB/s fixture.

## Phase 4: Runtime gateway and instance partitioning

Outcome:

- Narrow authority runtime contract.
- Sticky routes with monotonically increasing epochs.
- Byte-identical inline host remains default.
- Prepare, commit, and abort handoff state machine.
- Experimental instance worker lifecycle behind `MMO_RUNTIME_MODE`.

Primary seams:

- `server/runtime/`
- `server/ws_auth.ts`
- `server/main.ts`

Exit criteria:

- Inline output matches direct `GameServer` output.
- Stale worker output is rejected.
- A failed handoff leaves exactly one authoritative source.
- Invalid runtime modes fail closed.
- Overworld authority remains inline.

## Phase 5: Optional WebGPU backend

Outcome:

- Backend selection is pure and testable.
- Current WebGL2 behavior is wrapped without output changes.
- WebGPU is dynamically loaded only when explicitly requested.
- Unsupported or unavailable WebGPU falls back before scene construction.
- Diagnostics and benchmarks name the selected backend.

Primary seams:

- `src/render/backend/`
- renderer construction and prewarm boundaries

Exit criteria:

- WebGL2 screenshots and performance gates remain valid.
- WebGPU selection and fallback pass browser smoke tests.
- The experimental profile never silently drops actionable visuals.

## Final verification result

During iteration:

- Targeted Vitest files.
- `npm run ci:changed`.
- `npx tsc --noEmit`.
- `npm run build`.

Before publication, 29 focused files and all 454 tests pass, type checks pass, the
production build passes, and the browser tour, 80-player crowd comparison, and binary
microbenchmark are recorded. The full repository gate records 21,187 passes, 124 skips,
and 195 failures. Representative HTTP golden, bank source-shape, version-sync fixture,
and Windows symlink failures reproduce on the clean release base.

The DB-backed load soak remains required when PostgreSQL is available. The final pull
request is draft-only and targets the verified latest numbered release,
`release/v0.32.0`.
