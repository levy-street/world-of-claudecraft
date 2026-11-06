// The Guardian of the Heat's leaf (docs/design/raid/smith_heart.md section
// 7.4): every id the fight's sim, its renderer, its HUD, its dev helpers and
// its tests key on, the per-difficulty rules, the tuning, and the pure
// template-id helpers of its encounter objects. No SimContext, no rng.
//
// "The well of the first flame": the guardian stands half sunk in the
// wellspring at the back of the Hearth and the raid fights on the shore in
// front of it (inspired by Ragnaros in Firelands as a CONCEPT only: every
// name here is our own and was IP-checked, design doc 7.4).
//
// EVERY number here is a SKETCH, unmeasured (the design doc's 7.4 table says
// so too): anchored to the other guardians' (level 20 elite, ten players, a
// measured bot raid of about 400 to 460 damage a second) and the level-20
// cloth reference (about 1,135 to 1,345 health), to be calibrated with the
// meters harness before the raid ships. Every tunable lives in HEAT_TUNING
// and HEAT_DIFFICULTY, so a change is one number.
//
// What every client reads (no wire or IWorld change; all of it rides
// existing entity fields):
//   - the guardian's phase and stage: an aura on it (`value` the phase,
//     `value2` the stage, its `remaining` and `duration` the stage's clock),
//     its bar (the cast id below);
//   - the wellspring: a claim object whose template carries its state;
//   - every footprint (the fist's spot, the swell lanes and their waves, the
//     overflow's rivers, the seeds, the zones, a cinder's fall and scorch,
//     the trails): objects, a radius or
//     a half width in `scale`, a direction in `facing`, a state and its
//     length in the template;
//   - the adds (the Wellspawn, the Wellkeepers, the Seedflames, the Rolling
//     Cinders): mobs, and the marks and hunts they lay as auras;
//   - the moments as `spellfx` cues (HEAT_CUES).

/** The guardian (template id, frozen: its death lights the Heat vein). */
export const HEAT_GUARDIAN = 'heart_heat_guardian';

// ---- casts, auras, objects, cues --------------------------------------------------

/** The guardian's bars. */
export const HEAT_CASTS = {
  /** Basalt Fist: the crystal-and-basalt fist rises over a spot on the shore
   *  and slams it (planted, its facing locked on the spot). */
  fist: 'heart_heat_fist',
} as const;

/** The auras the fight puts on players, adds and the guardian. */
export const HEAT_AURAS = {
  /** On the guardian: its phase (`value` 1 to 3) and stage (`value2`, see
   *  HEAT_STAGES), the stage's clock in `remaining` and `duration`. */
  state: 'heart_heat_state',
  /** Hearth Flare's mark: more Fire (and other magic) damage taken. */
  scorched: 'heart_heat_scorched',
  /** Cinder Grip: the template's stacking burn on the tank (mob_swing.ts
   *  `stackPoison`; its aura id is the seam's own). */
  grip: 'stackpoison_heart_heat_guardian',
  /** A Wellkeeper's Kindling Mark: in 5 s this player trails fire. */
  kindling: 'heart_heat_kindling',
  /** The mark has caught: this player leaves a Cinder Trail. */
  trail: 'heart_heat_trailing',
  /** A Rolling Cinder or a Seedflame hunts this player. */
  hunted: 'heart_heat_hunted',
  /** On a Rolling Cinder: struck back, no knockback moves it for a while. */
  crust: 'heart_heat_crust',
} as const;

/** The guardian's stages (its state aura's `value2`). */
export const HEAT_STAGES = {
  fight: 0,
  sinking: 1,
  under: 2,
  rising: 3,
} as const;
export type HeatStage = keyof typeof HEAT_STAGES;

/** The fight's object templates (a radius or a half width rides `scale`). */
export const HEAT_OBJECTS = {
  /** The first wellspring, a claim object: `<prefix><calm|over>`. */
  wellPrefix: 'sh_heat_well_',
  /** Basalt Fist's spot: `<prefix><tenths>` of warning. */
  fistPrefix: 'sh_heat_fist_',
  /** A Molten Swell's lane from the fist's spot: `<prefix><warn|roll>_<tenths>`,
   *  along `facing`, its half width in `scale`, HEAT_TUNING.laneLength long. */
  lanePrefix: 'sh_heat_lane_',
  /** A Molten Swell's wave rolling down its lane (it moves; along `facing`,
   *  its half width in `scale`). */
  wave: 'sh_heat_wave',
  /** An overflow river from the wellspring: `<prefix><warn|flow>_<tenths>`,
   *  along `facing`, its half width in `scale`, HEAT_TUNING.riverLength long. */
  riverPrefix: 'sh_heat_river_',
  /** A Hearthseed: `<prefix><tenths>` to its burst, its burst reach in `scale`. */
  seedPrefix: 'sh_heat_seed_',
  /** Wakefire: `<prefix><band>_<warn|burn>_<tenths>` (bands round the well). */
  zonePrefix: 'sh_heat_zone_',
  /** Mythic: a slice of the Wheel of the Hearth (wheelTemplate). */
  wheelPrefix: 'sh_heat_wheel_',
  /** Where a Rolling Cinder will land: `<prefix><tenths>`. */
  fallPrefix: 'sh_heat_fall_',
  /** A cinder's burning landing spot: `<prefix><tenths>` of its life. */
  scorchPrefix: 'sh_heat_scorch_',
  /** A Cinder Trail patch: `<prefix><tenths>` of its life. */
  trailPrefix: 'sh_heat_trail_',
} as const;

/** The spellfx ability ids of the fight's moments. */
export const HEAT_CUES = {
  /** Basalt Fist lands (spellfxAt 'burst' at its spot). */
  fist: 'heart_heat_fist_land',
  /** A Molten Swell starts to roll (spellfxAt at its lane's start). */
  swell: 'heart_heat_swell',
  /** Hearth Flare strikes a far player (spellfx 'beam', guardian to them). */
  flare: 'heart_heat_flare',
  /** The guardian sinks into the wellspring (spellfx 'nova' on it). */
  sink: 'heart_heat_sink',
  /** It rises again (spellfx 'nova' on it). */
  rise: 'heart_heat_rise',
  /** An overflow river starts to flow (spellfxAt at its head). */
  river: 'heart_heat_river',
  /** A Falling Cinder strikes a player (spellfx 'burst' on them). */
  bolt: 'heart_heat_bolt',
  /** A Wellspawn climbs out at the room's edge (spellfxAt). */
  spawn: 'heart_heat_spawn',
  /** A Wellspawn reaches the wellspring and feeds it (spellfxAt). */
  feed: 'heart_heat_feed',
  /** A Wellkeeper marks a player (spellfx 'beam', keeper to them). */
  kindling: 'heart_heat_kindling',
  /** The guardian heaves the Hearthseeds out of the wellspring (spellfx
   *  'nova' on it): the throw's gesture and its meteors leave its hands. */
  seedThrow: 'heart_heat_seed_throw',
  /** A Hearthseed lands, HEAT_TUNING.seedFlight after the throw (spellfxAt). */
  seed: 'heart_heat_seed',
  /** A Hearthseed bursts (spellfxAt, its reach as the radius). */
  seedBurst: 'heart_heat_seed_burst',
  /** A Seedflame hatches from a burst (spellfxAt). */
  hatch: 'heart_heat_hatch',
  /** A Wakefire band ignites (spellfx 'nova' on the guardian). */
  ignite: 'heart_heat_ignite',
  /** A Rolling Cinder lands (spellfxAt). */
  cinderLand: 'heart_heat_cinder_land',
  /** A Rolling Cinder is struck back (spellfx 'burst' on it). */
  cinderKnock: 'heart_heat_cinder_knock',
  /** A Rolling Cinder reaches its quarry and bursts (spellfxAt). */
  cinderBurst: 'heart_heat_cinder_burst',
  /** The fight is over: the wellspring settles (spellfx 'nova'). */
  settle: 'heart_heat_settle',
} as const;

/** The fight's own mob templates (content/smith_heart.ts). */
export const HEAT_MOBS = {
  /** Heroic's children of the flame: they walk to the wellspring. */
  spawn: 'heart_heat_wellspawn',
  /** Heroic's second overflow: tanked, they mark a player who trails fire. */
  keeper: 'heart_heat_wellkeeper',
  /** Heroic: hatched from a Hearthseed's burst, fixed on one player. */
  seedflame: 'heart_heat_seedflame',
  /** Phase 3: the great living fireball that hunts a player. */
  cinder: 'heart_heat_rolling_cinder',
} as const;

/** The mobs the encounter walks itself (the mob AI leaves them be: hostile,
 *  in combat, never moved, aggroed or swung by it; mob/locomotion.ts). */
export const HEAT_WALKERS: ReadonlySet<string> = new Set([HEAT_MOBS.spawn, HEAT_MOBS.cinder]);

/** The damage, aura and object names (combat log, floating text, the buff
 *  bar; re-localized by src/ui/sim_i18n.ts through the mechanic reverse
 *  map). Every coined one was IP-checked (design doc 7.4). */
export const HEAT_NAMES = {
  well: 'The First Wellspring',
  wellFire: 'Wellspring Fire',
  state: 'The First Flame',
  fist: 'Basalt Fist',
  swell: 'Molten Swell',
  flare: 'Hearth Flare',
  scorched: 'Flare-Scorched',
  grip: 'Cinder Grip',
  river: 'Wellspring Overflow',
  bolt: 'Falling Cinder',
  feed: 'Fed Flame',
  kindling: 'Kindling Mark',
  trail: 'Cinder Trail',
  seed: 'Hearthseed',
  zone: 'Wakefire',
  wheel: 'Wheel of the Hearth',
  cinder: 'Rolling Cinder',
  cinderLand: 'Cinder Scorch',
  hunted: 'Hunted',
  crust: 'Cooling Crust',
} as const;

// ---- difficulty -----------------------------------------------------------------------

/** The fight's difficulty. Each tier is one HEAT_DIFFICULTY row; mythic is a
 *  dev-switched prototype (heat.ts setHeatDevTier) and, for now, the heroic
 *  row whole: its mythic-only mechanic is the `wheel` field and its
 *  own module, never a branch on a tier's name. */
export type HeatDifficulty = 'normal' | 'heroic' | 'mythic';

export interface HeatDifficultyRules {
  /** Every mechanic's damage, on top of the claim's own multiplier. */
  damageMult: number;
  /** The boss's health pool against the template's, set at the pull
   *  (tier_health.ts). */
  healthMult: number;
  /** The overflows bring the Wellspawn (and the second, two Wellkeepers). */
  overflowAdds: boolean;
  /** A Hearthseed's burst hatches a Seedflame. */
  seedHatch: boolean;
  /** Players a Falling Cinder volley strikes. */
  bolts: number;
  /** A Rolling Cinder's speed (yards a second; a player runs 7). */
  cinderSpeed: number;
  /** The Wheel of the Hearth (heat_wheel.ts). */
  wheel: boolean;
}

export const HEAT_DIFFICULTY: Readonly<Record<HeatDifficulty, HeatDifficultyRules>> = {
  normal: {
    damageMult: 1,
    healthMult: 1,
    overflowAdds: false,
    seedHatch: false,
    bolts: 2,
    cinderSpeed: 3.2,
    wheel: false,
  },
  heroic: {
    damageMult: 1.25,
    healthMult: 1.45,
    overflowAdds: true,
    seedHatch: true,
    bolts: 3,
    cinderSpeed: 4.4,
    wheel: false,
  },
  // Heroic whole, plus the Wheel of the Hearth.
  mythic: {
    damageMult: 1.25,
    healthMult: 1.45,
    overflowAdds: true,
    seedHatch: true,
    bolts: 3,
    cinderSpeed: 4.4,
    wheel: true,
  },
};

/** The phases (1 to 3, on every difficulty: the guardian never leaves the
 *  wellspring) and which of the fight's mechanics run in each. */
export type HeatPhase = 1 | 2 | 3;

export interface HeatPhaseKit {
  fist: boolean;
  flare: boolean;
  seeds: boolean;
  zones: boolean;
  cinders: boolean;
}

export const HEAT_PHASE_KIT: Readonly<Record<HeatPhase, HeatPhaseKit>> = {
  1: { fist: true, flare: true, seeds: false, zones: false, cinders: false },
  2: { fist: true, flare: false, seeds: true, zones: true, cinders: false },
  3: { fist: true, flare: false, seeds: false, zones: true, cinders: true },
};

// ---- the wellspring's size -------------------------------------------------------------

/** The first wellspring's burning lip (yards from its middle): the guardian's
 *  body radius too, so melee strikes it from the shore round the lip. The
 *  layout's HEARTH_WELL takes its radius from here, and every reach measured
 *  from the well's middle (Hearth Flare's, Wakefire's bands, a Wellspawn's
 *  feeding) is this plus its own margin, so the fight keeps its shape when the
 *  well grows (pass 4 of 2026-11-06: 8 to 10.5 with the guardian's body). */
export const HEAT_WELL_R = 10.5;

/** The guardian's template scale (its drawn size; the renderer's fire
 *  reckons in it): grown with the well in pass 4, 3 to 4. Its own swing's
 *  reach follows its body radius (mob_combat.ts), never this alone. */
export const HEAT_GUARDIAN_SCALE = 4;

// ---- tuning (SKETCH, unmeasured) ------------------------------------------------------

export const HEAT_TUNING = {
  // The phases (fractions of its health).
  overflowOneAt: 0.7,
  overflowTwoAt: 0.4,
  // The overflows.
  sinkSeconds: 2.5,
  riseSeconds: 3,
  /** Normal: the Hearth overflows this long. */
  overflowSeconds: 20,
  /** Heroic: until the adds are gone, at least this long, at most overflowMax. */
  overflowMin: 8,
  overflowMax: 45,
  // The wellspring: whoever stands in it burns.
  wellTick: 0.5,
  wellMin: 120,
  wellMax: 140,
  // Basalt Fist and its Molten Swells.
  fistFirst: 8,
  fistEvery: 22,
  fistCast: 3,
  fistR: 6,
  fistMin: 2500,
  fistMax: 2700,
  /** Three lanes from the spot: away from the wellspring and to either side.
   *  Pass 5 (2026-11-06, the owner's call): 11 yd wide (2.5 either side
   *  before), a wall a raid reads as a wave; from the lane's middle a player
   *  runs out of it in under a second, the warning is 3.6 s before it rolls. */
  laneLength: 32,
  laneHalf: 5.5,
  /** The waves start rolling this long after the fist lands. */
  waveDelay: 0.6,
  waveSpeed: 10,
  /** A wave's wall is this deep along its lane (2.5 before pass 5). */
  waveDepth: 5,
  waveMin: 380,
  waveMax: 440,
  // Hearth Flare (phase 1): everyone farther than flareReach from the
  // wellspring's middle (12 yd past its lip, the giant's reach) is struck.
  flareEvery: 4,
  flareReach: HEAT_WELL_R + 12,
  flareMin: 260,
  flareMax: 300,
  scorchedPct: 0.25,
  scorchedSeconds: 8,
  // Cinder Grip (the template's stackPoison): per stack a second.
  // 18 until the bot raid of 2026-11-04: swapped at 5 stacks, both tanks still
  // burned 90 a second each for 15 s, more than two level-20 healers keep up.
  gripPerTick: 9,
  gripSeconds: 15,
  gripMaxStacks: 10,
  // The overflow's rivers and Falling Cinders.
  riverEvery: 4.5,
  riverFirst: 1,
  riverCount: 3,
  riverWarn: 2.5,
  riverFlow: 3,
  riverHalf: 3,
  riverLength: 60,
  riverTick: 0.5,
  riverMin: 180,
  riverMax: 220,
  /** The rivers' bearings: this many, evenly from riverFrom to riverTo
   *  degrees (sim facing: 0 is +z, 90 east toward the door). */
  riverBearings: 9,
  riverFrom: 15,
  riverTo: 165,
  boltEvery: 3,
  boltFirst: 2,
  boltMin: 140,
  boltMax: 170,
  // Heroic: the Wellspawn.
  spawnSpeed: 3,
  /** Their speed factor at full health, falling to spawnMinFactor at
   *  spawnSlowAt of their health and below ("fully slowed"). */
  spawnMinFactor: 0.15,
  spawnSlowAt: 0.5,
  /** One reaching this far from the wellspring's middle feeds it (a yard and
   *  a half past its lip). */
  spawnReach: HEAT_WELL_R + 1.5,
  feedHealPct: 0.03,
  feedMin: 380,
  feedMax: 420,
  // Heroic's second overflow: the Wellkeepers and their Kindling Mark.
  markFirst: 4,
  markEvery: 10,
  markSeconds: 5,
  trailSeconds: 8,
  trailEvery: 0.6,
  trailR: 2.5,
  trailLife: 15,
  trailCap: 40,
  trailTick: 1,
  trailMin: 80,
  trailMax: 95,
  /** A Wellspawn standing in a trail heals this share of its health a
   *  second. */
  trailHealPct: 0.08,
  // Phase 2: Hearthseeds.
  seedFirst: 6,
  seedEvery: 30,
  seedLife: 10,
  seedCap: 10,
  /** A burst's reach and its damage at the seed (falling off with the
   *  square of the distance to nothing at the reach). */
  seedReach: 22,
  seedMax: 520,
  /** A seed is thrown: the guardian heaves it out of the wellspring as it
   *  falls (the seed's object and footprint show at once), and it strikes the
   *  floor this long after (its landing cue). Its fuse (seedLife) still runs
   *  from the throw, so the burst keeps its time. */
  seedFlight: 2.2,
  // Wakefire (phases 2 and 3).
  zoneFirst: 16,
  zoneEvery: 34,
  // The Wheel of the Hearth (Mythic): its clock, a round's warning, its burn and
  // bite (the same order as Wakefire's), how far out its slices reach.
  wheelFirst: 24,
  wheelEvery: 40,
  wheelWarn: 4,
  wheelBurn: 1.5,
  wheelTick: 0.5,
  wheelMin: 900,
  wheelMax: 1000,
  wheelBurnMin: 220,
  wheelBurnMax: 260,
  wheelOuter: 70,
  zoneWarn: 4,
  /** The next band begins its warning this long after the last began. */
  zoneStep: 2.5,
  zoneBurn: 2,
  zoneTick: 0.5,
  zoneMin: 900,
  zoneMax: 1000,
  zoneBurnMin: 220,
  zoneBurnMax: 260,
  // Phase 3: the Rolling Cinders.
  cinderFirst: 8,
  cinderEvery: 45,
  cinderFallWarn: 2,
  cinderLandR: 4,
  cinderLandMin: 300,
  cinderLandMax: 340,
  scorchLife: 8,
  /** Burning landings at once at most (the oldest goes out first). */
  scorchCap: 6,
  scorchTick: 0.5,
  scorchMin: 110,
  scorchMax: 130,
  /** It reaches its quarry this near: the quarry dies, those close burn. */
  cinderContact: 2.2,
  cinderKill: 99999,
  cinderSplashR: 3,
  cinderSplashMin: 600,
  cinderSplashMax: 700,
  /** A hit pushes it this far back, then Cooling Crust holds it. */
  cinderKnock: 6,
  crustSeconds: 5,
  cinderCap: 6,
  /** Its quarry gone, it picks another after this pause. */
  cinderRetarget: 1.5,
  /** Seconds of plain melee after a bar lands before the next begins. */
  barGap: 1.2,
} as const;

// ---- pure helpers ---------------------------------------------------------------------

/** A small integer hash (no rng in a pick). */
export function heatHash(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x2545f491) ^ Math.imul(b | 0, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** The health share the guardian cannot be pushed past in `phase` (the next
 *  threshold, so an overflow is never skipped), or null when none. */
export function phaseFloor(phase: HeatPhase): number | null {
  const T = HEAT_TUNING;
  if (phase === 1) return T.overflowOneAt;
  if (phase === 2) return T.overflowTwoAt;
  return null;
}

/** A Wellspawn's speed factor at `hpFrac` of its health: whole at full,
 *  falling to the floor at spawnSlowAt and below. */
export function spawnPace(hpFrac: number): number {
  const T = HEAT_TUNING;
  const k = Math.max(0, Math.min(1, (hpFrac - T.spawnSlowAt) / (1 - T.spawnSlowAt)));
  return T.spawnMinFactor + (1 - T.spawnMinFactor) * k;
}

/** A Hearthseed's burst at `d` yards (before the roll and the multiplier). */
export function seedFalloff(d: number): number {
  const T = HEAT_TUNING;
  if (d >= T.seedReach) return 0;
  const k = 1 - Math.max(0, d) / T.seedReach;
  return T.seedMax * k * k;
}

/** Wakefire's three bands round the wellspring's middle: [inner, outer)
 *  yards. 0 near the guardian, 1 the middle, 2 the back. */
export const ZONE_BANDS: readonly (readonly [number, number])[] = [
  [HEAT_WELL_R, HEAT_WELL_R + 11],
  [HEAT_WELL_R + 11, HEAT_WELL_R + 23],
  [HEAT_WELL_R + 23, 70],
];

/** The Wheel of the Hearth: how many slices, and how many rounds in a run. */
export const WHEEL_SLICES = 4;
export const WHEEL_ROUNDS = 3;

/** A slice's bearings round the wellspring (sim facing, degrees): 45 degrees each
 *  over the shore, the two ends taking in the floor behind it. */
export const WHEEL_ARCS_DEG: readonly (readonly [number, number])[] = [
  [-90, 45],
  [45, 90],
  [90, 135],
  [135, 270],
];

export type HeatWheelState = 'warn' | 'burn' | 'safe';

/** A Wheel slice's template: which, its state, its seconds. */
export function wheelTemplate(slice: number, state: HeatWheelState, seconds: number): string {
  return `${HEAT_OBJECTS.wheelPrefix}${slice}_${state}_${Math.round(seconds * 10)}`;
}

export function wheelOf(
  templateId: string,
): { slice: number; state: HeatWheelState; seconds: number } | null {
  if (!templateId.startsWith(HEAT_OBJECTS.wheelPrefix)) return null;
  const [a, state, t] = templateId.slice(HEAT_OBJECTS.wheelPrefix.length).split('_');
  const slice = Number(a);
  const n = Number(t);
  if (!Number.isInteger(slice) || slice < 0 || slice >= WHEEL_SLICES) return null;
  if (state !== 'warn' && state !== 'burn' && state !== 'safe') return null;
  return Number.isInteger(n) && n >= 0 ? { slice, state, seconds: n / 10 } : null;
}

/** The overflow rivers' bearing `i` (sim facing, radians). */
export function riverBearing(i: number): number {
  const T = HEAT_TUNING;
  const n = T.riverBearings;
  const deg = T.riverFrom + ((T.riverTo - T.riverFrom) * i) / Math.max(1, n - 1);
  return (deg * Math.PI) / 180;
}

// ---- object templates (pure) ----------------------------------------------------------

const tenthsOf = (seconds: number): number => Math.max(0, Math.round(seconds * 10));

/** A timed object's template (`<prefix><tenths>`). */
export function heatTimed(prefix: string, seconds: number): string {
  return `${prefix}${tenthsOf(seconds)}`;
}

/** A timed object's seconds, or null when the template is not one. */
export function heatTimedOf(prefix: string, templateId: string): number | null {
  if (!templateId.startsWith(prefix)) return null;
  const t = Number(templateId.slice(prefix.length));
  return Number.isInteger(t) && t >= 0 ? t / 10 : null;
}

/** The wellspring's states: calm (the guardian in it), overflowing (an
 *  overflow). */
export type HeatWellState = 'calm' | 'over';
export function wellTemplate(state: HeatWellState): string {
  return `${HEAT_OBJECTS.wellPrefix}${state}`;
}
export function wellOf(templateId: string): HeatWellState | null {
  if (!templateId.startsWith(HEAT_OBJECTS.wellPrefix)) return null;
  const s = templateId.slice(HEAT_OBJECTS.wellPrefix.length);
  return s === 'calm' || s === 'over' ? s : null;
}

/** A two-state timed object (`<prefix><state>_<tenths>`). */
function stateTemplate(prefix: string, state: string, seconds: number): string {
  return `${prefix}${state}_${tenthsOf(seconds)}`;
}
function stateOf<S extends string>(
  prefix: string,
  states: readonly S[],
  templateId: string,
): { state: S; seconds: number } | null {
  if (!templateId.startsWith(prefix)) return null;
  const [state, t] = templateId.slice(prefix.length).split('_');
  if (!(states as readonly string[]).includes(state)) return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= 0 ? { state: state as S, seconds: n / 10 } : null;
}

export type HeatLaneState = 'warn' | 'roll';
export function swellLaneTemplate(state: HeatLaneState, seconds: number): string {
  return stateTemplate(HEAT_OBJECTS.lanePrefix, state, seconds);
}
export function swellLaneOf(templateId: string): { state: HeatLaneState; seconds: number } | null {
  return stateOf(HEAT_OBJECTS.lanePrefix, ['warn', 'roll'] as const, templateId);
}

export type HeatRiverState = 'warn' | 'flow';
export function riverTemplate(state: HeatRiverState, seconds: number): string {
  return stateTemplate(HEAT_OBJECTS.riverPrefix, state, seconds);
}
export function riverOf(templateId: string): { state: HeatRiverState; seconds: number } | null {
  return stateOf(HEAT_OBJECTS.riverPrefix, ['warn', 'flow'] as const, templateId);
}

export type HeatZoneState = 'warn' | 'burn';
export function zoneTemplate(band: number, state: HeatZoneState, seconds: number): string {
  return `${HEAT_OBJECTS.zonePrefix}${band}_${state}_${tenthsOf(seconds)}`;
}
export function zoneOf(
  templateId: string,
): { band: number; state: HeatZoneState; seconds: number } | null {
  if (!templateId.startsWith(HEAT_OBJECTS.zonePrefix)) return null;
  const [b, state, t] = templateId.slice(HEAT_OBJECTS.zonePrefix.length).split('_');
  const band = Number(b);
  const n = Number(t);
  if (!Number.isInteger(band) || band < 0 || band >= ZONE_BANDS.length) return null;
  if (state !== 'warn' && state !== 'burn') return null;
  return Number.isInteger(n) && n >= 0 ? { band, state, seconds: n / 10 } : null;
}
