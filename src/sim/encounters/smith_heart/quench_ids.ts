// The Guardian of the Quench's leaf (docs/design/raid/smith_heart.md section
// 7.3): every id the fight's sim, its renderer, its HUD, its dev helpers and
// its tests key on, the per-difficulty rules, the tuning, and the pure
// template-id helpers of its encounter objects. No SimContext, no rng.
//
// EVERY number here is a SKETCH, unmeasured (the design doc's 7.3 table says
// so too): anchored to the Hammer Council's and the Breath's (level 20 elite,
// ten players, a measured bot raid of about 400 to 460 damage a second) and
// the level-20 cloth reference (about 1,135 to 1,345 health), to be
// calibrated with the meters harness before the raid ships.
//
// What every client reads (no wire or IWorld change; all of it rides
// existing entity fields):
//   - each player's cold: an aura on them whose `value` is the bar (0 to
//     100) and `value2` its trend (1 rising, -1 falling); the huddle's
//     warmth, the frozen, the brittle and the trapped are auras too;
//   - the ice: the cracks and the holes (objects, their radius in `scale`);
//   - the Smith's four blades (claim objects, their state in the template,
//     their place and facing on the entity), a slash's line (an object at its
//     blade, the way it runs in its facing, its state and length in the
//     template), a slash's mark (an aura: `value` its number, `value2` the
//     round's count);
//   - the shore ice raised round the lake (objects, combat walls once up);
//   - the guardian's bars (cast ids below), its awake marker and the
//     deepening cold's stacks (auras on it), the moments as `spellfx` cues.

/** The guardian (template id, frozen: its death lights the Quench vein). */
export const QUENCH_GUARDIAN = 'heart_quench_guardian';

// ---- casts, auras, objects, cues --------------------------------------------------

/** The guardian's bars (and the damage names they carry). Tempering Strike
 *  stays the template's swing cleave (no bar). */
export const QUENCH_CASTS = {
  /** Quenching Breath: the frontal cone the tank turns from the raid (the
   *  content record's cone, encounter-driven: this fight starts it). */
  breath: 'heart_quenching_breath',
  /** At half health: it raises its arms and the four blades tear free. */
  wake: 'heart_quench_blades_wake',
  /** Mythic, at a quarter health: its arms raised while every blade hunts. */
  flurry: 'heart_quench_blades_hunt',
} as const;

/** The auras the fight puts on players and on the guardian. */
export const QUENCH_AURAS = {
  /** The cold bar: `value` 0 to 100, `value2` its trend (1 up, -1 down). */
  cold: 'heart_quench_cold',
  /** Standing in a huddle: the cold falls instead of rising. */
  warmth: 'heart_quench_warmth',
  /** The cold reached full: frozen solid (an unbreakable stun) until the
   *  ice shatters. */
  frozen: 'heart_quench_frozen',
  /** More damage taken: much more while frozen solid (its value the
   *  freeze's), then less for a while after the shatter (the brittle's). */
  brittle: 'heart_quench_brittle',
  /** Struck by a shatter's splash a moment ago: `value` the cold it added,
   *  `value2` the entity id of the player whose ice shattered (the client's
   *  shards fly from them; the player's own alert reads it). */
  splashed: 'heart_quench_splashed',
  /** Fallen through the ice: held in the water (a root), then climbing out. */
  trapped: 'heart_quench_trapped',
  /** On the guardian through phase 2: the four blades are awake. */
  awake: 'heart_quench_blades_awake',
  /** Marked for a slash: `value` its number in the round, `value2` the round's count. */
  marked: 'heart_quench_slash_mark',
  /** On the guardian: one stack per deepening of the cold (phase 2). */
  deepening: 'heart_quench_deepening',
} as const;

/** The fight's object templates (a radius or a reach rides `scale`). */
export const QUENCH_OBJECTS = {
  /** A crack under a lingering huddle: `<prefix><tenths>` of warning. */
  crackPrefix: 'sh_quench_crack_',
  /** A hole of freezing water (stays the rest of the fight). */
  hole: 'sh_quench_hole',
  /** One of the Smith's four blades: `<prefix><state>` (bladeTemplate). */
  bladePrefix: 'sh_quench_blade_',
  /** A slash's line, from its blade along the entity's facing (laneTemplate). */
  lanePrefix: 'sh_quench_lane_',
  /** The shore ice: rising (no wall yet), then up (a combat wall). */
  rimRise: 'sh_quench_rim_rise',
  rim: 'sh_quench_rim',
} as const;

/** The spellfx ability ids of the fight's moments. */
export const QUENCH_CUES = {
  /** A player freezes solid (spellfx 'nova' on them). */
  freeze: 'heart_quench_freeze',
  /** The ice round a frozen player shatters (spellfxAt 'burst', radius =
   *  the splash). */
  shatter: 'heart_quench_shatter',
  /** A hole opens (spellfxAt 'burst', radius = the hole). */
  hole: 'heart_quench_hole',
  /** A player falls through the ice (spellfx 'nova' on them). */
  plunge: 'heart_quench_plunge',
  /** A trapped player climbs out on the edge (spellfx 'nova' on them). */
  climb: 'heart_quench_climb',
  /** The four blades tear free and stand (spellfx 'nova' on the guardian). */
  wake: 'heart_quench_wake',
  /** A blade flies its line (spellfxAt at the line's middle). */
  cross: 'heart_quench_cross',
  /** The shore ice heaves up round the lake (spellfx 'nova' on the guardian). */
  rim: 'heart_quench_rim',
  /** The fight is over: the shore ice falls and the lake refreezes whole
   *  (spellfx 'nova' on the guardian). */
  thaw: 'heart_quench_thaw',
  /** The rime cracks a player's immunity (an Ice Block's stasis) as they
   *  freeze or shatter: the cold bites through (spellfx 'nova' on them). */
  bite: 'heart_quench_bite',
} as const;

/** The damage and aura names (combat log, floating text, the buff bar;
 *  re-localized by src/ui/sim_i18n.ts through the mechanic reverse map). */
export const QUENCH_NAMES = {
  cold: 'Quenching Cold',
  warmth: 'Huddled Warmth',
  frozen: 'Encased in Rime',
  shatter: 'Shattering Cold',
  brittle: 'Frost-Brittle',
  splashed: 'Rime Splash',
  water: 'Freezing Water',
  trapped: 'Under the Ice',
  breath: 'Quenching Breath',
  wake: 'The Blades Wake',
  awake: 'The Blades Awake',
  cross: 'Crossing Blade',
  deepening: 'Deepening Cold',
  crack: 'Groaning Ice',
  hole: 'Open Water',
  blade: "Smith's Blade",
  rim: 'Shore Ice',
} as const;

// ---- difficulty -----------------------------------------------------------------------

/** The fight's difficulty. Each tier is one QUENCH_DIFFICULTY row; mythic is
 *  a dev-switched prototype (quench.ts setQuenchDevTier): a mythic-only
 *  mechanic is one more field here and its own module, never a branch on a
 *  tier's name. */
export type QuenchDifficulty = 'normal' | 'heroic' | 'mythic';

export interface QuenchDifficultyRules {
  /** Every mechanic's damage, on top of the claim's own multiplier. */
  damageMult: number;
  /** A shatter's splash: how far, and how much cold it adds. */
  splashR: number;
  splashCold: number;
  /** How many players a round of slashes marks, with two blades awake and with four. */
  slashMarksLake: number;
  slashMarksAwake: number;
  /** A mark's warning: seconds from its line showing to its blade flying. */
  slashAim: number;
  /** One blade makes the whole round, each slash from where the last ended. */
  slashChain: boolean;
  /** The Blades Hunt, the interphase at a quarter health (quench_flurry.ts). */
  flurry: boolean;
}

export const QUENCH_DIFFICULTY: Readonly<Record<QuenchDifficulty, QuenchDifficultyRules>> = {
  normal: {
    damageMult: 1,
    splashR: 6,
    splashCold: 35,
    slashMarksLake: 1,
    slashMarksAwake: 2,
    slashAim: 3,
    slashChain: false,
    flurry: false,
  },
  // Contagious cold: a shatter splashes further and harder.
  heroic: {
    damageMult: 1.25,
    splashR: 10,
    splashCold: 55,
    slashMarksLake: 2,
    slashMarksAwake: 3,
    slashAim: 2.5,
    slashChain: false,
    flurry: false,
  },
  // Every round one blade, slash after slash from where the last one ended.
  mythic: {
    damageMult: 1.25,
    splashR: 10,
    splashCold: 55,
    slashMarksLake: 2,
    slashMarksAwake: 4,
    slashAim: 2,
    slashChain: true,
    flurry: true,
  },
};

// ---- tuning (SKETCH, unmeasured) ------------------------------------------------------

export const QUENCH_TUNING = {
  // Frostbite: the cold bar. The team's pass of 2026-11-04 made it stickier
  // (was: full alone in 30 s, falling 6 a second in a huddle).
  coldMax: 100,
  /** Alone, the bar fills in about 24 s. */
  coldRise: 100 / 24,
  /** In a huddle (2 or more others within warmR), it falls this fast. */
  coldFall: 4,
  warmR: 6,
  warmNeed: 2,
  /** At full: frozen this long (was 4 s), taking `frozenPct` more damage
   *  from everything, then the shatter. */
  freezeSeconds: 6,
  frozenPct: 1,
  /** The shatter's hit (was 220 to 260): never lethal alone on Normal for a
   *  topped-up level-20 cloth wearer (about 1,135 health). */
  shatterMin: 360,
  shatterMax: 400,
  /** After the shatter: more damage taken for a while (was 20%). While it
   *  lasts a splash never takes the player past brittleSplashCap (a chain
   *  stays bounded: seconds alone before it can freeze them again). */
  brittleSeconds: 15,
  brittlePct: 0.3,
  brittleSplashCap: 80,
  /** How long a splash's mark stays on the player it struck. */
  splashMarkSeconds: 2.5,
  /** Cold a hit adds: the guardian's breath, a slash, a fall through the ice. */
  breathCold: 20,
  crossCold: 20,
  plungeCold: 30,
  // The ice (phase 1 and 2).
  /** A huddle lingering on one spot (its middle within strainJoin of where
   *  it began) for strainLinger seconds cracks the ice there; an unloaded
   *  spot heals at strainHeal a second. */
  strainJoin: 4,
  strainLinger: 8,
  strainHeal: 0.5,
  crackWarn: 2.5,
  holeR: 3.5,
  /** At most this many holes: past it the oldest skins over. */
  holeMax: 30,
  /** A body falls in this far inside a hole's rim. */
  holeMargin: 0.3,
  plungeMin: 150,
  plungeMax: 180,
  trapSeconds: 4,
  trapTick: 1,
  trapMin: 100,
  trapMax: 120,
  /** Out on the edge this far past the rim; then this long before the
   *  water can take them again. */
  climbOut: 1.0,
  climbGrace: 1.5,
  // Quenching Breath (encounter-driven: the content record holds the look's
  // numbers; these are the fight's clock).
  breathFirst: 6,
  breathEvery: 14,
  breathCast: 2.5,
  breathRange: 22,
  breathArcDeg: 70,
  breathMin: 240,
  breathMax: 280,
  // At half health: the blades wake.
  wakeAt: 0.5,
  wakeCast: 4,
  /** Tempering Strike: the template's swing cleave (every 4th landed swing,
   *  its arc and reach; content/smith_heart.ts reads these). */
  strikeEvery: 4,
  strikeArcDeg: 100,
  strikeRange: 8,
  // Phase 2: the deepening cold (the soft enrage).
  deepenEvery: 20,
  deepenStep: 0.1,
  // The slashes: seconds to the first after a wake, between rounds with two blades
  // and with four, the line's lock before the blade flies, the flight, the breath
  // between two slashes, how far in from the shore ice the line stops, its shortest,
  // its half width, its hit.
  slashFirst: 8,
  slashAfterWake: 6,
  slashEveryLake: 20,
  slashEveryAwake: 15,
  slashLock: 0.8,
  slashFly: 0.35,
  slashGap: 0.6,
  slashRimMargin: 2,
  slashMinLength: 4,
  laneHalf: 1.8,
  crossMin: 300,
  crossMax: 350,
  // Mythic's interphase: at what health, how long, its line's warning, the seconds
  // between two slashes at its start and at its end.
  flurryAt: 0.25,
  flurrySeconds: 20,
  flurryAim: 1,
  flurryGapStart: 1.5,
  flurryGapEnd: 1,
  // The shore ice.
  rimRise: 2.5,
  /** Seconds of plain melee after a bar lands before the next begins. */
  barGap: 1.2,
} as const;

// ---- pure helpers ---------------------------------------------------------------------

/** A slash's flight at linear fraction `k` (0..1) of its time: eased in and
 *  out, so the sim's blade, the line's hits and the painter's blade all ride
 *  one curve. Pure. */
export function slashEase(k: number): number {
  const c = Math.max(0, Math.min(1, k));
  return c * c * (3 - 2 * c);
}

/** The cold's rise multiplier with `stacks` of the deepening cold. */
export function deepenMult(stacks: number): number {
  return 1 + QUENCH_TUNING.deepenStep * Math.max(0, stacks);
}

/** One second of the cold: how far it moves for a player with `others`
 *  warm neighbours (the rise times the deepening; the fall flat). */
export function coldStep(others: number, mult = 1): number {
  const T = QUENCH_TUNING;
  return others >= T.warmNeed ? -T.coldFall : T.coldRise * mult;
}

/** A small integer hash (no rng in a pick). */
export function quenchHash(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x3c6ef372) ^ Math.imul(b | 0, 0x1b873593)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

// ---- object templates (pure) ----------------------------------------------------------

const tenthsOf = (seconds: number): number => Math.max(0, Math.round(seconds * 10));

/** A crack's template: its warning's length. */
export function crackTemplate(seconds: number): string {
  return `${QUENCH_OBJECTS.crackPrefix}${tenthsOf(seconds)}`;
}

/** A crack template's warning seconds, or null. */
export function crackOf(templateId: string): number | null {
  if (!templateId.startsWith(QUENCH_OBJECTS.crackPrefix)) return null;
  const t = Number(templateId.slice(QUENCH_OBJECTS.crackPrefix.length));
  return Number.isInteger(t) && t >= 0 ? t / 10 : null;
}

/** A blade's states: sunk in the lake, waking (tearing free), floating
 *  upright, flying (a slash). */
export type QuenchBladeState = 'sunk' | 'wake' | 'float' | 'fly';
const BLADE_STATES: readonly QuenchBladeState[] = ['sunk', 'wake', 'float', 'fly'];

export function bladeTemplate(state: QuenchBladeState): string {
  return `${QUENCH_OBJECTS.bladePrefix}${state}`;
}

export function bladeStateOf(templateId: string): QuenchBladeState | null {
  if (!templateId.startsWith(QUENCH_OBJECTS.bladePrefix)) return null;
  const s = templateId.slice(QUENCH_OBJECTS.bladePrefix.length) as QuenchBladeState;
  return BLADE_STATES.includes(s) ? s : null;
}

/** A slash's line: its warning, then the flight. */
export type QuenchLaneState = 'warn' | 'fly';

/** A line's template: its state, that state's seconds and its length in whole yards
 *  (the sim rounds the line to a whole length, so both read the same one). */
export function laneTemplate(state: QuenchLaneState, seconds: number, length: number): string {
  return `${QUENCH_OBJECTS.lanePrefix}${state}_${tenthsOf(seconds)}_${Math.round(length)}`;
}

export function laneOf(
  templateId: string,
): { state: QuenchLaneState; seconds: number; length: number } | null {
  if (!templateId.startsWith(QUENCH_OBJECTS.lanePrefix)) return null;
  const [state, t, l] = templateId.slice(QUENCH_OBJECTS.lanePrefix.length).split('_');
  if (state !== 'warn' && state !== 'fly') return null;
  const n = Number(t);
  const length = Number(l);
  if (!Number.isInteger(n) || n < 0 || !Number.isInteger(length) || length < 0) return null;
  return { state, seconds: n / 10, length };
}
