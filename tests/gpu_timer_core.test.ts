import { describe, expect, it } from 'vitest';
import {
  createGpuSectionTimer,
  type GpuTimerGl,
  QUERY_RESULT,
  QUERY_RESULT_AVAILABLE,
} from '../src/render/gpu_timer_core';

// A fake WebGL2 context for the timer state machine. Queries resolve when the
// test says so, letting the suite model multi-frame result latency, disjoint
// events, and pool starvation without a GPU.
const EXT = { TIME_ELAPSED_EXT: 0x88bf, GPU_DISJOINT_EXT: 0x8fbb };

interface FakeQuery {
  id: number;
  ns: number;
  available: boolean;
  deleted: boolean;
}

function makeFakeGl() {
  const queries: FakeQuery[] = [];
  let active: FakeQuery | null = null;
  let disjoint = false;
  const beginOrder: number[] = [];
  const gl: GpuTimerGl = {
    createQuery(): object {
      const q: FakeQuery = { id: queries.length, ns: 0, available: false, deleted: false };
      queries.push(q);
      return q;
    },
    deleteQuery(query: object): void {
      (query as FakeQuery).deleted = true;
    },
    beginQuery(target: number, query: object): void {
      expect(target).toBe(EXT.TIME_ELAPSED_EXT);
      // Timer queries must never nest: the previous one has to be ended first.
      expect(active).toBeNull();
      active = query as FakeQuery;
      beginOrder.push(active.id);
    },
    endQuery(target: number): void {
      expect(target).toBe(EXT.TIME_ELAPSED_EXT);
      expect(active).not.toBeNull();
      active = null;
    },
    getQueryParameter(query: object, pname: number): unknown {
      const q = query as FakeQuery;
      if (pname === QUERY_RESULT_AVAILABLE) return q.available;
      if (pname === QUERY_RESULT) return q.ns;
      return null;
    },
    getParameter(pname: number): unknown {
      if (pname === EXT.GPU_DISJOINT_EXT) {
        const value = disjoint;
        disjoint = false; // reading resets, like the real extension
        return value;
      }
      return null;
    },
  };
  return {
    gl,
    queries,
    beginOrder,
    setDisjoint(): void {
      disjoint = true;
    },
    resolveAll(nsPerQuery: (id: number) => number): void {
      for (const q of queries) {
        if (!q.available) {
          q.ns = nsPerQuery(q.id);
          q.available = true;
        }
      }
    },
  };
}

const MS = 1e6; // ns per ms

describe('gpu_timer_core', () => {
  it('records per-section results and whole-frame totals once queries resolve', () => {
    const fake = makeFakeGl();
    const timer = createGpuSectionTimer(fake.gl, EXT);

    timer.beginFrame();
    timer.split('scene');
    timer.split('bloom');
    timer.split('smaa');
    timer.endFrame();

    // Nothing resolved yet: stats stay empty rather than blocking.
    expect(timer.stats().frames).toBe(0);

    fake.resolveAll((id) => (id === 0 ? 4 * MS : id === 1 ? 2 * MS : 1 * MS));
    timer.beginFrame(); // poll happens here
    timer.endFrame();

    const stats = timer.stats();
    expect(stats.frames).toBe(1);
    expect(stats.frameAvgMs).toBeCloseTo(7, 5);
    expect(stats.frameP95Ms).toBeCloseTo(7, 5);
    const labels = stats.sections.map((s) => s.label);
    expect(labels).toEqual(['scene', 'bloom', 'smaa']);
    expect(stats.sections[0].avgMs).toBeCloseTo(4, 5);
    expect(stats.sections[1].avgMs).toBeCloseTo(2, 5);
    expect(stats.sections[2].avgMs).toBeCloseTo(1, 5);
  });

  it('never nests queries and reuses pooled query objects across frames', () => {
    const fake = makeFakeGl();
    const timer = createGpuSectionTimer(fake.gl, EXT);

    for (let frame = 0; frame < 5; frame++) {
      fake.resolveAll(() => 1 * MS);
      timer.beginFrame();
      timer.split('scene');
      timer.split('post');
      timer.endFrame();
    }
    // 2 queries in flight per frame, resolved before the next begins: the pool
    // stabilizes instead of growing per frame.
    expect(fake.queries.length).toBeLessThanOrEqual(4);
  });

  it('drops in-flight frames on a disjoint event and counts it', () => {
    const fake = makeFakeGl();
    const timer = createGpuSectionTimer(fake.gl, EXT);

    timer.beginFrame();
    timer.split('scene');
    timer.endFrame();

    fake.setDisjoint();
    fake.resolveAll(() => 99 * MS); // results exist but are untrustworthy
    timer.beginFrame();
    timer.endFrame();

    const stats = timer.stats();
    expect(stats.disjoints).toBe(1);
    expect(stats.frames).toBe(0); // the poisoned frame never lands
  });

  it('starves gracefully when the query pool runs dry', () => {
    const fake = makeFakeGl();
    const timer = createGpuSectionTimer(fake.gl, EXT);

    // Never resolve anything: every frame leaks its queries into the pending
    // list until the pool cap stops new sections.
    let sawStarvedSplit = false;
    for (let frame = 0; frame < 40; frame++) {
      timer.beginFrame();
      timer.split('scene');
      timer.split('post');
      timer.endFrame();
      if (fake.beginOrder.length < (frame + 1) * 2) sawStarvedSplit = true;
    }
    expect(sawStarvedSplit).toBe(true);
    // Resolve everything: pending frames land, starved ones are counted.
    fake.resolveAll(() => 1 * MS);
    timer.beginFrame();
    timer.endFrame();
    expect(timer.stats().starvedFrames).toBeGreaterThan(0);
  });

  it('ignores splits outside a frame (out-of-band census/prewarm renders)', () => {
    const fake = makeFakeGl();
    const timer = createGpuSectionTimer(fake.gl, EXT);
    timer.split('scene'); // no beginFrame: must not begin a GL query
    expect(fake.beginOrder.length).toBe(0);
  });

  it('reset drops retained samples and dispose deletes pooled queries', () => {
    const fake = makeFakeGl();
    const timer = createGpuSectionTimer(fake.gl, EXT);
    timer.beginFrame();
    timer.split('scene');
    timer.endFrame();
    fake.resolveAll(() => 3 * MS);
    timer.beginFrame();
    timer.endFrame();
    expect(timer.stats().frames).toBe(1);

    timer.reset();
    expect(timer.stats().frames).toBe(0);

    timer.dispose();
    expect(fake.queries.some((q) => q.deleted)).toBe(true);
    // Disposed timers are inert.
    timer.beginFrame();
    timer.split('scene');
    timer.endFrame();
    expect(timer.stats().frames).toBe(0);
  });
});
