import { describe, expect, it } from 'vitest';
import { WORLD_QUEST_CALLIGRAPHY_QUEST } from '../src/sim/content/world_quest_calligraphy';
import type { WorldQuestTraceDef, WorldQuestTraceState } from '../src/sim/types';
import {
  createWorldQuestTrace,
  stepWorldQuestTrace,
  WORLD_QUEST_TRACE_MAX_STEP,
  WORLD_QUEST_TRACE_MAX_TRAIL_POINTS,
  WORLD_QUEST_TRACE_PREVIEW_SECONDS,
  WORLD_QUEST_TRACE_RUN_SECONDS,
  WORLD_QUEST_TRACE_TOLERANCE,
  WORLD_QUEST_TRACE_TRAIL_SPACING,
} from '../src/sim/world_quest_trace_geometry';

type Point = { x: number; z: number };
const triangle: WorldQuestTraceDef = {
  kind: 'triangle',
  points: [
    { x: 0, z: 0 },
    { x: 12, z: 0 },
    { x: 6, z: 10 },
    { x: 0, z: 0 },
  ],
};

function drawing(shape = triangle, position = shape.points[0]) {
  const state = createWorldQuestTrace('wq_trace', shape, position, 0);
  stepWorldQuestTrace(state, shape, position, 6);
  return state;
}

function walk(
  state: WorldQuestTraceState,
  points: readonly Point[],
  shape = triangle,
  time = 6.05,
): number {
  for (let edge = 1; edge < points.length; edge++) {
    const a = points[edge - 1];
    const b = points[edge];
    const samples = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.25);
    for (let i = 1; i <= samples; i++) {
      stepWorldQuestTrace(
        state,
        shape,
        { x: a.x + ((b.x - a.x) * i) / samples, z: a.z + ((b.z - a.z) * i) / samples },
        time,
      );
      time += 0.05;
    }
  }
  return time;
}

describe('world quest trace geometry', () => {
  it.each([false, true])(
    'traces the authored square and crossing star in order (reverse=%s)',
    (reverse) => {
      const objective = WORLD_QUEST_CALLIGRAPHY_QUEST.objective;
      if (objective.type !== 'tracing') throw new Error('Expected tracing objective');
      expect(objective.shapes).toHaveLength(3);
      for (let shapeIndex = 1; shapeIndex < 3; shapeIndex++) {
        const shape = objective.shapes[shapeIndex];
        const state = createWorldQuestTrace('q', shape, shape.points[0], 0, shapeIndex);
        stepWorldQuestTrace(state, shape, shape.points[0], 6);
        const path = reverse ? [...shape.points].reverse() : shape.points;
        walk(state, path, shape);
        expect(state).toMatchObject({
          phase: 'success',
          shapeIndex,
          segment: shape.points.length - 1,
        });
        expect(state.trail.length).toBeLessThanOrEqual(256);
      }
    },
  );

  it('cannot treat a star intersection as the next vertex or take another crossing edge', () => {
    const objective = WORLD_QUEST_CALLIGRAPHY_QUEST.objective;
    if (objective.type !== 'tracing') throw new Error('Expected tracing objective');
    const star = objective.shapes[2];
    const state = drawing(star);
    const first = star.points[0];
    const end = star.points[1];
    const crossing = {
      x: first.x + (end.x - first.x) * 0.38,
      z: first.z + (end.z - first.z) * 0.38,
    };
    walk(state, [first, crossing], star);
    expect(state.segment).toBe(0);
    walk(state, [crossing, star.points[2]], star, 10);
    expect(state).toMatchObject({ phase: 'failed', reason: 'off-path', segment: 0 });
  });

  it('pins fair timing, error tolerance, fixed-tick motion and bounded trail tuning', () => {
    expect([WORLD_QUEST_TRACE_PREVIEW_SECONDS, WORLD_QUEST_TRACE_RUN_SECONDS]).toEqual([4, 120]);
    expect([WORLD_QUEST_TRACE_TOLERANCE, WORLD_QUEST_TRACE_MAX_STEP]).toEqual([1.25, 1.5]);
    expect([WORLD_QUEST_TRACE_TRAIL_SPACING, WORLD_QUEST_TRACE_MAX_TRAIL_POINTS]).toEqual([
      0.35, 256,
    ]);
  });

  it.each([1, -1])('accepts a real sampled full triangle in direction %s', (direction) => {
    const state = drawing();
    walk(state, direction === 1 ? triangle.points : [...triangle.points].reverse());
    expect(state).toMatchObject({ phase: 'success', segment: 3, direction, started: true });
    expect(state.trail.length).toBeGreaterThan(50);
  });

  it('allows modest corner rounding and stops without requiring exact vertices', () => {
    const state = drawing();
    const route = [
      { x: 0, z: 0 },
      { x: 11.3, z: 0 },
      { x: 11.5, z: 0.8 },
      { x: 6.5, z: 9.2 },
      { x: 5.5, z: 9.2 },
      { x: 0.4, z: 0.6 },
    ];
    const time = walk(state, route.slice(0, 2));
    for (let i = 0; i < 40; i++) stepWorldQuestTrace(state, triangle, route[1], time + i * 0.05);
    walk(state, route.slice(1), triangle, time + 2);
    expect(state.phase).toBe('success');
  });

  it('does not record preview movement or require standing on the start when preview ends', () => {
    const state = createWorldQuestTrace('wq_trace', triangle, { x: 5, z: 5 }, 0);
    stepWorldQuestTrace(state, triangle, { x: 4, z: 5 }, 3.99);
    expect(state).toMatchObject({ phase: 'preview', trail: [], started: false });
    stepWorldQuestTrace(state, triangle, { x: 4, z: 5 }, 4);
    expect(state).toMatchObject({ phase: 'drawing', trail: [], started: false });
    walk(state, [
      { x: 4, z: 5 },
      { x: 0, z: 0 },
    ]);
    expect(state.started).toBe(true);
    expect(state.segment).toBe(0);
    walk(state, triangle.points, triangle, 10);
    expect(state.phase).toBe('success');
  });

  it('never completes by standing or jittering at the start', () => {
    const state = drawing();
    for (let i = 0; i < 1000; i++)
      stepWorldQuestTrace(state, triangle, { x: (i % 2) * 0.1, z: 0 }, 6 + i * 0.05);
    expect(state).toMatchObject({ phase: 'drawing', segment: 0, direction: 0 });
    expect(state.trail).toEqual([{ x: 0, z: 0 }]);
  });

  it('fails just outside the outline corridor and retains the exact failure endpoint', () => {
    const state = drawing();
    walk(state, [
      { x: 0, z: 0 },
      { x: 5, z: 0 },
      { x: 5, z: 1.26 },
    ]);
    expect(state).toMatchObject({ phase: 'failed', reason: 'off-path' });
    expect(state.trail.at(-1)).toEqual({ x: 5, z: 1.26 });
  });

  it('accepts the literal tolerance boundary', () => {
    const state = drawing();
    walk(state, [
      { x: 0, z: 0 },
      { x: 5, z: 0 },
      { x: 5, z: 1.25 },
    ]);
    expect(state.phase).toBe('drawing');
  });

  it.each([
    { x: 1.50001, z: 0 },
    { x: NaN, z: 0 },
    { x: 0, z: Infinity },
  ])('fails discontinuous or nonfinite movement %j', (position) => {
    const state = drawing();
    stepWorldQuestTrace(state, triangle, position, 6.05);
    expect(state).toMatchObject({ phase: 'failed', reason: 'movement', segment: 0 });
    expect(state.trail.every((p) => Number.isFinite(p.x) && Number.isFinite(p.z))).toBe(true);
  });

  it('expires at 120 seconds after the four-second preview, including waiting to start', () => {
    const state = createWorldQuestTrace('wq_trace', triangle, { x: 5, z: 5 }, 20);
    expect(state.expiresAt).toBe(144);
    stepWorldQuestTrace(state, triangle, { x: 5, z: 5 }, 143.99);
    expect(state.phase).toBe('drawing');
    stepWorldQuestTrace(state, triangle, { x: 5, z: 5 }, 144);
    expect(state).toMatchObject({ phase: 'failed', reason: 'timeout' });
  });

  it('rejects interior diagonals and cannot skip to the next vertex', () => {
    const state = drawing();
    walk(state, [
      { x: 0, z: 0 },
      { x: 6, z: 0 },
      { x: 6, z: 10 },
    ]);
    expect(state).toMatchObject({ phase: 'failed', reason: 'off-path', segment: 0 });
  });

  it('repeatedly tracing one edge cannot count as the other edges', () => {
    const state = drawing();
    walk(state, [
      { x: 0, z: 0 },
      { x: 12, z: 0 },
      { x: 0, z: 0 },
      { x: 12, z: 0 },
    ]);
    expect(state).toMatchObject({ phase: 'failed', reason: 'off-path', segment: 1 });
  });

  it('bounds a long valid trail while retaining its start and failure endpoint', () => {
    const state = drawing();
    let time = walk(state, [
      { x: 0, z: 0 },
      { x: 2, z: 0 },
    ]);
    for (let i = 0; i < 25; i++)
      time = walk(
        state,
        [
          { x: 2, z: 0 },
          { x: 10, z: 0 },
          { x: 2, z: 0 },
        ],
        triangle,
        time,
      );
    expect(state.phase).toBe('drawing');
    expect(state.trail.length).toBeLessThanOrEqual(256);
    expect(state.trail[0]).toEqual({ x: 0, z: 0 });
    stepWorldQuestTrace(state, triangle, { x: 2, z: 1.4 }, time);
    expect(state).toMatchObject({ phase: 'failed', reason: 'off-path' });
    expect(state.trail.at(-1)).toEqual({ x: 2, z: 1.4 });
    expect(state.trail.length).toBeLessThanOrEqual(256);
  });

  it('never aliases caller points and returns the same caller-owned state', () => {
    const position = { x: 0, z: 0 };
    const state = drawing(triangle, position);
    position.x = 900;
    expect(state.lastPosition).toEqual({ x: 0, z: 0 });
    expect(state.trail[0]).toEqual({ x: 0, z: 0 });
    expect(stepWorldQuestTrace(state, triangle, { x: 0.1, z: 0 }, 6.05)).toBe(state);
  });

  it('keeps terminal results frozen and independent across runs', () => {
    const first = drawing();
    const second = drawing();
    walk(first, triangle.points);
    const snapshot = structuredClone(first);
    stepWorldQuestTrace(first, triangle, { x: NaN, z: 0 }, 900);
    expect(first).toEqual(snapshot);
    expect(second).toMatchObject({ phase: 'drawing', segment: 0, trail: [{ x: 0, z: 0 }] });
  });

  it('fails malformed outlines and nonfinite initialization closed', () => {
    expect(
      createWorldQuestTrace(
        'q',
        { kind: 'triangle', points: triangle.points.slice(0, 3) },
        { x: 0, z: 0 },
        0,
      ).phase,
    ).toBe('failed');
    expect(createWorldQuestTrace('q', triangle, { x: NaN, z: 0 }, 0).reason).toBe('movement');
    expect(createWorldQuestTrace('q', triangle, { x: 0, z: 0 }, Infinity).reason).toBe('movement');
  });
});
