// Personal, authoritative tracing presentation. No clock or graphics policy of its own.
import type { WorldQuestDef, WorldQuestProgress, WorldQuestTraceState } from '../sim/types';
import { worldQuestTraceShape } from '../sim/world_quest_trace_variants';

export interface TracePoint {
  x: number;
  z: number;
}
export interface TracePresentation {
  state: WorldQuestTraceState | null;
  points: readonly TracePoint[] | null;
  outline: boolean;
}
const QUAD_CORNERS = [0, 1, 2, 1, 3, 2] as const;
const TRACE_PHASES: readonly string[] = ['preview', 'drawing', 'failed', 'success'];

export function tracePresentationInto(
  out: TracePresentation,
  log: ReadonlyMap<string, WorldQuestProgress>,
  definitions: Readonly<Record<string, WorldQuestDef>>,
): void {
  out.state = null;
  out.points = null;
  out.outline = false;
  for (const [id, progress] of log) {
    const state = progress.tracing;
    const objective = definitions[id]?.objective;
    if (!state || state.questId !== id || objective?.type !== 'tracing') continue;
    if (
      !TRACE_PHASES.includes(state.phase) ||
      !Number.isInteger(state.shapeIndex) ||
      state.shapeIndex < 0
    )
      continue;
    const shape = worldQuestTraceShape(definitions[id], state.shapeIndex, progress.traceVariant);
    if (!shape || shape.points.length < 4) continue;
    out.state = state;
    out.points = shape.points;
    out.outline = state.phase === 'success' || state.phase === 'preview';
    return;
  }
}

/** Fill a caller-owned triangle buffer. Small ground-sampled quads follow the
 * surface at BOTH edges; capacity bounds work even for corrupt distant points. */
export function writeTraceRibbon(
  buffer: Float32Array,
  points: readonly TracePoint[],
  width: number,
  lift: number,
  groundAt: (x: number, z: number) => number,
): number {
  let offset = 0;
  const capacity = Math.floor(buffer.length / 18);
  let remaining = capacity;
  for (let i = 1; i < points.length && remaining > 0; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    if (!Number.isFinite(length) || length < 0.00001) continue;
    const steps = Math.min(remaining, Math.max(1, Math.ceil(length / 0.5)));
    const nx = (-dz / length) * width * 0.5;
    const nz = (dx / length) * width * 0.5;
    for (let step = 0; step < steps; step++) {
      const ax = a.x + dx * (step / steps);
      const az = a.z + dz * (step / steps);
      const bx = a.x + dx * ((step + 1) / steps);
      const bz = a.z + dz * ((step + 1) / steps);
      // Two triangles, ordered left/right at each cross-section.
      for (const corner of QUAD_CORNERS) {
        const x = (corner < 2 ? ax : bx) + (corner % 2 === 0 ? nx : -nx);
        const z = (corner < 2 ? az : bz) + (corner % 2 === 0 ? nz : -nz);
        buffer[offset++] = x;
        buffer[offset++] = groundAt(x, z) + lift;
        buffer[offset++] = z;
      }
    }
    remaining -= steps;
  }
  return offset / 3;
}

/** Reused marker points, also terrain-draped by writeTraceRibbon. */
export function traceCircleInto(points: TracePoint[], at: TracePoint, radius: number): void {
  for (let i = 0; i < points.length; i++) {
    const angle = (i / (points.length - 1)) * Math.PI * 2;
    points[i].x = at.x + Math.cos(angle) * radius;
    points[i].z = at.z + Math.sin(angle) * radius;
  }
}

/** The next walkable edge, never a shortcut across the figure. The sim's
 * segment counts completed edges in either direction. An undecided start
 * suggests forward, but a server-locked reverse run guides the reverse edge. */
export interface TraceGuidancePlan {
  visible: boolean;
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
}

export function traceGuidanceInto(
  out: TraceGuidancePlan,
  state: WorldQuestTraceState | null,
  points: readonly TracePoint[] | null,
): void {
  out.visible = false;
  if (state?.phase !== 'drawing' || !points || points.length < 4) return;
  const edgeCount = points.length - 1;
  if (!Number.isInteger(state.segment) || state.segment < 0 || state.segment >= edgeCount) return;
  if (!Number.isFinite(state.lastPosition.x) || !Number.isFinite(state.lastPosition.z)) return;
  let from = state.lastPosition;
  let to = points[0];
  if (state.started) {
    const direction = state.direction === -1 ? -1 : 1;
    const index = direction === 1 ? state.segment : edgeCount - state.segment;
    from = points[index];
    to = points[index + direction];
  }
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const lengthSq = dx * dx + dz * dz;
  if (!Number.isFinite(lengthSq)) return;
  // Keep the blue completed stroke uncovered: only the remaining edge gets
  // guide stars, projected onto the exact authored line, not onto a shortcut
  // from the player's tolerated off-centre foot position to the corner.
  const progress =
    state.started && lengthSq > 0
      ? Math.max(
          0,
          Math.min(
            1,
            ((state.lastPosition.x - from.x) * dx + (state.lastPosition.z - from.z) * dz) /
              lengthSq,
          ),
        )
      : 0;
  out.fromX = from.x + dx * progress;
  out.fromZ = from.z + dz * progress;
  out.toX = to.x;
  out.toZ = to.z;
  out.visible = true;
}

const SPARKLE_FLOATS = 72; // eight triangle-fan faces, position only
const SPARKLE_STEP = 1.1;

/** One four-point sparkle, ground-sampled at every vertex. Buffers are owned
 * by the caller and all live stars use the already-gated plain gold material. */
function writeSparkle(
  buffer: Float32Array,
  offset: number,
  x: number,
  z: number,
  radius: number,
  groundAt: (x: number, z: number) => number,
): number {
  for (let face = 0; face < 8; face++) {
    for (let vertex = 0; vertex < 3; vertex++) {
      const index = face + vertex - 1;
      const angle = (index * Math.PI) / 4;
      const reach = vertex === 0 ? 0 : index % 2 === 0 ? radius : radius * 0.24;
      const px = x + Math.cos(angle) * reach;
      const pz = z + Math.sin(angle) * reach;
      buffer[offset++] = px;
      buffer[offset++] = groundAt(px, pz) + 0.24;
      buffer[offset++] = pz;
    }
  }
  return offset;
}

/** Bounded, evenly spaced breadcrumbs, excluding both the player's completed
 * stroke and the larger corner marker. No timers, lights or tier-dependent loss. */
export function writeTraceSparkles(
  buffer: Float32Array,
  plan: TraceGuidancePlan,
  groundAt: (x: number, z: number) => number,
  corner = false,
): number {
  if (!plan.visible || buffer.length < SPARKLE_FLOATS) return 0;
  if (corner) return writeSparkle(buffer, 0, plan.toX, plan.toZ, 0.75, groundAt) / 3;
  const dx = plan.toX - plan.fromX;
  const dz = plan.toZ - plan.fromZ;
  const length = Math.hypot(dx, dz);
  if (!Number.isFinite(length) || length <= SPARKLE_STEP) return 0;
  const count = Math.min(
    Math.floor(buffer.length / SPARKLE_FLOATS),
    Math.ceil(length / SPARKLE_STEP) - 1,
  );
  let offset = 0;
  for (let i = 1; i <= count; i++) {
    const fraction = i / (count + 1);
    offset = writeSparkle(
      buffer,
      offset,
      plan.fromX + dx * fraction,
      plan.fromZ + dz * fraction,
      0.27,
      groundAt,
    );
  }
  return offset / 3;
}
