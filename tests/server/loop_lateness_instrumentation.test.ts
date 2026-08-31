// The two measures that close the world loop's blind spot.
//
// The tick profiler times the callback BODY. For a long time it also ran the 30 s
// persistence burst AFTER commit() closed the sample, so that work sat outside
// every phase and outside `total` as well. The consequence was not a small
// inaccuracy: a production loop stalling half a second every 30 s reported a
// healthy 60 ms tick, and the stall was only ever visible from OUTSIDE the
// process. Both facts below are load-bearing and neither is expressible as a
// behavioral assertion (they are statement ORDER and which variable is read), so
// they are pinned against the source.
//
// Note for the selective gate: this suite readFileSync's server/game.ts, so
// `vitest related` cannot see the dependency. Editing the loop body must run the
// real suite.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { WOC_TICK_PHASES } from '../../server/http/game_metrics';
import { createSerialWriter } from '../../server/serial_writer';
import { TickProfiler, type TickProfilerSample } from '../../server/tick_profiler';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const GAME_TS = readFileSync(join(ROOT, 'server/game.ts'), 'utf8');
const TICK_PROFILER_TS = readFileSync(join(ROOT, 'server/tick_profiler.ts'), 'utf8');

/** The guarded 20 Hz loop body, from the callback head to its last statement. */
function loopBody(): string {
  const start = GAME_TS.indexOf('const now = process.hrtime.bigint();');
  const end = GAME_TS.indexOf('this.lastTickCompletedAt = Date.now();');
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return GAME_TS.slice(start, end);
}

describe('world loop lateness instrumentation', () => {
  it('kicks off the persistence burst INSIDE the measured window', () => {
    // The whole point: commit() must close the sample AFTER the saves, so their
    // synchronous cost lands in `saves` and in `total`. Flipping these two lines
    // back restores the blind spot silently, with every test still green.
    const body = loopBody();
    const saves = body.indexOf('this.flushPeriodicSaves(dt);');
    const commit = body.indexOf('this.tickProfiler.commit(');
    expect(saves).toBeGreaterThan(0);
    expect(commit).toBeGreaterThan(0);
    expect(saves).toBeLessThan(commit);
  });

  it('measures lateness AHEAD of the 0.5 s clamp', () => {
    // `dt` is clamped to 0.5 s, and the clamp exists to DISCARD the overshoot: read
    // after it, a 900 ms stall would report as 450 ms of lateness, understating
    // exactly the episodes that matter most (past 0.5 s the realm stops simulating
    // the lost time altogether, so those are the ones that cost world time).
    const body = loopBody();
    const add = body.indexOf("this.tickProfiler.add('lateness'");
    const clamp = body.indexOf('if (dt > 0.5) dt = 0.5;');
    expect(add).toBeGreaterThan(0);
    expect(clamp).toBeGreaterThan(0);
    expect(add).toBeLessThan(clamp);
  });

  it('reports a lateness, not a raw gap', () => {
    const body = loopBody();
    const add = body.indexOf("this.tickProfiler.add('lateness'");
    const statement = body.slice(add, body.indexOf(';', add));
    // One on-time period is subtracted...
    expect(statement).toContain('DT * 1000');
    // ...and a callback that fired EARLY reports zero, never a negative that would
    // cancel a real stall out of the mean.
    expect(statement).toContain('Math.max(0,');
  });

  it('registers both phases on the always-on profiler', () => {
    // TickProfiler.add() silently ignores an unregistered phase, so a name that
    // is not in the constructor list is a measurement that is never recorded and
    // never errors.
    const registry = GAME_TS.slice(
      GAME_TS.indexOf('new TickProfiler(['),
      GAME_TS.indexOf('private perfDetailActive'),
    );
    expect(registry).toContain("'saves'");
    expect(registry).toContain("'lateness'");
  });

  it('exports both on the Prometheus phase set so an incident is readable from Grafana', () => {
    // Without this, the series exists in the admin capture only, which means it
    // is available exactly when someone already knows to go looking, and absent
    // for the retrospective that identifies the incident in the first place.
    expect(WOC_TICK_PHASES).toContain('saves');
    expect(WOC_TICK_PHASES).toContain('lateness');
  });
});

describe('scrape-time profile readout', () => {
  it('computes ONLY the phases the exporter publishes', () => {
    // statsFor copies a windowTicks-long ring into a JS array and sorts it, per
    // phase, inside the scrape's synchronous collect(). The profiler registers
    // dozens of detail phases that only carry data during an admin capture and
    // are never exported, so computing them all spends most of a contiguous
    // block on results the caller throws away.
    const profiler = new TickProfiler(['a', 'b', 'c'], 8);
    profiler.add('a', 1);
    profiler.add('b', 2);
    profiler.commit(3);
    const narrowed = profiler.profile(['a']);
    expect(Object.keys(narrowed.phases)).toEqual(['a']);
    expect(narrowed.phases.a.max).toBe(1);
    // ...and the unnarrowed readout still returns everything, so the admin
    // capture keeps its full detail.
    expect(Object.keys(profiler.profile().phases).sort()).toEqual([
      'a',
      'b',
      'c',
      'ticksRun',
      'total',
    ]);
  });

  it('skips an unknown name rather than reporting it as zero', () => {
    // A zero would read as "this phase never cost anything", which is a
    // different and much more reassuring claim than "this phase is not measured".
    const profiler = new TickProfiler(['a'], 4);
    profiler.commit(1);
    expect(Object.keys(profiler.profile(['a', 'nope']).phases)).toEqual(['a']);
  });

  it('narrows the metrics source to the exported set', () => {
    const main = readFileSync(join(ROOT, 'server/main.ts'), 'utf8');
    expect(main).toContain('tickPhaseMillis: () => game.tickPhaseMillis(WOC_TICK_PHASES)');
  });

  it('phaseMillis is the exporter shape (p95 + max only) with the same narrowing', () => {
    const profiler = new TickProfiler(['a', 'b'], 8);
    profiler.add('a', 4);
    profiler.add('b', 9);
    profiler.commit(13);
    expect(profiler.phaseMillis(['a', 'nope'])).toEqual({ a: { p95: 4, max: 4 } });
    expect(Object.keys(profiler.phaseMillis()).sort()).toEqual(['a', 'b', 'ticksRun', 'total']);
    expect(profiler.phaseMillis().b).toEqual({ p95: 9, max: 9 });
    const game = readFileSync(join(ROOT, 'server/game.ts'), 'utf8');
    expect(game).toContain('return this.tickProfiler.phaseMillis(only);');
  });
});

describe('catch-up divisor', () => {
  it('records how many sim ticks each sample carried', () => {
    // A sample is one loop CALLBACK, and add() sums a phase over every catch-up
    // tick inside it. Without this series a reader has no divisor at all.
    const profiler = new TickProfiler(['tick'], 8);
    profiler.add('tick', 8);
    profiler.commit(10, 1);
    profiler.add('tick', 80); // ten ticks ran together in one callback
    profiler.commit(95, 10);
    const stats = profiler.profile(['tick', 'ticksRun']);
    expect(stats.phases.tick.max).toBe(80);
    // ...and the divisor says the 10x phase reading is 10 ticks, not a slow tick:
    // 80 / 10 is the same 8 ms the quiet sample paid.
    expect(stats.phases.ticksRun.max).toBe(10);
    expect(stats.phases.ticksRun.p50).toBeGreaterThanOrEqual(1);
  });

  it('defaults to one tick so an uninstrumented caller is not silently wrong', () => {
    // A default of 0 would make every derived per-tick figure divide by zero, and
    // omitting the series would make a stale reader think the divisor is absent
    // rather than unknown.
    const profiler = new TickProfiler(['tick'], 4);
    profiler.add('tick', 5);
    profiler.commit(6);
    expect(profiler.profile(['ticksRun']).phases.ticksRun.max).toBe(1);
  });

  it('the world loop passes its real catch-up count', () => {
    const body = loopBody();
    expect(body).toContain('this.tickProfiler.commit(tickMs, ticksRun);');
  });
});

describe('saves measures the deferred write, not the enqueue', () => {
  function burnSyncMs(ms: number): void {
    const end = process.hrtime.bigint() + BigInt(ms) * 1_000_000n;
    while (process.hrtime.bigint() < end) {
      /* burn */
    }
  }

  it('bills the write thunk, which runs long after the enqueue returns', async () => {
    // The bug this pins: every shared-blob save reads its snapshot INSIDE the
    // queued thunk, and createSerialWriter defers that thunk with `tail.then`.
    // A timer around the enqueue call therefore sees bookkeeping and nothing else,
    // so an exported `saves` built that way reads ~0 while the write blocks the
    // loop for hundreds of ms. Measured on the pre-fix shape: 0.02 ms at the
    // enqueue site for a write that then blocked 250 ms.
    const observed: number[] = [];
    const enqueue = createSerialWriter((ms) => observed.push(ms));
    const atEnqueue = process.hrtime.bigint();
    const done = enqueue(async () => {
      burnSyncMs(30);
      return 'written';
    });
    const enqueueCostMs = Number(process.hrtime.bigint() - atEnqueue) / 1e6;
    // The enqueue frame itself is free: nothing ran yet.
    expect(enqueueCostMs).toBeLessThan(5);
    expect(observed).toEqual([]);
    expect(await done).toBe('written');
    // ...and the observer billed the thunk's real synchronous cost.
    expect(observed).toHaveLength(1);
    expect(observed[0]).toBeGreaterThanOrEqual(25);
  });

  it('charges a deferred write to the captured sample after commit clears current work', async () => {
    // The writer thunk runs from tail.then(...), so commit() has already closed
    // and cleared the current sample by the time the synchronous save work runs.
    // The enqueue context is the bridge back to the sample that kicked it off.
    const profiler = new TickProfiler(['saves'], 8);
    const enqueue = createSerialWriter<TickProfilerSample>((ms, sample) => {
      if (!sample) throw new Error('missing sample');
      profiler.addToSample(sample, 'saves', ms);
      profiler.addToSample(sample, 'total', ms);
    });
    const sample = profiler.currentSample();
    const done = enqueue(async () => {
      burnSyncMs(30);
      return 'written';
    }, sample);

    // Close the sample before the microtask runs. The old shape would put the
    // measurement in the next sample or lose it from total entirely.
    profiler.commit(1);
    expect(await done).toBe('written');
    profiler.commit(1);

    const phases = profiler.profile(['saves', 'total']).phases;
    expect(phases.saves.max).toBeGreaterThanOrEqual(25);
    expect(phases.total.max).toBeGreaterThanOrEqual(26);
  });

  it('bills the write even when it rejects, so a failing save is not free', () => {
    const observed: number[] = [];
    const enqueue = createSerialWriter((ms) => observed.push(ms));
    return expect(
      enqueue(async () => {
        throw new Error('write failed');
      }),
    )
      .rejects.toThrow('write failed')
      .then(() => expect(observed).toHaveLength(1));
  });

  it('never lets a throwing observer break a persistence write', () => {
    // A measurement must not be able to fail a save.
    const enqueue = createSerialWriter(() => {
      throw new Error('observer exploded');
    });
    return expect(enqueue(async () => 'written')).resolves.toBe('written');
  });

  it('an unobserved writer behaves exactly as before', async () => {
    const enqueue = createSerialWriter();
    const order: string[] = [];
    const a = enqueue(async () => void order.push('a'));
    const b = enqueue(async () => void order.push('b'));
    await Promise.all([a, b]);
    expect(order).toEqual(['a', 'b']);
  });

  it('wires both shared-blob writers to the saves phase', () => {
    // The market writer carries the market AND mail books (saveMail rides
    // enqueueMarketWrite); the rift writer carries the rift blob.
    expect(GAME_TS).toContain('const sample = this.tickProfiler.currentSample();');
    expect(TICK_PROFILER_TS).toContain("target.addToSample(sample, 'saves', ms);");
    expect(TICK_PROFILER_TS).toContain("target.addToSample(sample, 'total', ms);");
    expect(GAME_TS).toContain('void this.saveMarket(sample);');
    expect(GAME_TS).toContain('void this.saveMail(sample);');
    expect(GAME_TS).toContain('void this.saveRifts(sample);');
    expect(GAME_TS).toContain('createSerialWriter(this.onSaveMs)');
    expect(GAME_TS).not.toMatch(/createSerialWriter\(\s*\)/);
  });
});
