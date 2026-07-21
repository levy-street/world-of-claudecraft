// Acceptance-gate constants for the API request pipeline's realtime-neutrality
// budget. The gate that reads these lives in tests/server/perf_gate.test.ts.
//
// Two independent ceilings, both grounded in the sim's fixed tick so a change to
// the tick rate (or to a ratio here) fails the gate loudly rather than silently
// loosening a budget:
//
//   - TICK_P95_CEILING_MS: the authoritative world loop's per-tick p95 must stay at
//     or under this. Derived as TICK_P95_CEILING_RATIO of the whole per-tick budget
//     (DT_MS), so a tick that sits inside 80% of its 50 ms slot leaves headroom for
//     snapshot broadcast, event routing, and the async I/O (this pipeline included)
//     the same single event-loop thread services.
//   - PIPELINE_ADDED_P99_BUDGET_MS: the in-house /api onion may add at most this many
//     milliseconds at p99 to a request versus the bare legacy ladder. The pipeline
//     shares that ONE event-loop thread with the 20 Hz loop, so per-request overhead
//     is time stolen from the next tick; this caps it.
//
// Units are milliseconds throughout (matching TickProfiler, which the server feeds
// millisecond durations).

import { TICK_RATE } from '../../src/sim/types';

/**
 * The whole per-tick wall-clock budget in milliseconds, DERIVED from the sim's
 * TICK_RATE (never re-typed as the literal 50): a 20 Hz tick gives a 50 ms slot.
 * The gate asserts DT_MS === 50 so a TICK_RATE change is caught right here.
 */
export const DT_MS = 1000 / TICK_RATE;

/**
 * The fraction of the per-tick slot the world loop's p95 must stay within. 0.8
 * leaves 20% of every 50 ms tick for the broadcast, event routing, and async I/O
 * the same event loop also runs each tick.
 */
export const TICK_P95_CEILING_RATIO = 0.8;

/**
 * The per-tick p95 ceiling in milliseconds, DERIVED (ratio x slot): 0.8 x 50 = 40.
 * The gate pins this at 40 alongside the derivation so neither the ratio nor the
 * tick rate can drift the ceiling silently.
 */
export const TICK_P95_CEILING_MS = TICK_P95_CEILING_RATIO * DT_MS;

/**
 * The p99 wall-clock overhead the /api onion may add per request over the bare
 * legacy ladder, in milliseconds. Tune UP only with a measured justification: the
 * env-gated wall-clock arm records the real added p99 on the running machine, and a
 * local 3-run baseline sat well under 1.0 ms (see the perf_gate test-file header).
 */
export const PIPELINE_ADDED_P99_BUDGET_MS = 1.0;
