// Nythraxis grave mechanics, the pure half: the palette and the per-frame pose
// math behind the Grave Eruption telegraph (drawn by mage_ground_fx.ts on the
// shared meteor-warning path) and the Grave Flame patches it leaves behind
// (painted by nythraxis_grave_flame_visual.ts).
//
// Grave Eruption is skeletal hands bursting UP out of a crypt floor, so it keeps
// the meteor ring's exact actionable geometry (radius, countdown, rim) and swaps
// only the read: a purple rim and countdown, violet grave-light cracks, pale
// violet mist motes rising from the centre, no rock in the sky, and a cluster of
// bone shards that erupt from the disc at impact. Every helper here is
// allocation-free (the caller owns the output records) and deterministic: the
// scatter is a golden-angle spiral, never a random draw.
//
// Owner call (offensive-VFX purple pass): every Nythraxis damaging read shares
// one purple danger family with pale-violet highlights, so Grave Eruption and
// the ground fire it leaves no longer read green; only the friendly Binding
// Sigil (blue) and the Soul Rend stack marker (red-alone/green-stacked) stay
// off this family, since both are deliberately distinct reads.
//
// Node-only (RENDER_PURE_CORES): no three.js, no DOM, no randomness.

import {
  NYTHRAXIS_GRAVE_ERUPTION_CAST_ID,
  type NythraxisGravePoint,
} from '../sim/nythraxis_grave_eruption';

/** Purple/violet read for the eruption telegraph, one slot per meteor
 *  telegraph material so the fire meteor's palette maps onto it 1:1. */
export const NYTHRAXIS_GRAVE_ERUPTION_PALETTE = {
  /** the dark violet disc under the ring */
  footprint: 0x140a1e,
  /** the actionable rim (the exact authored radius) */
  boundary: 0x9a5df0,
  /** the collapsing countdown ring, a pale-violet highlight */
  countdown: 0xd9b8ff,
  /** violet grave-light cracks spreading over the flagstones */
  vein: 0xa06cff,
  /** pale violet mist motes rising from the centre while the ground stirs */
  mote: 0xb98cff,
  /** the bone shards that burst up at impact, pale-violet highlighted bone */
  shard: 0xf0e6ff,
} as const;

/** The burning patch an eruption leaves behind: blue-violet ground fire. */
export const NYTHRAXIS_GRAVE_FLAME_PALETTE = {
  fill: 0x1a0a2a,
  rim: 0x8a5cf0,
  ember: 0x5a2e9a,
  tongue: 0xd9b8ff,
} as const;

/** Soulfire (the pool a Soul Rend mark leaves behind): magenta-violet fire,
 *  warmer than Grave Flame's blue-violet so the two pools stay tellable apart
 *  while both read as the same purple danger family. */
export const NYTHRAXIS_SOUL_FLAME_PALETTE = {
  fill: 0x2a0a2a,
  rim: 0xc84fff,
  ember: 0x7a1a6e,
  tongue: 0xe8b8ff,
} as const;

export interface NythraxisFlamePalette {
  readonly fill: number;
  readonly rim: number;
  readonly ember: number;
  readonly tongue: number;
}

/** Palette selection stays on the authoritative row kind. */
export function nythraxisFlamePalette(kind: 'grave' | 'soul'): NythraxisFlamePalette {
  return kind === 'soul' ? NYTHRAXIS_SOUL_FLAME_PALETTE : NYTHRAXIS_GRAVE_FLAME_PALETTE;
}

/** True for the spellfxAt / warning-row ability the eruption authors. */
export function isNythraxisGraveEruption(ability: string | undefined): boolean {
  return ability === NYTHRAXIS_GRAVE_ERUPTION_CAST_ID;
}

const GOLDEN_ANGLE = 2.39996;

// ---------------------------------------------------------------------------
// Grave Eruption: the bone-shard burst at impact
// ---------------------------------------------------------------------------

/** Seconds the shards take to rise to full height after the impact. */
export const NYTHRAXIS_GRAVE_SHARD_RISE_SECONDS = 0.45;

export interface NythraxisGraveShardPose {
  /** offset from the circle centre, world yards */
  dx: number;
  dz: number;
  /** lift of the shard geometry's centre above the ground (its base sits on it) */
  y: number;
  /** width scale (x and z) */
  width: number;
  /** height scale (y): grows with `rise` */
  height: number;
  yaw: number;
  /** outward lean, radians about the world x and z axes */
  leanX: number;
  leanZ: number;
}

/** Rise progress 0..1 from seconds since the impact (linear; eased inside the pose). */
export function nythraxisGraveShardRise(sinceImpact: number): number {
  return Math.min(1, Math.max(0, sinceImpact / NYTHRAXIS_GRAVE_SHARD_RISE_SECONDS));
}

/** Shards fade over the last 40 percent of the linger, like the fire scorch. */
export function nythraxisGraveShardFade(sinceImpact: number, linger: number): number {
  const window = Math.max(1e-6, linger * 0.4);
  return Math.min(1, Math.max(0, (linger - sinceImpact) / window));
}

/**
 * One shard of the burst: a golden-angle spiral over the disc (a cluster, never a
 * ring), taller toward the middle, leaning outward, rising with an ease-out so
 * the burst reads violent at the start and settles.
 *
 * `geometryHalfHeight` is half the height of the unit shard geometry, so the
 * base of the scaled shard sits on the ground whatever its height scale.
 */
export function nythraxisGraveShardPoseInto(
  out: NythraxisGraveShardPose,
  index: number,
  count: number,
  radius: number,
  rise: number,
  geometryHalfHeight: number,
): NythraxisGraveShardPose {
  const angle = index * GOLDEN_ANGLE;
  const spreadFraction = Math.sqrt((index + 0.5) / Math.max(1, count));
  const spread = spreadFraction * radius * 0.82;
  const clampedRise = Math.min(1, Math.max(0, rise));
  const eased = 1 - (1 - clampedRise) ** 3;
  const fullHeight = (1.15 + ((index * 7) % 5) * 0.2) * (1.15 - spreadFraction * 0.35);
  const lean = 0.12 + spreadFraction * 0.3;
  out.dx = Math.cos(angle) * spread;
  out.dz = Math.sin(angle) * spread;
  out.height = Math.max(0.001, fullHeight * eased);
  out.width = 0.55 + ((index * 3) % 4) * 0.12;
  out.y = geometryHalfHeight * out.height;
  out.yaw = angle * 1.7;
  out.leanX = Math.sin(angle) * lean;
  out.leanZ = -Math.cos(angle) * lean;
  return out;
}

// ---------------------------------------------------------------------------
// Grave Flame: the burning patch
// ---------------------------------------------------------------------------

export const NYTHRAXIS_GRAVE_FLAME_GROUND_LIFT = 0.09;
export const NYTHRAXIS_GRAVE_FLAME_RIM_INNER_FRACTION = 0.84;

export interface NythraxisGraveFlamePlan {
  id: string;
  sourceId: number;
  x: number;
  y: number;
  z: number;
  radius: number;
}

/** Where a patch stands: the authored circle on the sampled ground, lifted off it. */
export function nythraxisGraveFlamePlanInto(
  out: NythraxisGraveFlamePlan,
  row: NythraxisGravePoint & { id: string; sourceId: number; radius: number },
  groundY: number,
): NythraxisGraveFlamePlan {
  out.id = row.id;
  out.sourceId = row.sourceId;
  out.x = row.x;
  out.y = groundY + NYTHRAXIS_GRAVE_FLAME_GROUND_LIFT;
  out.z = row.z;
  out.radius = row.radius;
  return out;
}

export interface NythraxisGraveFlamePulse {
  rim: number;
  fill: number;
  ember: number;
  tongue: number;
}

/** Opacities for one frame. The rim never drops below a readable floor: the
 *  patch edge is gameplay, only the breath on top of it is cosmetic. Reduced
 *  motion settles the breath at its midpoint. */
export function nythraxisGraveFlamePulseInto(
  out: NythraxisGraveFlamePulse,
  phase: number,
  reducedMotion: boolean,
): NythraxisGraveFlamePulse {
  const wave = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(phase);
  out.rim = 0.78 + wave * 0.18;
  out.fill = 0.3 + wave * 0.08;
  out.ember = 0.26 + wave * 0.16;
  out.tongue = 0.48 + wave * 0.24;
  return out;
}
