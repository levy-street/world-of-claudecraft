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
//     their place and facing on the entity), the echoes' footprints (objects
//     at each blade, the attack's facing on the entity, the reach in
//     `scale`), heroic's crossing lane (an object at its middle, along it);
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
  /** After the shatter: more damage taken for a while. */
  brittle: 'heart_quench_brittle',
  /** Fallen through the ice: held in the water (a root), then climbing out. */
  trapped: 'heart_quench_trapped',
  /** On the guardian through phase 2: the four blades are awake. */
  awake: 'heart_quench_blades_awake',
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
  /** An echo's footprint at a blade: `<prefix><b|s>_<tenths|hit>`
   *  (echoTemplate); the attack's facing on the entity. */
  echoPrefix: 'sh_quench_echo_',
  /** Heroic: the crossing lane between two blades (laneTemplate). */
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
  /** An echo lands (spellfxAt 'burst' at its blade, radius = its reach). */
  echo: 'heart_quench_echo',
  /** Heroic: two blades fly across the lake (spellfxAt at the lane's middle). */
  cross: 'heart_quench_cross',
  /** The shore ice heaves up round the lake (spellfx 'nova' on the guardian). */
  rim: 'heart_quench_rim',
  /** The fight is over: the shore ice falls and the lake refreezes whole
   *  (spellfx 'nova' on the guardian). */
  thaw: 'heart_quench_thaw',
} as const;

/** The damage and aura names (combat log, floating text, the buff bar;
 *  re-localized by src/ui/sim_i18n.ts through the mechanic reverse map). */
export const QUENCH_NAMES = {
  cold: 'Quenching Cold',
  warmth: 'Huddled Warmth',
  frozen: 'Encased in Rime',
  shatter: 'Shattering Cold',
  brittle: 'Frost-Brittle',
  water: 'Freezing Water',
  trapped: 'Under the Ice',
  breath: 'Quenching Breath',
  wake: 'The Blades Wake',
  awake: 'The Blades Awake',
  echoBreath: 'Echo of the Breath',
  echoStrike: 'Echo of the Strike',
  cross: 'Crossing Blade',
  deepening: 'Deepening Cold',
  crack: 'Groaning Ice',
  hole: 'Open Water',
  blade: "Smith's Blade",
  rim: 'Shore Ice',
} as const;

// ---- difficulty -----------------------------------------------------------------------

/** The fight's difficulty. Each tier is one QUENCH_DIFFICULTY row; mythic is
 *  a dev-switched prototype (quench.ts setQuenchDevTier) and, for now, the
 *  heroic row whole: a later mythic-only mechanic is one more field here and
 *  its own module, never a branch on a tier's name. */
export type QuenchDifficulty = 'normal' | 'heroic' | 'mythic';

/** How the echoes take the guardian's facing: `copy` (every blade the same
 *  way: today's rule on every tier). The mythic candidate, true mirrors (two
 *  blades copy and two reverse, by colour), is one more value here. */
export type QuenchEchoRule = 'copy';

export interface QuenchDifficultyRules {
  /** Every mechanic's damage, on top of the claim's own multiplier. */
  damageMult: number;
  /** A shatter's splash: how far, and how much cold it adds. */
  splashR: number;
  splashCold: number;
  /** The blades cross the lake in pairs (phase 2). */
  dance: boolean;
  echoRule: QuenchEchoRule;
}

export const QUENCH_DIFFICULTY: Readonly<Record<QuenchDifficulty, QuenchDifficultyRules>> = {
  normal: { damageMult: 1, splashR: 6, splashCold: 25, dance: false, echoRule: 'copy' },
  // Contagious cold: a shatter splashes further and harder.
  heroic: { damageMult: 1.25, splashR: 10, splashCold: 45, dance: true, echoRule: 'copy' },
  // Exactly heroic for now: the seam for one later mythic-only mechanic.
  mythic: { damageMult: 1.25, splashR: 10, splashCold: 45, dance: true, echoRule: 'copy' },
};

// ---- tuning (SKETCH, unmeasured) ------------------------------------------------------

export const QUENCH_TUNING = {
  // Frostbite: the cold bar.
  coldMax: 100,
  /** Alone, the bar fills in about 30 s. */
  coldRise: 100 / 30,
  /** In a huddle (2 or more others within warmR), it falls this fast. */
  coldFall: 6,
  warmR: 6,
  warmNeed: 2,
  /** At full: frozen this long, then the shatter. */
  freezeSeconds: 4,
  shatterMin: 220,
  shatterMax: 260,
  brittleSeconds: 15,
  brittlePct: 0.2,
  /** Cold a hit adds: the guardian's breath and its echo, an echoed strike,
   *  the crossing blade, a fall through the ice. */
  breathCold: 20,
  echoStrikeCold: 10,
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
  // Phase 2: the echoes.
  /** Each echo lands this long after the guardian's own attack; below
   *  lowAt health, sooner. */
  echoDelay: 3,
  echoDelayLow: 2,
  lowAt: 0.25,
  echoBreathMin: 260,
  echoBreathMax: 300,
  echoStrikeMin: 200,
  echoStrikeMax: 240,
  /** Tempering Strike: the template's swing cleave (every 4th landed swing,
   *  its arc and reach; content/smith_heart.ts reads these), and its echo. */
  strikeEvery: 4,
  strikeArcDeg: 100,
  strikeRange: 8,
  /** Behind a blade (away from the attack), within this, is always safe. */
  leeR: 5,
  /** An echo's footprint stays this long after it lands (its blast). */
  echoShow: 0.6,
  // Phase 2: the deepening cold (the soft enrage).
  deepenEvery: 20,
  deepenStep: 0.1,
  // Heroic phase 2: the blades cross.
  danceFirst: 20,
  danceEvery: 40,
  danceWarn: 3,
  danceFly: 1.2,
  laneHalf: 2.5,
  crossMin: 300,
  crossMax: 350,
  laneCrack: 2,
  laneHoleR: 2.5,
  laneHoleEvery: 7,
  // The shore ice.
  rimRise: 2.5,
  /** Seconds of plain melee after a bar lands before the next begins. */
  barGap: 1.2,
} as const;

// ---- pure helpers ---------------------------------------------------------------------

/** Seconds between the guardian's attack and its echoes at `hpFrac`. */
export function echoDelay(hpFrac: number): number {
  return hpFrac <= QUENCH_TUNING.lowAt ? QUENCH_TUNING.echoDelayLow : QUENCH_TUNING.echoDelay;
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
 *  upright, flying (heroic's crossing). */
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

/** Which attack an echo repeats: Quenching Breath's cone or Tempering
 *  Strike's arc. */
export type QuenchEchoKind = 'breath' | 'strike';

/** An echo's template: its kind and the seconds to its landing, or its blast
 *  once landed (`hit`). */
export function echoTemplate(kind: QuenchEchoKind, seconds: number | 'hit'): string {
  const k = kind === 'breath' ? 'b' : 's';
  return `${QUENCH_OBJECTS.echoPrefix}${k}_${seconds === 'hit' ? 'hit' : tenthsOf(seconds)}`;
}

/** An echo template's kind and seconds to land (null once it has hit). */
export function echoOf(
  templateId: string,
): { kind: QuenchEchoKind; seconds: number | null; hit: boolean } | null {
  if (!templateId.startsWith(QUENCH_OBJECTS.echoPrefix)) return null;
  const [k, t] = templateId.slice(QUENCH_OBJECTS.echoPrefix.length).split('_');
  const kind = k === 'b' ? 'breath' : k === 's' ? 'strike' : null;
  if (!kind) return null;
  if (t === 'hit') return { kind, seconds: null, hit: true };
  const n = Number(t);
  return Number.isInteger(n) && n >= 0 ? { kind, seconds: n / 10, hit: false } : null;
}

/** Heroic's crossing lane: its warning, the flight, its crack. */
export type QuenchLaneState = 'warn' | 'fly' | 'crack';

export function laneTemplate(state: QuenchLaneState, seconds: number): string {
  return `${QUENCH_OBJECTS.lanePrefix}${state}_${tenthsOf(seconds)}`;
}

export function laneOf(templateId: string): { state: QuenchLaneState; seconds: number } | null {
  if (!templateId.startsWith(QUENCH_OBJECTS.lanePrefix)) return null;
  const [state, t] = templateId.slice(QUENCH_OBJECTS.lanePrefix.length).split('_');
  if (state !== 'warn' && state !== 'fly' && state !== 'crack') return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= 0 ? { state, seconds: n / 10 } : null;
}
