// The cannon shot on screen, the pure half: the shell's arc from the muzzle to
// the blast and the trail it drops, the muzzle flash and the barrel's recoil
// spring, the impact flash and shockwave, the dirt chunks' closed-form flights,
// the scorch mark's fade, the camera shake by distance and the counts the low
// preset sheds. The Three consumer is cannon_shell_visuals.ts; the Ground Blast
// of Realm Racers is where the shell, trail, flash and shockwave curves come from.
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

export const CANNON_SHELL = {
  /** Arc height above the chord, as a share of the span, clamped. */
  arcFraction: 0.18,
  arcMin: 2.5,
  arcMax: 7,
  trailMotes: 16,
  /** Seconds a trail mote lingers; one drops every trailLife / trailMotes seconds. */
  trailLife: 0.32,
  /** Shell spin (rad/s) and its glow's pulse. */
  spinY: 9,
  spinX: 6,
  glowPulse: 0.12,
  glowRate: 30,
} as const;

export const CANNON_MUZZLE = {
  flashLife: 0.08,
  /** The barrel's kick back along its own axis (local units) and its spring. */
  recoilKick: 0.35,
  recoilAttack: 0.035,
  recoilLife: 0.25,
  fovPunch: 2,
  /** Camera trauma per shot: the renderer squares trauma, so this is a light kick. */
  shake: 0.22,
} as const;

export const CANNON_BLAST = {
  flashLife: 0.28,
  flashLift: 0.9,
  waveLife: 0.45,
  /** The shockwave runs out to (0.4 + waveReach) blast radii. */
  waveReach: 2.4,
  waveLift: 0.12,
  chunkLife: 1.6,
  chunkGravity: 26,
  /** Seconds the scorch holds before it starts to fade, and its whole life. */
  scorchHold: 1.5,
  scorchLife: 8,
  /** Scorch radius, as a share of the blast radius. */
  scorchScale: 0.45,
  /** Camera shake of a blast: full within `full` yards of the turret, none past `zero`. */
  shake: 0.55,
  shakeFull: 10,
  shakeZero: 40,
} as const;

export const CANNON_SHELL_POOL = 4;
export const CANNON_IMPACT_POOL = 6;
export const CANNON_SCORCH_POOL = 18;
export const CANNON_CHUNKS_PER_IMPACT = 12;

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

function smoothstep(n: number): number {
  const t = clamp01(n);
  return t * t * (3 - 2 * t);
}

/** Cosmetic counts per shot. The low preset sheds these only: the shell, the
 *  flash, the shockwave and the AoE ring are the same on every tier. */
export interface CannonShotCounts {
  chunks: number;
  /** Debris particles of the dirt burst. */
  dirt: number;
  /** Dust puffs around the blast. */
  dust: number;
  sparks: number;
  /** Smoke puffs at the muzzle. */
  smoke: number;
}

const FULL_COUNTS: Readonly<CannonShotCounts> = {
  chunks: 12,
  dirt: 28,
  dust: 3,
  sparks: 14,
  smoke: 2,
};
const LOW_COUNTS: Readonly<CannonShotCounts> = {
  chunks: 5,
  dirt: 12,
  dust: 1,
  sparks: 4,
  smoke: 1,
};

export function cannonShotCounts(low: boolean): Readonly<CannonShotCounts> {
  return low ? LOW_COUNTS : FULL_COUNTS;
}

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

export interface CannonMuzzleFlashFrame {
  /** Radius of the hot core (yd). */
  core: number;
  /** Length and width of the flame tongue along the barrel (yd). */
  length: number;
  width: number;
}

/** The muzzle flash `age` seconds after the shot; false once it is spent. */
export function cannonMuzzleFlashInto(age: number, out: CannonMuzzleFlashFrame): boolean {
  if (!(age >= 0) || age >= CANNON_MUZZLE.flashLife) return false;
  const u = age / CANNON_MUZZLE.flashLife;
  const env = u < 0.2 ? 0.6 + 2 * u : (1 - u) / 0.8;
  out.core = 0.7 * env;
  out.length = 1.9 * env * (0.8 + 0.4 * u);
  out.width = 0.42 * env;
  return true;
}

export interface CannonBurstFrame {
  /** Scale of the flash sphere or the shockwave ring (yd). */
  scale: number;
  /** Brightness, 0 to 1 (an additive fade). */
  fade: number;
}

/** The impact flash sphere `age` seconds after the blast; false once it is spent. */
export function cannonFlashInto(age: number, radius: number, out: CannonBurstFrame): boolean {
  if (!(age >= 0) || age >= CANNON_BLAST.flashLife) return false;
  const t = age / CANNON_BLAST.flashLife;
  out.scale = radius * (0.35 + 0.9 * t);
  out.fade = (1 - t) * (1 - t);
  return true;
}

/** The ground shockwave `age` seconds after the blast; false once it is spent. */
export function cannonWaveInto(age: number, radius: number, out: CannonBurstFrame): boolean {
  if (!(age >= 0) || age >= CANNON_BLAST.waveLife) return false;
  const t = age / CANNON_BLAST.waveLife;
  out.scale = radius * (0.4 + CANNON_BLAST.waveReach * t);
  out.fade = 0.9 * (1 - t) ** 1.5;
  return true;
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
 * the ground (a subtractive blend), strongest at the centre, broken by a coarse
 * soot mottle and radial burn streaks, zero at the rim, and a little more in
 * blue than in red so the mark reads as brown char rather than grey.
 */
export function cannonScorchTexels(size: number): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  const cells = 6;
  const mottle = (u: number, v: number): number => {
    const x = (u * 0.5 + 0.5) * cells;
    const y = (v * 0.5 + 0.5) * cells;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = smoothstep(x - x0);
    const fy = smoothstep(y - y0);
    const at = (i: number, j: number): number => cannonHash01(i * 131 + 7, j);
    const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
    const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
    return top + (bottom - top) * fy;
  };
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = ((i + 0.5) / size) * 2 - 1;
      const v = ((j + 0.5) / size) * 2 - 1;
      const r = Math.hypot(u, v);
      const angle = Math.atan2(v, u);
      const core = 1 - smoothstep((r - 0.12) / 0.62);
      const streak = Math.max(0, Math.cos(angle * 9 + 0.9 * Math.sin(angle * 4))) ** 6;
      const reach = 1 - smoothstep((r - 0.35) / 0.6);
      const soot = mottle(u, v);
      const dark = clamp01(core * (0.55 + 0.45 * soot) + streak * reach * 0.45 * soot);
      const amount = r >= 0.98 ? 0 : 0.78 * dark;
      const at = (j * size + i) * 4;
      data[at] = Math.round(255 * amount * 0.86);
      data[at + 1] = Math.round(255 * amount * 0.92);
      data[at + 2] = Math.round(255 * amount);
      data[at + 3] = 255;
    }
  }
  return data;
}

/** A uniform draw in [0, 1) from two integers (a stateless hash, no random source). */
export function cannonHash01(a: number, b: number): number {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca77);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
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
  out.speed = 4.5 + 5 * h(2);
  out.lift = 6 + 6 * h(3);
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
  out.size = 0.14 + 0.2 * h(8);
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
  /** Set by the shot's impact: the shell is gone, its trail fades out. */
  landed: boolean;
}

export interface CannonImpactSlot {
  active: boolean;
  x: number;
  y: number;
  z: number;
  /** Frame seconds of the frame that consumed the impact. */
  at: number;
  chunkCount: number;
  readonly chunks: CannonChunk[];
}

export interface CannonScorchSlot {
  active: boolean;
  x: number;
  y: number;
  z: number;
  at: number;
  yaw: number;
  /** The ground's unit normal under it. */
  nx: number;
  ny: number;
  nz: number;
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

/** Samples the ground normal at (x, z) from four heights a yard apart. */
export function cannonGroundNormalInto(
  ground: (x: number, z: number) => number,
  x: number,
  z: number,
  out: { nx: number; ny: number; nz: number },
): void {
  const dx = (ground(x - 1, z) - ground(x + 1, z)) / 2;
  const dz = (ground(x, z - 1) - ground(x, z + 1)) / 2;
  const len = Math.hypot(dx, 1, dz);
  if (!Number.isFinite(len) || len < 1e-6) {
    out.nx = 0;
    out.ny = 1;
    out.nz = 0;
    return;
  }
  out.nx = dx / len;
  out.ny = 1 / len;
  out.nz = dz / len;
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
  readonly impacts: CannonImpactSlot[] = Array.from({ length: CANNON_IMPACT_POOL }, () => ({
    active: false,
    x: 0,
    y: 0,
    z: 0,
    at: 0,
    chunkCount: 0,
    chunks: Array.from({ length: CANNON_CHUNKS_PER_IMPACT }, newCannonChunk),
  }));
  readonly scorches: CannonScorchSlot[] = Array.from({ length: CANNON_SCORCH_POOL }, () => ({
    active: false,
    x: 0,
    y: 0,
    z: 0,
    at: 0,
    yaw: 0,
    nx: 0,
    ny: 1,
    nz: 0,
  }));
  /** Frame seconds of the last shot's muzzle (its flash and the recoil run from it). */
  muzzleAt = Number.NEGATIVE_INFINITY;
  /** The scorch slot the last impact took. */
  lastScorch = -1;
  private nextShell = 0;
  private nextImpact = 0;
  private nextScorch = 0;

  clear(): void {
    for (const shell of this.shells) shell.shotId = 0;
    for (const impact of this.impacts) impact.active = false;
    for (const scorch of this.scorches) scorch.active = false;
    this.muzzleAt = Number.NEGATIVE_INFINITY;
    this.lastScorch = -1;
  }

  /** A shell leaves `muzzle` toward the blast point; returns its slot. */
  fired(shot: CannonFiredShot, muzzle: CannonPoint, time: number): number {
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
    return index;
  }

  /** The blast of shot `shotId`: its shell lands, and a blast, chunks and a scorch start. */
  impact(
    shot: CannonImpactShot,
    time: number,
    chunkCount: number,
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
    slot.chunkCount = Math.max(0, Math.min(CANNON_CHUNKS_PER_IMPACT, chunkCount));
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
    this.lastScorch = this.nextScorch;
    const scorch = this.scorches[this.nextScorch];
    this.nextScorch = (this.nextScorch + 1) % this.scorches.length;
    scorch.active = true;
    scorch.x = shot.x;
    scorch.y = shot.y;
    scorch.z = shot.z;
    scorch.at = time;
    scorch.yaw = cannonHash01(shot.shotId, 997) * Math.PI * 2;
    cannonGroundNormalInto(ground, shot.x, shot.z, scorch);
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
   * The live trail motes of shell `index` at `tick`, newest first, as (x, y, z,
   * scale) quads in `out`; returns how many. A mote drops every trailLife /
   * trailMotes seconds of the flight and shrinks away over trailLife, so the
   * trail keeps fading after the shell lands. A slot whose trail is spent is freed.
   */
  trailInto(index: number, tick: number, out: Float32Array): number {
    const s = this.shells[index];
    if (!s || s.shotId === 0) return 0;
    const { trailLife, trailMotes } = CANNON_SHELL;
    const flight = Math.max(0, s.impactTick - s.firedTick) * DT;
    const age = (tick - s.firedTick) * DT;
    if (age < 0) return 0;
    if (age >= flight + trailLife) {
      s.shotId = 0;
      return 0;
    }
    const interval = trailLife / trailMotes;
    const last = Math.floor(Math.min(age, flight) / interval);
    let n = 0;
    for (let k = last; k >= 0 && n < trailMotes && (n + 1) * 4 <= out.length; k--) {
      const moteAge = age - k * interval;
      if (moteAge >= trailLife) break;
      const life = 1 - moteAge / trailLife;
      const t = flight > 0 ? Math.min(1, (k * interval) / flight) : 1;
      const at = n * 4;
      out[at] = s.fromX + (s.toX - s.fromX) * t;
      out[at + 1] = s.fromY + (s.toY - s.fromY) * t + s.arc * 4 * t * (1 - t);
      out[at + 2] = s.fromZ + (s.toZ - s.fromZ) * t;
      out[at + 3] = life * life;
      n++;
    }
    return n;
  }
}
