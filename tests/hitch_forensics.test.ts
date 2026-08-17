import { describe, expect, it } from 'vitest';
import { createHitchForensics } from '../src/game/hitch_forensics';

const state = (over: Record<string, number | string> = {}) => ({
  programs: 400,
  textures: 900,
  views: 30,
  heapUsedMb: 1200,
  biome: 'peaks',
  ...over,
});

describe('createHitchForensics', () => {
  it('records nothing while frames stay under the hitch threshold', () => {
    const f = createHitchForensics();
    f.sample(0, 20, state());
    f.sample(5000, 33, state({ programs: 410 }));
    f.sample(10000, 90, state({ programs: 420 }));
    expect(f.records()).toEqual([]);
  });

  it('pins the default threshold at exactly 150ms', () => {
    // The forensics contract everywhere (bench stall counts, prod reports)
    // speaks in "stalls over 150": a drifted default silently reclassifies
    // every capture, so the boundary is pinned to the value itself.
    const under = createHitchForensics();
    under.sample(0, 20, state());
    under.sample(5000, 149.9, state({ programs: 500 }));
    expect(under.records()).toEqual([]);

    const at = createHitchForensics();
    at.sample(0, 20, state());
    at.sample(5000, 150, state({ programs: 500 }));
    expect(at.records()).toHaveLength(1);
  });

  it('stores only the fields that changed across a hitch interval', () => {
    const f = createHitchForensics();
    f.sample(0, 20, state());
    f.sample(5000, 480, state({ programs: 412, views: 71, biome: 'marsh' }));
    const records = f.records();
    expect(records).toHaveLength(1);
    expect(records[0].atMs).toBe(5000);
    expect(records[0].worstFrameMs).toBe(480);
    expect(records[0].intervalMs).toBe(5000);
    expect(records[0].diff).toEqual({
      programs: { from: 400, to: 412 },
      views: { from: 30, to: 71 },
      biome: { from: 'peaks', to: 'marsh' },
    });
    // Unchanged fields never ride along.
    expect(records[0].diff.textures).toBeUndefined();
  });

  it('paces itself: samples inside the interval are absorbed, not diffed', () => {
    const f = createHitchForensics({ sampleEveryMs: 5000 });
    f.sample(0, 20, state());
    // 1 Hz caller ticks between snapshots: no baseline advance, no record.
    f.sample(1000, 500, state({ programs: 405 }));
    f.sample(2000, 20, state({ programs: 406 }));
    expect(f.records()).toEqual([]);
    // The 5 s boundary closes the interval: the hitch seen inside it lands,
    // diffed against the interval's OPENING snapshot.
    f.sample(5200, 500, state({ programs: 409 }));
    const records = f.records();
    expect(records).toHaveLength(1);
    expect(records[0].diff.programs).toEqual({ from: 400, to: 409 });
  });

  it('keeps the worst frame seen across absorbed samples', () => {
    const f = createHitchForensics({ sampleEveryMs: 5000 });
    f.sample(0, 20, state());
    f.sample(1000, 700, state());
    f.sample(5100, 30, state({ views: 45 }));
    const records = f.records();
    expect(records).toHaveLength(1);
    expect(records[0].worstFrameMs).toBe(700);
  });

  it('bounds the ring, evicting the oldest record', () => {
    const f = createHitchForensics({ limit: 2, sampleEveryMs: 1000 });
    f.sample(0, 20, state());
    f.sample(1000, 200, state({ programs: 401 }));
    f.sample(2000, 200, state({ programs: 402 }));
    f.sample(3000, 200, state({ programs: 403 }));
    const records = f.records();
    expect(records).toHaveLength(2);
    expect(records[0].diff.programs).toEqual({ from: 401, to: 402 });
    expect(records[1].diff.programs).toEqual({ from: 402, to: 403 });
  });

  it('records a hitch even when nothing in the vector moved', () => {
    // An empty diff is itself a diagnosis: the stall came from outside the
    // tracked state (GC, driver, tab contention).
    const f = createHitchForensics();
    f.sample(0, 20, state());
    f.sample(5000, 300, state());
    const records = f.records();
    expect(records).toHaveLength(1);
    expect(records[0].diff).toEqual({});
  });

  it('resets clean', () => {
    const f = createHitchForensics();
    f.sample(0, 20, state());
    f.sample(5000, 300, state({ views: 50 }));
    f.reset();
    expect(f.records()).toEqual([]);
    // A fresh baseline is required again before any record can land.
    f.sample(6000, 400, state());
    expect(f.records()).toEqual([]);
  });
});

describe('PerfMonitor wiring', () => {
  it('samples the forensics at the 1 Hz tick and surfaces records in the snapshot', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/game/perf.ts', import.meta.url), 'utf8');
    expect(source).toContain('this.hitchForensics.sample(');
    expect(source).toContain('hitchForensics: this.hitchForensics.records()');
  });
});
