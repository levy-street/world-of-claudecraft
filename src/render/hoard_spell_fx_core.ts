// Pure plans for the Buried Hoard spell effects (src/render/hoard_spell_fx.ts):
// the Storm Caller's Lightning Strike, Hoarfrost's Whiteout Gust, and Archon
// Nyxaris's Voidfall, Event Horizon and Singularity Collapse. DOM-free and
// Three-free: every shape and every timing the look is built on is a number a
// Node test can pin, and the adapter only writes them into pooled buffers.
//
// All of it is COSMETIC. The warning a player reads to survive is the floor
// telegraph (hoard_boss_fx.ts), whose disc, rim and countdown never depend on
// anything here, so the low tier sheds this module whole.

import { hoardHash } from './hoard_boss_dressing_core';

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

// ---------------------------------------------------------------- Lightning Strike

/** Arcs crawling round the rim at full charge, and points per arc. */
export const STRIKE_RIM_ARCS = 9;
export const STRIKE_ARC_POINTS = 5;
/** Points down the main bolt, its branches, and how tall it stands (yards). */
export const STRIKE_BOLT_POINTS = 11;
export const STRIKE_BRANCHES = 4;
export const STRIKE_BRANCH_POINTS = 5;
export const STRIKE_BOLT_HEIGHT = 34;
/** Ground forks racing out of the impact, and points per fork. */
export const STRIKE_GROUND_FORKS = 7;
export const STRIKE_FORK_POINTS = 5;
/** Seconds the impact and its aftermath live. */
export const STRIKE_IMPACT_SEC = 0.85;
/** The re-roll rate of every electrical shape (Hz), and its calm twin. */
export const SPELL_FLICKER_HZ = 16;
export const SPELL_FLICKER_CALM_HZ = 2;

export interface StrikeChargePlan {
  /** Rim arcs alive right now: a couple at first, all of them near the end. */
  arcs: number;
  /** Arc brightness, and how far the arcs reach in toward the centre (0 to 1). */
  arcOpacity: number;
  reach: number;
  /** The gathering glow in the middle of the circle. */
  coreOpacity: number;
  coreScale: number;
  /** The brief white flash just before the bolt (0 outside the last moments). */
  preFlash: number;
  /** The thin leader feeling its way down from the sky, 0 to 1 of the height. */
  leader: number;
}

/** `progress` is 0 when the circle appears and 1 when the bolt lands. */
export function strikeCharge(progress: number): StrikeChargePlan {
  const p = clamp01(progress);
  const late = clamp01((p - 0.82) / 0.18);
  return {
    arcs: Math.max(2, Math.round(STRIKE_RIM_ARCS * (0.2 + 0.8 * p * p))),
    arcOpacity: 0.35 + 0.6 * p,
    reach: 0.12 + 0.5 * p,
    coreOpacity: 0.08 + 0.5 * p * p,
    coreScale: 0.25 + 0.4 * p,
    preFlash: late * late,
    leader: clamp01((p - 0.55) / 0.45),
  };
}

/** One jagged arc hugging the rim: flat x,z pairs on a unit circle, its inner
 *  points dipping toward the centre by `reach`. */
export function strikeRimArc(
  seed: number,
  arc: number,
  bucket: number,
  reach: number,
  out: number[] = [],
): number[] {
  out.length = 0;
  const start = ((arc + hoardHash(seed, arc, bucket)) / STRIKE_RIM_ARCS) * Math.PI * 2;
  const span = 0.5 + hoardHash(seed, arc, bucket + 3) * 0.7;
  for (let point = 0; point < STRIKE_ARC_POINTS; point++) {
    const t = point / (STRIKE_ARC_POINTS - 1);
    const belly = Math.sin(t * Math.PI);
    const dip = belly * reach * hoardHash(seed * 7 + arc, point, bucket);
    const radius = 1 - dip;
    const angle = start + span * t;
    out.push(Math.sin(angle) * radius, Math.cos(angle) * radius);
  }
  return out;
}

/** The main bolt: x,y,z triples from the sky (y = 1) to the ground (y = 0) in
 *  unit height, kicked sideways hard up high and pinned dead centre at the
 *  ground, so it always lands on the mark. */
export function strikeBolt(seed: number, bucket: number, out: number[] = []): number[] {
  out.length = 0;
  for (let point = 0; point < STRIKE_BOLT_POINTS; point++) {
    const t = point / (STRIKE_BOLT_POINTS - 1);
    const sway = (1 - t) * (1 - t * 0.4);
    const pinned = point === STRIKE_BOLT_POINTS - 1 ? 0 : 1;
    out.push(
      (hoardHash(seed, point, bucket) - 0.5) * 0.16 * sway * pinned + (1 - t) * 0.05,
      1 - t,
      (hoardHash(seed, point + 31, bucket) - 0.5) * 0.16 * sway * pinned,
    );
  }
  return out;
}

/** A branch forking off the main bolt at a fraction of its height: x,y,z
 *  triples in the same unit frame, starting ON the trunk. */
export function strikeBranch(
  seed: number,
  branch: number,
  bucket: number,
  trunk: readonly number[],
  out: number[] = [],
): number[] {
  out.length = 0;
  const joint = 2 + Math.floor(hoardHash(seed, branch, 91) * (STRIKE_BOLT_POINTS - 5));
  const ox = trunk[joint * 3];
  const oy = trunk[joint * 3 + 1];
  const oz = trunk[joint * 3 + 2];
  const heading = hoardHash(seed, branch, 92) * Math.PI * 2;
  const length = 0.1 + hoardHash(seed, branch, 93) * 0.12;
  for (let point = 0; point < STRIKE_BRANCH_POINTS; point++) {
    const t = point / (STRIKE_BRANCH_POINTS - 1);
    const kick = (hoardHash(seed * 3 + branch, point, bucket) - 0.5) * 0.05 * t;
    out.push(
      ox + Math.sin(heading) * length * t + kick,
      oy - length * 0.9 * t,
      oz + Math.cos(heading) * length * t - kick,
    );
  }
  return out;
}

/** A ground fork racing out from the impact: flat x,z pairs, unit radius. */
export function strikeGroundFork(
  seed: number,
  fork: number,
  bucket: number,
  out: number[] = [],
): number[] {
  out.length = 0;
  const heading = ((fork + hoardHash(seed, fork, 5) * 0.8) / STRIKE_GROUND_FORKS) * Math.PI * 2;
  const length = 0.75 + hoardHash(seed, fork, 6) * 0.7;
  for (let point = 0; point < STRIKE_FORK_POINTS; point++) {
    const t = point / (STRIKE_FORK_POINTS - 1);
    const kick = (hoardHash(seed * 11 + fork, point, bucket) - 0.5) * 0.3 * t;
    const angle = heading + kick;
    out.push(Math.sin(angle) * length * t, Math.cos(angle) * length * t);
  }
  return out;
}

export interface StrikeImpactPlan {
  /** The bolt: full for a few frames, a strobing echo, then gone. */
  bolt: number;
  /** The ground flash disc. */
  flash: number;
  flashScale: number;
  /** The shock ring racing out past the circle. */
  ring: number;
  ringScale: number;
  /** Ground forks and the residual sparks: the aftermath. */
  forks: number;
  forkReach: number;
  residue: number;
  /** The column of light the bolt leaves in the air. */
  afterglow: number;
  done: boolean;
}

export function strikeImpact(age: number): StrikeImpactPlan {
  const a = Math.max(0, age);
  const life = clamp01(a / STRIKE_IMPACT_SEC);
  const hit = clamp01(1 - a / 0.12);
  // A second, dimmer return stroke: what makes a bolt read as lightning.
  const echo = a > 0.16 && a < 0.27 ? 0.55 : 0;
  const ringT = clamp01(a / 0.34);
  return {
    bolt: Math.max(hit, echo),
    flash: clamp01(1 - a / 0.22) ** 2,
    flashScale: 0.7 + clamp01(a / 0.22) * 0.9,
    ring: (1 - ringT) * 0.95,
    ringScale: 0.3 + (1 - (1 - ringT) ** 3) * 1.6,
    forks: clamp01(1 - a / 0.5),
    forkReach: clamp01(a / 0.1),
    residue: a < 0.12 ? 0 : (1 - life) * 0.8,
    afterglow: clamp01(1 - a / 0.4) * 0.3,
    done: a >= STRIKE_IMPACT_SEC,
  };
}

// ---------------------------------------------------------------- Whiteout Gust

export const GUST_STREAKS = 22;

export interface GustStreakPlan {
  /** Bearing inside the cone as a fraction of its half angle (-1 to 1). */
  bearing: number;
  /** Head and tail distance from the boss, as fractions of the reach. */
  head: number;
  tail: number;
  lift: number;
  opacity: number;
}

/** Wind streaks racing down the cone. They speed up and thicken as the gust
 *  winds up, so the cone visibly fills with the storm that is about to hit. */
export function gustStreak(
  seed: number,
  index: number,
  elapsed: number,
  progress: number,
  out: GustStreakPlan,
): GustStreakPlan {
  const p = clamp01(progress);
  const speed = 0.55 + p * 1.5 + hoardHash(seed, index, 1) * 0.5;
  const phase = (elapsed * speed + hoardHash(seed, index, 2)) % 1;
  const length = 0.1 + p * 0.16;
  out.bearing = (hoardHash(seed, index, 3) * 2 - 1) * 0.94;
  out.head = Math.min(1, phase + length);
  out.tail = phase;
  out.lift = 0.4 + hoardHash(seed, index, 4) * 2.2;
  // Fade in at the boss, out at the edge, and only a share of them early on.
  const alive = hoardHash(seed, index, 5) < 0.3 + p * 0.7 ? 1 : 0;
  out.opacity = alive * Math.sin(clamp01(phase) * Math.PI) * (0.35 + 0.65 * p);
  return out;
}

export const GUST_BLAST_SEC = 0.6;

/** The gust landing: a white wall racing the length of the cone. */
export function gustBlast(age: number): { front: number; opacity: number; done: boolean } {
  const t = clamp01(age / 0.28);
  return {
    front: 1 - (1 - t) ** 2,
    opacity: clamp01(1 - age / GUST_BLAST_SEC) * 0.9,
    done: age >= GUST_BLAST_SEC,
  };
}

// ---------------------------------------------------------------- Archon Nyxaris

export const HORIZON_STREAKS = 56;
/** Sub-segments per streak: enough for the spiral to read as a curve. */
export const HORIZON_STREAK_SEGMENTS = 3;
/** How far round the spiral a streak's tail trails its head (radians). */
export const HORIZON_STREAK_SWEEP = 0.34;

export interface HorizonStreakPlan {
  angle: number;
  /** Head (inner) and tail (outer) radius as fractions of the outer radius. */
  head: number;
  tail: number;
  lift: number;
  opacity: number;
}

/** Event Horizon: light from the whole room is dragged in a spiral toward the
 *  eye. `eye` is the safe radius as a fraction of the outer radius; streaks
 *  die at its edge, so the eye reads as the one calm place. */
export function horizonStreak(
  seed: number,
  index: number,
  elapsed: number,
  progress: number,
  eye: number,
  out: HorizonStreakPlan,
): HorizonStreakPlan {
  const p = clamp01(progress);
  const speed = 0.25 + p * 0.95 + hoardHash(seed, index, 1) * 0.3;
  const fall = (elapsed * speed + hoardHash(seed, index, 2)) % 1;
  const radius = 1 - fall * (1 - eye);
  const length = 0.06 + p * 0.1;
  out.angle = hoardHash(seed, index, 3) * Math.PI * 2 + fall * (1.4 + p * 1.6);
  out.head = Math.max(eye, radius - length * 0.5);
  out.tail = Math.min(1, radius + length * 0.5);
  out.lift = 0.5 + hoardHash(seed, index, 4) * 1.6 * (1 - fall);
  out.opacity = Math.sin(clamp01(fall) * Math.PI) * (0.3 + 0.7 * p);
  return out;
}

/** The safe eye: a steady beacon that brightens as the Horizon closes in. */
export function horizonEye(progress: number, elapsed: number, calm: boolean) {
  const p = clamp01(progress);
  const pulse = calm ? 0.5 : 0.5 + 0.5 * Math.sin(elapsed * (3 + p * 7));
  return {
    ringOpacity: 0.55 + 0.4 * pulse,
    columnOpacity: 0.04 + 0.08 * p + 0.03 * pulse,
    columnHeight: 6 + p * 8,
  };
}

export const HORIZON_WAVE_SEC = 0.7;

/** The Horizon resolving: a violet wall sweeps from the eye out to the walls. */
export function horizonWave(age: number, eye: number) {
  const t = clamp01(age / 0.45);
  return {
    scale: eye + (1 - (1 - t) ** 2) * (1 - eye),
    opacity: clamp01(1 - age / HORIZON_WAVE_SEC) * 0.85,
    done: age >= HORIZON_WAVE_SEC,
  };
}

export const COLLAPSE_RINGS = 3;
export const COLLAPSE_BURST_SEC = 0.9;
export const COLLAPSE_SHARDS = 14;

/** Singularity Collapse winding up: rings fall inward faster and faster, and a
 *  dark-bright core swells where they meet. */
export function collapseRing(ring: number, elapsed: number, progress: number) {
  const p = clamp01(progress);
  const fall = (elapsed * (0.7 + p * 2.4) + ring / COLLAPSE_RINGS) % 1;
  return {
    scale: Math.max(0.04, 1 - fall),
    opacity: Math.sin(fall * Math.PI) * (0.35 + 0.6 * p),
    core: 0.1 + 0.32 * p * p,
  };
}

/** ...and detonating: a flash, a shock ring past the circle, a pillar of light,
 *  and shards of it thrown outward. */
export function collapseBurst(age: number) {
  const a = Math.max(0, age);
  const ringT = clamp01(a / 0.4);
  return {
    flash: clamp01(1 - a / 0.25) ** 2,
    ring: (1 - ringT) * 0.95,
    ringScale: 0.2 + (1 - (1 - ringT) ** 3) * 1.5,
    pillar: clamp01(1 - a / 0.55) * 0.2,
    shardReach: 1 - (1 - clamp01(a / 0.5)) ** 2,
    shards: clamp01(1 - a / COLLAPSE_BURST_SEC),
    done: a >= COLLAPSE_BURST_SEC,
  };
}

export const VOIDFALL_HEIGHT = 30;
export const VOIDFALL_SPLASH_SEC = 0.55;
export const VOIDFALL_SWIRLS = 5;

/** Voidfall: a star falls out of the dark onto the mark. It hangs high for most
 *  of the warning and drops in the last third, arriving exactly at impact. */
export function voidfallStar(progress: number) {
  const p = clamp01(progress);
  const drop = clamp01((p - 0.35) / 0.65);
  return {
    height: VOIDFALL_HEIGHT * (1 - drop * drop),
    trail: 2 + drop * 9,
    opacity: 0.35 + 0.65 * p,
  };
}

/** The pool it leaves: slow arms of void turning round the mark. Flat x,z pairs
 *  on a unit circle, a logarithmic spiral arm per index. */
export function voidfallSwirl(arm: number, elapsed: number, points: number, out: number[] = []) {
  out.length = 0;
  const turn = elapsed * 0.9 + (arm / VOIDFALL_SWIRLS) * Math.PI * 2;
  for (let point = 0; point < points; point++) {
    const t = point / (points - 1);
    const angle = turn + t * 2.2;
    const radius = 0.12 + t * 0.85;
    out.push(Math.sin(angle) * radius, Math.cos(angle) * radius);
  }
  return out;
}
