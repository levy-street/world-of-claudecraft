// THE API-pipeline realtime-neutrality acceptance gate. The non-goal it must protect is
// "no realtime regression": the in-house /api onion runs on the SAME single event-loop
// thread as the authoritative 20 Hz world loop, so any per-request overhead it adds is
// time stolen from the next sim tick. This file gates that, split by host the same
// way tests/hud_perf_budget.test.ts splits its client budget: deterministic arms
// that run in every `npm test`, and a wall-clock arm env-gated off by default.
//
//   ARM A - TICK-CEILING MATH (always on, deterministic). Drives a real
//     TickProfiler (server/tick_profiler.ts, the exact instrument the world loop
//     feeds and game.perfProfile() exposes) with SYNTHETIC per-tick durations and
//     asserts the p95 math against TICK_P95_CEILING_MS. It pins the constant
//     relationships (DT_MS === 50, TICK_P95_CEILING_MS === 40, ceiling === ratio x
//     DT_MS, DT_MS === 1000 / TICK_RATE) so a sim tick-rate change or a ratio edit
//     fails LOUDLY at the constant, and it drives both a healthy and a breaching
//     synthetic sample so the ceiling assertion is proven non-vacuous (it has
//     teeth). It also pins the game-side seam: a compile-time assertion that
//     game.perfProfile()'s per-phase stats still expose a numeric p95, and a
//     runtime assertion that TickProfiler.profile() does, so the seam cannot drift.
//
//   ARM B - PIPELINE BOUNDED-WORK (always on, deterministic). Builds the REAL
//     createApiDispatcher over the REAL createApiRegistry and drives N identical
//     requests through BOTH the onion-fronted path and the bare 'legacy' entry,
//     gating on DETERMINISTIC derived work counts (never raw ms) read from
//     injectable seams: a counting MetricSink (sink events emitted), a counting
//     route-middleware, and a counting handler. It asserts the onion's per-request
//     work is EXACTLY {1 sink observation, 1 middleware run, 1 handler call} and
//     that this is:
//       (1) CONSTANT across request index (doubling the request count exactly
//           doubles each counter, so no per-request accumulation / global scan whose
//           cost grows with prior requests),
//       (2) REGISTRY-SIZE INDEPENDENT AT THE SEAMS (a 1-route registry and a
//           200-route registry produce identical per-request COUNTED work for a
//           static match; note a matcher scan INTERNAL to one dispatch still
//           counts 1 at every seam, so this pin alone does not prove O(1) matching,
//           see the honest-scope paragraph below),
//       (3) BOUNDED-CARDINALITY (the sink label is the :param TEMPLATE, so distinct
//           concrete paths collapse to one series and cannot blow up the sink), and
//       (4) INERT when off (the 'legacy' entry emits ZERO onion work: sink count 0,
//           handler never called, so the flag-off rollback default adds nothing).
//     Why this proxy protects the non-goal, and its honest scope: the counted
//     seams deterministically catch per-request work that grows with prior
//     requests (accumulation / a scan over request history), extra seam
//     invocations, the flag-off path doing onion work, and unbounded sink
//     cardinality growing memory. They CANNOT see CPU cost internal to a single
//     seam call: an O(routes) matcher scan inside one dispatch still counts 1 at
//     every seam, so that class, plus the constant-FACTOR ms overhead, belongs to
//     the wall-clock arm (ARM C) and the perf:load soak. Run ARM C before the
//     ladder deletion and on release cadence; it is not part of `npm test`.
//
//   ARM C - WALL-CLOCK (env PERF_GATE_WALLCLOCK=1, SKIPPED by default). The real p99
//     comparison: warm up, then run >= 2000 iterations through the onion path and the
//     bare legacy path with process.hrtime.bigint(), and assert
//     p99(onion) - p99(bare) < PIPELINE_ADDED_P99_BUDGET_MS. The bare floor is a
//     SYNCHRONOUS handler, so the measured added-p99 is a conservative UPPER bound on
//     the onion's true overhead versus an equivalently-async legacy handler (it also
//     charges the sync->async transition). A second env-gated arm drives a real Sim
//     tick loop while bursting pipeline requests between ticks and asserts the
//     measured tick p95 stays <= TICK_P95_CEILING_MS. NOTE: a single JS thread cannot
//     inflate one synchronous tick's OWN duration by running HTTP work (they never
//     overlap), so this arm measures tick self-cost + between-tick servicing, NOT the
//     production event-loop GAP jitter a slow handler causes by delaying the next
//     tick. That true under-load gap jitter stays the job of the live soak
//     scripts/server_load_jitter.mjs (npm run perf:load), which this gate does not
//     replace.
//
// RUN THE WALL-CLOCK ARM MANUALLY:
//   PERF_GATE_WALLCLOCK=1 npx vitest run tests/server/perf_gate.test.ts
// It never runs in CI / a bare `npm test`; scripts/server_load_jitter.mjs remains
// the live multi-client soak.

import type * as http from 'node:http';
import { describe, expect, it } from 'vitest';
import type { GameServer } from '../../server/game';
import {
  type ApiDelegate,
  type ApiDispatcher,
  createApiDispatcher,
  selectApiEntry,
} from '../../server/http/dispatch';
import {
  type MetricEvent,
  type MetricSink,
  noopMetricSink,
} from '../../server/http/middleware/metric_sink';
import {
  DT_MS,
  PIPELINE_ADDED_P99_BUDGET_MS,
  TICK_P95_CEILING_MS,
  TICK_P95_CEILING_RATIO,
} from '../../server/http/perf_gate';
import { createApiRegistry } from '../../server/http/registry';
import type { Middleware, RouteDef } from '../../server/http/types';
import { TickProfiler } from '../../server/tick_profiler';
import { TICK_RATE } from '../../src/sim/types';
import { FakeRes, makeReq } from './helpers';

// --------------------------------------------------------------------------
// ARM A - tick-ceiling math (Node, deterministic, every npm test).
// --------------------------------------------------------------------------

// Compile-time seam pin: game.perfProfile() spreads TickProfiler.profile(), so its
// per-phase stats MUST expose a numeric p95. If the game seam ever dropped p95 (or
// the profiler shape drifted), this type stops resolving to `number` and the
// assignment below fails tsc, catching the drift the runtime arm only sees for the
// profiler in isolation. `import type` is erased at build, so this pulls no world.
type GamePhaseP95 = ReturnType<GameServer['perfProfile']>['phases'][string]['p95'];
const _gamePerfExposesNumericP95: GamePhaseP95 = 0;
void _gamePerfExposesNumericP95;

// Feed one synthetic per-tick loop-body duration (ms) as the tick 'total'. `commit`
// records `total` = the passed totalMs; we drive a window of these and read p95.
function profileOfDurations(durationsMs: readonly number[]): ReturnType<TickProfiler['profile']> {
  const profiler = new TickProfiler(['tick'], Math.max(1, durationsMs.length));
  for (const ms of durationsMs) {
    profiler.add('tick', ms);
    profiler.commit(ms);
  }
  return profiler.profile();
}

describe('perf_gate ARM A: tick p95 ceiling is grounded in the sim tick (npm test)', () => {
  it('derives DT_MS and the ceiling from TICK_RATE, pinning the exact values so a tick-rate change fails loudly', () => {
    // The whole slot and the ceiling are DERIVED, never re-typed. These literal pins
    // are the tripwire: change TICK_RATE (or the ratio) and one of these fails,
    // forcing a human to re-evaluate the budget rather than silently shifting it.
    expect(DT_MS).toBe(1000 / TICK_RATE);
    expect(DT_MS).toBe(50);
    expect(TICK_P95_CEILING_RATIO).toBe(0.8);
    expect(TICK_P95_CEILING_MS).toBe(TICK_P95_CEILING_RATIO * DT_MS);
    expect(TICK_P95_CEILING_MS).toBe(40);
  });

  it('a healthy tick window (every tick well inside the slot) reports p95 at or under the ceiling', () => {
    // 100 ticks all at 20 ms: p95 = 20 <= 40. The PASS case.
    const prof = profileOfDurations(Array.from({ length: 100 }, () => 20));
    expect(prof.phases.total.p95).toBeLessThanOrEqual(TICK_P95_CEILING_MS);
    expect(prof.phases.total.p95).toBe(20);
  });

  it('a breaching tick window trips the ceiling, proving the assertion is non-vacuous', () => {
    // 90 ticks at 20 ms then 10 at 50 ms: sorted, the p95 sample (index 95 of 100)
    // is 50 ms, which is ABOVE the 40 ms ceiling. This is the shape the gate must
    // reject, so we assert the ceiling comparison actually detects it (teeth).
    const durations = [
      ...Array.from({ length: 90 }, () => 20),
      ...Array.from({ length: 10 }, () => 50),
    ];
    const prof = profileOfDurations(durations);
    expect(prof.phases.total.p95).toBe(50);
    expect(prof.phases.total.p95).toBeGreaterThan(TICK_P95_CEILING_MS);
  });

  it('pins the profile() seam shape at runtime: every phase carries a numeric p95', () => {
    // The runtime companion to the compile-time game-seam pin above. game.perfProfile()
    // spreads exactly this object, so a numeric p95 here is the numeric p95 there.
    const prof = profileOfDurations([10, 20, 30]);
    for (const name of ['tick', 'total'] as const) {
      expect(typeof prof.phases[name].p95).toBe('number');
    }
    expect(prof.phases.total.p95).toBeGreaterThanOrEqual(0);
  });
});

// --------------------------------------------------------------------------
// ARM B - pipeline bounded-work (Node, deterministic, every npm test).
// --------------------------------------------------------------------------

const PROBE_STATIC = '/api/perf-probe';
const PROBE_DYNAMIC = '/api/perf-probe/:id';

/** A trivial GET route whose middleware + handler increment injected counters. */
function probeRoute(path: string, onMiddleware?: () => void, onHandler?: () => void): RouteDef {
  const middleware: Middleware[] | undefined = onMiddleware
    ? [
        async (_ctx, next) => {
          onMiddleware();
          await next();
        },
      ]
    : undefined;
  return {
    method: 'GET',
    path,
    surface: 'api',
    middleware,
    handler: async (ctx) => {
      onHandler?.();
      ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
      ctx.res.end('{"ok":true}');
    },
  };
}

/** A MetricSink that records every event for counting. */
function countingSink(): { sink: MetricSink; events: MetricEvent[] } {
  const events: MetricEvent[] = [];
  return { sink: { record: (e) => events.push(e) }, events };
}

/**
 * Drive the fire-and-forget dispatcher to completion by draining the MICROTASK
 * queue (not setImmediate): the onion handler ends the response on a later
 * microtask, so spinning `await Promise.resolve()` completes it without injecting
 * macrotask scheduler latency (which matters for the wall-clock arm). A sync bare
 * handler is already ended, so this returns after zero spins. This settles up to
 * res.end; it does NOT wait for the onion UNWIND (withMetrics records the sink event
 * in a finally AFTER res.end), which is why the counting arm uses fullDrain instead.
 */
async function settle(res: FakeRes): Promise<void> {
  let spins = 0;
  while (!res.writableEnded) {
    await Promise.resolve();
    if (++spins > 10_000) throw new Error('request never completed');
  }
}

/**
 * A full macrotask boundary: one setImmediate fires only after the entire microtask
 * queue has drained, so after `await fullDrain()` the onion has completed all the
 * way through its unwind (including withMetrics' finally sink record). The counting
 * arm needs this: settle would return mid-unwind, before the metric is recorded, and
 * undercount the last few requests' sink events. The probe routes do no macrotask
 * I/O, so one boundary is sufficient.
 */
function fullDrain(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Fire `n` identical GET requests through an entry, fully draining each (through the
 * onion unwind) before the next, so injected work counters (sink/middleware/handler)
 * are complete when the caller asserts.
 */
async function driveN(entry: ApiDispatcher, url: string, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    const res = new FakeRes();
    entry(makeReq({ method: 'GET', url }), res as unknown as http.ServerResponse);
    await fullDrain();
  }
}

describe('perf_gate ARM B: the onion does bounded, constant work per request (npm test)', () => {
  it('does exactly one sink observation + one middleware run + one handler call per request, and stays constant as requests accumulate', async () => {
    let middlewareCalls = 0;
    let handlerCalls = 0;
    let delegateCalls = 0;
    const { sink, events } = countingSink();
    const registry = createApiRegistry([
      probeRoute(
        PROBE_STATIC,
        () => {
          middlewareCalls++;
        },
        () => {
          handlerCalls++;
        },
      ),
    ]);
    const dispatcher = createApiDispatcher({
      registry,
      delegate: () => {
        delegateCalls++;
      },
      metricSink: sink,
    });

    const N = 500;
    await driveN(dispatcher, PROBE_STATIC, N);
    // Per-request work is EXACTLY one of each: no matched path ever fell through to
    // the legacy delegate, and the onion emitted one observation per request.
    expect(events.length).toBe(N);
    expect(middlewareCalls).toBe(N);
    expect(handlerCalls).toBe(N);
    expect(delegateCalls).toBe(0);

    // Doubling the request count exactly doubles each counter: per-request cost does
    // not grow with the number of prior requests (no accumulation, no global scan
    // over request history). If work were super-linear, these would overshoot 2N.
    await driveN(dispatcher, PROBE_STATIC, N);
    expect(events.length).toBe(2 * N);
    expect(middlewareCalls).toBe(2 * N);
    expect(handlerCalls).toBe(2 * N);
    expect(delegateCalls).toBe(0);
  });

  it('per-request work is independent of the registry size (added registry entries change nothing observable at the seams)', async () => {
    // Build a big registry: 200 padding routes plus the same probe. A static match
    // hits the router's exact-map, so per-request observable work must be identical
    // to the 1-route case. If matching became a per-request scan, this would still
    // count 1 each here, but the wall-clock arm would show it; the deterministic
    // guarantee we can pin is that added registry entries change NOTHING observable.
    const pad: RouteDef[] = Array.from({ length: 200 }, (_v, i) =>
      probeRoute(`/api/perf-probe-pad-${String(i).padStart(3, '0')}`),
    );
    let handlerCalls = 0;
    const { sink, events } = countingSink();
    const registry = createApiRegistry([
      ...pad,
      probeRoute(PROBE_STATIC, undefined, () => {
        handlerCalls++;
      }),
    ]);
    const dispatcher = createApiDispatcher({ registry, delegate: () => {}, metricSink: sink });

    const N = 200;
    await driveN(dispatcher, PROBE_STATIC, N);
    expect(events.length).toBe(N);
    expect(handlerCalls).toBe(N);
    // Every event landed on the one probe route, none on the 200 padding routes.
    expect(events.every((e) => e.route === PROBE_STATIC)).toBe(true);
  });

  it('records the sink event against the :param TEMPLATE, so distinct concrete paths collapse to one bounded series', async () => {
    // Bounded metric cardinality is a realtime/memory guard: a per-request concrete
    // path label would grow the sink unbounded. Hit the dynamic route with distinct
    // ids and assert every recorded label is the single template.
    const { sink, events } = countingSink();
    const registry = createApiRegistry([probeRoute(PROBE_DYNAMIC)]);
    const dispatcher = createApiDispatcher({ registry, delegate: () => {}, metricSink: sink });

    for (const id of ['1', '2', '3', 'abc', 'zzz']) {
      const res = new FakeRes();
      dispatcher(
        makeReq({ method: 'GET', url: `/api/perf-probe/${id}` }),
        res as unknown as http.ServerResponse,
      );
      await fullDrain();
    }
    expect(events.length).toBe(5);
    expect(new Set(events.map((e) => e.route))).toEqual(new Set([PROBE_DYNAMIC]));
  });

  it('is inert when off: the legacy entry does ZERO onion work (no sink event, handler never called)', async () => {
    // API_DISPATCH defaults to 'legacy'; selectApiEntry('legacy', ...) bypasses the
    // dispatcher entirely and calls the legacy delegate. The rollback default must
    // add nothing: no onion, no sink observation, no handler.
    let handlerCalls = 0;
    let legacyCalls = 0;
    const { sink, events } = countingSink();
    const registry = createApiRegistry([
      probeRoute(PROBE_STATIC, undefined, () => {
        handlerCalls++;
      }),
    ]);
    const onion = createApiDispatcher({ registry, delegate: () => {}, metricSink: sink });
    // A real legacy handler writes its own response; model that so the drive loop's
    // per-request drain completes (the point under test is that the onion, not the
    // legacy arm, stays inert).
    const legacyDelegate: ApiDelegate = (_req, res) => {
      legacyCalls++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    };
    const entry = selectApiEntry('legacy', onion, legacyDelegate);

    await driveN(entry, PROBE_STATIC, 100);
    expect(legacyCalls).toBe(100);
    expect(events.length).toBe(0);
    expect(handlerCalls).toBe(0);
  });
});

// --------------------------------------------------------------------------
// ARM C - wall-clock (env PERF_GATE_WALLCLOCK=1, skipped by default).
// --------------------------------------------------------------------------

const WALLCLOCK = process.env.PERF_GATE_WALLCLOCK === '1';
const wallDescribe = WALLCLOCK ? describe : describe.skip;

/** p-th percentile of a sample set (same nearest-rank rule TickProfiler uses). */
function percentile(samples: readonly number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}

/** Time each request (dispatch + settle) with hrtime, discarding the warmup runs. */
async function timeEntry(
  entry: ApiDispatcher,
  url: string,
  iters: number,
  warmup: number,
): Promise<number[]> {
  const samples: number[] = [];
  for (let i = 0; i < iters + warmup; i++) {
    const res = new FakeRes();
    const req = makeReq({ method: 'GET', url });
    const t0 = process.hrtime.bigint();
    entry(req, res as unknown as http.ServerResponse);
    await settle(res);
    const t1 = process.hrtime.bigint();
    if (i >= warmup) samples.push(Number(t1 - t0) / 1e6);
  }
  return samples;
}

wallDescribe('perf_gate ARM C: wall-clock added-p99 and tick p95 (PERF_GATE_WALLCLOCK=1)', () => {
  it('adds under the p99 budget per request versus the bare legacy path', async () => {
    const ITERS = 4000; // >= 2000 for a stable p99
    const WARMUP = 500;

    const onion = createApiDispatcher({
      registry: createApiRegistry([probeRoute(PROBE_STATIC)]),
      delegate: () => {},
      metricSink: noopMetricSink,
    });
    // The bare floor: a synchronous legacy handler doing the same response write,
    // wrapped by selectApiEntry('legacy') exactly as production wraps the ladder.
    const bare = selectApiEntry(
      'legacy',
      (() => {}) as unknown as ApiDispatcher,
      ((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      }) as ApiDelegate,
    );

    const bareSamples = await timeEntry(bare, PROBE_STATIC, ITERS, WARMUP);
    const onionSamples = await timeEntry(onion, PROBE_STATIC, ITERS, WARMUP);
    const bareP99 = percentile(bareSamples, 99);
    const onionP99 = percentile(onionSamples, 99);
    const added = onionP99 - bareP99;
    console.log(
      `[perf_gate] onion p99=${onionP99.toFixed(4)}ms bare p99=${bareP99.toFixed(4)}ms added=${added.toFixed(4)}ms (budget ${PIPELINE_ADDED_P99_BUDGET_MS}ms, iters=${ITERS})`,
    );
    expect(added).toBeLessThan(PIPELINE_ADDED_P99_BUDGET_MS);
  });

  it('keeps the world-loop tick p95 within the ceiling while the pipeline services requests between ticks', async () => {
    // A conservative model of the shared event loop: run a real Sim tick, then let
    // the loop service one pipeline request (its microtasks drain in the gap before
    // the next tick), and measure tick durations with the same TickProfiler the
    // server uses. See the header: this is tick self-cost + between-tick servicing,
    // not production gap jitter (the soak owns that).
    const { Sim } = await import('../../src/sim/sim');
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
    const onion = createApiDispatcher({
      registry: createApiRegistry([probeRoute(PROBE_STATIC)]),
      delegate: () => {},
      metricSink: noopMetricSink,
    });

    for (let i = 0; i < 200; i++) sim.tick(); // warm the world

    const TICKS = 4000;
    const profiler = new TickProfiler(['tick'], TICKS);
    for (let i = 0; i < TICKS; i++) {
      const t0 = process.hrtime.bigint();
      sim.tick();
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      profiler.add('tick', ms);
      profiler.commit(ms);
      const res = new FakeRes();
      onion(makeReq({ method: 'GET', url: PROBE_STATIC }), res as unknown as http.ServerResponse);
      await settle(res);
    }
    const prof = profiler.profile();
    console.log(
      `[perf_gate] tick p50=${prof.phases.total.p50}ms p95=${prof.phases.total.p95}ms p99=${prof.phases.total.p99}ms max=${prof.phases.total.max}ms (ceiling ${TICK_P95_CEILING_MS}ms, ticks=${TICKS})`,
    );
    expect(prof.phases.total.p95).toBeLessThanOrEqual(TICK_P95_CEILING_MS);
  });
});
