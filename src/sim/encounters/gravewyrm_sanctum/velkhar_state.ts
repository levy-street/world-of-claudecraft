// Velkhar's fight state (encounters/gravewyrm_sanctum/velkhar.ts), on the boss
// as Entity.sanctumFight. A type-only leaf so src/sim/types.ts can name it in
// the SanctumFightState union. Sim authority only: the client reads the fight
// from casts, auras and the encounter objects (world coordinates throughout).

/** A Soulfire Trench: the lane while its bar runs, then the meltwater strip. */
export interface VelkharTrench {
  objectId: number;
  /** The lane's start (world), yaw and length (clipped to the vault's rim). */
  x: number;
  z: number;
  yaw: number;
  length: number;
  /** Seconds the strip still holds (unused while it is only painted). */
  remaining: number;
  melted: boolean;
}

/** A heroic Warm Hands puddle. */
export interface VelkharPuddle {
  objectId: number;
  x: number;
  z: number;
  remaining: number;
}

/** A Bonewalker of this fight. */
export interface VelkharWalker {
  id: number;
  /** Heroic Warm Hands: where it last stood still and for how long. */
  stillX: number;
  stillZ: number;
  still: number;
  /** In meltwater last tick (Grasp of the Thawed is on it). */
  wet: boolean;
}

/** An Unquenched Bonewalker counting down to its rise. */
export interface VelkharRiser {
  /** The sunk body (kept until it rises, then removed). */
  corpseId: number;
  ringId: number;
  x: number;
  z: number;
  remaining: number;
}

export interface VelkharFightState {
  kind: 'velkhar';
  /** Seconds to the next Waking Thaw, and the pool it climbs from next. */
  thawTimer: number;
  thawPool: number;
  /** A pyre roaring before its flare: pool index, its flare object, seconds left. */
  flare: { pool: number; objectId: number; remaining: number } | null;
  /** Flare objects lingering after their flare (object id, seconds left). */
  embers: { objectId: number; remaining: number }[];
  trenchTimer: number;
  volleyTimer: number;
  /** How many of the 66 and 33 percent waves have come. */
  wavesFired: number;
  /** Where he braced for the bar in flight (world). */
  plantedAt: { x: number; y: number; z: number } | null;
  /** The trench whose bar is running (its lane is painted). */
  painting: VelkharTrench | null;
  /** The melted strips still on the vault floor. */
  trenches: VelkharTrench[];
  puddles: VelkharPuddle[];
  walkers: VelkharWalker[];
  risers: VelkharRiser[];
  /** The Held statues of this fight (object ids). */
  statues: number[];
  /** Bonewalkers that rose a second time this fight (Cold Comfort reads it). */
  rises: number;
  /** Bonewalkers Held this fight. */
  held: number;
  /** Mechanic casts started (the deterministic salt). */
  casts: number;
}
