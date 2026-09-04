// Nythraxis soft fire, the pure half. The crypt's fire (Grave Flame, Soulfire,
// the Gravefire line) is drawn the way Marrowgar's Coldflame was: a dense,
// translucent cloud of flame sprites rising and dissolving, not geometry. This
// core owns everything about that cloud that is not Three: the colour ramps
// per mechanic, the sprite shapes, the sprite budgets, and the deterministic
// spot each sprite rises from (hashed by index, so a cloud never shimmers as
// its window slides). The emitter (nythraxis_soft_fire.ts) turns spots into
// instance attributes; the painters place them.

import { NYTHRAXIS_GRAVEFIRE_LENGTH } from '../sim/nythraxis_gravefire';
import { hash2 } from '../sim/rng';

export type NythraxisSoftFireKind = 'grave' | 'soul' | 'gravefire';

/** Three stops of the sprite colour ramp: the hot core, the flame body, the cooling tip. */
export interface NythraxisSoftFireRamp {
  core: number;
  body: number;
  tip: number;
}

export const NYTHRAXIS_SOFT_FIRE_RAMPS: Readonly<
  Record<NythraxisSoftFireKind, NythraxisSoftFireRamp>
> = {
  // Grave Flame: sickly green with a pale lime core.
  grave: { core: 0xf2ffc8, body: 0x6fe04a, tip: 0x0f3d1e },
  // Soulfire: blood red with an orange-white core.
  soul: { core: 0xffe6c4, body: 0xff4a2e, tip: 0x4a0808 },
  // Gravefire: the Coldflame read, violet with a near-white core.
  gravefire: { core: 0xf4ecff, body: 0xa070ff, tip: 0x2a0c4e },
};

/** How one kind's sprites move: world-unit size and rise, seconds per sprite loop. */
export interface NythraxisSoftFireShape {
  spriteScale: number;
  rise: number;
  duration: number;
}

export const NYTHRAXIS_SOFT_FIRE_SHAPES: Readonly<
  Record<NythraxisSoftFireKind, NythraxisSoftFireShape>
> = {
  grave: { spriteScale: 1.7, rise: 2.4, duration: 1.4 },
  soul: { spriteScale: 1.9, rise: 2.8, duration: 1.3 },
  gravefire: { spriteScale: 1.5, rise: 2.0, duration: 1.2 },
};

/** Patch sprites per square yard of footprint, clamped to a sane budget per patch. */
export const NYTHRAXIS_GRAVE_FLAME_SPRITE_DENSITY = 1.4;
export const NYTHRAXIS_GRAVE_FLAME_SPRITES_MIN = 24;
export const NYTHRAXIS_GRAVE_FLAME_SPRITES_MAX = 96;
/** Line sprites per lit yard. */
export const NYTHRAXIS_GRAVEFIRE_SPRITES_PER_YARD = 5;
/** Sprites rise from inside this fraction of the footprint, never off its edge. */
export const NYTHRAXIS_SOFT_FIRE_INSET = 0.85;

const SPOT_SEED = 0x51f7e;

/** Deterministic per-sprite seed in [0, 1): the shader's clock offset and shape jitter. */
export function nythraxisSoftFireSeed(index: number): number {
  return hash2(index, 3, SPOT_SEED);
}

/** Sprite budget for a circular patch of this radius. */
export function nythraxisGraveFlameSpriteCount(radius: number): number {
  const wanted = Math.ceil(Math.PI * radius * radius * NYTHRAXIS_GRAVE_FLAME_SPRITE_DENSITY);
  return Math.max(
    NYTHRAXIS_GRAVE_FLAME_SPRITES_MIN,
    Math.min(NYTHRAXIS_GRAVE_FLAME_SPRITES_MAX, wanted),
  );
}

/** Sprite budget for a line: enough for its whole possible length. */
export function nythraxisGravefireSpriteCount(length: number = NYTHRAXIS_GRAVEFIRE_LENGTH): number {
  return NYTHRAXIS_GRAVEFIRE_SPRITES_PER_YARD * length;
}

export interface NythraxisSoftFireDiscSpot {
  dx: number;
  dz: number;
}

/** Sprite `index` of a patch rises from a fixed, area-uniform spot inside the circle. */
export function nythraxisSoftFireDiscSpotInto(
  out: NythraxisSoftFireDiscSpot,
  index: number,
  radius: number,
): NythraxisSoftFireDiscSpot {
  const spread = Math.sqrt(hash2(index, 0, SPOT_SEED)) * radius * NYTHRAXIS_SOFT_FIRE_INSET;
  const angle = hash2(index, 1, SPOT_SEED) * Math.PI * 2;
  out.dx = Math.cos(angle) * spread;
  out.dz = Math.sin(angle) * spread;
  return out;
}

export interface NythraxisGravefireSpot {
  /** yards from the ignition point along the line */
  along: number;
  /** world units across the line, signed */
  across: number;
}

/**
 * Sprite `index` of a line owns yard `floor(index / perYard)` plus a hashed
 * offset along and across it. The emitter shows only the sprites whose spot is
 * inside the lit window, so a sliding window never re-seats a sprite.
 */
export function nythraxisGravefireSpotInto(
  out: NythraxisGravefireSpot,
  index: number,
  halfWidth: number,
  perYard: number = NYTHRAXIS_GRAVEFIRE_SPRITES_PER_YARD,
): NythraxisGravefireSpot {
  const yard = Math.floor(index / perYard);
  out.along = yard + hash2(index, 0, SPOT_SEED);
  out.across = (hash2(index, 1, SPOT_SEED) * 2 - 1) * halfWidth * NYTHRAXIS_SOFT_FIRE_INSET;
  return out;
}
