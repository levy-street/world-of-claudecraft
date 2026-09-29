// Fire and Fly explosive barrels on screen, the pure half: a new barrel's pop
// up, its warning ring's breathing, the shake and swell through the fuse, the
// sparks the fuse throws, the tall fire column of its blast and the drum's
// shards flying off. The Three consumer is turret_barrel_visual.ts; the
// blast's flash, fireball, shock ring, dust, dirt and scorch are the cannon's
// own (cannon_shell_visuals.ts), drawn wider and hotter.
//
// Three/DOM/i18n-free (RENDER_PURE_CORES), deterministic (every spread is a
// hash of the barrel and the index) and allocation-free per frame.

import { type CannonPuff, cannonHash01, cannonPuffLaunch, PUFF } from './cannon_puff_core';

/** The red drum with soot on its lid: of the kit's barrels, the one that reads as explosive at 35 yd. */
export const TURRET_BARREL_MODEL_URL = '/models/resources/fuel_a_barrel_dirty.glb';

export const TURRET_BARREL_LOOK = {
  /** Seconds a new barrel takes to pop up to its size (a little over on the way). */
  popSeconds: 0.35,
  /** The warning ring on the ground: its outer radius (yd), its band's inner edge as a share of it, and its lift. */
  ringRadius: 1.35,
  ringInner: 0.74,
  ringLift: 0.08,
  /** An unlit ring breathes gently; a lit one throbs fast and wide until the blast. */
  ringPulse: 0.05,
  ringHz: 0.7,
  litRingPulse: 0.22,
  litRingHz: 7,
  /** The fuse's shake at its end: offset (yd), tilt (rad), and how fast it rattles. */
  shakeOffset: 0.06,
  shakeTilt: 0.1,
  shakeHz: 26,
  /** How much the drum swells by the end of the fuse, as a share of its size. */
  swell: 0.1,
  /** The cannon's blast drawn this much bigger than a shell's (flash, fireball, dust, shake). */
  blastScale: 1.4,
} as const;

/** The drum's shards: pieces per blast, blasts whose shards fly at once, their life and pull. */
export const TURRET_BARREL_SHARDS = { perBlast: 10, pool: 6, life: 2.6, gravity: 26 } as const;

/** Cosmetic counts per blast and per fuse. The low preset sheds these only; the warning ring,
 *  the fuse's glow and the cannon blast's fixed pieces are the same on every tier. */
export interface TurretBarrelCounts {
  fuseSparks: number;
  embers: number;
  shards: number;
}

const FULL_COUNTS: Readonly<TurretBarrelCounts> = { fuseSparks: 12, embers: 12, shards: 10 };
const LOW_COUNTS: Readonly<TurretBarrelCounts> = { fuseSparks: 5, embers: 5, shards: 5 };

export function turretBarrelCounts(low: boolean): Readonly<TurretBarrelCounts> {
  return low ? LOW_COUNTS : FULL_COUNTS;
}

/** The fire column's fixed part: rising fireballs and the bright flame core. */
export const TURRET_BARREL_FIREBALLS = 10;
export const TURRET_BARREL_FLAMES = 8;
/** The fuse's fixed part: the hot glow over the bung and two flame licks. */
export const TURRET_FUSE_FIXED_PUFFS = 3;
/** The most puffs one fuse and one blast's fire column launch (the full counts). */
export const TURRET_FUSE_PUFFS = TURRET_FUSE_FIXED_PUFFS + FULL_COUNTS.fuseSparks;
export const TURRET_BARREL_FIRE_PUFFS =
  TURRET_BARREL_FIREBALLS + TURRET_BARREL_FLAMES + FULL_COUNTS.embers;

const TAU = Math.PI * 2;
const NO_FLOOR = Number.NEGATIVE_INFINITY;

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

function smoothstep(n: number): number {
  const t = clamp01(n);
  return t * t * (3 - 2 * t);
}

/** A new barrel's size, 0 to 1 and a little over on the way, `age` seconds after it was first drawn. */
export function turretBarrelPop(age: number): number {
  if (!(age > 0)) return 0;
  const u = age / TURRET_BARREL_LOOK.popSeconds;
  if (u >= 1) return 1;
  const c = 1.7;
  const t = u - 1;
  return 1 + (c + 1) * t * t * t + c * t * t;
}

/** The warning ring's radius at frame seconds `time`; `litAge` is the fuse's age, or null while unlit. */
export function turretBarrelRingRadius(time: number, litAge: number | null, seed: number): number {
  const look = TURRET_BARREL_LOOK;
  if (litAge === null) {
    const phase = cannonHash01(seed, 1) * TAU;
    return look.ringRadius * (1 + look.ringPulse * Math.sin(TAU * look.ringHz * time + phase));
  }
  const beat = 0.5 - 0.5 * Math.cos(TAU * look.litRingHz * Math.max(0, litAge));
  return look.ringRadius * (1 + look.litRingPulse * beat);
}

export interface TurretBarrelFuseFrame {
  dx: number;
  dz: number;
  tiltX: number;
  tiltZ: number;
  /** A multiplier on the drum's size. */
  swell: number;
}

export function newTurretBarrelFuseFrame(): TurretBarrelFuseFrame {
  return { dx: 0, dz: 0, tiltX: 0, tiltZ: 0, swell: 1 };
}

/** The drum rattling harder and swelling as its fuse of `fuse` seconds burns down, `age` seconds in. */
export function turretBarrelFuseInto(
  out: TurretBarrelFuseFrame,
  age: number,
  fuse: number,
  seed: number,
): TurretBarrelFuseFrame {
  const look = TURRET_BARREL_LOOK;
  const u = fuse > 0 ? clamp01(age / fuse) : 1;
  const k = 0.35 + 0.65 * u;
  const w = TAU * look.shakeHz * Math.max(0, age);
  // Called per lit barrel per frame: no closure, the hash is inlined.
  out.dx = look.shakeOffset * k * Math.sin(w + cannonHash01(seed, 10) * TAU);
  out.dz = look.shakeOffset * k * Math.sin(1.37 * w + cannonHash01(seed, 11) * TAU);
  out.tiltX = look.shakeTilt * k * Math.sin(1.13 * w + cannonHash01(seed, 12) * TAU);
  out.tiltZ = look.shakeTilt * k * Math.sin(0.91 * w + cannonHash01(seed, 13) * TAU);
  out.swell = 1 + look.swell * smoothstep(u);
  return out;
}

/**
 * Launches a lit fuse's puffs into `out` from index 0 and returns how many: a
 * hot glow over the bung for the whole fuse and two flame licks (every tier),
 * then `sparks` sparks spraying up and out of the bung, spread over the fuse.
 * `topY` is the drum's top, `floorY` the ground the sparks come to rest on.
 */
export function turretFuseSparksInto(
  out: CannonPuff[],
  seed: number,
  x: number,
  topY: number,
  z: number,
  floorY: number,
  fuse: number,
  sparks: number,
): number {
  const h = (i: number, k: number): number => cannonHash01(seed ^ 0x5f3a, i * 8 + k);
  let n = 0;
  cannonPuffLaunch(
    out[n++],
    PUFF.glow,
    x,
    topY + 0.12,
    z,
    0,
    0,
    0,
    0,
    0,
    0.8,
    1.5,
    fuse + 0.04,
    0,
    h(0, 0) * TAU,
    0,
    NO_FLOOR,
  );
  for (let i = 0; i < 2; i++) {
    cannonPuffLaunch(
      out[n++],
      PUFF.flame,
      x,
      topY + 0.08,
      z,
      (h(1 + i, 0) - 0.5) * 0.6,
      2.2 + 1.6 * h(1 + i, 1),
      (h(1 + i, 2) - 0.5) * 0.6,
      2,
      0,
      0.45,
      0.85,
      0.16 + 0.06 * h(1 + i, 3),
      i * fuse * 0.45,
      h(1 + i, 4) * TAU,
      0,
      NO_FLOOR,
    );
  }
  const count = Math.max(0, Math.min(out.length - n, sparks));
  for (let i = 0; i < count; i++) {
    const a = h(10 + i, 0) * TAU;
    const speed = 2.5 + 3.5 * h(10 + i, 1);
    cannonPuffLaunch(
      out[n++],
      PUFF.spark,
      x + Math.sin(a) * 0.08,
      topY + 0.05,
      z + Math.cos(a) * 0.08,
      Math.sin(a) * speed,
      3 + 4 * h(10 + i, 2),
      Math.cos(a) * speed,
      1.2,
      14,
      0.26 + 0.12 * h(10 + i, 3),
      0.06,
      0.35 + 0.25 * h(10 + i, 4),
      (i / Math.max(1, count)) * fuse,
      0,
      0,
      floorY + 0.05,
    );
  }
  return n;
}

/**
 * Writes entries `first` to `first + count - 1` of a barrel blast's fire
 * column into `out` from index 0 and returns how many it wrote: fireballs
 * rising in a tall column and cooling into faint smoke, a bright flame core
 * bursting up (every tier), then `embers` embers flung high and falling. The
 * column spans more puffs than one pooled burst holds, so a caller fills
 * several bursts from successive ranges of the same recipe.
 */
export function turretBarrelFireInto(
  out: CannonPuff[],
  first: number,
  count: number,
  seed: number,
  x: number,
  y: number,
  z: number,
  floorY: number,
  embers: number,
): number {
  const h = (i: number, k: number): number => cannonHash01(seed ^ 0x7e11, i * 12 + k);
  const total = TURRET_BARREL_FIREBALLS + TURRET_BARREL_FLAMES + Math.max(0, embers);
  const end = Math.min(total, first + Math.min(count, out.length));
  let n = 0;
  for (let i = Math.max(0, first); i < end; i++) {
    const p = out[n++];
    if (i < TURRET_BARREL_FIREBALLS) {
      const k = i / TURRET_BARREL_FIREBALLS;
      const a = h(i, 0) * TAU;
      const r = 0.3 + 0.5 * h(i, 1);
      const spread = 0.8 + 1.2 * h(i, 2);
      cannonPuffLaunch(
        p,
        PUFF.fireball,
        x + Math.sin(a) * r,
        y + 0.6 + 0.4 * k,
        z + Math.cos(a) * r,
        Math.sin(a) * spread,
        5 + 7 * k + 2 * h(i, 3),
        Math.cos(a) * spread,
        1.8,
        -2.5,
        1.2 + 0.5 * h(i, 4),
        3.2 + 1.6 * h(i, 5),
        1 + 0.5 * h(i, 6),
        0.02 * i,
        h(i, 7) * TAU,
        (h(i, 8) - 0.5) * 1.2,
        NO_FLOOR,
      );
    } else if (i < TURRET_BARREL_FIREBALLS + TURRET_BARREL_FLAMES) {
      // The column itself: flame tongues shot up one after another, the later
      // ones faster, so the fire stands several yards tall for half a second.
      const k = (i - TURRET_BARREL_FIREBALLS) / TURRET_BARREL_FLAMES;
      const a = h(i, 0) * TAU;
      cannonPuffLaunch(
        p,
        PUFF.flame,
        x + Math.sin(a) * 0.25,
        y + 0.7,
        z + Math.cos(a) * 0.25,
        Math.sin(a) * 0.9,
        8 + 8 * k + 2 * h(i, 1),
        Math.cos(a) * 0.9,
        1.6,
        0,
        1.8 + 0.5 * h(i, 2),
        3.4 + 1 * h(i, 3),
        0.5 + 0.3 * h(i, 4),
        0.12 * k,
        h(i, 5) * TAU,
        0,
        NO_FLOOR,
      );
    } else {
      const a = h(i, 0) * TAU;
      const speed = 6 + 6 * h(i, 1);
      cannonPuffLaunch(
        p,
        PUFF.spark,
        x,
        y + 1,
        z,
        Math.sin(a) * speed,
        8 + 7 * h(i, 2),
        Math.cos(a) * speed,
        0.6,
        16,
        0.5 + 0.2 * h(i, 3),
        0.1,
        0.9 + 0.6 * h(i, 4),
        0.03 * h(i, 5),
        0,
        0,
        floorY + 0.05,
      );
    }
  }
  return n;
}

/** The most puffs a blast's fire column launches for `embers` embers. */
export function turretBarrelFirePuffs(embers: number): number {
  return TURRET_BARREL_FIREBALLS + TURRET_BARREL_FLAMES + Math.max(0, embers);
}

/** Seconds after the event by which every one of `count` launched puffs is spent. */
export function turretPuffsEnd(puffs: readonly CannonPuff[], count: number): number {
  let end = 0;
  for (let i = 0; i < count; i++) end = Math.max(end, puffs[i].delay + puffs[i].life);
  return end;
}

export interface TurretShard {
  startX: number;
  startY: number;
  startZ: number;
  vx: number;
  vz: number;
  lift: number;
  /** Seconds until it comes down on `floorY`; it lies there afterwards. */
  landAt: number;
  floorY: number;
  spin: number;
  axisX: number;
  axisY: number;
  axisZ: number;
  /** Its plate's width, thickness and height (yd). */
  sx: number;
  sy: number;
  sz: number;
  /** 0 to 1: which shade of the drum it takes (the lid, sooty paint, clean paint). */
  shade: number;
}

export function newTurretShard(): TurretShard {
  return {
    startX: 0,
    startY: 0,
    startZ: 0,
    vx: 0,
    vz: 0,
    lift: 0,
    landAt: 0,
    floorY: 0,
    spin: 0,
    axisX: 1,
    axisY: 0,
    axisZ: 0,
    sx: 0,
    sy: 0,
    sz: 0,
    shade: 0,
  };
}

function landTime(lift: number, startY: number, floorY: number): number {
  const g = TURRET_BARREL_SHARDS.gravity;
  const disc = lift * lift + 2 * g * (startY - floorY);
  if (disc <= 0) return lift / g;
  return (lift + Math.sqrt(disc)) / g;
}

/**
 * Launches shard `index` of `count` off a drum blowing at (x, y, z): torn
 * around the drum, thrown out and high at a hashed speed, tumbling about a
 * hashed axis; the first one is the lid. The floor it lands on is sampled
 * once, under where it comes down.
 */
export function turretShardLaunch(
  out: TurretShard,
  seed: number,
  index: number,
  count: number,
  x: number,
  y: number,
  z: number,
  ground: (x: number, z: number) => number,
): TurretShard {
  const h = (k: number): number => cannonHash01(seed ^ 0x3d27, index * 13 + k);
  const angle = ((index + 0.8 * (h(0) - 0.5)) / Math.max(1, count)) * TAU;
  const speed = 5 + 7 * h(1);
  out.vx = Math.sin(angle) * speed;
  out.vz = Math.cos(angle) * speed;
  out.startX = x + Math.sin(angle) * 0.4;
  out.startY = y + 0.4 + 0.8 * h(2);
  out.startZ = z + Math.cos(angle) * 0.4;
  out.lift = index === 0 ? 17 : 8 + 8 * h(3);
  out.spin = 7 + 11 * h(4);
  const ax = h(5) - 0.5;
  const ay = h(6) - 0.5;
  const az = h(7) - 0.5;
  const len = Math.hypot(ax, ay, az);
  out.axisX = len > 1e-6 ? ax / len : 1;
  out.axisY = len > 1e-6 ? ay / len : 0;
  out.axisZ = len > 1e-6 ? az / len : 0;
  if (index === 0) {
    out.sx = 0.72;
    out.sy = 0.06;
    out.sz = 0.72;
    out.shade = 0;
  } else {
    out.sx = 0.28 + 0.25 * h(8);
    out.sy = 0.05;
    out.sz = 0.4 + 0.35 * h(9);
    out.shade = 0.2 + 0.8 * h(10);
  }
  const guess = landTime(out.lift, out.startY, y);
  const floor = ground(out.startX + out.vx * guess, out.startZ + out.vz * guess);
  out.floorY = (Number.isFinite(floor) ? floor : y) + out.sy * 0.5;
  out.landAt = landTime(out.lift, out.startY, out.floorY);
  return out;
}

export interface TurretShardFrame {
  x: number;
  y: number;
  z: number;
  /** Tumble angle about the shard's axis (rad): it stops turning when it lands. */
  angle: number;
  /** Its size multiplier, shrinking away at the end of its life. */
  scale: number;
}

/** A shard `age` seconds into its flight; false before and after its life. */
export function turretShardInto(shard: TurretShard, age: number, out: TurretShardFrame): boolean {
  const life = TURRET_BARREL_SHARDS.life;
  if (!(age >= 0) || age >= life) return false;
  const t = Math.min(age, shard.landAt);
  out.x = shard.startX + shard.vx * t;
  out.z = shard.startZ + shard.vz * t;
  out.y =
    age < shard.landAt
      ? shard.startY + shard.lift * age - 0.5 * TURRET_BARREL_SHARDS.gravity * age * age
      : shard.floorY;
  out.angle = shard.spin * t;
  out.scale = 1 - smoothstep((age - 0.7 * life) / (0.3 * life));
  return true;
}
