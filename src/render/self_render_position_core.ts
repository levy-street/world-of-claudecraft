// The local player's DISPLAY pose, one frame at a time: the intent-driven
// predictor while it owns the position, the lead-smoothed authoritative
// interpolation otherwise, and the one-time offset that hands them over
// without a camera step. Pure ({x,y,z} in and out, no Three), so the renderer
// is a thin consumer and a headless latency harness can drive the same math.

import type { Entity } from '../sim/types';
import {
  SELF_MOTION_SNAP_DIST_SQ,
  type SelfMotionFrame,
  SelfMotionPredictor,
  updateSelfRenderFallback,
  type Vec3Like,
} from './self_motion';

// Decay rate of the one-time offset captured when the self-motion predictor
// takes over from the lead-smoothing path (gone in ~0.3 s, no camera step).
const SELF_MOTION_HANDOFF_RATE = 15;
export const MAX_SELF_REWIND_YD_PER_SEC = 12;

function decayOffset(offset: Vec3Like, dt: number, maxDistance = Number.POSITIVE_INFINITY): void {
  const decayShare = 1 - Math.exp(-SELF_MOTION_HANDOFF_RATE * Math.max(0, dt));
  const decayDistance = Math.hypot(offset.x, offset.y, offset.z) * decayShare;
  const appliedShare =
    decayDistance > maxDistance && decayDistance > 0
      ? decayShare * (maxDistance / decayDistance)
      : decayShare;
  offset.x *= 1 - appliedShare;
  offset.y *= 1 - appliedShare;
  offset.z *= 1 - appliedShare;
}

/**
 * The handoff-offset teleport rule. The offset exists to hide a SMALL gap
 * between the drawn pose and the pose that takes over (a predictor lead, a
 * reconcile correction), decayed so the camera glides instead of stepping.
 * A gap no real motion could open in one frame is a teleport (dungeon exit,
 * hearth, graveyard release, rift or delve exit, unstuck) and must never be
 * glided: decaying it drew the body flying across the map. Same six-yard rule
 * the other whole-pose smoothers apply (self_motion.ts SELF_MOTION_SNAP_DIST_SQ,
 * camera_boom_core.ts BOOM_SNAP_DIST; the step smoother's STEP_SMOOTH_SNAP is a
 * separate, tighter vertical-only rule), and the same margin: the fastest
 * plausible mover (23.1 yd/s, entity_reanchor.ts) over the main loop's 0.25 s
 * frame clamp covers 5.8 yd, so one frame of real motion never trips it.
 */
export function isTeleportGap(dx: number, dy: number, dz: number): boolean {
  return dx * dx + dy * dy + dz * dz > SELF_MOTION_SNAP_DIST_SQ;
}

/**
 * Did the pose the display is anchored to jump a teleport this frame? Both
 * paths draw `position = target + offset`, so `position - offset` is last
 * frame's target on x and z, and the gap to the new one is the AUTHORITATIVE
 * jump alone. Measuring from the drawn pose instead would count the decaying
 * offset too, and a legitimately accumulated offset (handoff plus a run of
 * reconcile residuals) could then read as a teleport and pop. Two small
 * display terms do ride along in `position`: the renderer writes the step
 * smoother's y back into it (bounded by STEP_SMOOTH_MAX_LAG), and on the plain
 * fallback path it is the lead-smoothed pose; both stay well inside the margin
 * above, so neither can turn real motion into a snap.
 */
function targetJumpedTeleport(
  state: SelfRenderPositionState,
  tx: number,
  ty: number,
  tz: number,
): boolean {
  return (
    state.ready &&
    isTeleportGap(
      state.position.x - state.offset.x - tx,
      state.position.y - state.offset.y - ty,
      state.position.z - state.offset.z - tz,
    )
  );
}

function clearOffset(offset: Vec3Like): void {
  offset.x = 0;
  offset.y = 0;
  offset.z = 0;
}

export interface ReconciledSelfPrediction {
  kind: 'reconciled';
  position: Vec3Like;
  residual: Vec3Like | null;
}

export type SelfRenderPrediction = SelfMotionFrame | ReconciledSelfPrediction;

export function selfSnapshotAlpha(alpha: number, lead: number): number {
  return Math.min(1.25, alpha + Math.max(0, lead));
}

export interface SelfRenderPositionState {
  /** The pose the frame draws. The caller owns the object, so the renderer can
   *  pass the THREE.Vector3 the camera and the entity loop already read (and
   *  keep writing, as the step-smoothing pass does). */
  position: Vec3Like;
  /** Predictor-handoff gap, captured once and decayed to zero. */
  offset: Vec3Like;
  ready: boolean;
  active: boolean;
  lastSelfId: number | null;
  predictor: SelfMotionPredictor | null;
}

export function createSelfRenderPositionState(
  position: Vec3Like = { x: 0, y: 0, z: 0 },
): SelfRenderPositionState {
  return {
    position,
    offset: { x: 0, y: 0, z: 0 },
    ready: false,
    active: false,
    lastSelfId: null,
    predictor: null,
  };
}

/**
 * Bind the display pose to the character it belongs to. Returns true on the
 * frame the identity changed, when the caller must also drop its own
 * per-character carry-over.
 */
export function noteSelfIdentity(state: SelfRenderPositionState, selfId: number): boolean {
  if (state.lastSelfId === selfId) return false;
  state.lastSelfId = selfId;
  state.ready = false;
  // A still-decaying predictor-handoff offset belongs to the previous
  // character; leaking it would displace the new one for a few frames.
  state.offset.x = 0;
  state.offset.y = 0;
  state.offset.z = 0;
  return true;
}

export function updateSelfRenderPosition(
  state: SelfRenderPositionState,
  p: Entity,
  seed: number,
  alpha: number,
  dt: number,
  selfAlphaLead: number,
  selfMotion: SelfRenderPrediction | null,
  authoritativeDiscontinuity: boolean,
  riftCollisionToken = 0,
): Vec3Like {
  // Online intent-driven extrapolation: when active it owns the position and
  // the lead-smoothing path below becomes the fallback (both write the same
  // position, so enable/disable hands off without a pop, absorbed by the
  // snap/smooth rules on the next frame).
  if (selfMotion) {
    const reconciled = selfMotion as Partial<ReconciledSelfPrediction>;
    let predicted = reconciled.position ?? null;
    if (reconciled.kind !== 'reconciled') {
      if (!state.predictor) state.predictor = new SelfMotionPredictor(seed, riftCollisionToken);
      predicted = state.predictor.step(
        p,
        selfMotion as SelfMotionFrame,
        authoritativeDiscontinuity,
      );
    }
    if (predicted) {
      // Follow the predictor output exactly (it is already continuous;
      // smoothing it again would re-add the display lag this exists to
      // remove). The only discontinuity is the handoff frame from the
      // lead-smoothing path below: capture that gap once as an offset and
      // decay it, so the camera glides instead of stepping.
      // A teleport is not a handoff: when the new pose sits a teleport away
      // from the drawn one (the predictor re-adopted a jumped anchor, or a
      // v2 reconcile replayed onto a jumped acknowledgement), adopt it
      // outright, residual included, exactly like an authoritative
      // discontinuity.
      const discontinuity =
        authoritativeDiscontinuity ||
        targetJumpedTeleport(state, predicted.x, predicted.y, predicted.z);
      if (discontinuity) {
        clearOffset(state.offset);
      } else if (state.ready && !state.active) {
        state.offset.x = state.position.x - predicted.x;
        state.offset.y = state.position.y - predicted.y;
        state.offset.z = state.position.z - predicted.z;
      }
      const residual = reconciled.kind === 'reconciled' ? reconciled.residual : null;
      if (residual && !discontinuity && !isTeleportGap(residual.x, residual.y, residual.z)) {
        state.offset.x += residual.x;
        state.offset.y += residual.y;
        state.offset.z += residual.z;
      }
      decayOffset(state.offset, dt);
      state.position.x = predicted.x + state.offset.x;
      state.position.y = predicted.y + state.offset.y;
      state.position.z = predicted.z + state.offset.z;
      state.ready = true;
      state.active = true;
      return state.position;
    }
  }
  const predictorWasActive = state.active;
  state.active = false;
  const playerAlpha = selfSnapshotAlpha(alpha, selfAlphaLead);
  const px = p.prevPos.x + (p.pos.x - p.prevPos.x) * playerAlpha;
  const py = p.prevPos.y + (p.pos.y - p.prevPos.y) * playerAlpha;
  const pz = p.prevPos.z + (p.pos.z - p.prevPos.z) * playerAlpha;
  // The same teleport rule as the predictor path: a handoff gap (prediction
  // suspending on the teleport frame) or a mid-decay target jump of teleport
  // size adopts the authoritative pose outright instead of rewinding toward
  // it at MAX_SELF_REWIND_YD_PER_SEC.
  const discontinuity = authoritativeDiscontinuity || targetJumpedTeleport(state, px, py, pz);
  if (discontinuity) {
    clearOffset(state.offset);
  } else if (state.ready && predictorWasActive) {
    state.offset.x = state.position.x - px;
    state.offset.y = state.position.y - py;
    state.offset.z = state.position.z - pz;
  }
  if (
    !discontinuity &&
    (predictorWasActive || state.offset.x !== 0 || state.offset.y !== 0 || state.offset.z !== 0)
  ) {
    const previousX = state.position.x;
    const previousY = state.position.y;
    const previousZ = state.position.z;
    const offsetLength = Math.hypot(state.offset.x, state.offset.y, state.offset.z);
    const rewindX = offsetLength > 0 ? state.offset.x / offsetLength : 0;
    const rewindY = offsetLength > 0 ? state.offset.y / offsetLength : 0;
    const rewindZ = offsetLength > 0 ? state.offset.z / offsetLength : 0;
    decayOffset(state.offset, dt, MAX_SELF_REWIND_YD_PER_SEC * Math.max(0, dt));
    const tentativeX = px + state.offset.x;
    const tentativeY = py + state.offset.y;
    const tentativeZ = pz + state.offset.z;
    const totalRewind =
      (previousX - tentativeX) * rewindX +
      (previousY - tentativeY) * rewindY +
      (previousZ - tentativeZ) * rewindZ;
    const maxRewind = MAX_SELF_REWIND_YD_PER_SEC * Math.max(0, dt);
    if (totalRewind > maxRewind) {
      const excess = totalRewind - maxRewind;
      state.offset.x += rewindX * excess;
      state.offset.y += rewindY * excess;
      state.offset.z += rewindZ * excess;
    }
    state.position.x = px + state.offset.x;
    state.position.y = py + state.offset.y;
    state.position.z = pz + state.offset.z;
    state.ready = true;
    return state.position;
  }
  updateSelfRenderFallback(
    state.position,
    px,
    py,
    pz,
    state.ready,
    dt,
    selfAlphaLead > 0,
    discontinuity,
  );
  state.ready = true;
  return state.position;
}
