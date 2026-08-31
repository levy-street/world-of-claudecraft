// Pure per-frame fade policy for hideable objects that cross the eye-to-camera
// segment. Subjects behind an occluder become readable immediately; restoration
// eases back to opaque once the segment clears. Scene geometry never changes
// the requested chase-camera distance.

/** Opacity an occluding structure settles at while it blocks the view. */
export const OCCLUDER_FADE_ALPHA = 0.2;
/** Ease rate back to opaque (slower, so reappearing structures read calm). */
export const OCCLUDER_FADE_IN_RATE = 6;
// Snap distance: within this of the target the fade completes exactly, so
// consumers can rely on `alpha === 1` to restore original material state.
const SNAP = 0.01;

/**
 * Advance one occluder's fade alpha. Occlusion snaps to the ghost target on
 * the first frame so information timing is tier-independent; restoration is
 * exponential unless reduced motion asks for a direct state change. `floor`
 * is the occluded resting alpha: the default 20% ghost, or 0 for the raid
 * shells' backface cull, which hides the wall outright.
 */
export function stepOccluderFade(
  alpha: number,
  occluded: boolean,
  dt: number,
  reducedMotion = false,
  floor = OCCLUDER_FADE_ALPHA,
): number {
  const target = occluded ? floor : 1;
  const start = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 1;
  if (dt <= 0) return start;
  if (occluded || reducedMotion) return target;
  const next = start + (target - start) * (1 - Math.exp(-OCCLUDER_FADE_IN_RATE * dt));
  return Math.abs(next - target) <= SNAP ? target : next;
}

/** Whether a fade is at rest for its current occlusion state (no work left). */
export function occluderFadeSettled(
  alpha: number,
  occluded: boolean,
  floor = OCCLUDER_FADE_ALPHA,
): boolean {
  return alpha === (occluded ? floor : 1);
}

/**
 * Whether the eye-to-camera segment crosses an axis-aligned box footprint
 * below its top (all coordinates in one space; XZ slab test, Y checked at the
 * entry point). Either endpoint standing inside the footprint below the top
 * also counts as a hit, mirroring the prop/tree footprint tests.
 */
export function occluderSegmentHitsBox(
  boxX: number,
  boxZ: number,
  halfW: number,
  halfD: number,
  topY: number,
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  camX: number,
  camY: number,
  camZ: number,
): boolean {
  const eyeInside = Math.abs(eyeX - boxX) < halfW && Math.abs(eyeZ - boxZ) < halfD;
  const camInside = Math.abs(camX - boxX) < halfW && Math.abs(camZ - boxZ) < halfD;
  if ((eyeY < topY && eyeInside) || (camY < topY && camInside)) return true;
  const dx = camX - eyeX;
  const dz = camZ - eyeZ;
  const lax = eyeX - boxX;
  const laz = eyeZ - boxZ;
  let tmin = -Infinity;
  let tmax = Infinity;
  if (Math.abs(dx) < 1e-9) {
    if (lax < -halfW || lax > halfW) return false;
  } else {
    let t1 = (-halfW - lax) / dx;
    let t2 = (halfW - lax) / dx;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
  }
  if (Math.abs(dz) < 1e-9) {
    if (laz < -halfD || laz > halfD) return false;
  } else {
    let t1 = (-halfD - laz) / dz;
    let t2 = (halfD - laz) / dz;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
  }
  if (tmax < tmin || tmax < 0) return false;
  if (tmin < 0 || tmin > 1) return false;
  return eyeY + (camY - eyeY) * tmin < topY;
}

/**
 * A crossing that begins within this many yards of the EYE end of the
 * segment is the player standing AGAINST the structure, not the structure
 * covering the player: without this guard, a body pressed to a wall (or, for
 * a landing point authored close to a gate mouth, simply standing near it)
 * hides the whole structure at most orbit angles, because the entry point
 * sits centimetres from the eye at eye height.
 */
export const OCCLUDER_HIDE_EYE_CLEARANCE = 1.0;

/**
 * Whether the eye-to-camera segment crosses an ORIENTED box footprint below
 * its top (rotated slab test in the box's local frame, Y checked at the
 * entry point, gated by `OCCLUDER_HIDE_EYE_CLEARANCE`). Either endpoint
 * standing inside the footprint below the top also counts as a hit,
 * mirroring `occluderSegmentHitsBox`; unlike that axis-aligned test, this one
 * takes `rot` (three.js `rotation.y` convention) so it fits a footprint that
 * does not sit world-axis-aligned, such as a gate mouth seated at an
 * authored facing.
 */
export function occluderSegmentHitsObb(
  boxX: number,
  boxZ: number,
  halfW: number,
  halfD: number,
  rot: number,
  topY: number,
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  camX: number,
  camY: number,
  camZ: number,
): boolean {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const toLocal = (x: number, z: number): [number, number] => {
    const dx = x - boxX;
    const dz = z - boxZ;
    return [dx * c - dz * s, dx * s + dz * c];
  };
  const [lex, lez] = toLocal(eyeX, eyeZ);
  const [lcx, lcz] = toLocal(camX, camZ);
  const eyeInside = Math.abs(lex) < halfW && Math.abs(lez) < halfD;
  const camInside = Math.abs(lcx) < halfW && Math.abs(lcz) < halfD;
  if ((eyeY < topY && eyeInside) || (camY < topY && camInside)) return true;
  const dx = lcx - lex;
  const dz = lcz - lez;
  let tmin = -Infinity;
  let tmax = Infinity;
  if (Math.abs(dx) < 1e-9) {
    if (lex < -halfW || lex > halfW) return false;
  } else {
    let t1 = (-halfW - lex) / dx;
    let t2 = (halfW - lex) / dx;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
  }
  if (Math.abs(dz) < 1e-9) {
    if (lez < -halfD || lez > halfD) return false;
  } else {
    let t1 = (-halfD - lez) / dz;
    let t2 = (halfD - lez) / dz;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
  }
  if (tmax < tmin || tmax < 0) return false;
  if (tmin < 0 || tmin > 1) return false;
  if (tmin * Math.hypot(camX - eyeX, camZ - eyeZ) < OCCLUDER_HIDE_EYE_CLEARANCE) return false;
  return eyeY + (camY - eyeY) * tmin < topY;
}

/**
 * How far from the camera (yards, XZ) a structure's fade programs are asked
 * for AHEAD of its first occlusion (occluder_fade_gate.ts). Geometry, not a
 * timer: a structure can only start fading once it crosses the eye-to-camera
 * segment, and the longest such segment the game ever draws is the spawn
 * cinematic's opening pull-back (spawn_cinematic.ts startDist 55); the chase
 * camera's wheel range is far shorter. Everything anchored inside this reach
 * is what the camera can fade next. A wide structure anchored just beyond it
 * can still cross the segment first: its edge-frame consult then holds it
 * opaque until the link lands, which is a late fade, never a stall.
 */
export const OCCLUDER_FADE_PREFETCH_YD = 60;

/** The slice of an instanced-ghost pool the hide decision consults. */
export interface OccluderGhostReadiness<T> {
  allReady(parts: T): boolean;
}

/**
 * Whether a hideable structure keeps drawing its instances this frame instead
 * of swapping to ghost stand-ins: it is not occluding, or its ghost programs
 * are still linking behind the fade gate. A structure already ghosted never
 * comes back through here (its fade owns the swap back). The pool is consulted
 * ONLY for an occluding, not-yet-ghosted structure, because a consult requests
 * the compile: asking for every tree in the field would prefetch the world.
 * The pool and its parts come in as two arguments rather than a thunk so the
 * per-tree per-frame call allocates nothing.
 */
export function occluderKeepsInstances<T>(
  occluded: boolean,
  hasGhosts: boolean,
  ghosts: OccluderGhostReadiness<T>,
  parts: T,
): boolean {
  if (hasGhosts) return false;
  if (!occluded) return true;
  return !ghosts.allReady(parts);
}

/** Whether an anchor at (x, z) is within the prefetch reach of the camera. */
export function withinOccluderFadePrefetch(
  x: number,
  z: number,
  camX: number,
  camZ: number,
): boolean {
  const dx = x - camX;
  const dz = z - camZ;
  return dx * dx + dz * dz <= OCCLUDER_FADE_PREFETCH_YD * OCCLUDER_FADE_PREFETCH_YD;
}
