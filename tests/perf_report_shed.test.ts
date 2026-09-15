import { describe, expect, it } from 'vitest';
import {
  jsonByteLength,
  RAW_SUMMARY_KNOWN_KEYS,
  RAW_SUMMARY_RESERVED_KEYS,
  RAW_SUMMARY_SCALAR_KEYS,
  RAW_SUMMARY_SHED_RUNG_IDS,
  shedRawSummaryToFit,
  stripReservedRawSummaryKeys,
} from '../server/perf_report_shed';

const CAP = 16 * 1024;

// A stand-in for perf_report.ts compactPrewarmSummary: the shed module only
// needs "fewer members, same shape". The real compactor rides the ingest
// suite (tests/perf_report.test.ts).
function fakeCompactPrewarm(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of ['elapsedMs', 'manifestPlanned', 'manifestCompleted', 'manifestPartial']) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  if (Array.isArray(source.entries)) {
    out.entries = source.entries.slice(0, 24).map((entry) => {
      const record = entry as Record<string, unknown>;
      return { id: record.id, status: record.status, detail: String(record.detail).slice(0, 40) };
    });
  }
  if (Array.isArray(source.compileUnits)) out.compileUnits = source.compileUnits.slice(0, 6);
  return out;
}

const deps = { compactPrewarm: fakeCompactPrewarm };
const frameMs = { avg: 16.7, p50: 16.6, p95: 33.4, p99: 50.2, max: 120, long50: 3 };

/** The small keys every real report carries: about 2 KB together. */
function coreKeys(): Record<string, unknown> {
  return {
    graphicsConfigVersion: 16,
    seconds: 300,
    visibleSeconds: 240,
    frames: 14_400,
    hiddenPresentSkips: 0,
    windows: {
      last10s: { seconds: 10, frames: 600, fps: 60, frameMs },
      last30s: { seconds: 30, frames: 1800, fps: 60, frameMs },
      worst10s: { atMs: 120_000, seconds: 10, frames: 300, fps: 30, frameMs },
    },
    mainMs: {
      sim: { count: 6000, avg: 1.2, p95: 3.1, max: 14 },
      events: { count: 6000, avg: 0.2, p95: 0.6, max: 4 },
      render: { count: 6000, avg: 8.1, p95: 14.2, max: 60 },
    },
    rendererPhaseMs: { cull: 0.4, views: 1.1, submit: 6.2, post: 0.9 },
    rendererBudget: { targetFps: 60, level: 3, backoffs: 2 },
    rendererDrawingBuffer: {
      width: 2560,
      height: 1440,
      cssWidth: 2560,
      cssHeight: 1440,
      dynamicResolution: false,
    },
    browser: { longTasks: { totalMs: 200, avg: 66.7, max: 150, lastAge: 900 } },
    hud: { hotDomWrites: 12, hotDomSkippedWrites: 900, hotDomSkipRate: 0.98 },
    heapSawtooth: { samples: 300, minMb: 210, maxMb: 480, cyclesPerMin: 1.4 },
    netPipeline: { parseMs: { count: 240, p50: 0.4, p95: 1.2, max: 6.5 } },
    postRevealLinks: { programsGained: 41, closed: true, baselineLost: false },
    bootPhases: { entryMs: 9000, rendererCtorMs: 1000, prepareZoneMs: 2000 },
    shaderWarm: { active: true, mode: 'worker', refusal: null, held: 0, warmed: 120 },
    entryReveal: { waitedMs: 1200, boundMs: 4000, waits: [{ key: 'terrain', waitedMs: 800 }] },
  };
}

function bigString(bytes: number): string {
  return 'x'.repeat(bytes);
}

/** A report shaped like a heavy first beacon, well over the cap. */
function heavyReport(): Record<string, unknown> {
  return {
    ...coreKeys(),
    rendererDiagnostics: { newMaterials: ['MeshStandardMaterial:tree', 'Sprite:label'] },
    assets: { preload: { count: 40, ms: 3200 }, byType: { glb: 12, webp: 28 } },
    rendererPrewarmSummary: {
      elapsedMs: 3200,
      manifestPlanned: 32,
      manifestCompleted: 30,
      manifestPartial: 2,
      compileUnits: Array.from({ length: 12 }, (_, i) => ({
        id: `programs:compile:unit_${i}`,
        lane: 'programs.compile',
        syncMs: i * 3,
        settledDurationMs: i * 6,
        failedAtMs: null,
        programDelta: 2,
        statusAtReveal: 'settled',
      })),
      entries: Array.from({ length: 32 }, (_, i) => ({
        id: `textures.scene_${i}`,
        category: 'world',
        required: i < 8,
        status: i % 8 === 0 ? 'partial' : 'completed',
        elapsedMs: 120 + i,
        remainingMsAfter: 4200 - i,
        programDelta: 1,
        textureDelta: 12,
        workDone: 12,
        workPlanned: 20,
        detail: `uploaded=12 pending=8 ${bigString(140)}`,
      })),
    },
    rendererQualityBuckets: {
      version: 16,
      bands: { foliage: bigString(1500), shadows: bigString(1500) },
      baseline: { foliage: bigString(500), shadows: bigString(500) },
      levels: { foliage: 3, shadows: 2 },
      features: { composer: true, ao: false, shadowMap: 2048 },
    },
    rendererFoliage: { residency: bigString(900), buckets: [1, 2, 3] },
    rendererGpuQueue: {
      units: 400,
      pending: 2,
      stallCount: 1,
      active: { label: 'char-skin', priority: 2, ageMs: 40 },
      stalls: [{ label: 'char-skin', priority: 2, ageMs: 4000, settled: true }],
      slowest: Array.from({ length: 8 }, (_, i) => ({ label: `unit_${i}`, syncMs: 40 - i })),
      blockiest: Array.from({ length: 8 }, (_, i) => ({ label: `unit_${i}`, frameGapMs: 90 - i })),
      longestWaits: Array.from({ length: 8 }, (_, i) => ({ label: `wait_${i}`, waitMs: 300 - i })),
      waitingTails: Array.from({ length: 4 }, (_, i) => ({ label: `tail_${i}`, ageMs: 20 + i })),
      recent: {
        windowMs: 300_000,
        units: 40,
        lanes: Array.from({ length: 8 }, (_, i) => ({ priority: i, units: 5, worstWaitMs: 10 })),
      },
    },
    input: { latency: { p50: 4, p95: 12, max: 60 }, debug: bigString(700) },
  };
}

describe('raw summary shed ladder', () => {
  it('returns a blob under the cap untouched, without any marker', () => {
    const value = coreKeys();
    const out = shedRawSummaryToFit(value, CAP, deps);
    expect(out).toBe(value);
    expect(out).not.toHaveProperty('truncated');
    expect(out).not.toHaveProperty('dropped');
  });

  it('fits a heavy report by shedding in ladder order and keeps every core key intact', () => {
    const input = heavyReport();
    expect(jsonByteLength(input)).toBeGreaterThan(CAP);
    const out = shedRawSummaryToFit(input, CAP, deps);
    expect(jsonByteLength(out)).toBeLessThanOrEqual(CAP);
    expect(out.truncated).toBe(true);
    const dropped = out.dropped as string[];
    // In ladder order: the two cheap whole keys, then the prewarm compaction.
    expect(dropped.slice(0, 3)).toEqual([
      'rendererDiagnostics',
      'assets',
      'rendererPrewarmSummary.lists',
    ]);
    const order = dropped.map((id) => RAW_SUMMARY_SHED_RUNG_IDS.indexOf(id));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The core survives with its values: readers keep their SQL paths.
    for (const key of Object.keys(coreKeys())) {
      expect(out[key], key).toEqual(input[key]);
    }
    // Absent-vs-shed: a known input key is either present or named in
    // `dropped` (as its own rung, or the parent of a dotted sub-rung).
    for (const key of Object.keys(input)) {
      if (dropped.includes(key)) expect(out).not.toHaveProperty(key);
      else expect(out).toHaveProperty(key);
    }
    // The prewarm compaction rung left the summary present, on fewer members.
    const prewarm = out.rendererPrewarmSummary as Record<string, unknown>;
    expect(prewarm.manifestPlanned).toBe(32);
    expect((prewarm.compileUnits as unknown[]).length).toBe(6);
  });

  it('is deterministic and never mutates its input', () => {
    const input = heavyReport();
    const before = structuredClone(input);
    const first = shedRawSummaryToFit(input, CAP, deps);
    const second = shedRawSummaryToFit(structuredClone(input), CAP, deps);
    expect(first).toEqual(second);
    expect(input).toEqual(before);
  });

  it('stops at the first rung that fits, leaving later rungs untouched', () => {
    const value = {
      ...coreKeys(),
      rendererFoliage: { filler: bigString(20_000) },
      rendererGpuQueue: { active: null, stalls: [], slowest: [{ label: 'a' }], longestWaits: [] },
      input: { latency: { p50: 4 } },
      netPipeline: { parseMs: { count: 1 } },
    };
    const out = shedRawSummaryToFit(value, CAP, deps);
    expect(out.dropped).toEqual(['rendererFoliage']);
    expect(out.rendererGpuQueue).toEqual(value.rendererGpuQueue);
    expect(out.input).toEqual(value.input);
    expect(out.netPipeline).toEqual(value.netPipeline);
  });

  it('sheds in ladder order, not by size: a small earlier rung goes before the big one', () => {
    const value = {
      ...coreKeys(),
      rendererFoliage: { small: true },
      input: { debug: bigString(20_000) },
    };
    const out = shedRawSummaryToFit(value, CAP, deps);
    // rendererFoliage sits before input on the ladder, so it goes first even
    // though it saved nothing worth mentioning: the order is what makes
    // `dropped` readable across the fleet.
    expect(out.dropped).toEqual(['rendererFoliage', 'input']);
  });

  it('sheds a sub-block rung by deleting its members, keeping the rest of the block', () => {
    const value = {
      ...coreKeys(),
      rendererGpuQueue: {
        active: { label: 'char-skin' },
        stalls: [{ label: 'char-skin' }],
        pending: 3,
        slowest: [{ label: 'a', detail: bigString(20_000) }],
        blockiest: [{ label: 'b' }],
        longestWaits: [{ label: 'w' }],
        waitingTails: [{ label: 't' }],
        recent: { windowMs: 1000, lanes: [{ priority: 1 }] },
      },
    };
    const out = shedRawSummaryToFit(value, CAP, deps);
    expect(out.dropped).toEqual(['rendererGpuQueue.rankings']);
    expect(out.rendererGpuQueue).toEqual({
      active: { label: 'char-skin' },
      stalls: [{ label: 'char-skin' }],
      pending: 3,
      longestWaits: [{ label: 'w' }],
      waitingTails: [{ label: 't' }],
      recent: { windowMs: 1000, lanes: [{ priority: 1 }] },
    });

    const waits = {
      ...coreKeys(),
      rendererGpuQueue: {
        active: null,
        longestWaits: [{ label: 'w', detail: bigString(20_000) }],
        recent: { windowMs: 1000, units: 4, lanes: [{ priority: 1 }] },
      },
    };
    const shed = shedRawSummaryToFit(waits, CAP, deps);
    expect(shed.dropped).toEqual(['rendererGpuQueue.waits']);
    expect(shed.rendererGpuQueue).toEqual({ active: null, recent: { windowMs: 1000, units: 4 } });
  });

  it('drops the static quality-bucket bands before the levels and features', () => {
    const value = {
      ...coreKeys(),
      rendererQualityBuckets: {
        version: 16,
        bands: { big: bigString(20_000) },
        baseline: { foliage: 1 },
        levels: { foliage: 3 },
        features: { composer: true },
      },
    };
    const out = shedRawSummaryToFit(value, CAP, deps);
    expect(out.dropped).toEqual(['rendererQualityBuckets.bands']);
    expect(out.rendererQualityBuckets).toEqual({
      version: 16,
      levels: { foliage: 3 },
      features: { composer: true },
    });
  });

  it('keeps only the incomplete prewarm entries once the compact lists still overflow', () => {
    const entries = Array.from({ length: 24 }, (_, i) => ({
      id: `entry_${i}`,
      status: i % 6 === 0 ? 'timed-out' : 'completed',
      detail: bigString(1200),
    }));
    const value = { ...coreKeys(), rendererPrewarmSummary: { manifestPlanned: 24, entries } };
    // The fake compactor keeps 24 entries at 40 chars of detail, so the
    // entries rung is what brings this one under a tight cap.
    const out = shedRawSummaryToFit(value, 3 * 1024, deps);
    expect(out.dropped).toEqual(['rendererPrewarmSummary.lists', 'rendererPrewarmSummary.entries']);
    const kept = (out.rendererPrewarmSummary as { entries: Array<{ id: string }> }).entries;
    expect(kept.map((entry) => entry.id)).toEqual(['entry_0', 'entry_6', 'entry_12', 'entry_18']);
  });

  it('drops the legacy prewarm twin when the summary is present, and compacts it otherwise', () => {
    const twin = { manifestPlanned: 4, entries: [{ id: 'a', detail: bigString(20_000) }] };
    const both = shedRawSummaryToFit(
      { ...coreKeys(), rendererPrewarmSummary: { manifestPlanned: 4 }, rendererPrewarm: twin },
      CAP,
      deps,
    );
    expect(both.dropped).toEqual(['rendererPrewarm.twin']);
    expect(both.rendererPrewarmSummary).toEqual({ manifestPlanned: 4 });

    const alone = shedRawSummaryToFit({ ...coreKeys(), rendererPrewarm: twin }, CAP, deps);
    expect(alone.dropped).toEqual(['rendererPrewarmSummary.lists']);
    expect(alone).not.toHaveProperty('rendererPrewarm');
    expect((alone.rendererPrewarmSummary as { manifestPlanned: number }).manifestPlanned).toBe(4);
  });

  it('sheds an unknown key first and never lets its name into dropped', () => {
    const out = shedRawSummaryToFit(
      { ...coreKeys(), 'evil-key': bigString(20_000), other: 1 },
      CAP,
      deps,
    );
    expect(out.dropped).toEqual(['unlisted']);
    expect(out).not.toHaveProperty('evil-key');
    expect(out).not.toHaveProperty('other');
    for (const id of out.dropped as string[]) expect(RAW_SUMMARY_SHED_RUNG_IDS).toContain(id);
  });

  it('survives keys named like Object.prototype members, shedding them as unlisted', () => {
    // After `delete out.constructor` the name still reads as present through
    // the prototype; a membership test by `in` would then serialize the
    // inherited function and throw, and the ingest's catch would store `{}`:
    // the whole-blob drop by another route.
    const value = JSON.parse(
      JSON.stringify({
        ...coreKeys(),
        constructor: bigString(20_000),
        toString: 'x',
        hasOwnProperty: 1,
        __proto__: { polluted: true },
      }),
    ) as Record<string, unknown>;
    const out = shedRawSummaryToFit(value, CAP, deps);
    expect(out.dropped).toEqual(['unlisted']);
    expect(jsonByteLength(out)).toBeLessThanOrEqual(CAP);
    for (const key of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
      expect(Object.hasOwn(out, key), key).toBe(false);
    }
    expect(out.windows).toEqual(coreKeys().windows);
  });

  it('stops exactly at the cap boundary: a cap equal to the size after one rung sheds one rung', () => {
    const value = { ...coreKeys(), rendererDiagnostics: bigString(20_000), assets: { a: 1 } };
    const afterOne = shedRawSummaryToFit(value, CAP, deps);
    expect(afterOne.dropped).toEqual(['rendererDiagnostics']);
    const exact = jsonByteLength(afterOne);
    expect(shedRawSummaryToFit(value, exact, deps).dropped).toEqual(['rendererDiagnostics']);
    expect(shedRawSummaryToFit(value, exact - 1, deps).dropped).toEqual([
      'rendererDiagnostics',
      'assets',
    ]);
  });

  it('reaches the core tail only for a hostile core key, and still records it', () => {
    // Only core keys present, so the ladder walks straight into its tail:
    // the keys before `windows` on it go first (they are the ladder's order,
    // not a size judgement), then the inflated key itself.
    const value = { windows: bigString(40_000), bootPhases: coreKeys().bootPhases, seconds: 3 };
    const out = shedRawSummaryToFit(value, CAP, deps);
    expect(out.dropped).toEqual(['windows']);
    expect(out).not.toHaveProperty('windows');
    expect(out.bootPhases).toEqual(coreKeys().bootPhases);
    expect(out.seconds).toBe(3);
  });

  it('holds the cap as a hard bound whatever known key a hostile payload inflates', () => {
    // Every known key, inflated as a STRING (so no sub-block or conditional
    // rung can touch it) past the cap on its own, beside a real core: the
    // returned blob must fit regardless, which is only true if every key has
    // an unconditional whole-key rung. The legacy prewarm twin was the gap.
    for (const key of RAW_SUMMARY_KNOWN_KEYS) {
      const out = shedRawSummaryToFit({ ...coreKeys(), [key]: bigString(40_000) }, CAP, deps);
      expect(jsonByteLength(out), key).toBeLessThanOrEqual(CAP);
      expect(out.truncated, key).toBe(true);
      expect(out, key).not.toHaveProperty(key);
    }
    // Same with every known key inflated at once, and with the empty cap: the
    // ladder bottoms out at the bare markers rather than an over-cap blob.
    const all = Object.fromEntries(RAW_SUMMARY_KNOWN_KEYS.map((key) => [key, bigString(4000)]));
    const out = shedRawSummaryToFit(all, 512, deps);
    expect(jsonByteLength(out)).toBeLessThanOrEqual(512);
    expect(Object.keys(out).sort()).toEqual(['dropped', 'truncated']);
  });

  it('sheds the scalars together as the very last rung, none of the five surviving', () => {
    const value = { seconds: bigString(20_000), frames: 3, visibleSeconds: 2, windows: { a: 1 } };
    const out = shedRawSummaryToFit(value, CAP, deps);
    expect(out.dropped).toEqual(['windows', 'scalars']);
    for (const key of RAW_SUMMARY_SCALAR_KEYS) expect(out, key).not.toHaveProperty(key);
    expect(Object.keys(out).sort()).toEqual(['dropped', 'truncated']);
  });

  it('keeps the wedge residue of the GPU queue and the entry reveal in the core tail', () => {
    // A wedged queue and a slow entry are what a truncated report must still
    // carry, so their whole-key rungs sit after every non-core block.
    const at = (id: string) => RAW_SUMMARY_SHED_RUNG_IDS.indexOf(id);
    for (const earlier of ['netPipeline', 'heapSawtooth', 'hud', 'mainMs', 'rendererBudget']) {
      expect(at(earlier), earlier).toBeLessThan(at('rendererGpuQueue'));
      expect(at(earlier), earlier).toBeLessThan(at('entryReveal'));
    }
    expect(at('rendererGpuQueue')).toBeLessThan(at('windows'));
  });

  it('sheds the dev trace first under the loopback cap', () => {
    const value = { ...coreKeys(), devTrace: { frames: bigString(600 * 1024) }, input: { a: 1 } };
    const out = shedRawSummaryToFit(value, 512 * 1024, deps);
    expect(out.dropped).toEqual(['devTrace']);
    expect(out.input).toEqual({ a: 1 });
  });

  it('strips the server-authored markers from client input', () => {
    const value: Record<string, unknown> = { truncated: true, dropped: ['windows'], seconds: 1 };
    stripReservedRawSummaryKeys(value);
    expect(value).toEqual({ seconds: 1 });
  });

  it('pins the vocabularies: unique rungs, every known key on the ladder, markers never known', () => {
    expect(new Set(RAW_SUMMARY_SHED_RUNG_IDS).size).toBe(RAW_SUMMARY_SHED_RUNG_IDS.length);
    const scalars = [
      'graphicsConfigVersion',
      'seconds',
      'visibleSeconds',
      'frames',
      'hiddenPresentSkips',
    ];
    expect([...RAW_SUMMARY_SCALAR_KEYS]).toEqual(scalars);
    const wholeKeyRungs = RAW_SUMMARY_SHED_RUNG_IDS.filter(
      (id) => !id.includes('.') && id !== 'unlisted' && id !== 'scalars',
    );
    expect([...wholeKeyRungs, ...scalars].sort()).toEqual([...RAW_SUMMARY_KNOWN_KEYS].sort());
    for (const key of RAW_SUMMARY_RESERVED_KEYS) {
      expect(RAW_SUMMARY_KNOWN_KEYS).not.toContain(key);
      expect(RAW_SUMMARY_SHED_RUNG_IDS).not.toContain(key);
    }
    // Every dotted rung names a known parent key.
    for (const id of RAW_SUMMARY_SHED_RUNG_IDS.filter((id) => id.includes('.'))) {
      expect(RAW_SUMMARY_KNOWN_KEYS).toContain(id.split('.')[0]);
    }
  });
});
