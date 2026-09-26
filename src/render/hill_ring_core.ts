// King of the Hill ring: the pure per-frame plan for the circle drawn on the
// ground (src/render/hill_ring.ts owns the meshes). The ring's colour says who
// holds it from anywhere in the zone (nobody: the neutral gold; your group:
// the friendly green; another group: the hostile red), its rim pulses while
// a challenge is running so a contested hill reads as one before the bar is
// looked at, and the interior wash stays faint so the circle marks ground
// without hiding it. While the hill is only announced (the warning phase) the
// circle is drawn as a still, faint gold outline: the ground it will stand
// on, not yet a prize. Colours are hex literals here rather than CSS tokens
// because they feed Three materials, the rift death zone precedent.

import type { HillInfo } from '../world_api/world_pvp';

export interface HillRingPlan {
  color: number;
  ringOpacity: number;
  fillOpacity: number;
}

export const HILL_COLOR_UNHELD = 0xd9a441;
export const HILL_COLOR_YOURS = 0x4fd36a;
export const HILL_COLOR_OTHERS = 0xff4f3f;

export const HILL_RING_MAX_OPACITY = 0.9;
export const HILL_RING_MIN_OPACITY = 0.55;
/** A calm hill barely breathes; a contested one pulses visibly. */
export const HILL_PULSE_SPEED_CALM = 1.2;
export const HILL_PULSE_SPEED_CONTESTED = 5.0;
export const HILL_FILL_OPACITY = 0.16;
/** The announced-but-not-risen circle: still and faint. */
export const HILL_WARNING_RING_OPACITY = 0.35;
export const HILL_WARNING_FILL_OPACITY = 0.04;

export function hillRingColor(holder: HillInfo['holder']): number {
  if (holder === 'you') return HILL_COLOR_YOURS;
  if (holder === 'other') return HILL_COLOR_OTHERS;
  return HILL_COLOR_UNHELD;
}

export function hillPulseSpeed(contested: boolean): number {
  return contested ? HILL_PULSE_SPEED_CONTESTED : HILL_PULSE_SPEED_CALM;
}

/** The full per-frame plan. `phase` is the caller-advanced pulse clock
 *  (radians, advanced by hillPulseSpeed * dt); `info.phase` is the hill's. */
export function hillRingPlan(
  phase: number,
  info: Pick<HillInfo, 'phase' | 'holder' | 'challenger'>,
): HillRingPlan {
  if (info.phase === 'warning') {
    return {
      color: HILL_COLOR_UNHELD,
      ringOpacity: HILL_WARNING_RING_OPACITY,
      fillOpacity: HILL_WARNING_FILL_OPACITY,
    };
  }
  const contested = info.challenger !== 'none';
  const wave = contested ? 0.5 + 0.5 * Math.sin(phase) : 1;
  return {
    color: hillRingColor(info.holder),
    ringOpacity: HILL_RING_MIN_OPACITY + (HILL_RING_MAX_OPACITY - HILL_RING_MIN_OPACITY) * wave,
    fillOpacity: HILL_FILL_OPACITY,
  };
}

// The radial profile. The circle is drawn as a dense terrain-draped mesh whose
// per-vertex alpha follows these curves, so it reads as light on the ground
// rather than a sheet laid over it: the interior is clear at the centre and
// thickens toward the edge, and the rim is a soft glow that feathers both in and
// out of the true radius. `t` is the distance from the centre over the radius.

/** Where the rim glow starts inside the radius, and how far it feathers past it. */
export const HILL_RIM_INNER_T = 0.88;
export const HILL_RIM_OUTER_T = 1.05;
/** The draped mesh keeps a vertex at most this far from its neighbours along a
 *  radius, in yards, so it follows the ground instead of cutting through slopes. */
export const HILL_RADIAL_STEP_YARDS = 2;
export const HILL_RIM_STEP_YARDS = 0.5;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const u = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return u * u * (3 - 2 * u);
}

/** Interior wash weight (0 to 1): clear at the centre, strongest at the rim. */
export function hillFillAlpha(t: number): number {
  if (t <= 0 || t >= 1) return 0;
  return smoothstep(0, 1, t);
}

/** Rim glow weight (0 to 1): rises from the rim's inner edge to a peak on the
 *  true radius, then feathers out to nothing just past it. */
export function hillRimAlpha(t: number): number {
  if (t <= HILL_RIM_INNER_T || t >= HILL_RIM_OUTER_T) return 0;
  return t <= 1 ? smoothstep(HILL_RIM_INNER_T, 1, t) : 1 - smoothstep(1, HILL_RIM_OUTER_T, t);
}

/** Normalised radial stops from `from` to `to` (both as fractions of the
 *  radius), spaced at most `stepYards` apart on a circle of `radius` yards,
 *  always including both ends. */
export function hillRadialStops(
  radius: number,
  from: number,
  to: number,
  stepYards: number,
): number[] {
  const span = Math.max(0, to - from) * radius;
  const n = Math.max(1, Math.ceil(span / Math.max(0.01, stepYards)));
  return Array.from({ length: n + 1 }, (_, i) => from + ((to - from) * i) / n);
}

/** The identity a ring visual is keyed by: a new hill is a new mesh set, a
 *  holder change only retints the one that stands. */
export function hillRingKey(info: Pick<HillInfo, 'x' | 'z' | 'radius'>): string {
  return `${info.x},${info.z},${info.radius}`;
}
