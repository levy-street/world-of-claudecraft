// Fire and Fly (turret defense POC) tuning, data only. The engine is
// src/sim/minigames/turret_defense.ts; the wave plan resolver
// (src/sim/minigames/turret_defense_plan.ts) reads the templates from MOBS.
// TURRET_WAVES is the Standard scenario's table (fire_and_fly_scenarios.ts).

import { FIRE_AND_FLY_TOWER } from '../fire_and_fly_field';
import {
  DT,
  type TurretBowlingDef,
  type TurretSizeClass,
  type TurretSizeDef,
  type TurretWaveDef,
} from '../types';

const ticks = (seconds: number): number => Math.round(seconds / DT);

export const TURRET_SIZE_CLASSES: Readonly<Record<TurretSizeClass, Readonly<TurretSizeDef>>> = {
  small: { mass: 1, breachValue: 2, radius: 0.6, height: 1.2 },
  medium: { mass: 1.6, breachValue: 4, radius: 0.5, height: 2 },
  large: { mass: 3, breachValue: 10, radius: 0.9, height: 2.6 },
  huge: { mass: 4.5, breachValue: 15, radius: 1.2, height: 3 },
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
/** Inside the march, well clear of the tower's foot and of the 46 yd spawn ring. */
export const TURRET_BARREL_RING = { minRadius: 16, maxRadius: 30 } as const;

export const TURRET_WAVES: readonly TurretWaveDef[] = [
  {
    entries: [{ templateId: 'forest_wolf', count: 8, level: 2 }],
    coreDamage: 60,
    gapMinTicks: GAP_MIN,
    gapMaxTicks: GAP_MAX,
    barrels: { count: 3, ...TURRET_BARREL_RING },
  },
  {
    entries: [
      { templateId: 'forest_wolf', count: 6, level: 2 },
      { templateId: 'wild_boar', count: 6, level: 3 },
    ],
    coreDamage: 64,
    gapMinTicks: GAP_MIN,
    gapMaxTicks: GAP_MAX,
    barrels: { count: 3, ...TURRET_BARREL_RING },
  },
  {
    entries: [
      { templateId: 'vale_bandit', count: 8, level: 5 },
      { templateId: 'webwood_spider', count: 6, level: 4 },
    ],
    coreDamage: 84,
    gapMinTicks: GAP_MIN,
    gapMaxTicks: GAP_MAX,
    barrels: { count: 4, ...TURRET_BARREL_RING },
  },
  {
    entries: [
      { templateId: 'tunnel_rat', count: 8, level: 6 },
      { templateId: 'fen_troll', count: 4, level: 11 },
    ],
    coreDamage: 100,
    gapMinTicks: GAP_MIN,
    gapMaxTicks: GAP_MAX,
    barrels: { count: 4, ...TURRET_BARREL_RING },
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
    barrels: { count: 5, ...TURRET_BARREL_RING },
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
    barrels: { count: 5, ...TURRET_BARREL_RING },
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
  /**
   * A hit below this falloff only grazes: full damage, but no throw and no timer
   * restarted. Relaunching on every rim hit kept a body lying past the maximum
   * range from ever getting up.
   */
  grazeFalloff: 0.2,
  /** Horizontal launch speed of a core hit on mass 1 (yd/s), scaled by falloff / mass^massExponent. */
  push: 18.34,
  /** Vertical launch speed of a core hit on mass 1 (yd/s), scaled the same way. */
  pop: 19.59,
  /** A cube root: on flat ground a yeti still flies about a third as far as a wolf. */
  massExponent: 1 / 3,
  /** Random spread of the throw direction, either side (radians). */
  deviation: Math.PI / 12,
  /** Closer than this to the blast point, a body is thrown outward from the turret. */
  deadCenter: 0.05,
  /** Juggling adds velocity; these caps keep a juggled body's flight bounded. */
  maxLaunchSpeed: 32,
  maxLaunchLift: 26,
} as const;

/**
 * Explosive barrels. A shell blast or a barrel blast reaching one (centre within
 * the blast radius plus the barrel's), or a thrown body touching it faster than
 * the bowling minimum speed, lights it; it blows after the fuse, so a chain reads
 * as a ripple. Its blast follows the shell's falloff and launch rules, bigger.
 */
export const TURRET_EXPLOSIVE_BARREL = {
  /** The drum's footprint (yd): a thrown body bounces off it, and a blast reaches it this much further. */
  radius: 0.5,
  /** Its top over the ground (yd): a body flying higher clears it. */
  height: 1.3,
  /** Barrels standing at once; an intact one outlives its wave. */
  cap: 6,
  /** The closest two barrels may stand (yd). */
  minSpacing: 6,
  /** How far a bearing may wander from the middle of its share of the circle, as a share of it, either side. */
  bearingJitter: 0.35,
  /** Draws a barrel gets at a clear spot before its wave does without it. */
  placementTries: 6,
  /** Room (yd) a marcher's lane keeps from a barrel, past the two radii. */
  laneMargin: 0.4,
  fuseTicks: ticks(0.25),
  blastRadius: 9,
  blastCore: 2.5,
  /** A core hit's damage, as a multiple of the wave's shell core damage. */
  damageScale: 2,
  /** Push and pop, as a multiple of the shell's. */
  throwScale: 1.35,
} as const;

/**
 * The Shockwave, a limited weapon: the tower slams and a ring rolls out from its
 * wall, throwing every living body it meets on the ground outward, low and flat.
 * It cancels a windup, lights no barrel itself, and rearms on its own clock,
 * apart from the shell's reload. First values, to tune by playtest.
 */
export const TURRET_SHOCKWAVE = {
  /** Where the front starts: the tower's wall. */
  innerRadius: FIRE_AND_FLY_TOWER.radius,
  reach: 12,
  /** The front rolls from the wall to the reach in this time, at a steady speed. */
  rollTicks: ticks(0.4),
  /** Full strength inside the core, then the shell's linear falloff: 60 percent at the reach. */
  falloffCore: 8,
  falloffRadius: 18,
  /** Feet higher than this over the ground pass over the front. */
  groundClearance: 1.5,
  /** Push and pop as multiples of the shell's: a shove, not a launch. */
  pushScale: 1.2,
  popScale: 0.6,
  /** Damage at full strength, as a multiple of the wave's shell core damage. */
  damageScale: 0.3,
  rearmTicks: ticks(1.5),
} as const;

/**
 * The fragmentation shell, a limited weapon: aimed, flown and reloaded like a
 * shell, it bursts over its point into a fixed star of bomblets (one on the
 * point, the rest on a circle turned to the shot's bearing, one straight ahead)
 * that land in turn and blast like small shells, lighting barrels as a shell
 * does. No draw anywhere: the pattern is the same every time. First values.
 */
export const TURRET_FRAGMENTATION = {
  /** The burst's height over the aim point (visual only: the bomblets land on the ground). */
  burstHeight: 4,
  outerCount: 5,
  outerRadius: 4.5,
  /** Ticks from the burst to the centre bomblet, then to the first outer one; one tick apart after. */
  centreDelayTicks: ticks(0.2),
  outerDelayTicks: ticks(0.25),
  blastRadius: 3.5,
  blastCore: 1,
  /** A bomblet's damage at full strength, as a multiple of the shot's. */
  damageScale: 0.5,
  /** Push and pop as multiples of the shell's. */
  throwScale: 0.55,
} as const;

/**
 * Bowling. The reach doubles the standing radii: a tumbling body sweeps about
 * twice its footprint, and at the bare radii a whole run saw only a handful of
 * knocks.
 */
export const TURRET_BOWLING: Readonly<TurretBowlingDef> = {
  enabled: true,
  minSpeed: 5,
  reachScale: 2,
  transfer: 0.5,
  pop: 7,
  damageShare: 0.1,
  flyerKeep: 0.6,
  lyingHeight: 0.35,
};

const STRIKE_MARGIN = 0.4;

export const TURRET_ARENA = {
  spawnRadius: 46,
  /**
   * A monster stops at breachRadius + its body radius from the center and winds
   * up: a small margin off the tower's wall, so it strikes in contact.
   */
  breachRadius: FIRE_AND_FLY_TOWER.radius + STRIKE_MARGIN,
  /** The cannon tower's body: a flight below its parapet reflects off it, a skid stops against it. */
  turretRadius: FIRE_AND_FLY_TOWER.radius,
  turretHeight: FIRE_AND_FLY_TOWER.topY,
} as const;

export const TURRET_TIMING = {
  introTicks: ticks(3),
  betweenTicks: ticks(5),
  /** March speed = template moveSpeed x marchFactor. */
  marchFactor: 0.55,
  windupTicks: ticks(1.5),
  downTicks: ticks(0.8),
  riseTicks: ticks(0.6),
  corpseTicks: ticks(5),
  /** An ended run's result stays up this long, then the seat leaves on its own, as through Leave. */
  endedSeatTicks: ticks(120),
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
