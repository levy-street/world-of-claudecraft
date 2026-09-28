// Fire and Fly (turret defense POC) tuning, data only. The engine is
// src/sim/minigames/turret_defense.ts; the wave plan resolver
// (src/sim/minigames/turret_defense_plan.ts) reads the templates from MOBS.

import { DT, type TurretSizeClass, type TurretSizeDef, type TurretWaveDef } from '../types';

const ticks = (seconds: number): number => Math.round(seconds / DT);

export const TURRET_SIZE_CLASSES: Readonly<Record<TurretSizeClass, Readonly<TurretSizeDef>>> = {
  small: { mass: 1, breachValue: 2, radius: 0.6 },
  medium: { mass: 1.6, breachValue: 4, radius: 0.5 },
  large: { mass: 3, breachValue: 10, radius: 0.9 },
  huge: { mass: 4.5, breachValue: 15, radius: 1.2 },
};

export const TURRET_TEMPLATE_SIZES: Readonly<Record<string, TurretSizeClass>> = {
  forest_wolf: 'small',
  wild_boar: 'small',
  webwood_spider: 'small',
  tunnel_rat: 'small',
  vale_bandit: 'medium',
  deeprock_kobold: 'medium',
  boneclad_revenant: 'medium',
  fen_troll: 'large',
  thornpeak_ogre: 'large',
  frostmane_yeti: 'huge',
  idol_guardian: 'huge',
};

const GAP_MIN = ticks(0.8);
const GAP_MAX = ticks(1.6);

export const TURRET_WAVES: readonly TurretWaveDef[] = [
  {
    entries: [{ templateId: 'forest_wolf', count: 8, level: 2 }],
    coreDamage: 60,
    gapMinTicks: GAP_MIN,
    gapMaxTicks: GAP_MAX,
  },
  {
    entries: [
      { templateId: 'forest_wolf', count: 6, level: 2 },
      { templateId: 'wild_boar', count: 6, level: 3 },
    ],
    coreDamage: 64,
    gapMinTicks: GAP_MIN,
    gapMaxTicks: GAP_MAX,
  },
  {
    entries: [
      { templateId: 'vale_bandit', count: 8, level: 5 },
      { templateId: 'webwood_spider', count: 6, level: 4 },
    ],
    coreDamage: 84,
    gapMinTicks: GAP_MIN,
    gapMaxTicks: GAP_MAX,
  },
  {
    entries: [
      { templateId: 'tunnel_rat', count: 8, level: 6 },
      { templateId: 'fen_troll', count: 4, level: 11 },
    ],
    coreDamage: 100,
    gapMinTicks: GAP_MIN,
    gapMaxTicks: GAP_MAX,
  },
  {
    entries: [
      { templateId: 'deeprock_kobold', count: 8, level: 15 },
      { templateId: 'thornpeak_ogre', count: 4, level: 16 },
      { templateId: 'boneclad_revenant', count: 4, level: 19 },
    ],
    coreDamage: 130,
    gapMinTicks: GAP_MIN,
    gapMaxTicks: GAP_MAX,
  },
  {
    entries: [
      { templateId: 'boneclad_revenant', count: 6, level: 19 },
      { templateId: 'frostmane_yeti', count: 2, level: 20 },
      { templateId: 'idol_guardian', count: 1, level: 20, bossLast: true },
    ],
    coreDamage: 220,
    gapMinTicks: GAP_MIN,
    gapMaxTicks: GAP_MAX,
  },
];

export const TURRET_WEAPON = {
  cooldownTicks: ticks(0.45),
  minRange: 2,
  maxRange: 60,
  /** Shell flight = clamp(range / shellSpeed, minFlight, maxFlight) seconds. */
  shellSpeed: 110,
  minFlightTicks: ticks(0.2),
  maxFlightTicks: ticks(0.9),
  blastRadius: 6,
  blastCore: 1.5,
  /** Horizontal launch speed of a core hit on mass 1 (yd/s), scaled by falloff / sqrt(mass). */
  push: 16.5,
  /** Vertical launch speed of a core hit on mass 1 (yd/s), scaled the same way. */
  pop: 17.3,
  /** Random spread of the throw direction, either side (radians). */
  deviation: Math.PI / 12,
  /** Closer than this to the blast point, a body is thrown outward from the turret. */
  deadCenter: 0.05,
  /** Juggling adds velocity; these caps keep a juggled body's flight bounded. */
  maxLaunchSpeed: 32,
  maxLaunchLift: 26,
} as const;

export const TURRET_ARENA = {
  spawnRadius: 46,
  /** A monster stops at breachRadius + its body radius from the center and winds up. */
  breachRadius: 3.5,
  /** The tank's own body: a flight below its top reflects off it, a skid stops against it. */
  turretRadius: 2.2,
  turretHeight: 3,
} as const;

export const TURRET_TIMING = {
  integrity: 100,
  introTicks: ticks(3),
  betweenTicks: ticks(5),
  /** March speed = template moveSpeed x marchFactor. */
  marchFactor: 0.55,
  windupTicks: ticks(1.5),
  downTicks: ticks(0.8),
  riseTicks: ticks(0.6),
  corpseTicks: ticks(5),
} as const;

export const TURRET_PHYSICS = {
  /** Gameplay gravity (yd/s^2), snappier than the player's. */
  gravity: 30,
  /** A ground contact faster than this (yd/s, downward) bounces; slower lands. */
  bounceMinSpeed: 4,
  /** Vertical speed kept by a bounce. */
  restitution: 0.35,
  /** Horizontal speed kept by a bounce. */
  bounceKeep: 0.6,
  /** Horizontal speed kept by a collider reflection. */
  wallRestitution: 0.4,
  skidDecel: 25,
  skidStopSpeed: 0.3,
  /** Water deeper than this (yd) at a landing point drowns the body at once. */
  deepWater: 0.8,
  /** A flight that finds no contact within this bound is lost in the void. */
  maxFlightTicks: ticks(10),
  maxSkidTicks: ticks(3),
  /** Contact search samples per tick (0.4 yd apart at the 32 yd/s juggle cap). */
  substeps: 4,
  /** Ground standing more than this above a flying body where it meets it is a face, not a floor. */
  stepRise: 0.25,
} as const;
