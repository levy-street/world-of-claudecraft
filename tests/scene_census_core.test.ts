// Scene census core (src/render/scene_census_core.ts): the measured
// per-bucket breakdown behind the ?perf overlay's census button, and the
// hitch tracker correlating long frames with program/texture growth.
//
// The fake host models three's counter semantics: autoReset=true zeroes the
// counters at render start; autoReset=false accumulates across renders (the
// census switches to manual mode so shadow-pass draws survive the read on
// every tier), and the shadow pass only renders while shadowAutoUpdate holds.

import { describe, expect, it } from 'vitest';
import type { DrawStatsCounters } from '../src/render/draw_stats_core';
import {
  captureSceneCensus,
  censusCount,
  censusTableLines,
  createHitchTracker,
  type SceneCensusHost,
  type SceneCensusMeta,
} from '../src/render/scene_census_core';

interface FakeChild {
  category: string;
  visible: boolean;
  calls: number;
  triangles: number;
  shadowCalls: number;
}

interface FakeHost {
  host: SceneCensusHost;
  state: {
    renders(): number;
    discards(): number;
    autoReset(): boolean;
    shadowAuto(): boolean;
    autoResetDuringRenders(): boolean[];
  };
}

function zero(): DrawStatsCounters {
  return { calls: 0, triangles: 0, points: 0, lines: 0 };
}

function makeHost(
  children: FakeChild[],
  opts: { shadowsEnabled?: boolean; postCalls?: number; throwOnRender?: number } = {},
): FakeHost {
  const postCalls = opts.postCalls ?? 0;
  const shadowsEnabled = opts.shadowsEnabled ?? true;
  let counters = zero();
  let autoReset = true;
  let shadowAuto = true;
  let renders = 0;
  let discards = 0;
  const autoResetDuringRenders: boolean[] = [];
  const host: SceneCensusHost = {
    children: () =>
      children.map((c) => ({
        category: c.category,
        get visible() {
          return c.visible;
        },
        setVisible: (visible: boolean) => {
          c.visible = visible;
        },
      })),
    render: () => {
      renders++;
      if (opts.throwOnRender === renders) throw new Error('boom');
      autoResetDuringRenders.push(autoReset);
      // three r165 semantics: the shadow pass draws FIRST; with autoReset on,
      // render() then calls info.reset() before the scene pass, so a
      // post-render read drops the shadow draws. The census must therefore
      // hold the counters in manual-reset mode or its shadow share reads 0.
      if (shadowsEnabled && shadowAuto) {
        for (const c of children) {
          if (c.visible) counters.calls += c.shadowCalls;
        }
      }
      if (autoReset) counters = zero();
      for (const c of children) {
        if (!c.visible) continue;
        counters.calls += c.calls;
        counters.triangles += c.triangles;
      }
      counters.calls += postCalls;
      counters.triangles += postCalls;
    },
    counters: () => ({ ...counters }),
    resetCounters: () => {
      counters = zero();
    },
    countersAutoReset: () => autoReset,
    setCountersAutoReset: (v: boolean) => {
      autoReset = v;
    },
    programCount: () => 42,
    textureCount: () => 7,
    geometryCount: () => 9,
    shadowsEnabled: () => shadowsEnabled,
    shadowAutoUpdate: () => shadowAuto,
    setShadowAutoUpdate: (v: boolean) => {
      shadowAuto = v;
    },
    discardOutOfBand: () => {
      discards++;
    },
  };
  return {
    host,
    state: {
      renders: () => renders,
      discards: () => discards,
      autoReset: () => autoReset,
      shadowAuto: () => shadowAuto,
      autoResetDuringRenders: () => autoResetDuringRenders.slice(),
    },
  };
}

const META: SceneCensusMeta = {
  atMs: 123,
  tier: 'ultra',
  playerPosition: { x: 10, y: 2, z: -340 },
  cameraPosition: { x: 12, y: 8, z: -350 },
};

function worldChildren(): FakeChild[] {
  return [
    { category: 'terrain', visible: true, calls: 10, triangles: 1000, shadowCalls: 3 },
    { category: 'foliage', visible: true, calls: 20, triangles: 5000, shadowCalls: 8 },
    // A hidden sibling in an existing bucket: must not add cost, must stay hidden.
    { category: 'foliage', visible: false, calls: 7, triangles: 900, shadowCalls: 2 },
    { category: 'props', visible: true, calls: 5, triangles: 400, shadowCalls: 1 },
  ];
}

describe('captureSceneCensus', () => {
  it('measures baseline, shadow share, and per-bucket costs by visibility diffing', () => {
    const children = worldChildren();
    const { host, state } = makeHost(children, { postCalls: 4 });
    const report = captureSceneCensus(host, META);

    // baseline: visible children (10+20+5) + their shadow draws (3+8+1) + post 4
    expect(report.baseline.calls).toBe(51);
    expect(report.baseline.triangles).toBe(6404);

    // shadow: frozen pass drops exactly the shadow draws of visible children
    expect(report.shadow.measured).toBe(true);
    expect(report.shadow.calls).toBe(12);
    expect(report.shadow.callsShare).toBeCloseTo(12 / 51, 2);

    // buckets sorted by calls desc; each bucket cost includes its shadow draws
    expect(report.rows.map((r) => r.category)).toEqual(['foliage', 'terrain', 'props']);
    const [foliage, terrain, props] = report.rows;
    expect(foliage.calls).toBe(28);
    expect(foliage.triangles).toBe(5000);
    expect(foliage.roots).toBe(2);
    expect(foliage.visibleRoots).toBe(1);
    expect(terrain.calls).toBe(13);
    expect(props.calls).toBe(6);
    expect(foliage.callsShare).toBeCloseTo(28 / 51, 2);

    // residual: baseline minus bucket sum = the post-chain floor
    expect(report.residual.calls).toBe(51 - 28 - 13 - 6);
    expect(report.residual.triangles).toBe(4);

    expect(report.programs).toBe(42);
    expect(report.textures).toBe(7);
    expect(report.geometries).toBe(9);
    // baseline + shadow + one per bucket
    expect(report.renders).toBe(5);
    expect(report.tier).toBe('ultra');
    expect(report.atMs).toBe(123);
    expect(state.discards()).toBe(1);
  });

  it('holds the counters in manual-reset mode for every measurement render', () => {
    const children = worldChildren();
    const { host, state } = makeHost(children, { postCalls: 4 });
    const report = captureSceneCensus(host, META);
    const during = state.autoResetDuringRenders();
    // 5 measurement renders in manual mode, then the trailing restore render
    // after the mode has been handed back.
    expect(during).toEqual([false, false, false, false, false, true]);
    // Decisive: with three's auto-reset semantics the post-render read drops
    // the shadow pass, so this nonzero share exists only because of the
    // manual mode (the fake models the reset-after-shadow-pass ordering).
    expect(report.shadow.calls).toBe(12);
  });

  it('presents a trailing restored frame and keeps it out of the measurements', () => {
    const children = worldChildren();
    const { host, state } = makeHost(children, { postCalls: 4 });
    const report = captureSceneCensus(host, META);
    // baseline + shadow + 3 buckets measured, plus the restore render
    expect(report.renders).toBe(5);
    expect(state.renders()).toBe(6);
    expect(state.discards()).toBe(1);
  });

  it('restores visibility, counter mode, and shadow mode after the capture', () => {
    const children = worldChildren();
    const { host, state } = makeHost(children, { postCalls: 4 });
    captureSceneCensus(host, META);
    expect(children.map((c) => c.visible)).toEqual([true, true, false, true]);
    expect(state.autoReset()).toBe(true);
    expect(state.shadowAuto()).toBe(true);
  });

  it('skips the shadow pass measurement when shadows are disabled', () => {
    const children = worldChildren();
    const { host } = makeHost(children, { shadowsEnabled: false });
    const report = captureSceneCensus(host, META);
    expect(report.shadow.measured).toBe(false);
    expect(report.shadow.calls).toBe(0);
    // no shadow render: baseline + one per bucket
    expect(report.renders).toBe(4);
    // and no shadow draws anywhere in the baseline
    expect(report.baseline.calls).toBe(35);
  });

  it('restores everything and discards the burst even when a render throws', () => {
    const children = worldChildren();
    // render 3 is the first bucket pass (after baseline + shadow), so the
    // bucket's children are hidden at the moment of the throw.
    const { host, state } = makeHost(children, { throwOnRender: 3 });
    expect(() => captureSceneCensus(host, META)).toThrow('boom');
    expect(children.map((c) => c.visible)).toEqual([true, true, false, true]);
    expect(state.autoReset()).toBe(true);
    expect(state.shadowAuto()).toBe(true);
    expect(state.discards()).toBe(1);
  });

  it('still discards and reports normally when only the trailing restore render throws', () => {
    const children = worldChildren();
    // render 6 is the presentation-only restore render after the 5
    // measurements; its throw must be swallowed and the discard still run.
    const { host, state } = makeHost(children, { postCalls: 4, throwOnRender: 6 });
    const report = captureSceneCensus(host, META);
    expect(report.baseline.calls).toBe(51);
    expect(report.renders).toBe(5);
    expect(state.discards()).toBe(1);
    expect(children.map((c) => c.visible)).toEqual([true, true, false, true]);
  });
});

describe('censusTableLines', () => {
  it('renders header, shadow, sorted buckets, and residual, skipping zero rows', () => {
    const children = worldChildren();
    children.push({ category: 'ui3d', visible: true, calls: 0, triangles: 0, shadowCalls: 0 });
    const { host } = makeHost(children, { postCalls: 4 });
    const report = captureSceneCensus(host, META);
    // zero-cost bucket present in the report data
    expect(report.rows.some((r) => r.category === 'ui3d')).toBe(true);
    const lines = censusTableLines(report);
    expect(lines[0]).toContain('census ultra');
    expect(lines[0]).toContain('calls 51');
    expect(lines[0]).toContain('prog 42');
    expect(lines[1]).toBe('pos 10,-340');
    expect(lines.some((l) => l.startsWith('shadow'))).toBe(true);
    expect(lines.some((l) => l.startsWith('foliage'))).toBe(true);
    // zero-cost bucket dropped from the table
    expect(lines.some((l) => l.startsWith('ui3d'))).toBe(false);
    expect(lines[lines.length - 1]).toContain('residual');
    // buckets appear in calls-descending order
    const foliageAt = lines.findIndex((l) => l.startsWith('foliage'));
    const propsAt = lines.findIndex((l) => l.startsWith('props'));
    expect(foliageAt).toBeGreaterThan(-1);
    expect(foliageAt).toBeLessThan(propsAt);
  });

  it('formats counts with K/M suffixes', () => {
    expect(censusCount(950)).toBe('950');
    expect(censusCount(1500)).toBe('1.5K');
    expect(censusCount(25_000)).toBe('25K');
    expect(censusCount(1_500_000)).toBe('1.5M');
    expect(censusCount(25_000_000)).toBe('25M');
  });
});

describe('createHitchTracker', () => {
  const base = { atMs: 1000, submitMs: 5, programs: 100, textures: 50, createdViews: 0 };

  it('records nothing for fast frames but still counts program growth', () => {
    const tracker = createHitchTracker();
    expect(tracker.frame({ ...base, frameMs: 10 })).toBeNull();
    expect(tracker.frame({ ...base, frameMs: 12, programs: 103 })).toBeNull();
    const s = tracker.summary();
    expect(s.frames).toBe(2);
    expect(s.hitches).toBe(0);
    expect(s.programGrowthFrames).toBe(1);
    expect(s.programsAdded).toBe(3);
  });

  it('classifies hitch causes by priority: compile over texture over view-create', () => {
    const tracker = createHitchTracker();
    tracker.frame({ ...base, frameMs: 10 });
    // program AND texture growth in the same long frame: compile wins
    const compile = tracker.frame({
      ...base,
      frameMs: 80,
      programs: 105,
      textures: 55,
      createdViews: 2,
    });
    expect(compile?.cause).toBe('shader-compile');
    expect(compile?.programDelta).toBe(5);
    expect(compile?.textureDelta).toBe(5);
    // texture growth only
    const tex = tracker.frame({ ...base, frameMs: 40, programs: 105, textures: 60 });
    expect(tex?.cause).toBe('texture-upload');
    // view creation only
    const view = tracker.frame({
      ...base,
      frameMs: 40,
      programs: 105,
      textures: 60,
      createdViews: 3,
    });
    expect(view?.cause).toBe('view-create');
    // nothing changed
    const other = tracker.frame({ ...base, frameMs: 40, programs: 105, textures: 60 });
    expect(other?.cause).toBe('other');
    const s = tracker.summary();
    expect(s.hitches).toBe(4);
    expect(s.byCause['shader-compile']).toBe(1);
    expect(s.byCause['texture-upload']).toBe(1);
    expect(s.byCause['view-create']).toBe(1);
    expect(s.byCause.other).toBe(1);
  });

  it('treats the first frame as baseline: no deltas even on a long frame', () => {
    const tracker = createHitchTracker();
    const first = tracker.frame({ ...base, frameMs: 100, programs: 300 });
    expect(first?.cause).toBe('other');
    expect(first?.programDelta).toBe(0);
    expect(tracker.summary().programsAdded).toBe(0);
  });

  it('caps the recent ring and resets cleanly', () => {
    const tracker = createHitchTracker({ recentLimit: 3 });
    for (let i = 0; i < 5; i++) {
      tracker.frame({ ...base, atMs: 1000 + i, frameMs: 50 });
    }
    const s = tracker.summary();
    expect(s.hitches).toBe(5);
    expect(s.recent.length).toBe(3);
    expect(s.recent[2].atMs).toBe(1004);
    tracker.reset();
    const cleared = tracker.summary();
    expect(cleared.frames).toBe(0);
    expect(cleared.hitches).toBe(0);
    expect(cleared.programsAdded).toBe(0);
    expect(cleared.recent).toEqual([]);
  });
});
