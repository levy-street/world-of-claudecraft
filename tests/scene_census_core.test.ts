// Scene census core (src/render/scene_census_core.ts): the measured
// per-bucket breakdown behind the ?perf overlay's census button, and the
// hitch tracker correlating long frames with program/texture growth.
//
// The fake host models three's counter semantics: autoReset=true zeroes the
// counters at render start; autoReset=false accumulates across renders (the
// census switches to manual mode so shadow-pass draws survive the read on
// every tier), and the shadow pass only renders while shadowAutoUpdate holds.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GC_DROP_MIN_MB } from '../src/game/heap_sawtooth';
import type { DrawStatsCounters } from '../src/render/draw_stats_core';
import {
  captureSceneCensus,
  censusCount,
  censusTableLines,
  createHitchTracker,
  HITCH_GC_DROP_MIN_MB,
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
      // three r185 semantics: with autoReset on, render() calls info.reset()
      // at the TOP of the pass, before the shadow pass (r165 reset after it).
      // Under auto-reset a post-render read therefore holds only this
      // render's counters, which zeroes the census's cross-render diffs; the
      // census must hold the counters in manual-reset mode either way.
      if (autoReset) counters = zero();
      if (shadowsEnabled && shadowAuto) {
        for (const c of children) {
          if (c.visible) counters.calls += c.shadowCalls;
        }
      }
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
    // Decisive: under auto-reset every render() zeroes the counters, so the
    // census's cross-render visibility diffs would collapse; the nonzero
    // shadow share exists only because the capture held manual mode.
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
  // rendererMs is the whole frame by default: the callback owns the stall,
  // so the resource rules decide; the off-frame cases lower it explicitly.
  // heapMb is unknown (0) by default, as on every non-Chrome browser; the gc
  // cases feed a real reading.
  const base = {
    atMs: 1000,
    submitMs: 5,
    programs: 100,
    textures: 50,
    createdViews: 0,
    zoneBuildMs: 0,
    viewBuildMs: 0,
    rendererMs: 250,
    heapMb: 0,
  };

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
    expect(s.byCause['zone-build']).toBe(0);
    expect(s.byCause['off-frame']).toBe(0);
  });

  it('files a frame with zone build spend under zone-build, ahead of view-create', () => {
    const tracker = createHitchTracker();
    tracker.frame({ ...base, frameMs: 10 });
    const zone = tracker.frame({ ...base, frameMs: 60, zoneBuildMs: 41.234, createdViews: 3 });
    expect(zone?.cause).toBe('zone-build');
    expect(zone?.zoneBuildMs).toBe(41.23);
    // Resource growth still wins over the ledger: a compile in the same frame
    // is the older, surer signal.
    const compile = tracker.frame({ ...base, frameMs: 60, zoneBuildMs: 41, programs: 101 });
    expect(compile?.cause).toBe('shader-compile');
    const upload = tracker.frame({
      ...base,
      frameMs: 60,
      zoneBuildMs: 41,
      programs: 101,
      textures: 51,
    });
    expect(upload?.cause).toBe('texture-upload');
    // No zone spend: the arm does not fire.
    const view = tracker.frame({
      ...base,
      frameMs: 60,
      programs: 101,
      textures: 51,
      createdViews: 1,
    });
    expect(view?.cause).toBe('view-create');
    expect(tracker.summary().byCause['zone-build']).toBe(1);
  });

  it('weighs the two construction ledgers: the heavier one owns the frame', () => {
    const tracker = createHitchTracker();
    tracker.frame({ ...base, frameMs: 10 });
    // A 0.3 ms zone step beside 50 ms of view builds is the views' hitch,
    // whatever the created count says.
    const views = tracker.frame({ ...base, frameMs: 60, zoneBuildMs: 0.3, viewBuildMs: 50 });
    expect(views?.cause).toBe('view-create');
    expect(views?.viewBuildMs).toBe(50);
    expect(views?.zoneBuildMs).toBe(0.3);
    // View spend alone, no created count (a mount or a form built on an
    // existing view): still the views' hitch.
    expect(tracker.frame({ ...base, frameMs: 60, viewBuildMs: 12 })?.cause).toBe('view-create');
    // A created view with no ledger spend at all still files view-create.
    expect(tracker.frame({ ...base, frameMs: 60, createdViews: 1 })?.cause).toBe('view-create');
    // The zone side wins at or above the view side.
    expect(
      tracker.frame({ ...base, frameMs: 60, zoneBuildMs: 30, viewBuildMs: 30, createdViews: 2 })
        ?.cause,
    ).toBe('zone-build');
    expect(tracker.frame({ ...base, frameMs: 60, zoneBuildMs: 31, viewBuildMs: 30 })?.cause).toBe(
      'zone-build',
    );
    // Resource growth still outranks both ledgers.
    expect(
      tracker.frame({ ...base, frameMs: 60, zoneBuildMs: 1, viewBuildMs: 50, textures: 51 })?.cause,
    ).toBe('texture-upload');
    const s = tracker.summary();
    expect(s.byCause['view-create']).toBe(3);
    expect(s.byCause['zone-build']).toBe(2);
    expect(s.byCause['texture-upload']).toBe(1);
  });

  it('files a stall the frame callback did not own under off-frame', () => {
    const tracker = createHitchTracker();
    tracker.frame({ ...base, frameMs: 10 });
    // 20 of 100 ms inside the callback: the other 80 passed elsewhere.
    const off = tracker.frame({ ...base, frameMs: 100, rendererMs: 20 });
    expect(off?.cause).toBe('off-frame');
    expect(off?.rendererMs).toBe(20);
    // Exactly half stays with the callback (other): the share is a strict floor.
    const half = tracker.frame({ ...base, frameMs: 100, rendererMs: 50 });
    expect(half?.cause).toBe('other');
    // A named cause beats off-frame even when the callback was short.
    const view = tracker.frame({ ...base, frameMs: 100, rendererMs: 20, createdViews: 1 });
    expect(view?.cause).toBe('view-create');
    const zone = tracker.frame({ ...base, frameMs: 100, rendererMs: 20, zoneBuildMs: 5 });
    expect(zone?.cause).toBe('zone-build');
    expect(tracker.summary().byCause['off-frame']).toBe(1);
    expect(tracker.summary().byCause.other).toBe(1);
  });

  it('mirrors the heap sawtooth quantization floor (render cannot import game/)', () => {
    expect(HITCH_GC_DROP_MIN_MB).toBe(GC_DROP_MIN_MB);
    expect(HITCH_GC_DROP_MIN_MB).toBe(2);
  });

  it('files a long frame in which the heap shrank under gc, carrying the drop size', () => {
    const tracker = createHitchTracker();
    tracker.frame({ ...base, frameMs: 10, heapMb: 200 });
    const gc = tracker.frame({ ...base, frameMs: 60, heapMb: 158.766 });
    expect(gc?.cause).toBe('gc');
    expect(gc?.heapDropMb).toBe(41.2);
    // Growth is allocation, not a collection: the drop stays at zero and the
    // frame falls through to the callback-share rule.
    const grow = tracker.frame({ ...base, frameMs: 60, heapMb: 190 });
    expect(grow?.cause).toBe('other');
    expect(grow?.heapDropMb).toBe(0);
    // A dip under the quantization floor is noise, not a collection: the event
    // still carries it, but it does not decide the cause.
    const noise = tracker.frame({ ...base, frameMs: 60, heapMb: 190 - HITCH_GC_DROP_MIN_MB + 0.1 });
    expect(noise?.cause).toBe('other');
    expect(noise?.heapDropMb).toBe(1.9);
    // Exactly the floor files: the floor is inclusive.
    const atFloor = tracker.frame({ ...base, frameMs: 60, heapMb: 188.1 - HITCH_GC_DROP_MIN_MB });
    expect(atFloor?.cause).toBe('gc');
    expect(atFloor?.heapDropMb).toBe(2);
    expect(tracker.summary().byCause.gc).toBe(2);
    expect(tracker.summary().byCause.other).toBe(2);
  });

  it('ranks gc below every named resource and above off-frame', () => {
    const tracker = createHitchTracker();
    tracker.frame({ ...base, frameMs: 10, heapMb: 200 });
    const view = tracker.frame({ ...base, frameMs: 100, heapMb: 150, createdViews: 1 });
    expect(view?.cause).toBe('view-create');
    expect(view?.heapDropMb).toBe(50);
    const zone = tracker.frame({ ...base, frameMs: 100, heapMb: 100, zoneBuildMs: 5 });
    expect(zone?.cause).toBe('zone-build');
    // The callback owned 20 of 100 ms, but the heap shrank: the collection is
    // the named suspect, not the anonymous off-frame bucket.
    const gc = tracker.frame({ ...base, frameMs: 100, heapMb: 60, rendererMs: 20 });
    expect(gc?.cause).toBe('gc');
    const off = tracker.frame({ ...base, frameMs: 100, heapMb: 70, rendererMs: 20 });
    expect(off?.cause).toBe('off-frame');
    expect(off?.heapDropMb).toBe(0);
    // A sub-floor dip does not rescue the frame from off-frame either.
    const dip = tracker.frame({ ...base, frameMs: 100, heapMb: 69, rendererMs: 20 });
    expect(dip?.cause).toBe('off-frame');
    expect(dip?.heapDropMb).toBe(1);
  });

  it('never files gc from an unknown heap, and an unknown sample leaves the baseline alone', () => {
    const tracker = createHitchTracker();
    // No reading at all (non-Chrome): long frames never become gc.
    tracker.frame({ ...base, frameMs: 10 });
    expect(tracker.frame({ ...base, frameMs: 60 })?.cause).toBe('other');
    // A known baseline, then a 0 sample: no drop, and the baseline survives it,
    // so the next real reading still measures against 200.
    tracker.frame({ ...base, frameMs: 10, heapMb: 200 });
    const unknown = tracker.frame({ ...base, frameMs: 60, heapMb: 0 });
    expect(unknown?.cause).toBe('other');
    expect(unknown?.heapDropMb).toBe(0);
    const next = tracker.frame({ ...base, frameMs: 60, heapMb: 150 });
    expect(next?.cause).toBe('gc');
    expect(next?.heapDropMb).toBe(50);
    expect(tracker.summary().byCause.gc).toBe(1);
  });

  it('treats the first frame as baseline: no deltas even on a long frame', () => {
    const tracker = createHitchTracker();
    const first = tracker.frame({ ...base, frameMs: 100, programs: 300, heapMb: 200 });
    expect(first?.cause).toBe('other');
    expect(first?.programDelta).toBe(0);
    expect(first?.heapDropMb).toBe(0);
    expect(tracker.summary().programsAdded).toBe(0);
    expect(tracker.summary().byCause.gc).toBe(0);
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
    expect(cleared.byCause).toEqual({
      'shader-compile': 0,
      'texture-upload': 0,
      'zone-build': 0,
      'view-create': 0,
      gc: 0,
      'off-frame': 0,
      other: 0,
    });
    // The heap baseline resets with the counters: the first reading after a
    // reset is a baseline again, never a drop against the old run.
    tracker.frame({ ...base, frameMs: 10, heapMb: 200 });
    tracker.reset();
    expect(tracker.frame({ ...base, frameMs: 60, heapMb: 100 })?.cause).toBe('other');
  });
});

describe('the fake host models the installed three reset ordering', () => {
  it('pins info.reset() ahead of the shadow pass in the shipped renderer', () => {
    // The stub above encodes r185 ordering (reset at the top of render(),
    // before shadowMap.render); this source pin stops a future three train
    // from silently invalidating the fixture the way r165's ordering did.
    const renderer = readFileSync(
      path.resolve(__dirname, '../node_modules/three/src/renderers/WebGLRenderer.js'),
      'utf8',
    );
    const resetAt = renderer.indexOf('if ( this.info.autoReset === true ) this.info.reset();');
    const shadowAt = renderer.indexOf('shadowMap.render(');
    expect(resetAt).toBeGreaterThan(-1);
    expect(shadowAt).toBeGreaterThan(-1);
    expect(resetAt).toBeLessThan(shadowAt);
  });
});
