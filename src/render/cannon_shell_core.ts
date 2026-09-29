// The cannon shot on screen, the pure half: the shell's arc from the muzzle to
// the blast and the wake it drops, the barrel's recoil spring, the dirt chunks'
// closed-form flights, the scorch draped on the ground and its fade, the camera
// shake by distance and the counts the low preset sheds, plus the pools every
// event's puffs (cannon_puff_core.ts) are launched into. The Three consumer is
// cannon_shell_visuals.ts; the Realm Racers Ground Blast is where the shell's
// arc comes from.
//
// Two clocks: a shell flies on the sim tick (fractional, from the display clock)
// so it lands on the tick its blast resolves; everything an event starts (the
// muzzle, the blast, the chunks, the scorch) runs on frame seconds from the frame
// that consumed it, so a flash is never seen half spent.
//
// Three/DOM/i18n-free (RENDER_PURE_CORES), deterministic (a chunk's spread is a
// hash of its impact and index) and allocation-free per frame: fixed pools
// refilled in place.

import { DT } from '../sim/types';
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

export interface CannonFiredShot {
  readonly shotId: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly flightTicks: number;
  readonly impactTick: number;
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
  }));
  readonly muzzles: CannonMuzzleSlot[] = Array.from({ length: CANNON_MUZZLE_POOL }, () => ({
    active: false,
    at: 0,
    puffCount: 0,
    puffs: Array.from({ length: CANNON_MUZZLE_PUFFS }, newCannonPuff),
  }));
  readonly impacts: CannonImpactSlot[] = Array.from({ length: CANNON_IMPACT_POOL }, () => ({
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
  readonly scorches: CannonScorchSlot[] = Array.from({ length: CANNON_SCORCH_POOL }, () => ({
    active: false,
    x: 0,
    y: 0,
    z: 0,
    at: 0,
    yaw: 0,
    half: 0,
    heights: new Float32Array(CANNON_SCORCH_VERTS),
  }));
  /** Frame seconds of the last shot's muzzle (the recoil runs from it). */
  muzzleAt = Number.NEGATIVE_INFINITY;
  /** The scorch slot the last impact took. */
  lastScorch = -1;
  private nextShell = 0;
  private nextMuzzle = 0;
  private nextImpact = 0;
  private nextScorch = 0;

  clear(): void {
    for (const shell of this.shells) shell.shotId = 0;
    for (const muzzle of this.muzzles) muzzle.active = false;
    for (const impact of this.impacts) impact.active = false;
    for (const scorch of this.scorches) scorch.active = false;
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
  ): number {
    const index = this.nextShell;
    this.nextShell = (index + 1) % this.shells.length;
    const slot = this.shells[index];
    slot.shotId = shot.shotId;
    slot.fromX = muzzle.x;
    slot.fromY = muzzle.y;
    slot.fromZ = muzzle.z;
    slot.toX = shot.x;
    slot.toY = shot.y;
    slot.toZ = shot.z;
    slot.impactTick = shot.impactTick;
    slot.firedTick = shot.impactTick - shot.flightTicks;
    slot.arc = cannonArcHeight(Math.hypot(shot.x - muzzle.x, shot.z - muzzle.z));
    slot.landed = false;
    this.muzzleAt = time;
    const puffs = this.muzzles[this.nextMuzzle];
    this.nextMuzzle = (this.nextMuzzle + 1) % this.muzzles.length;
    puffs.active = true;
    puffs.at = time;
    puffs.puffCount = cannonMuzzlePuffs(
      puffs.puffs,
      shot.shotId,
      muzzle.x,
      muzzle.y,
      muzzle.z,
      dir.x,
      dir.y,
      dir.z,
      Math.max(0, Math.min(CANNON_MUZZLE_PUFFS - CANNON_MUZZLE_FIXED_PUFFS, smoke)),
    );
    return index;
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
    for (const shell of this.shells) if (shell.shotId === shot.shotId) shell.landed = true;
    const index = this.nextImpact;
    this.nextImpact = (index + 1) % this.impacts.length;
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

  /** The shell's progress along its arc at `tick` (0 at the muzzle, 1 at the blast). */
  progress(index: number, tick: number): number {
    const s = this.shells[index];
    const span = s.impactTick - s.firedTick;
    return span > 0 ? clamp01((tick - s.firedTick) / span) : 1;
  }

  /** Writes the shell's point at progress `t` along its arc. */
  arcPointInto(index: number, t: number, out: CannonPoint): void {
    const s = this.shells[index];
    out.x = s.fromX + (s.toX - s.fromX) * t;
    out.z = s.fromZ + (s.toZ - s.fromZ) * t;
    out.y = s.fromY + (s.toY - s.fromY) * t + s.arc * 4 * t * (1 - t);
  }

  /** Writes the shell's point at `tick`; false when no shell flies in this slot
   *  (free, landed, or not yet or no longer in the air). */
  shellAt(index: number, tick: number, out: CannonPoint): boolean {
    const s = this.shells[index];
    if (!s || s.shotId === 0 || s.landed) return false;
    if (tick < s.firedTick) return false;
    const t = this.progress(index, tick);
    if (t >= 1) return false;
    this.arcPointInto(index, t, out);
    return true;
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
      if ((k & 1) === 1 && age < sparkLife && n < cap) {
        cannonTrailPuffInto(out[n], s.shotId, k, true, x, y, z);
        ages[n++] = age;
      }
    }
    return n;
  }
}
