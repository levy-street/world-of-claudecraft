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
 * exponential unless reduced motion asks for a direct state change.
 */
export function stepOccluderFade(
  alpha: number,
  occluded: boolean,
  dt: number,
  reducedMotion = false,
): number {
  const target = occluded ? OCCLUDER_FADE_ALPHA : 1;
  const start = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 1;
  if (dt <= 0) return start;
  if (occluded || reducedMotion) return target;
  const next = start + (target - start) * (1 - Math.exp(-OCCLUDER_FADE_IN_RATE * dt));
  return Math.abs(next - target) <= SNAP ? target : next;
}

/** Whether a fade is at rest for its current occlusion state (no work left). */
export function occluderFadeSettled(alpha: number, occluded: boolean): boolean {
  return alpha === (occluded ? OCCLUDER_FADE_ALPHA : 1);
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
