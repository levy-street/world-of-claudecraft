// The cannon shot on screen, the pure half: the shell's arc from the muzzle to
// the blast and the wake it drops (a fragmentation shell's fizzes with sparks),
// the barrel's recoil spring, the dirt chunks' closed-form flights, the scorch
// draped on the ground and its fade, the camera shake by distance and the counts
// the low preset sheds, plus the pools every event's puffs (cannon_puff_core.ts)
// are launched into: the blasts, a fragmentation shell's airburst
// (cannon_frag_core.ts) and one slot for a slam's cracked ground mark
// (cannon_ground_mark_core.ts). The Three consumer is
// cannon_shell_visuals.ts; the Realm Racers Ground Blast is where the shell's
// arc comes from.
//
// Two clocks: a shell flies on the sim tick (fractional, from the display clock)
// so it lands on the tick its blast resolves; everything an event starts (the
// muzzle, the blast, the chunks, the scorch) runs on frame seconds from the frame
// that consumed it, so a flash is never seen half spent. A caller's own shot may
// launch its shell before its event (launchOwn, on a predicted flight); the event
// then adopts it (adoptOwn: re-timed to its impact tick, the aim offset fading
// out over the rest of the flight), or it shrinks away with no blast.
//
// Three/DOM/i18n-free (RENDER_PURE_CORES), deterministic (a chunk's spread is a
// hash of its impact and index) and allocation-free per frame: fixed pools
// refilled in place.

import { DT } from '../sim/types';
import { type CannonAirburstCounts, cannonAirburstPuffs } from './cannon_frag_core';
import {
  CANNON_BLAST_FIXED_PUFFS,
  CANNON_DUST_PUFFS,
  CANNON_MUZZLE_FIXED_PUFFS,
  CANNON_SMOKE_PUFFS,
  CANNON_TRAIL,
  type CannonPuff,
  cannonBlastPuffs,
  cannonHash01,
  cannonMuzzlePuffs,
  cannonNoiseInto,
  cannonTrailPuffInto,
  newCannonPuff,
} from './cannon_puff_core';

export { cannonHash01 } from './cannon_puff_core';

export const CANNON_SHELL = {
  /** Arc height above the chord, as a share of the span, clamped. */
  arcFraction: 0.18,
  arcMin: 2.5,
  arcMax: 7,
  /** The steepest a shell leaves its muzzle (rad): a close shot's arc flattens to it. */
  maxLaunchPitch: Math.PI / 4,
  /** Shell spin (rad/s). */
  spinY: 9,
  spinX: 6,
} as const;

export const CANNON_MUZZLE = {
  /** The barrel's kick back along its own axis (local units) and its spring. */
  recoilKick: 0.35,
  recoilAttack: 0.035,
  recoilLife: 0.25,
  fovPunch: 2,
  /** Camera trauma per shot: the renderer squares trauma, so this is a light kick. */
  shake: 0.22,
  /** Seconds a shot's muzzle puffs can live (the smoke is the longest). */
  life: 1.5,
} as const;

export const CANNON_BLAST = {
  /** Seconds a blast's puffs and chunks can live (the dust is the longest). */
  life: 2.1,
  chunkLife: 2,
  chunkGravity: 26,
  /** Seconds the scorch holds before it starts to fade, and its whole life. */
  scorchHold: 1.5,
  scorchLife: 8,
  /** Scorch half-width, as a share of the blast radius. */
  scorchScale: 0.45,
  /** Camera shake of a blast: full within `full` yards of the turret, none past `zero`. */
  shake: 0.55,
  shakeFull: 10,
  shakeZero: 40,
} as const;

/** Seconds an own shell no event confirmed takes to shrink away (no blast, no scorch). */
export const CANNON_OWN_FADE_SECONDS = 0.25;

export const CANNON_SHELL_POOL = 4;
export const CANNON_MUZZLE_POOL = 4;
export const CANNON_IMPACT_POOL = 6;
export const CANNON_SCORCH_POOL = 18;
export const CANNON_CHUNKS_PER_IMPACT = 12;
/** Quads per side of a draped scorch. */
export const CANNON_SCORCH_GRID = 8;
export const CANNON_SCORCH_VERTS = (CANNON_SCORCH_GRID + 1) * (CANNON_SCORCH_GRID + 1);
/**
 * A scorch's draped layers, as yards over the sampled ground and a share of
 * its darkening: the soil itself, then two sheets through the grass canopy,
 * because a meadow's blades hide nearly all the soil a mark on the ground could
 * darken (the test site's grass left a sliver of it showing). Stacked, the
 * blades read burnt at the root and singed at the tip.
 */
export const CANNON_SCORCH_LAYERS: readonly { readonly lift: number; readonly strength: number }[] =
  [
    { lift: 0.06, strength: 1 },
    { lift: 0.3, strength: 0.32 },
    { lift: 0.55, strength: 0.25 },
  ];

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

function smoothstep(n: number): number {
  const t = clamp01(n);
  return t * t * (3 - 2 * t);
}

/** Cosmetic counts per shot. The low preset sheds these only: the shell and
 *  its wake, the flash, the fireball and the shock ring are the same on every tier. */
export interface CannonShotCounts {
  chunks: number;
  /** Dirt clods of the burst. */
  dirt: number;
  /** Puffs of the dust cloud. */
  dust: number;
  sparks: number;
  /** Smoke puffs at the muzzle. */
  smoke: number;
}

const FULL_COUNTS: Readonly<CannonShotCounts> = {
  chunks: 12,
  dirt: 24,
  dust: CANNON_DUST_PUFFS,
  sparks: 16,
  smoke: CANNON_SMOKE_PUFFS,
};
const LOW_COUNTS: Readonly<CannonShotCounts> = {
  chunks: 5,
  dirt: 8,
  dust: 4,
  sparks: 5,
  smoke: 2,
};

export function cannonShotCounts(low: boolean): Readonly<CannonShotCounts> {
  return low ? LOW_COUNTS : FULL_COUNTS;
}

/** The most puffs one blast launches (the full counts). */
export const CANNON_BLAST_PUFFS =
  CANNON_BLAST_FIXED_PUFFS + FULL_COUNTS.dust + FULL_COUNTS.dirt + FULL_COUNTS.sparks;
/** The most puffs one muzzle launches. */
export const CANNON_MUZZLE_PUFFS = CANNON_MUZZLE_FIXED_PUFFS + FULL_COUNTS.smoke;
/** The most wake puffs one shell keeps alive: a 60 yd shot drops about as many
 *  in its last half second. */
export const CANNON_TRAIL_PUFFS = 80;

export function cannonArcHeight(span: number): number {
  return Math.min(
    CANNON_SHELL.arcMax,
    Math.max(CANNON_SHELL.arcMin, span * CANNON_SHELL.arcFraction),
  );
}

/**
 * The arc height of a shell that falls `rise` yards (negative: down) over a
 * `span` yard reach: cannonArcHeight, flattened so the shell never leaves the
 * muzzle steeper than CANNON_SHELL.maxLaunchPitch (a barrel cannot elevate past it).
 */
export function cannonShellArc(span: number, rise: number): number {
  const flattest = (Math.max(0, span) * Math.tan(CANNON_SHELL.maxLaunchPitch) - rise) / 4;
  return Math.max(0, Math.min(cannonArcHeight(span), flattest));
}

/** The elevation (rad) a shell leaves its muzzle at on that arc: the tangent at its start. */
export function cannonLaunchPitch(span: number, rise: number): number {
  return Math.atan2(rise + 4 * cannonShellArc(span, rise), Math.max(0, span));
}

/** How far the camera shakes for a blast `distance` yards from the turret (0 to 1). */
export function cannonShakeFalloff(distance: number): number {
  const { shakeFull, shakeZero } = CANNON_BLAST;
  if (!(distance > shakeFull)) return 1;
  if (distance >= shakeZero) return 0;
  return 1 - (distance - shakeFull) / (shakeZero - shakeFull);
}

/** The barrel's offset back along its axis `age` seconds after a shot: a fast
 *  kick, then a damped spring home with a slight overshoot forward. */
export function cannonRecoilOffset(age: number): number {
  const { recoilKick, recoilAttack, recoilLife } = CANNON_MUZZLE;
  if (!(age >= 0) || age >= recoilLife) return 0;
  if (age < recoilAttack) {
    const u = age / recoilAttack;
    return recoilKick * (1 - (1 - u) * (1 - u));
  }
  const r = (age - recoilAttack) / (recoilLife - recoilAttack);
  return recoilKick * Math.exp(-4 * r) * Math.cos(1.35 * Math.PI * r);
}

/** The scorch's darkening, 0 to 1, `age` seconds after the blast. */
export function cannonScorchFade(age: number): number {
  const { scorchHold, scorchLife } = CANNON_BLAST;
  if (!(age >= 0) || age >= scorchLife) return 0;
  const rise = Math.min(1, age / 0.12);
  return rise * (1 - smoothstep((age - scorchHold) / (scorchLife - scorchHold)));
}

/**
 * The scorch texture, `size` square RGBA texels: how much each texel darkens
 * the ground (a subtractive blend), near black char over the inner half, broken
 * by a coarse soot mottle and radial burn streaks, fading to nothing at the rim,
 * and a little more in blue than in red so the mark reads as brown char rather
 * than grey. It has to be this dark: tone mapping, mip averaging and the
 * grazing angle a blast 35 to 40 yd away is seen at eat a faint mark whole.
 */
export function cannonScorchTexels(size: number): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  const mottle = cannonNoiseInto(new Float64Array(size * size), size, 6, 7, 1, 1);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = ((i + 0.5) / size) * 2 - 1;
      const v = ((j + 0.5) / size) * 2 - 1;
      const r = Math.hypot(u, v);
      const angle = Math.atan2(v, u);
      const soot = mottle[j * size + i];
      // A ragged rim: the burn reaches further along some bearings than others.
      const rim = 0.72 + 0.14 * (soot - 0.5) + 0.06 * Math.sin(angle * 5 + 1.3);
      const core = 1 - smoothstep((r - 0.22) / (rim - 0.22));
      const streak = Math.max(0, Math.cos(angle * 9 + 0.9 * Math.sin(angle * 4))) ** 6;
      const reach = 1 - smoothstep((r - 0.45) / 0.5);
      const dark = clamp01(core * (0.72 + 0.28 * soot) + streak * reach * 0.35 * soot);
      const amount = r >= 0.98 ? 0 : 0.85 * dark;
      const at = (j * size + i) * 4;
      data[at] = Math.round(255 * amount * 0.86);
      data[at + 1] = Math.round(255 * amount * 0.92);
      data[at + 2] = Math.round(255 * amount);
      data[at + 3] = 255;
    }
  }
  return data;
}

export interface CannonChunk {
  startX: number;
  startY: number;
  startZ: number;
  dirX: number;
  dirZ: number;
  speed: number;
  lift: number;
  /** Seconds until it comes down on `floorY`; it rests there afterwards. */
  landAt: number;
  floorY: number;
  spin: number;
  axisX: number;
  axisY: number;
  axisZ: number;
  size: number;
  /** 0 to 1: which earth shade it takes. */
  shade: number;
}

export function newCannonChunk(): CannonChunk {
  return {
    startX: 0,
    startY: 0,
    startZ: 0,
    dirX: 1,
    dirZ: 0,
    speed: 0,
    lift: 0,
    landAt: 0,
    floorY: 0,
    spin: 0,
    axisX: 1,
    axisY: 0,
    axisZ: 0,
    size: 0,
    shade: 0,
  };
}

function landTime(lift: number, startY: number, floorY: number): number {
  const g = CANNON_BLAST.chunkGravity;
  const disc = lift * lift + 2 * g * (startY - floorY);
  // A floor above the apex (a wall of terrain): it lands at the apex.
  if (disc <= 0) return lift / g;
  return (lift + Math.sqrt(disc)) / g;
}

/**
 * Launches chunk `index` of `count` from a blast at (x, y, z): spread around the
 * blast, thrown out and up at a hashed speed, spinning about a hashed axis. The
 * floor it lands on is sampled once, under where it comes down.
 */
export function cannonChunkLaunch(
  out: CannonChunk,
  seed: number,
  index: number,
  count: number,
  x: number,
  y: number,
  z: number,
  ground: (x: number, z: number) => number,
): CannonChunk {
  const h = (k: number): number => cannonHash01(seed, index * 11 + k);
  const n = Math.max(1, count);
  const angle = ((index + 0.9 * (h(0) - 0.5)) / n) * Math.PI * 2;
  out.dirX = Math.sin(angle);
  out.dirZ = Math.cos(angle);
  const offset = 0.3 + 0.7 * h(1);
  out.startX = x + out.dirX * offset;
  out.startY = y + 0.2;
  out.startZ = z + out.dirZ * offset;
  out.speed = 2.5 + 4 * h(2);
  out.lift = 12 + 4.5 * h(3);
  out.spin = 6 + 10 * h(4);
  const ax = h(5) - 0.5;
  const ay = h(6) - 0.5;
  const az = h(7) - 0.5;
  const len = Math.hypot(ax, ay, az);
  if (len > 1e-6) {
    out.axisX = ax / len;
    out.axisY = ay / len;
    out.axisZ = az / len;
  } else {
    out.axisX = 1;
    out.axisY = 0;
    out.axisZ = 0;
  }
  out.size = 0.2 + 0.26 * h(8);
  out.shade = h(9);
  const guess = landTime(out.lift, out.startY, y);
  const floor = ground(
    out.startX + out.dirX * out.speed * guess,
    out.startZ + out.dirZ * out.speed * guess,
  );
  out.floorY = (Number.isFinite(floor) ? floor : y) + out.size * 0.4;
  out.landAt = landTime(out.lift, out.startY, out.floorY);
  return out;
}

export interface CannonChunkFrame {
  x: number;
  y: number;
  z: number;
  /** Spin angle about the chunk's axis (rad). */
  angle: number;
  /** Size after the shrink at the end of its life (yd). */
  scale: number;
}

/** A chunk `age` seconds into its flight; false before and after its life. */
export function cannonChunkInto(chunk: CannonChunk, age: number, out: CannonChunkFrame): boolean {
  const life = CANNON_BLAST.chunkLife;
  if (!(age >= 0) || age >= life) return false;
  const t = Math.min(age, chunk.landAt);
  out.x = chunk.startX + chunk.dirX * chunk.speed * t;
  out.z = chunk.startZ + chunk.dirZ * chunk.speed * t;
  out.y =
    age < chunk.landAt
      ? chunk.startY + chunk.lift * age - 0.5 * CANNON_BLAST.chunkGravity * age * age
      : chunk.floorY;
  out.angle = chunk.spin * t;
  out.scale = chunk.size * (1 - smoothstep((age - 0.65 * life) / (0.35 * life)));
  return true;
}

export interface CannonPoint {
  x: number;
  y: number;
  z: number;
}

export interface CannonShellSlot {
  /** 0 when the slot is free. */
  shotId: number;
  fromX: number;
  fromY: number;
  fromZ: number;
  toX: number;
  toY: number;
  toZ: number;
  firedTick: number;
  impactTick: number;
  arc: number;
  /** Set by the shot's impact: the shell is gone, its wake fades out. */
  landed: boolean;
  /** Hash seed of its muzzle and wake: the shot id, or its own launch's. */
  seed: number;
  /** The caller's serial for a shell launched ahead of its event (its own shot), else 0. */
  own: number;
  /** An own shell its event took over: the rest of its flight is the event's. */
  adopted: boolean;
  /** Where an adopted flight was re-timed from: the tick, and the progress there. */
  bendTick: number;
  bendProgress: number;
  /** The own aim point less the event's: it fades to nothing over the rest of the flight. */
  offX: number;
  offY: number;
  offZ: number;
  /** Frame seconds an own shell its event never confirmed began to shrink away; NaN otherwise. */
  fadeAt: number;
  /** A fragmentation shell: its wake fizzes, a spark at every drop. */
  fizz: boolean;
  /** The progress its wake ends at: where a shrunk shell vanished, 1 otherwise. */
  endProgress: number;
}

export interface CannonMuzzleSlot {
  active: boolean;
  /** Frame seconds of the frame that consumed the shot. */
  at: number;
  puffCount: number;
  readonly puffs: CannonPuff[];
}

export interface CannonImpactSlot {
  active: boolean;
  x: number;
  y: number;
  z: number;
  /** Frame seconds of the frame that consumed the impact. */
  at: number;
  /** How big the blast reads (cannonBlastPower). */
  power: number;
  chunkCount: number;
  readonly chunks: CannonChunk[];
  puffCount: number;
  readonly puffs: CannonPuff[];
}

export interface CannonScorchSlot {
  active: boolean;
  x: number;
  y: number;
  z: number;
  at: number;
  yaw: number;
  /** Half-width (yd) of the square it is draped over. */
  half: number;
  /** The ground under each draped vertex, sampled once at the impact. */
  readonly heights: Float32Array;
}

function newScorch(): CannonScorchSlot {
  return {
    active: false,
    x: 0,
    y: 0,
    z: 0,
    at: 0,
    yaw: 0,
    half: 0,
    heights: new Float32Array(CANNON_SCORCH_VERTS),
  };
}

export interface CannonFiredShot {
  readonly shotId: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly flightTicks: number;
  readonly impactTick: number;
  /** A fragmentation shell; a plain one when absent. */
  readonly weapon?: 'frag';
}

export interface CannonImpactShot {
  readonly shotId: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Samples the ground under a scorch's (GRID + 1)^2 vertices into `heights`,
 * once per vertex, for every layer draped over it: a square `half` yards from
 * its centre each way, turned by `yaw`. `centre` is the ground under the blast,
 * already sampled by the caller: it is the middle vertex (GRID is even) and the
 * height a vertex with no ground takes. A flat mark buries itself wherever the
 * ground bulges (a 0.15 yd rise over 2 yd hides most of a 5 yd plane), so each
 * vertex takes its own height.
 */
export function cannonScorchHeightsInto(
  heights: Float32Array,
  x: number,
  z: number,
  yaw: number,
  half: number,
  centre: number,
  ground: (x: number, z: number) => number,
): Float32Array {
  const grid = CANNON_SCORCH_GRID;
  const mid = (grid / 2) * (grid + 1) + grid / 2;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  let at = 0;
  for (let j = 0; j <= grid; j++) {
    const v = (j / grid) * 2 - 1;
    for (let i = 0; i <= grid; i++, at++) {
      if (at === mid) {
        heights[at] = centre;
        continue;
      }
      const u = (i / grid) * 2 - 1;
      const g = ground(x + (u * c - v * s) * half, z + (u * s + v * c) * half);
      heights[at] = Number.isFinite(g) ? g : centre;
    }
  }
  return heights;
}

/**
 * Drapes one layer of a scorch over its sampled `heights`
 * (cannonScorchHeightsInto): every vertex at its ground height plus `lift`,
 * written as xyz from `offset` in `out`.
 */
export function cannonScorchDrapeInto(
  out: Float32Array,
  offset: number,
  x: number,
  z: number,
  yaw: number,
  half: number,
  lift: number,
  heights: Float32Array,
): void {
  const grid = CANNON_SCORCH_GRID;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  let at = offset;
  let k = 0;
  for (let j = 0; j <= grid; j++) {
    const v = (j / grid) * 2 - 1;
    for (let i = 0; i <= grid; i++) {
      const u = (i / grid) * 2 - 1;
      out[at++] = x + (u * c - v * s) * half;
      out[at++] = heights[k++] + lift;
      out[at++] = z + (u * s + v * c) * half;
    }
  }
}

/**
 * The shots in flight and the blasts on the ground, in fixed round-robin pools.
 * Fed the seat's fired and impact events once each; read back per frame.
 */
const OWN_POINT: CannonPoint = { x: 0, y: 0, z: 0 };

/** An adopted own shell's progress: its predicted line up to the bend, then on to the impact. */
function adoptedProgress(s: CannonShellSlot, tick: number): number {
  if (tick <= s.bendTick) {
    const head = s.bendTick - s.firedTick;
    return head > 0 ? clamp01(s.bendProgress * ((tick - s.firedTick) / head)) : s.bendProgress;
  }
  const tail = s.impactTick - s.bendTick;
  return tail > 0
    ? clamp01(s.bendProgress + (1 - s.bendProgress) * ((tick - s.bendTick) / tail))
    : 1;
}

/**
 * An adopted own shell's point at progress `t`: on its own aim up to the bend,
 * then on the event's arc plus the gap it had at the bend, fading to nothing
 * by the impact.
 */
function adoptedPointInto(s: CannonShellSlot, t: number, out: CannonPoint): void {
  const bend = s.bendProgress;
  const gap = t <= bend ? t : bend < 1 ? (bend * (1 - t)) / (1 - bend) : 0;
  out.x = s.fromX + (s.toX - s.fromX) * t + s.offX * gap;
  out.z = s.fromZ + (s.toZ - s.fromZ) * t + s.offZ * gap;
  out.y = s.fromY + (s.toY - s.fromY) * t + s.arc * 4 * t * (1 - t) + s.offY * gap;
}

function slotProgress(s: CannonShellSlot, tick: number): number {
  if (s.adopted) return adoptedProgress(s, tick);
  const span = s.impactTick - s.firedTick;
  return span > 0 ? clamp01((tick - s.firedTick) / span) : 1;
}

/** The tick an own shell passed progress `t`: the inverse of its progress. */
function ownTickAt(s: CannonShellSlot, t: number): number {
  if (s.adopted && t < s.bendProgress) {
    return s.firedTick + (t / s.bendProgress) * (s.bendTick - s.firedTick);
  }
  const from = s.adopted ? s.bendTick : s.firedTick;
  const p0 = s.adopted ? s.bendProgress : 0;
  return p0 < 1 ? from + ((t - p0) / (1 - p0)) * (s.impactTick - from) : from;
}

/**
 * An own shell's wake (CannonShotTimeline.trailPuffsInto): dropped along the path it
 * actually flew, on its own timing, and ending where a shrunk shell vanished. The
 * spacing comes from its launch's aim, so an adoption moves no puff already dropped.
 */
function ownTrailInto(
  s: CannonShellSlot,
  tick: number,
  out: CannonPuff[],
  ages: Float32Array,
): number {
  const { smokeLife, sparkLife, spacing } = CANNON_TRAIL;
  if (tick < s.firedTick) return 0;
  const reach = Math.min(slotProgress(s, tick), s.endProgress);
  if ((tick - ownTickAt(s, reach)) * DT >= smokeLife) {
    s.shotId = 0;
    s.own = 0;
    return 0;
  }
  const length =
    Math.hypot(s.toX + s.offX - s.fromX, s.toY + s.offY - s.fromY, s.toZ + s.offZ - s.fromZ) +
    s.arc * 0.6;
  const drops = Math.max(1, Math.ceil(length / spacing));
  const last = Math.floor(reach * drops);
  const cap = Math.min(out.length, ages.length);
  const p = OWN_POINT;
  let n = 0;
  for (let k = Math.min(last, drops); k >= 0 && n < cap; k--) {
    const t = k / drops;
    const age = (tick - ownTickAt(s, t)) * DT;
    if (age >= smokeLife) break;
    if (s.adopted) adoptedPointInto(s, t, p);
    else {
      p.x = s.fromX + (s.toX - s.fromX) * t;
      p.z = s.fromZ + (s.toZ - s.fromZ) * t;
      p.y = s.fromY + (s.toY - s.fromY) * t + s.arc * 4 * t * (1 - t);
    }
    cannonTrailPuffInto(out[n], s.seed, k, false, p.x, p.y, p.z);
    ages[n++] = age;
    if ((s.fizz || (k & 1) === 1) && age < sparkLife && n < cap) {
      cannonTrailPuffInto(out[n], s.seed, k, true, p.x, p.y, p.z);
      ages[n++] = age;
    }
  }
  return n;
}

export class CannonShotTimeline {
  readonly shells: CannonShellSlot[] = Array.from({ length: CANNON_SHELL_POOL }, () => ({
    shotId: 0,
    fromX: 0,
    fromY: 0,
    fromZ: 0,
    toX: 0,
    toY: 0,
    toZ: 0,
    firedTick: 0,
    impactTick: 0,
    arc: 0,
    landed: false,
    seed: 0,
    own: 0,
    adopted: false,
    bendTick: 0,
    bendProgress: 0,
    offX: 0,
    offY: 0,
    offZ: 0,
    fadeAt: Number.NaN,
    endProgress: 1,
    fizz: false,
  }));
  readonly muzzles: CannonMuzzleSlot[] = Array.from({ length: CANNON_MUZZLE_POOL }, () => ({
    active: false,
    at: 0,
    puffCount: 0,
    puffs: Array.from({ length: CANNON_MUZZLE_PUFFS }, newCannonPuff),
  }));
  readonly impacts: CannonImpactSlot[];
  readonly scorches: CannonScorchSlot[] = Array.from({ length: CANNON_SCORCH_POOL }, newScorch);
  /** A slam's cracked ground mark: one slot of its own, the newest slam's. */
  readonly groundMark: CannonScorchSlot = newScorch();
  /** Frame seconds of the last shot's muzzle (the recoil runs from it). */
  muzzleAt = Number.NEGATIVE_INFINITY;
  /** The scorch slot the last impact took. */
  lastScorch = -1;
  private nextShell = 0;
  private nextMuzzle = 0;
  private nextScorch = 0;

  /**
   * `impactPool` blasts stay on the ground at once; the next one takes the lowest
   * free slot, so the chunks drawn reach only as far as the live blasts do, or over
   * the oldest when none is free. A shell whose flight is over waits at its blast point for its impact
   * for up to `holdTicks` (an own one once adopted), for a display tick that runs
   * ahead of the clock bringing the impact.
   */
  constructor(
    impactPool: number = CANNON_IMPACT_POOL,
    private readonly holdTicks = 0,
  ) {
    this.impacts = Array.from({ length: Math.max(1, Math.floor(impactPool)) }, () => ({
      active: false,
      x: 0,
      y: 0,
      z: 0,
      at: 0,
      power: 1,
      chunkCount: 0,
      chunks: Array.from({ length: CANNON_CHUNKS_PER_IMPACT }, newCannonChunk),
      puffCount: 0,
      puffs: Array.from({ length: CANNON_BLAST_PUFFS }, newCannonPuff),
    }));
  }

  private takeImpact(): number {
    const impacts = this.impacts;
    let oldest = 0;
    for (let i = 0; i < impacts.length; i++) {
      if (!impacts[i].active) return i;
      if (impacts[i].at < impacts[oldest].at) oldest = i;
    }
    return oldest;
  }

  clear(): void {
    for (const shell of this.shells) {
      shell.shotId = 0;
      shell.own = 0;
    }
    for (const muzzle of this.muzzles) muzzle.active = false;
    for (const impact of this.impacts) impact.active = false;
    for (const scorch of this.scorches) scorch.active = false;
    this.groundMark.active = false;
    this.muzzleAt = Number.NEGATIVE_INFINITY;
    this.lastScorch = -1;
  }

  /**
   * A shell leaves `muzzle` toward the blast point along the barrel's unit
   * axis `dir`, breathing `smoke` puffs; returns its shell slot.
   */
  fired(
    shot: CannonFiredShot,
    muzzle: CannonPoint,
    dir: CannonPoint,
    time: number,
    smoke: number,
    report = true,
  ): number {
    const index = this.launch(
      shot.shotId,
      shot.shotId,
      shot,
      shot.impactTick - shot.flightTicks,
      shot.impactTick,
      muzzle,
    );
    this.shells[index].fizz = shot.weapon === 'frag';
    if (report) this.report(shot.shotId, muzzle, dir, time, smoke);
    return index;
  }

  /**
   * A shell the caller launches ahead of its event (its own shot, on the click),
   * named by the caller's `serial`, with its muzzle report: it flies toward
   * `target` from `firedTick` to the predicted `impactTick` until `adoptOwn`
   * hands it the event's flight; a fragmentation shell's (`fizz`) wake fizzes
   * from the muzzle. Returns its shell slot.
   */
  launchOwn(
    serial: number,
    target: CannonPoint,
    firedTick: number,
    impactTick: number,
    muzzle: CannonPoint,
    dir: CannonPoint,
    time: number,
    smoke: number,
    fizz = false,
  ): number {
    // Negative: never a real shot id, so no impact lands it before it is adopted.
    const index = this.launch(-serial, -serial, target, firedTick, impactTick, muzzle);
    this.shells[index].own = serial;
    this.shells[index].fizz = fizz;
    this.report(-serial, muzzle, dir, time, smoke);
    return index;
  }

  /**
   * The event of own launch `serial` arrived at display `tick`: the shell keeps its
   * progress, the rest of its flight lands on the event's impact tick, and its
   * offset from the event's point fades to nothing on the way. False when no
   * shell of that launch still flies (its slot recycled, shrunk away or spent).
   */
  adoptOwn(serial: number, shot: CannonFiredShot, tick: number): boolean {
    for (let i = 0; i < this.shells.length; i++) {
      const s = this.shells[i];
      if (s.own !== serial || s.shotId === 0 || s.adopted || s.landed) continue;
      if (!Number.isNaN(s.fadeAt)) continue;
      const at = Math.max(tick, s.firedTick);
      const progress = this.progress(i, at);
      if (progress >= 1) return false;
      s.bendProgress = progress;
      s.bendTick = at;
      s.offX = s.toX - shot.x;
      s.offY = s.toY - shot.y;
      s.offZ = s.toZ - shot.z;
      s.toX = shot.x;
      s.toY = shot.y;
      s.toZ = shot.z;
      s.impactTick = shot.impactTick;
      s.shotId = shot.shotId;
      s.adopted = true;
      s.fizz = shot.weapon === 'frag';
      return true;
    }
    return false;
  }

  /** Own shells no event adopted whose launch `refused` names start shrinking away at `time`. */
  fadeRefused(refused: (serial: number) => boolean, time: number): void {
    for (const s of this.shells) {
      if (s.own === 0 || s.shotId === 0 || s.adopted || s.landed) continue;
      if (Number.isNaN(s.fadeAt) && refused(s.own)) s.fadeAt = time;
    }
  }

  /** A shrunk shell is gone: its wake ends where it vanished, with no blast. */
  settleFades(tick: number, time: number): void {
    for (let i = 0; i < this.shells.length; i++) {
      const s = this.shells[i];
      if (s.landed || s.shotId === 0 || !(time - s.fadeAt >= CANNON_OWN_FADE_SECONDS)) continue;
      s.endProgress = this.progress(i, tick);
      s.landed = true;
    }
  }

  /** The shell's size at `time`: 1, or shrinking to 0 once it began to fade. */
  shellScale(index: number, time: number): number {
    const fadeAt = this.shells[index].fadeAt;
    if (Number.isNaN(fadeAt)) return 1;
    return clamp01(1 - (time - fadeAt) / CANNON_OWN_FADE_SECONDS);
  }

  private launch(
    shotId: number,
    seed: number,
    target: CannonPoint,
    firedTick: number,
    impactTick: number,
    muzzle: CannonPoint,
  ): number {
    const index = this.nextShell;
    this.nextShell = (index + 1) % this.shells.length;
    const slot = this.shells[index];
    slot.shotId = shotId;
    slot.fromX = muzzle.x;
    slot.fromY = muzzle.y;
    slot.fromZ = muzzle.z;
    slot.toX = target.x;
    slot.toY = target.y;
    slot.toZ = target.z;
    slot.impactTick = impactTick;
    slot.firedTick = firedTick;
    slot.arc = cannonShellArc(
      Math.hypot(target.x - muzzle.x, target.z - muzzle.z),
      target.y - muzzle.y,
    );
    slot.landed = false;
    slot.seed = seed;
    slot.own = 0;
    slot.adopted = false;
    slot.bendTick = firedTick;
    slot.bendProgress = 0;
    slot.offX = 0;
    slot.offY = 0;
    slot.offZ = 0;
    slot.fadeAt = Number.NaN;
    slot.endProgress = 1;
    slot.fizz = false;
    return index;
  }

  private report(
    seed: number,
    muzzle: CannonPoint,
    dir: CannonPoint,
    time: number,
    smoke: number,
  ): void {
    this.muzzleAt = time;
    const puffs = this.muzzles[this.nextMuzzle];
    this.nextMuzzle = (this.nextMuzzle + 1) % this.muzzles.length;
    puffs.active = true;
    puffs.at = time;
    puffs.puffCount = cannonMuzzlePuffs(
      puffs.puffs,
      seed,
      muzzle.x,
      muzzle.y,
      muzzle.z,
      dir.x,
      dir.y,
      dir.z,
      Math.max(0, Math.min(CANNON_MUZZLE_PUFFS - CANNON_MUZZLE_FIXED_PUFFS, smoke)),
    );
  }

  /**
   * The blast of shot `shotId`: its shell lands, and a blast of `power`
   * (cannonBlastPower), its chunks, its puffs and a scorch start. The ground
   * is sampled once per point that needs it: under the blast (shared by the
   * ring, the sparks and the scorch's middle vertex), under each chunk, ring
   * puff and clod, and under each scorch vertex for all of its layers.
   */
  impact(
    shot: CannonImpactShot,
    time: number,
    counts: Readonly<CannonShotCounts>,
    radius: number,
    power: number,
    ground: (x: number, z: number) => number,
  ): number {
    this.land(shot.shotId);
    const index = this.takeImpact();
    const slot = this.impacts[index];
    slot.active = true;
    slot.x = shot.x;
    slot.y = shot.y;
    slot.z = shot.z;
    slot.at = time;
    slot.power = power;
    const under = ground(shot.x, shot.z);
    const centre = Number.isFinite(under) ? under : shot.y;
    slot.chunkCount = Math.max(0, Math.min(CANNON_CHUNKS_PER_IMPACT, counts.chunks));
    for (let i = 0; i < slot.chunkCount; i++) {
      cannonChunkLaunch(
        slot.chunks[i],
        shot.shotId,
        i,
        slot.chunkCount,
        shot.x,
        shot.y,
        shot.z,
        ground,
      );
    }
    slot.puffCount = cannonBlastPuffs(
      slot.puffs,
      shot.shotId,
      shot.x,
      shot.y,
      shot.z,
      radius,
      power,
      {
        dust: Math.min(FULL_COUNTS.dust, counts.dust),
        dirt: Math.min(FULL_COUNTS.dirt, counts.dirt),
        sparks: Math.min(FULL_COUNTS.sparks, counts.sparks),
        smoke: 0,
      },
      ground,
      centre,
    );
    this.lastScorch = this.nextScorch;
    const scorch = this.scorches[this.nextScorch];
    this.nextScorch = (this.nextScorch + 1) % this.scorches.length;
    scorch.active = true;
    scorch.x = shot.x;
    scorch.y = shot.y;
    scorch.z = shot.z;
    scorch.at = time;
    scorch.yaw = cannonHash01(shot.shotId, 997) * Math.PI * 2;
    scorch.half = radius * CANNON_BLAST.scorchScale;
    cannonScorchHeightsInto(
      scorch.heights,
      shot.x,
      shot.z,
      scorch.yaw,
      scorch.half,
      centre,
      ground,
    );
    return index;
  }

  /**
   * Shot `shotId` bursts in the air at (x, y, z): its shell is gone, and an
   * impact slot shows the airburst's puffs (`counts`), with no chunk and no
   * scorch. Returns the slot.
   */
  airburst(
    shotId: number,
    x: number,
    y: number,
    z: number,
    time: number,
    counts: Readonly<CannonAirburstCounts>,
  ): number {
    this.land(shotId);
    const index = this.takeImpact();
    const slot = this.impacts[index];
    slot.active = true;
    slot.x = x;
    slot.y = y;
    slot.z = z;
    slot.at = time;
    slot.power = 1;
    slot.chunkCount = 0;
    slot.puffCount = cannonAirburstPuffs(slot.puffs, shotId, x, y, z, counts);
    return index;
  }

  /**
   * A slam's cracked mark around (x, z), `half` yards each way, laid at `time`
   * in the ground-mark slot (a newer slam's takes it over), its ground sampled
   * once per vertex as a scorch's is.
   */
  markGround(
    seed: number,
    x: number,
    y: number,
    z: number,
    half: number,
    time: number,
    ground: (x: number, z: number) => number,
  ): void {
    const mark = this.groundMark;
    const under = ground(x, z);
    mark.active = true;
    mark.x = x;
    mark.y = y;
    mark.z = z;
    mark.at = time;
    mark.yaw = cannonHash01(seed, 991) * Math.PI * 2;
    mark.half = half;
    cannonScorchHeightsInto(
      mark.heights,
      x,
      z,
      mark.yaw,
      half,
      Number.isFinite(under) ? under : y,
      ground,
    );
  }

  /** The shell of shot `shotId` is down (an own one only once adopted). */
  private land(shotId: number): void {
    // An own shell not yet adopted flies on a caller's serial, which a blast's id may equal.
    for (const shell of this.shells) {
      if (shell.shotId === shotId && (shell.own === 0 || shell.adopted)) shell.landed = true;
    }
  }

  /** The shell's progress along its arc at `tick` (0 at the muzzle, 1 at the blast). */
  progress(index: number, tick: number): number {
    return slotProgress(this.shells[index], tick);
  }

  /** Writes the shell's point at progress `t` along its arc. */
  arcPointInto(index: number, t: number, out: CannonPoint): void {
    const s = this.shells[index];
    if (s.adopted) {
      adoptedPointInto(s, t, out);
      return;
    }
    out.x = s.fromX + (s.toX - s.fromX) * t;
    out.z = s.fromZ + (s.toZ - s.fromZ) * t;
    out.y = s.fromY + (s.toY - s.fromY) * t + s.arc * 4 * t * (1 - t);
  }

  /** Writes the shell's point at `tick`; false when no shell flies in this slot
   *  (free, landed, or not yet or no longer in the air, past any hold). */
  shellAt(index: number, tick: number, out: CannonPoint): boolean {
    const s = this.shells[index];
    if (!s || s.shotId === 0 || s.landed) return false;
    if (tick < s.firedTick) return false;
    const t = this.progress(index, tick);
    if (t >= 1 && !this.waiting(s, tick)) return false;
    this.arcPointInto(index, t, out);
    return true;
  }

  private waiting(s: CannonShellSlot, tick: number): boolean {
    return (
      this.holdTicks > 0 && (s.own === 0 || s.adopted) && tick - s.impactTick <= this.holdTicks
    );
  }

  /** Seconds the shell in `index` has flown at `tick`. */
  shellAge(index: number, tick: number): number {
    return (tick - this.shells[index].firedTick) * DT;
  }

  /**
   * The live wake of shell `index` at `tick`, newest first: its puffs written
   * into `out` from index 0 with each one's age in `ages`; returns how many. A
   * puff drops every CANNON_TRAIL.spacing yards of the arc (by distance, so a
   * fast shell leaves an unbroken line) at the moment the shell passed there,
   * and lives on after the shell lands. A slot whose wake is spent is freed.
   */
  trailPuffsInto(index: number, tick: number, out: CannonPuff[], ages: Float32Array): number {
    const s = this.shells[index];
    if (!s || s.shotId === 0) return 0;
    if (s.own !== 0) return ownTrailInto(s, tick, out, ages);
    const { smokeLife, sparkLife, spacing } = CANNON_TRAIL;
    const flight = Math.max(0, s.impactTick - s.firedTick) * DT;
    const elapsed = (tick - s.firedTick) * DT;
    if (elapsed < 0) return 0;
    if (elapsed >= flight + smokeLife) {
      s.shotId = 0;
      return 0;
    }
    const length = Math.hypot(s.toX - s.fromX, s.toY - s.fromY, s.toZ - s.fromZ) + s.arc * 0.6;
    const drops = Math.max(1, Math.ceil(length / spacing));
    const last = flight > 0 ? Math.floor((Math.min(elapsed, flight) / flight) * drops) : drops;
    const cap = Math.min(out.length, ages.length);
    let n = 0;
    for (let k = Math.min(last, drops); k >= 0 && n < cap; k--) {
      const t = k / drops;
      const age = elapsed - t * flight;
      if (age >= smokeLife) break;
      const x = s.fromX + (s.toX - s.fromX) * t;
      const y = s.fromY + (s.toY - s.fromY) * t + s.arc * 4 * t * (1 - t);
      const z = s.fromZ + (s.toZ - s.fromZ) * t;
      cannonTrailPuffInto(out[n], s.shotId, k, false, x, y, z);
      ages[n++] = age;
      if ((s.fizz || (k & 1) === 1) && age < sparkLife && n < cap) {
        cannonTrailPuffInto(out[n], s.shotId, k, true, x, y, z);
        ages[n++] = age;
      }
    }
    return n;
  }
}
