import { describe, expect, it } from 'vitest';
import {
  type TraceGuidancePlan,
  type TracePresentation,
  traceCircleInto,
  traceGuidanceInto,
  tracePresentationInto,
  writeTraceRibbon,
  writeTraceSparkles,
} from '../src/render/world_quest_trace_core';
import type { WorldQuestDef, WorldQuestProgress, WorldQuestTraceState } from '../src/sim/types';

const points = [
  { x: 0, z: 0 },
  { x: 10, z: 0 },
  { x: 5, z: 10 },
  { x: 0, z: 0 },
];
const definitions = {
  q: {
    objective: {
      type: 'tracing',
      instructorNpcId: 'scribe',
      shapes: [{ kind: 'triangle', points }],
    },
  },
} as unknown as Record<string, WorldQuestDef>;
const state = (phase: WorldQuestTraceState['phase'] = 'preview'): WorldQuestTraceState => ({
  questId: 'q',
  shapeIndex: 0,
  phase,
  previewUntil: 6,
  expiresAt: 100,
  trail: [],
  lastPosition: points[0],
  segment: 0,
  direction: 0,
  started: false,
});
const plan = (): TracePresentation => ({ state: null, points: null, outline: false });
const log = (tracing: WorldQuestTraceState): Map<string, WorldQuestProgress> =>
  new Map([['q', { count: 0, completed: false, tracing } as unknown as WorldQuestProgress]]);

describe('world quest tracing presentation', () => {
  it('selects only the authoritative round and rejects invalid round indexes', () => {
    const shapes = [
      { kind: 'triangle', points },
      {
        kind: 'square',
        points: [
          { x: 0, z: 0 },
          { x: 10, z: 0 },
          { x: 10, z: 10 },
          { x: 0, z: 10 },
          { x: 0, z: 0 },
        ],
      },
      {
        kind: 'star',
        points: [
          { x: 0, z: 0 },
          { x: 6, z: 10 },
          { x: -4, z: 4 },
          { x: 10, z: 4 },
          { x: 0, z: 10 },
          { x: 0, z: 0 },
        ],
      },
    ];
    const defs = {
      q: { objective: { type: 'tracing', instructorNpcId: 'scribe', shapes } },
    } as unknown as Record<string, WorldQuestDef>;
    const tracing = state();
    const progress = log(tracing);
    const out = plan();
    for (const shapeIndex of [0, 1, 2]) {
      tracing.shapeIndex = shapeIndex;
      tracePresentationInto(out, progress, defs);
      expect(out.points).toBe(shapes[shapeIndex].points);
      expect(out.outline).toBe(true);
    }
    for (const shapeIndex of [-1, 3, 0.5, Number.NaN]) {
      tracing.shapeIndex = shapeIndex;
      tracePresentationInto(out, progress, defs);
      expect(out).toEqual(plan());
    }
  });
  it.each([1, -1] as const)(
    'guides every star edge in direction %s without switching at its crossings',
    (direction) => {
      const star = [
        { x: 0, z: 0 },
        { x: 6, z: 10 },
        { x: -4, z: 4 },
        { x: 10, z: 4 },
        { x: 0, z: 10 },
        { x: 0, z: 0 },
      ];
      const tracing = state('drawing');
      tracing.started = true;
      tracing.direction = direction;
      tracing.shapeIndex = 2;
      const guide: TraceGuidancePlan = { visible: false, fromX: 0, fromZ: 0, toX: 0, toZ: 0 };
      for (let segment = 0; segment < 5; segment++) {
        tracing.segment = segment;
        const from = direction === 1 ? segment : 5 - segment;
        const to = from + direction;
        tracing.lastPosition = {
          x: (star[from].x + star[to].x) / 2,
          z: (star[from].z + star[to].z) / 2,
        };
        traceGuidanceInto(guide, tracing, star);
        expect([guide.toX, guide.toZ]).toEqual([star[to].x, star[to].z]);
        expect([guide.fromX, guide.fromZ]).toEqual([
          tracing.lastPosition.x,
          tracing.lastPosition.z,
        ]);
      }
      tracing.lastPosition = { x: 2.4, z: 4 };
      tracing.segment = direction === 1 ? 0 : 4;
      traceGuidanceInto(guide, tracing, star);
      expect([guide.toX, guide.toZ]).toEqual(direction === 1 ? [6, 10] : [0, 0]);
      tracing.segment = 2;
      traceGuidanceInto(guide, tracing, star);
      expect([guide.toX, guide.toZ]).toEqual(direction === 1 ? [10, 4] : [-4, 4]);
    },
  );
  it.each([
    [1, 0, 0, 1],
    [1, 1, 1, 2],
    [1, 2, 2, 3],
    [-1, 0, 3, 2],
    [-1, 1, 2, 1],
    [-1, 2, 1, 0],
  ] as const)(
    'guides direction %s segment %s along only its remaining authored edge',
    (direction, segment, from, to) => {
      const tracing = state('drawing');
      tracing.started = true;
      tracing.direction = direction;
      tracing.segment = segment;
      tracing.lastPosition = {
        x: (points[from].x + points[to].x) / 2,
        z: (points[from].z + points[to].z) / 2,
      };
      const guide: TraceGuidancePlan = { visible: false, fromX: 0, fromZ: 0, toX: 0, toZ: 0 };
      traceGuidanceInto(guide, tracing, points);
      expect(guide).toEqual({
        visible: true,
        fromX: tracing.lastPosition.x,
        fromZ: tracing.lastPosition.z,
        toX: points[to].x,
        toZ: points[to].z,
      });
    },
  );
  it('leads to the start first, suggests forward when undecided, then follows reverse once locked', () => {
    const tracing = state('drawing');
    tracing.lastPosition = { x: -3, z: -4 };
    const guide: TraceGuidancePlan = { visible: false, fromX: 0, fromZ: 0, toX: 0, toZ: 0 };
    traceGuidanceInto(guide, tracing, points);
    expect(guide).toEqual({ visible: true, fromX: -3, fromZ: -4, toX: 0, toZ: 0 });
    tracing.started = true;
    tracing.lastPosition = { x: 0, z: 0 };
    traceGuidanceInto(guide, tracing, points);
    expect([guide.toX, guide.toZ]).toEqual([10, 0]);
    tracing.direction = -1;
    traceGuidanceInto(guide, tracing, points);
    expect([guide.toX, guide.toZ]).toEqual([5, 10]);
  });
  it.each(['preview', 'failed', 'success'] as const)(
    'clears guidance in %s and restores it on retry',
    (phase) => {
      const tracing = state('drawing');
      const guide: TraceGuidancePlan = { visible: false, fromX: 0, fromZ: 0, toX: 0, toZ: 0 };
      traceGuidanceInto(guide, tracing, points);
      expect(guide.visible).toBe(true);
      tracing.phase = phase;
      traceGuidanceInto(guide, tracing, points);
      expect(guide.visible).toBe(false);
      tracing.phase = 'drawing';
      traceGuidanceInto(guide, tracing, points);
      expect(guide.visible).toBe(true);
      traceGuidanceInto(guide, null, null);
      expect(guide.visible).toBe(false);
    },
  );
  it('rejects stale invalid segment indexes instead of pointing across the shape', () => {
    const tracing = state('drawing');
    const guide: TraceGuidancePlan = { visible: false, fromX: 0, fromZ: 0, toX: 0, toZ: 0 };
    for (const segment of [-1, 0.5, 3, Number.NaN]) {
      tracing.segment = segment;
      traceGuidanceInto(guide, tracing, points);
      expect(guide.visible).toBe(false);
    }
  });
  it('writes bounded small gold stars ahead of progress and a larger exact corner star', () => {
    const guide: TraceGuidancePlan = { visible: true, fromX: 4, fromZ: 0, toX: 10, toZ: 0 };
    const buffer = new Float32Array(72 * 64);
    const count = writeTraceSparkles(buffer, guide, (x, z) => x + z);
    expect(count).toBeGreaterThan(24);
    expect(count).toBeLessThanOrEqual(64 * 24);
    for (let i = 0; i < count * 3; i += 3) {
      expect(buffer[i]).toBeGreaterThan(4);
      expect(buffer[i]).toBeLessThan(10);
      expect(buffer[i + 1]).toBeCloseTo(buffer[i] + buffer[i + 2] + 0.24, 5);
    }
    const corner = new Float32Array(72);
    expect(writeTraceSparkles(corner, guide, () => 0, true)).toBe(24);
    const xs = Array.from({ length: 24 }, (_, i) => corner[i * 3]);
    expect(Math.min(...xs)).toBeCloseTo(9.25);
    expect(Math.max(...xs)).toBeCloseTo(10.75);
    const tiny = new Float32Array(72);
    guide.toX = 100000;
    expect(writeTraceSparkles(tiny, guide, () => 0)).toBe(24);
    guide.visible = false;
    expect(writeTraceSparkles(tiny, guide, () => 0, true)).toBe(0);
  });
  it('shows the authoritative preview until the server changes its phase', () => {
    const out = plan();
    const tracing = state();
    const progress = log(tracing);
    tracePresentationInto(out, progress, definitions);
    expect(out.outline).toBe(true);
    expect(out.points).toBe(points);
    tracing.phase = 'drawing';
    tracePresentationInto(out, progress, definitions);
    expect(out.outline).toBe(false);
    expect(out.state).not.toBeNull();
  });
  it.each(['drawing', 'failed', 'success'] as const)(
    'uses %s state without a local timer',
    (phase) => {
      const out = plan();
      tracePresentationInto(out, log(state(phase)), definitions);
      expect(out.outline).toBe(phase === 'success');
      expect(out.state?.phase).toBe(phase);
      tracePresentationInto(out, new Map(), definitions);
      expect(out.state).toBeNull();
    },
  );
  it('hides unknown, mismatched and removed quests without retaining the previous run', () => {
    const out = plan();
    const progress = log(state());
    tracePresentationInto(out, progress, definitions);
    tracePresentationInto(out, progress, {});
    expect(out).toEqual(plan());
    const malformed = state();
    malformed.questId = 'other';
    tracePresentationInto(out, log(malformed), definitions);
    expect(out).toEqual(plan());
    tracePresentationInto(out, new Map(), definitions);
    expect(out).toEqual(plan());
  });
  it('samples both ribbon edges on the exact injected ground and bounds spacing', () => {
    const buffer = new Float32Array(1000);
    const count = writeTraceRibbon(
      buffer,
      [
        { x: 0, z: 0 },
        { x: 2, z: 0 },
      ],
      0.4,
      0.16,
      (x, z) => 2 * x + z,
    );
    expect(count).toBe(24);
    for (let i = 0; i < count * 3; i += 3) {
      expect(buffer[i + 1]).toBeCloseTo(2 * buffer[i] + buffer[i + 2] + 0.16, 5);
      expect(Math.abs(buffer[i + 2])).toBeCloseTo(0.2, 5);
    }
    expect(Math.max(...Array.from({ length: count }, (_, i) => buffer[i * 3]))).toBe(2);
  });
  it('skips degenerate/nonfinite segments and cannot exceed its fixed buffer', () => {
    const buffer = new Float32Array(18);
    expect(
      writeTraceRibbon(
        buffer,
        [
          { x: 0, z: 0 },
          { x: 0, z: 0 },
        ],
        1,
        0,
        () => 0,
      ),
    ).toBe(0);
    expect(
      writeTraceRibbon(
        buffer,
        [
          { x: 0, z: 0 },
          { x: Number.NaN, z: 0 },
        ],
        1,
        0,
        () => 0,
      ),
    ).toBe(0);
    expect(
      writeTraceRibbon(
        buffer,
        [
          { x: 0, z: 0 },
          { x: 100000, z: 0 },
        ],
        1,
        0,
        () => 0,
      ),
    ).toBe(6);
    expect([...buffer].every(Number.isFinite)).toBe(true);
  });
  it('fills a closed marker without replacing caller-owned points', () => {
    const circle = Array.from({ length: 17 }, () => ({ x: 0, z: 0 }));
    const first = circle[0];
    traceCircleInto(circle, { x: 3, z: 4 }, 2);
    expect(circle[0]).toBe(first);
    expect(circle[0].x).toBeCloseTo(circle[16].x);
    expect(circle[0].z).toBeCloseTo(circle[16].z);
    for (const point of circle) expect(Math.hypot(point.x - 3, point.z - 4)).toBeCloseTo(2);
  });
});
