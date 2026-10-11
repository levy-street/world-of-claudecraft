// Pure, fixed-tick outline matching. All mutable progress belongs to the supplied
// run; sampled presentation trails never determine quest completion.
import type { WorldQuestTraceDef, WorldQuestTraceState } from './types';

export const WORLD_QUEST_TRACE_PREVIEW_SECONDS = 4;
/** Extra memorization time per corner past a simple four-point figure. */
export const WORLD_QUEST_TRACE_PREVIEW_PER_CORNER_SECONDS = 0.4;

/** A complex sigil earns a longer look: the base clock plus a little per corner. */
export function worldQuestTracePreviewSeconds(shape: WorldQuestTraceDef): number {
  const corners = Math.max(0, shape.points.length - 4);
  return WORLD_QUEST_TRACE_PREVIEW_SECONDS + WORLD_QUEST_TRACE_PREVIEW_PER_CORNER_SECONDS * corners;
}
export const WORLD_QUEST_TRACE_RUN_SECONDS = 120;
export const WORLD_QUEST_TRACE_TOLERANCE = 1.25;
export const WORLD_QUEST_TRACE_MAX_STEP = 1.5;
export const WORLD_QUEST_TRACE_TRAIL_SPACING = 0.35;
export const WORLD_QUEST_TRACE_MAX_TRAIL_POINTS = 256;

type Point = { x: number; z: number };
const finite = (p: Point): boolean => Number.isFinite(p.x) && Number.isFinite(p.z);
const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.z - b.z);

function validShape(shape: WorldQuestTraceDef): boolean {
  const points = shape.points;
  return (
    points.length >= 4 &&
    points.every(finite) &&
    distance(points[0], points[points.length - 1]) === 0 &&
    points.slice(1).every((p, i) => distance(points[i], p) > 2 * WORLD_QUEST_TRACE_TOLERANCE)
  );
}

function edgeDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const fraction = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)),
  );
  return Math.hypot(p.x - a.x - fraction * dx, p.z - a.z - fraction * dz);
}

function appendTrail(state: WorldQuestTraceState, position: Point, force = false): void {
  const last = state.trail[state.trail.length - 1];
  const delta = last ? distance(last, position) : Infinity;
  if (delta === 0 || (!force && delta < WORLD_QUEST_TRACE_TRAIL_SPACING)) return;
  if (state.trail.length >= WORLD_QUEST_TRACE_MAX_TRAIL_POINTS) {
    // Preserve the start and the whole outline, not just its most recent tail.
    state.trail = state.trail.filter((_, i) => i % 2 === 0 || i === state.trail.length - 1);
  }
  state.trail.push({ ...position });
}

function fail(
  state: WorldQuestTraceState,
  reason: WorldQuestTraceState['reason'],
  position?: Point,
): WorldQuestTraceState {
  state.phase = 'failed';
  state.reason = reason;
  if (position && finite(position)) appendTrail(state, position, true);
  return state;
}

export function createWorldQuestTrace(
  questId: string,
  shape: WorldQuestTraceDef,
  position: Point,
  time: number,
  shapeIndex = 0,
): WorldQuestTraceState {
  const startTime = Number.isFinite(time) ? time : 0;
  const preview = worldQuestTracePreviewSeconds(shape);
  const state: WorldQuestTraceState = {
    questId,
    shapeIndex,
    phase: 'preview',
    previewUntil: startTime + preview,
    expiresAt: startTime + preview + WORLD_QUEST_TRACE_RUN_SECONDS,
    trail: [],
    lastPosition: finite(position) ? { ...position } : { x: 0, z: 0 },
    segment: 0,
    direction: 0,
    started: false,
  };
  if (!finite(position) || !Number.isFinite(time)) return fail(state, 'movement');
  if (!validShape(shape)) return fail(state, 'off-path');
  return state;
}

/** Mutates and returns the caller-owned run. Invoke once per authoritative 20 Hz tick. */
export function stepWorldQuestTrace(
  state: WorldQuestTraceState,
  shape: WorldQuestTraceDef,
  position: Point,
  time: number,
): WorldQuestTraceState {
  if (state.phase === 'failed' || state.phase === 'success') return state;
  if (!finite(position) || !Number.isFinite(time)) return fail(state, 'movement');
  if (!validShape(shape)) return fail(state, 'off-path', position);
  if (time >= state.expiresAt) return fail(state, 'timeout', position);
  const previous = state.lastPosition;
  state.lastPosition = { ...position };
  if (time < state.previewUntil) return state;
  state.phase = 'drawing';
  if (distance(previous, position) > WORLD_QUEST_TRACE_MAX_STEP)
    return fail(state, 'movement', position);
  const points = shape.points;
  const edgeCount = points.length - 1;
  const startDistance = distance(position, points[0]);
  if (!state.started) {
    if (startDistance > WORLD_QUEST_TRACE_TOLERANCE) return state;
    state.started = true;
    state.metrics = { startedAt: time, distance: 0, deviationDistance: 0 };
    appendTrail(state, position, true);
    return state;
  }
  appendTrail(state, position);
  if (state.direction === 0) {
    // Turning or waiting on the start marker cannot advance a single edge.
    if (startDistance <= WORLD_QUEST_TRACE_TOLERANCE) return state;
    const forward = edgeDistance(position, points[0], points[1]);
    const reverse = edgeDistance(position, points[0], points[edgeCount - 1]);
    if (Math.min(forward, reverse) > WORLD_QUEST_TRACE_TOLERANCE)
      return fail(state, 'off-path', position);
    state.direction = forward <= reverse ? 1 : -1;
  }
  const from = state.direction === 1 ? state.segment : edgeCount - state.segment;
  const to = from + state.direction;
  if (state.metrics) {
    const moved = distance(previous, position);
    state.metrics.distance += moved;
    state.metrics.deviationDistance += moved * edgeDistance(position, points[from], points[to]);
  }
  // A capsule around ONLY the expected edge forbids crossing the interior or
  // walking a different edge repeatedly to accumulate distance as false credit.
  if (edgeDistance(position, points[from], points[to]) > WORLD_QUEST_TRACE_TOLERANCE) {
    return fail(state, 'off-path', position);
  }
  if (distance(position, points[to]) <= WORLD_QUEST_TRACE_TOLERANCE) {
    state.segment++;
    if (state.segment === edgeCount) {
      appendTrail(state, position, true);
      state.phase = 'success';
    }
  }
  return state;
}
