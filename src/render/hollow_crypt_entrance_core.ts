// The Fallen Chapel's cosmetic plan (pure, Three-free): the Hollow Crypt's
// world entrance (door (80, 90), Eastbrook Vale). Where the stair's soul light
// hangs, the virtual stair the portal shader traces behind the arch, the grave
// mist's puffs, and the spirit sprites (candle flames and their halos, the
// rising motes, the will-o-wisps of the nave, the pale glow in the empty rose
// window). src/render/hollow_crypt_entrance.ts is the thin painter and its
// shaders evaluate THESE formulas on the GPU. Every value is door-local:
// lx = x - door.x (+x WEST), lz = z - door.z (+z NORTH), y above the door's
// terrain height. Cosmetic only: nothing here is a telegraph, the door stays
// a click box and a nameplate on every tier, and the effects tier only thins
// the puffs, motes and wisps.
import { globalDayness } from './day_night_core';

/** The static effects tier (src/game/ui_effects_profile.ts resolves it). */
export type CryptEffectsTier = 'low' | 'medium' | 'high' | 'ultra';

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function smoothstep(a: number, b: number, v: number): number {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}

function fract(v: number): number {
  return v - Math.floor(v);
}

/** How much of the haunting shows at a day/night phase: 0 through the day,
 *  rising through dusk, 1 at night. */
export function cryptNightAmount(phase: number): number {
  return smoothstep(0, 1, (0.62 - globalDayness(phase)) / 0.5);
}

/** The single point light: the cold violet breath of the stair, just inside
 *  the arch (a fire-light sink source, like every world glow light). */
export const CRYPT_SOUL_LIGHT = {
  lx: 0,
  y: 1.35,
  lz: 0.9,
  color: 0x7a5cff,
  intensity: 2.1,
  distance: 15,
} as const;

// ---- the stair behind the portal -------------------------------------------------
//
// The player never walks down (the walk-in trigger takes them at the arch) and
// the terrain cannot be cut, so the stair is drawn INSIDE a box of three flat
// windows that stands in the stair-house: a front just behind the sill, a lid
// a yard up (over the tops of the meadow grass, which the engine sows
// everywhere and which would otherwise stand in the stair's mouth), and a
// back up to the vault. The shader traces each view ray against this virtual
// flight (treads, risers, side walls, a ceiling parallel to the flight), so
// the steps keep true parallax from any camera: a descent into the dark, not a
// painted plane.

export const CRYPT_STAIR = {
  /** Half width of the well (the portal lane). */
  halfWidth: 1.3,
  /** The well runs from lz z0 (behind the sill) to z1 (its back). */
  z0: 0.58,
  z1: 4.18,
  /** The floor the flight leaves from, and the lid of the window box. */
  y: 0.13,
  lid: 1.0,
  /** The back window stands at z1 under the stair's pointed vault: from the
   *  lid up to the springing at the walls and the apex on the axis. */
  spring: 3.7,
  apex: 5.3,
  /** The flight: the first tread lies `lip` under the floor. */
  lip: 0.07,
  tread: 0.56,
  riser: 0.26,
  steps: 22,
} as const;

export type CryptStairHitKind = 'tread' | 'riser' | 'wall' | 'ceiling' | 'void';

export interface CryptStairHit {
  kind: CryptStairHitKind;
  /** Ray parameter of the hit (yards, the direction is unit). */
  t: number;
  /** The step the hit belongs to (treads and risers). */
  step: number;
  /** Depth of the hit below the well's floor (yards, 0 at the top). */
  depth: number;
}

/** The stair vault's pointed profile at the well's back, from the west
 *  springing over the apex to the east one (x, y pairs; `grow` widens it about
 *  the axis and the springing line). */
export function cryptVaultProfile(steps: number, grow = 1): [number, number][] {
  const s = CRYPT_STAIR;
  const half = s.halfWidth;
  const rise = s.apex - s.spring;
  const radius = (half * half + rise * rise) / (2 * half);
  const top = Math.asin(Math.min(1, rise / radius));
  const side: [number, number][] = [];
  for (let i = 0; i < steps; i++) {
    const a = (top * i) / steps;
    side.push([
      (half - radius + radius * Math.cos(a)) * grow,
      s.spring + radius * Math.sin(a) * grow,
    ]);
  }
  return [
    ...side,
    [0, s.spring + rise * grow],
    ...side.map(([x, y]) => [-x, y] as [number, number]).reverse(),
  ];
}

/** Height of tread k of the virtual flight. */
export function cryptStairTreadY(k: number): number {
  return CRYPT_STAIR.y - CRYPT_STAIR.lip - k * CRYPT_STAIR.riser;
}

/**
 * Trace a ray (origin on a window of the box, unit direction, door-local)
 * against the virtual stair: the SAME test the portal's fragment shader runs. A ray going
 * north only ever meets treads (the risers face down the flight); a ray going
 * south through the broken vault can meet a riser.
 */
export function cryptStairTrace(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  out: CryptStairHit,
): CryptStairHit {
  const s = CRYPT_STAIR;
  let best = 1e5;
  let kind: CryptStairHitKind = 'void';
  let step = 0;
  for (let k = 0; k < s.steps; k++) {
    const zk = s.z0 + k * s.tread;
    const yk = cryptStairTreadY(k);
    if (dy < -1e-4) {
      const t = (yk - oy) / dy;
      const z = oz + dz * t;
      if (t > 0 && t < best && z >= zk && z <= zk + s.tread) {
        best = t;
        kind = 'tread';
        step = k;
      }
    }
    if (dz < -1e-4) {
      const t = (zk + s.tread - oz) / dz;
      const y = oy + dy * t;
      if (t > 0 && t < best && y <= yk && y >= yk - s.riser) {
        best = t;
        kind = 'riser';
        step = k;
      }
    }
  }
  if (Math.abs(dx) > 1e-4) {
    const t = ((dx > 0 ? s.halfWidth : -s.halfWidth) - ox) / dx;
    if (t > 0 && t < best) {
      best = t;
      kind = 'wall';
    }
  }
  // The vault runs parallel to the flight from the back window: two planes
  // rising from the springing at each wall to the apex on the axis.
  const slope = s.riser / s.tread;
  const pitch = (s.apex - s.spring) / s.halfWidth;
  for (const side of [-1, 1]) {
    const dn = dy + pitch * side * dx + slope * dz;
    if (dn <= 1e-4) continue;
    const t = (s.apex - oy - pitch * side * ox - slope * (oz - s.z1)) / dn;
    if (t > 0 && t < best && side * (ox + dx * t) >= 0) {
      best = t;
      kind = 'ceiling';
    }
  }
  const zEnd = s.z0 + s.steps * s.tread;
  if (dz > 1e-4) {
    const t = (zEnd - oz) / dz;
    if (t > 0 && t < best) {
      best = t;
      kind = 'void';
    }
  }
  out.kind = kind;
  out.t = best;
  out.step = step;
  out.depth = Math.max(0, s.y - (oy + dy * Math.min(best, 40)));
  return out;
}

/** The soul light's breath at a depth below the well's floor: a slow crest
 *  that climbs the flight (the phase falls with depth, so the crest rises). */
export function cryptStairBreath(depth: number, time: number, motion: number): number {
  return 0.72 + 0.28 * Math.sin(time * 0.9 * motion - depth * 1.3);
}

// ---- the grave mist ----------------------------------------------------------------

export interface CryptMistField {
  readonly name: string;
  /** Share of the puffs this field takes. */
  readonly share: number;
  /** Where its puffs are born (an ellipse rx by rz about ox, oz). */
  readonly ox: number;
  readonly oz: number;
  readonly rx: number;
  readonly rz: number;
  /** The drift over one life, and how far the lanes fan sideways along it. */
  readonly dx: number;
  readonly dz: number;
  readonly fan: number;
  /** Puff centre above the ground, and puff width. */
  readonly y: number;
  readonly size: number;
  /** Rise over one life (yards), billboard height over width, and the share
   *  of its night strength it keeps in full daylight. */
  readonly rise: number;
  readonly aspect: number;
  readonly dayAlpha: number;
}

/** The stair's breath pours over the sill and creeps down the nave; thinner
 *  pools lie in the nave and between the headstones of the two yards; and a
 *  column of soul wisps rises up the gable's faces and over it, day and night. */
export const CRYPT_MIST_FIELDS: readonly CryptMistField[] = [
  {
    name: 'stair',
    share: 0.32,
    ox: 0,
    oz: 0.4,
    rx: 0.9,
    rz: 0.5,
    dx: 0,
    dz: -10,
    fan: 4.6,
    y: 0.3,
    size: 2.0,
    rise: 0.25,
    aspect: 0.42,
    dayAlpha: 0.5,
  },
  {
    name: 'nave',
    share: 0.18,
    ox: 0,
    oz: -12.5,
    rx: 5.6,
    rz: 6.5,
    dx: 0.9,
    dz: -1.8,
    fan: 0,
    y: 0.28,
    size: 2.9,
    rise: 0.25,
    aspect: 0.42,
    dayAlpha: 0.5,
  },
  {
    name: 'yard_east',
    share: 0.15,
    ox: -14.5,
    oz: -9,
    rx: 3.6,
    rz: 3.2,
    dx: -1.3,
    dz: -0.9,
    fan: 0,
    y: 0.28,
    size: 2.7,
    rise: 0.25,
    aspect: 0.42,
    dayAlpha: 0.5,
  },
  {
    name: 'yard_west',
    share: 0.15,
    ox: 14.2,
    oz: -16.5,
    rx: 3.6,
    rz: 3.2,
    dx: 1.3,
    dz: -0.7,
    fan: 0,
    y: 0.28,
    size: 2.7,
    rise: 0.25,
    aspect: 0.42,
    dayAlpha: 0.5,
  },
  // The daytime signature: soul wisps seeping out of the gable's stone and
  // rising up both its faces and over its head in a slow leaning column,
  // tall violet streaks against the shadowed wall that read from the road at
  // noon (anything rising inside the nave is hidden from the road by the
  // gable itself).
  {
    name: 'column',
    share: 0.2,
    ox: 0,
    oz: -21.6,
    rx: 4.6,
    rz: 2,
    dx: 1.2,
    dz: -2.4,
    fan: 0,
    y: 1.5,
    size: 3,
    rise: 32,
    aspect: 2.2,
    dayAlpha: 1.7,
  },
];

/** Puff count by the static effects tier (never the FPS governor). */
export function cryptMistPuffCount(tier: CryptEffectsTier): number {
  switch (tier) {
    case 'low':
      return 14;
    case 'medium':
      return 28;
    case 'high':
      return 44;
    default:
      return 60;
  }
}

export interface CryptMistPuff {
  /** The field it belongs to (an index into CRYPT_MIST_FIELDS). */
  field: number;
  /** Birth place and drift over one life (door-local). */
  ox: number;
  oz: number;
  dx: number;
  dz: number;
  /** Life-cycle offset in [0, 1) and life cycles per second. */
  phase: number;
  speed: number;
  /** Width in yards at birth and centre height above the ground. */
  size: number;
  y: number;
  /** Rise over one life, billboard height over width, daylight strength. */
  rise: number;
  aspect: number;
  dayAlpha: number;
}

/** A puff's fixed parameters: golden-ratio spreads, no random stream. */
export function cryptMistPuff(index: number, count: number): CryptMistPuff {
  const u = (index + 0.5) / Math.max(1, count);
  let field = 0;
  let acc = 0;
  for (let i = 0; i < CRYPT_MIST_FIELDS.length; i++) {
    acc += CRYPT_MIST_FIELDS[i].share;
    field = i;
    if (u < acc) break;
  }
  const f = CRYPT_MIST_FIELDS[field];
  const g = fract(index * 0.61803398875 + 0.13);
  const h = fract(index * 0.75487766625 + 0.31);
  const k = fract(index * 0.56984029099 + 0.57);
  const angle = g * Math.PI * 2;
  const radius = Math.sqrt(h);
  const lane = k * 2 - 1;
  return {
    field,
    ox: f.ox + Math.cos(angle) * radius * f.rx,
    oz: f.oz + Math.sin(angle) * radius * f.rz,
    dx: f.dx + lane * f.fan,
    dz: f.dz,
    phase: fract(index * 0.38196601125 + 0.07),
    speed: 0.032 + g * 0.026,
    size: f.size * (0.8 + k * 0.45),
    y: f.y,
    rise: f.rise,
    aspect: f.aspect,
    dayAlpha: f.dayAlpha,
  };
}

export interface CryptMistPose {
  x: number;
  y: number;
  z: number;
  /** Billboard width in yards (the height is the puff's aspect times it). */
  scale: number;
  alpha: number;
}

/** Where a puff is at a time: the painter's vertex shader runs the same
 *  formula (MIST_VERTEX). motion 0 (reduced motion) freezes every puff at its
 *  own phase, so the mist stands still but still lies where it lay. */
export function cryptMistPose(
  puff: CryptMistPuff,
  time: number,
  motion: number,
  out: CryptMistPose,
): CryptMistPose {
  const t = fract(puff.phase + time * puff.speed * motion);
  out.x = puff.ox + puff.dx * t + Math.sin(time * 0.21 * motion + puff.phase * Math.PI * 2) * 0.35;
  out.y = puff.y + puff.rise * t;
  out.z = puff.oz + puff.dz * t;
  out.scale = puff.size * (0.75 + 0.9 * t);
  out.alpha = smoothstep(0, 0.18, t) * (1 - smoothstep(0.6, 1, t));
  return out;
}

/** A puff's strength by time of day: its own daylight share, full at night
 *  (the ground mist is a thin veil by day, the soul column stays plain). */
export function cryptMistStrength(dayAlpha: number, night: number): number {
  return dayAlpha + (1 - dayAlpha) * night;
}

// ---- the spirit sprites --------------------------------------------------------------

/** Every Gravecaller wick of the model (lx, y, lz), from the Blender build's
 *  stats.json: the flames stand exactly on the modelled candles. */
export const CRYPT_CANDLE_WICKS: readonly (readonly [number, number, number])[] = [
  [-1.383, 0.461, -1.848],
  [-1.513, 0.405, -1.923],
  [-1.447, 0.518, -1.851],
  [-1.524, 0.522, -1.962],
  [-1.67, 0.632, -0.77],
  [-1.18, 0.578, -0.6],
  [-1.02, 0.66, -0.46],
  [1.453, 0.174, -1.883],
  [1.397, 0.108, -1.986],
  [1.522, 0.384, -1.77],
  [1.47, 0.107, -1.984],
  [1.67, 0.413, -0.77],
  [1.18, 0.633, -0.6],
  [1.02, 0.66, -0.46],
  [-4.635, 1.133, 3.75],
  [-4.486, 1.044, 4.015],
  [-4.494, 1.112, 3.935],
  [5.656, 0.25, -3.603],
  [5.628, 0.06, -3.72],
  [5.575, 0.025, -3.567],
  [-6.41, 0.567, -3.58],
  [-6.497, 0.553, -3.219],
  [-6.349, 0.377, -3.241],
  [-6.415, 0.449, -3.286],
];

export const CRYPT_SPRITE_KIND = {
  flame: 0,
  halo: 1,
  mote: 2,
  wisp: 3,
  rose: 4,
  shaft: 5,
} as const;
export type CryptSpriteKind = (typeof CRYPT_SPRITE_KIND)[keyof typeof CRYPT_SPRITE_KIND];

export interface CryptSprite {
  kind: CryptSpriteKind;
  x: number;
  y: number;
  z: number;
  /** Billboard height in yards (the flame is half as wide as it is tall). */
  size: number;
  phase: number;
  speed: number;
  /** Wander radius (wisps) or rise (motes), yards. */
  range: number;
}

/** The empty rose window: its centre, the radius of its opening, and the
 *  length of the pale shafts that spill from it (south over the approach,
 *  north into the nave). The glow is a card IN the wall plane, behind the
 *  tracery's faces, so the stonework stands dark against it from both sides. */
export const CRYPT_ROSE = { lx: 0, y: 11.2, lz: -22, radius: 2.8, shaft: 10 } as const;

/** Where the wisps wander: the nave between the walls, off the door lane's end. */
export const CRYPT_WISP_FIELD = { x0: -6.8, x1: 6.8, z0: -20, z1: -5.5, y0: 1.1, y1: 3.2 } as const;

function tierRank(tier: CryptEffectsTier): number {
  return tier === 'low' ? 0 : tier === 'medium' ? 1 : tier === 'high' ? 2 : 3;
}

/** Candle clusters: wicks within a yard of each other share one halo. */
export function cryptCandleClusters(
  wicks: readonly (readonly [number, number, number])[] = CRYPT_CANDLE_WICKS,
): { x: number; y: number; z: number; count: number }[] {
  const out: { x: number; y: number; z: number; count: number }[] = [];
  for (const [x, y, z] of wicks) {
    const near = out.find((c) => Math.hypot(c.x / c.count - x, c.z / c.count - z) < 1);
    if (near) {
      near.x += x;
      near.y += y;
      near.z += z;
      near.count++;
    } else {
      out.push({ x, y, z, count: 1 });
    }
  }
  return out.map((c) => ({ x: c.x / c.count, y: c.y / c.count, z: c.z / c.count, count: c.count }));
}

/**
 * The sprite list of a tier. Every flame burns on every tier (they are the
 * candles' light, two dozen tiny quads); the halos too. The motes and the
 * wisps thin with the tier and are gone on low, with the rose window's glow
 * and its two shafts.
 */
export function cryptSprites(
  tier: CryptEffectsTier,
  wicks: readonly (readonly [number, number, number])[] = CRYPT_CANDLE_WICKS,
): CryptSprite[] {
  const rank = tierRank(tier);
  const out: CryptSprite[] = [];
  wicks.forEach(([x, y, z], i) => {
    out.push({
      kind: CRYPT_SPRITE_KIND.flame,
      x,
      y,
      z,
      size: 0.2 + fract(i * 0.61803398875) * 0.08,
      phase: fract(i * 0.75487766625 + 0.2),
      speed: 1,
      range: 0,
    });
  });
  const clusters = cryptCandleClusters(wicks);
  clusters.forEach((c, i) => {
    out.push({
      kind: CRYPT_SPRITE_KIND.halo,
      x: c.x,
      y: c.y + 0.12,
      z: c.z,
      size: 1.0 + Math.min(4, c.count) * 0.28,
      phase: fract(i * 0.38196601125 + 0.4),
      speed: 1,
      range: 0,
    });
  });
  const motes = [0, 8, 14, 20][rank];
  for (let i = 0; i < motes; i++) {
    const c = clusters[i % Math.max(1, clusters.length)] ?? { x: 0, y: 0.5, z: 0 };
    out.push({
      kind: CRYPT_SPRITE_KIND.mote,
      x: c.x + (fract(i * 0.61803398875) - 0.5) * 0.5,
      y: c.y + 0.1,
      z: c.z + (fract(i * 0.75487766625) - 0.5) * 0.5,
      size: 0.07 + fract(i * 0.38196601125) * 0.05,
      phase: fract(i * 0.56984029099 + 0.11),
      speed: 0.16 + fract(i * 0.61803398875 + 0.5) * 0.12,
      range: 1.5 + fract(i * 0.75487766625 + 0.3) * 1.1,
    });
  }
  const wisps = [0, 3, 5, 7][rank];
  const w = CRYPT_WISP_FIELD;
  for (let i = 0; i < wisps; i++) {
    out.push({
      kind: CRYPT_SPRITE_KIND.wisp,
      x: w.x0 + 1.6 + fract(i * 0.61803398875 + 0.27) * (w.x1 - w.x0 - 3.2),
      y: w.y0 + 0.5 + fract(i * 0.38196601125 + 0.6) * (w.y1 - w.y0 - 1.0),
      z: w.z0 + 1.6 + fract(i * 0.75487766625 + 0.44) * (w.z1 - w.z0 - 3.2),
      size: 0.55 + fract(i * 0.56984029099) * 0.25,
      phase: fract(i * 0.56984029099 + 0.71),
      speed: 0.11 + fract(i * 0.61803398875 + 0.9) * 0.08,
      range: 1.5,
    });
  }
  // The lowest preset sheds the rose window's glow with the wisps: all three
  // are decoration, and the door, the stair and the candles stay.
  if (rank === 0) return out;
  out.push({
    kind: CRYPT_SPRITE_KIND.rose,
    x: CRYPT_ROSE.lx,
    y: CRYPT_ROSE.y,
    z: CRYPT_ROSE.lz,
    size: CRYPT_ROSE.radius * 2,
    phase: 0.3,
    speed: 1,
    range: 0,
  });
  // range carries the shaft's heading: -1 spills south, +1 north into the nave
  for (const heading of [-1, 1]) {
    out.push({
      kind: CRYPT_SPRITE_KIND.shaft,
      x: CRYPT_ROSE.lx,
      y: CRYPT_ROSE.y,
      z: CRYPT_ROSE.lz,
      size: CRYPT_ROSE.shaft,
      phase: heading > 0 ? 0.62 : 0.17,
      speed: 1,
      range: heading,
    });
  }
  return out;
}

export interface CryptSpritePose {
  x: number;
  y: number;
  z: number;
  /** Billboard width and height, yards. */
  w: number;
  h: number;
  alpha: number;
}

/**
 * Where a sprite is and how bright: the painter's vertex shader runs the same
 * formula (SPRITE_VERTEX). night in [0, 1] (cryptNightAmount), motion 1 or 0
 * (reduced motion: flames stand still and steady, motes hang, wisps hold their
 * place and only breathe).
 */
export function cryptSpritePose(
  s: CryptSprite,
  time: number,
  night: number,
  motion: number,
  out: CryptSpritePose,
): CryptSpritePose {
  const tau = Math.PI * 2;
  const tm = time * motion;
  out.x = s.x;
  out.y = s.y;
  out.z = s.z;
  out.w = s.size;
  out.h = s.size;
  out.alpha = 1;
  switch (s.kind) {
    case CRYPT_SPRITE_KIND.flame: {
      const flick = Math.sin(tm * 11 + s.phase * 40) * Math.sin(tm * 7.3 + s.phase * 17);
      out.w = s.size * 0.5;
      out.h = s.size * (1 + 0.16 * flick);
      out.x = s.x + Math.sin(tm * 5.1 + s.phase * 23) * 0.012;
      out.y = s.y + out.h * 0.42;
      out.alpha = 0.9 + 0.1 * flick;
      break;
    }
    case CRYPT_SPRITE_KIND.halo: {
      out.alpha = (0.3 + 0.5 * night) * (0.86 + 0.14 * Math.sin(tm * 3.1 + s.phase * tau));
      break;
    }
    case CRYPT_SPRITE_KIND.mote: {
      const t = fract(s.phase + tm * s.speed);
      out.x = s.x + Math.sin(tm * 0.9 + s.phase * 31) * 0.22 * t;
      out.y = s.y + s.range * t;
      out.z = s.z + Math.cos(tm * 0.7 + s.phase * 19) * 0.22 * t;
      out.alpha = smoothstep(0, 0.12, t) * (1 - smoothstep(0.55, 1, t)) * (0.55 + 0.45 * night);
      break;
    }
    case CRYPT_SPRITE_KIND.wisp: {
      const a = tm * s.speed + s.phase * tau;
      out.x = s.x + Math.sin(a) * s.range;
      out.y = s.y + Math.sin(a * 1.7 + s.phase * 9) * 0.45;
      out.z = s.z + Math.cos(a * 0.8 + s.phase * 4) * s.range;
      out.alpha = night * (0.55 + 0.45 * Math.sin(time * 0.6 + s.phase * 11));
      break;
    }
    default: {
      out.alpha = night * (0.8 + 0.2 * Math.sin(time * 0.4 + s.phase * tau));
    }
  }
  return out;
}
