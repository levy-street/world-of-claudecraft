// Stealth Rework shimmer band: the pure half of the rim glint
// (stealth_shimmer_visual.ts is the Three painter). The world hands over a
// list of shimmers with whole-yard positions and a stepped fade, and no id, so
// the display keeps its own small set of drawn shimmers: each frame every
// target claims the nearest drawn one within SHIMMER_MATCH_RADIUS and the drawn
// one eases toward it (no one-yard jumps), a new target fades in where it is,
// and a drawn one nobody claimed fades out. Each drawn shimmer turns its front
// to the viewer, so the generic body never shows which way the stealther faces.
// The shimmer is ACTIONABLE information (someone is there), so nothing here
// reads a graphics tier: every preset draws the same plan.

import type { StealthShimmer } from '../sim/stealth_shimmer';

/** The glint's strength against its full design (the alpha multiplier). */
export const SHIMMER_STRENGTH = 0.25;
/** A target claims a drawn shimmer this close (yards). */
export const SHIMMER_MATCH_RADIUS = 3;
/** Position easing rate (per second). */
export const SHIMMER_MOVE_RATE = 6;
/** Seconds to fade fully in, and to fade fully out. */
export const SHIMMER_FADE_IN = 0.3;
export const SHIMMER_FADE_OUT = 0.15;

export interface DrawnShimmer {
  x: number;
  y: number;
  z: number;
  /** Current fade (0 to 1) and the one it is heading for. */
  alpha: number;
  target: number;
  /** Last live distance fade, retained while the display fades out. */
  bandFade: number;
  /** Turned toward the viewer: rotation about +Y (forward is +Z). */
  yaw: number;
  /** The step that last claimed it (a stamp, so a frame allocates nothing). */
  claimedAt: number;
}

let stepStamp = 0;

/** Advance `drawn` (mutated in place, returned) toward this frame's `targets`.
 *  `viewerX/Z` is where the viewer stands; null leaves yaw unchanged. */
export function stepShimmers(
  drawn: DrawnShimmer[],
  targets: readonly StealthShimmer[],
  dt: number,
  viewerX: number | null,
  viewerZ: number | null,
): DrawnShimmer[] {
  const stamp = ++stepStamp;
  const ease = 1 - Math.exp(-Math.max(0, dt) * SHIMMER_MOVE_RATE);
  for (const t of targets) {
    let best: DrawnShimmer | null = null;
    let bestD2 = SHIMMER_MATCH_RADIUS * SHIMMER_MATCH_RADIUS;
    for (const d of drawn) {
      if (d.claimedAt === stamp) continue;
      const d2 = (d.x - t.x) ** 2 + (d.z - t.z) ** 2;
      if (d2 <= bestD2) {
        best = d;
        bestD2 = d2;
      }
    }
    if (best) {
      best.x += (t.x - best.x) * ease;
      best.y += (t.y - best.y) * ease;
      best.z += (t.z - best.z) * ease;
      best.target = t.fade;
      best.bandFade = t.fade;
    } else {
      best = {
        x: t.x,
        y: t.y,
        z: t.z,
        alpha: 0,
        target: t.fade,
        bandFade: t.fade,
        yaw: 0,
        claimedAt: 0,
      };
      drawn.push(best);
    }
    best.claimedAt = stamp;
  }
  for (let i = drawn.length - 1; i >= 0; i--) {
    const d = drawn[i];
    if (d.claimedAt !== stamp) d.target = 0;
    const rate = d.target > d.alpha ? 1 / SHIMMER_FADE_IN : 1 / SHIMMER_FADE_OUT;
    const step = Math.max(0, dt) * rate;
    d.alpha =
      d.target > d.alpha ? Math.min(d.target, d.alpha + step) : Math.max(d.target, d.alpha - step);
    if (d.target === 0 && d.alpha === 0) {
      drawn.splice(i, 1);
      continue;
    }
    if (viewerX !== null && viewerZ !== null) d.yaw = Math.atan2(viewerX - d.x, viewerZ - d.z);
  }
  // Live shimmers ahead of fading ones, so at the draw cap a new arrival is
  // never the one left out (a stable partition: order is otherwise kept).
  let w = 0;
  for (let i = 0; i < drawn.length; i++) {
    const d = drawn[i];
    if (d.target <= 0) continue;
    for (let j = i; j > w; j--) drawn[j] = drawn[j - 1];
    drawn[w++] = d;
  }
  return drawn;
}

/** Keep the distance-strength floor separate from appearance/disappearance.
 *  CPU alpha tracks the distance fade, so normalize by the last live fade. */
export function shimmerDisplayOpacity(alpha: number, bandFade: number): number {
  if (!(bandFade > 0)) return 0;
  const displayFade = Math.min(1, Math.max(0, alpha / bandFade));
  return (0.4 + 0.6 * bandFade) * displayFade;
}

/** The sparkle pattern repeats on this period (seconds); time is wrapped to it
 *  so shader precision never decays over a long session. */
export const SHIMMER_TIME_PERIOD = 600;

/** The time a glint animates on: frozen under reduced motion (the rim stays,
 *  its moving sparkle stops). */
export function shimmerShaderTime(time: number, reducedMotion: boolean): number {
  return reducedMotion ? 0 : time % SHIMMER_TIME_PERIOD;
}
