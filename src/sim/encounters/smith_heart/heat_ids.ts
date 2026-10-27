// The Guardian of the Heat's leaf (docs/design/raid/smith_heart.md section
// 7.4): every id the fight's sim, its renderer, its HUD, its dev helpers and
// its tests key on, the per-difficulty rules, the tuning, and the pure
// template-id helpers of its encounter objects. No SimContext, no rng.
//
// The fight is a PROPOSAL built as a playable prototype (the designer has not
// approved it yet), and EVERY number here is a SKETCH, unmeasured (the design
// doc's 7.4 table says so too): anchored to the other guardians' (level 20
// elite, ten players, a measured bot raid of about 400 to 460 damage a
// second) and the level-20 cloth reference (about 1,135 to 1,345 health), to
// be calibrated with the meters harness before the raid ships. Every tunable
// lives in HEAT_TUNING and HEAT_DIFFICULTY, so a change is one number.
//
// What every client reads (no wire or IWorld change; all of it rides existing
// entity fields):
//   - the heat: the guardian's resource (0 to 100, the target frame's bar)
//     and a quiet marker on every player in the Hearth (`value` the heat,
//     `value2` its trend: 1 rising, -1 falling), which the HUD's heat gauge
//     reads; the stoking (its stacks) and the overheating (from 90) are
//     auras on the guardian;
//   - each player's Crystal Burn: a spell-vulnerability debuff, its stacks;
//   - the crystals: their rise spots and the crystals themselves (objects,
//     their life in the template), every beam a `spellfx` beam from the
//     crystal to the player it struck (or back into the guardian);
//   - the channel: one object at its middle, its state and that state's
//     length in the template, its half width in `scale`;
//   - heroic's Knell Embers: objects, their radius in `scale`;
//   - the moments as `spellfx` cues (HEAT_CUES).

/** The guardian (template id, frozen: its death lights the Heat vein). */
export const HEAT_GUARDIAN = 'heart_heat_guardian';

// ---- casts, auras, objects, cues --------------------------------------------------

/** The guardian's bars. Molten Pour stays the trash kit's own line on its own
 *  clock; Searing Knell stays the trash kit's screech (the fight watches it
 *  land for heroic's embers). */
export const HEAT_CASTS = {
  /** Shed Heat: it pours its heat into the crystals rising from the floor. */
  shed: 'heart_heat_shed',
  /** The trash kit's casts (content/smith_heart.ts SMITH_HEART_CASTS). */
  pour: 'heart_molten_pour',
  knell: 'heart_anvil_clang',
} as const;

/** The auras the fight puts on players and on the guardian. */
export const HEAT_AURAS = {
  /** On every player in the Hearth: the heat (`value` 0 to 100, `value2`
   *  the trend), a quiet marker the HUD's gauge reads. */
  heat: 'heart_heat_hearth',
  /** Crystal Burn: more spell damage taken per stack (a `spellvuln`). */
  burn: 'heart_heat_burn',
  /** On the guardian: one stack per stoking of the Hearth (the soft enrage). */
  stoked: 'heart_heat_stoked',
  /** On the guardian from 90 heat: the overheat is coming. */
  overheating: 'heart_heat_overheating',
} as const;

/** The fight's object templates (a radius or a half width rides `scale`). */
export const HEAT_OBJECTS = {
  /** A crystal's rise spot while Shed Heat's bar runs: `<prefix><tenths>`
   *  of warning. */
  risePrefix: 'sh_heat_rise_',
  /** A Kindled Crystal: `<prefix><tenths>` of its life. */
  crystalPrefix: 'sh_heat_crystal_',
  /** The channel across the Hearth: `<prefix><state>_<tenths>`. */
  channelPrefix: 'sh_heat_channel_',
  /** Heroic: Knell Embers where a stunned player stood: `<prefix><tenths>`
   *  of their life. */
  embersPrefix: 'sh_heat_embers_',
} as const;

/** The spellfx ability ids of the fight's moments. */
export const HEAT_CUES = {
  /** A crystal's ray strikes a player (spellfx 'beam', crystal to player). */
  beam: 'heart_heat_beam',
  /** Nobody near: the ray goes back into the guardian (spellfx 'beam',
   *  crystal to guardian). */
  beamBack: 'heart_heat_beam_back',
  /** The Hearth Pulse rolls out over the raid (spellfx 'nova' on the
   *  guardian). */
  pulse: 'heart_heat_pulse',
  /** The overheat's blast (spellfx 'nova' on the guardian). */
  overheat: 'heart_heat_overheat',
  /** The guardian crosses 90 heat: the wind-up begins (spellfx 'nova'). */
  windup: 'heart_heat_windup',
  /** A crystal tears up out of the basalt (spellfxAt 'burst' at it). */
  rise: 'heart_heat_rise',
  /** A crystal burns out (spellfxAt 'burst' at it). */
  fade: 'heart_heat_fade',
  /** The channel's fire starts to flow (spellfxAt 'burst' at its head). */
  flow: 'heart_heat_flow',
  /** Heroic: embers left where a stunned player stood (spellfxAt). */
  embers: 'heart_heat_embers',
  /** The Hearth is stoked hotter (spellfx 'nova' on the guardian). */
  stoke: 'heart_heat_stoke',
  /** The fight is over: the Hearth settles (spellfx 'nova' on the guardian). */
  settle: 'heart_heat_settle',
} as const;

/** The damage and aura names (combat log, floating text, the buff bar;
 *  re-localized by src/ui/sim_i18n.ts through the mechanic reverse map).
 *  Every one was IP-checked (design doc 7.4). */
export const HEAT_NAMES = {
  heat: "The Hearth's Heat",
  pulse: 'Hearth Pulse',
  overheat: 'Hearthburst',
  overheating: 'Overheating',
  shed: 'Shed Heat',
  crystal: 'Kindled Crystal',
  ray: 'Kindled Ray',
  burn: 'Crystal Burn',
  channel: 'Flowing Fire',
  embers: 'Knell Embers',
  stoked: 'Stoked Hearth',
} as const;

// ---- difficulty -----------------------------------------------------------------------

/** The fight's difficulty. Each tier is one HEAT_DIFFICULTY row; mythic is a
 *  dev-switched prototype (heat.ts setHeatDevTier) and, for now, the heroic
 *  row whole: a later mythic-only mechanic is one more field here and its
 *  own module, never a branch on a tier's name. */
export type HeatDifficulty = 'normal' | 'heroic' | 'mythic';

export interface HeatDifficultyRules {
  /** Every mechanic's damage, on top of the claim's own multiplier. */
  damageMult: number;
  /** Kindled Crystals a Shed Heat raises. */
  crystals: number;
  /** Seconds for one stack of Crystal Burn to fade. */
  burnDecay: number;
  /** Searing Knell leaves Knell Embers where each stunned player stood. */
  knellEmbers: boolean;
  /** Hearthburst's damage (a near wipe on normal, a wipe on heroic). */
  overheatMin: number;
  overheatMax: number;
}

export const HEAT_DIFFICULTY: Readonly<Record<HeatDifficulty, HeatDifficultyRules>> = {
  normal: {
    damageMult: 1,
    crystals: 2,
    burnDecay: 6,
    knellEmbers: false,
    overheatMin: 900,
    overheatMax: 1000,
  },
  heroic: {
    damageMult: 1.25,
    crystals: 3,
    burnDecay: 10,
    knellEmbers: true,
    overheatMin: 2400,
    overheatMax: 2600,
  },
  // Exactly heroic for now: the seam for one later mythic-only mechanic.
  mythic: {
    damageMult: 1.25,
    crystals: 3,
    burnDecay: 10,
    knellEmbers: true,
    overheatMin: 2400,
    overheatMax: 2600,
  },
};

// ---- tuning (SKETCH, unmeasured) ------------------------------------------------------

export const HEAT_TUNING = {
  // The heat.
  heatMax: 100,
  heatStart: 0,
  /** Points a second, before the stoking. */
  heatRise: 1,
  /** The Hearth Pulse: every `pulseEvery` s, fire on everyone in the Hearth,
   *  `pulseBase + pulsePerHeat * heat` (a tenth either way). */
  pulseEvery: 3,
  pulseBase: 12,
  pulsePerHeat: 1.3,
  pulseSpread: 0.1,
  /** From here the overheat winds up (the gauge flashes, the body whitens,
   *  a raid warning). */
  windupAt: 90,
  /** After Hearthburst the Hearth has vented to this. */
  ventTo: 0,
  // The stoking (the soft enrage): the heat rises this much faster every
  // stokeEvery seconds, without end.
  stokeEvery: 40,
  stokeStep: 0.2,
  // Shed Heat and the Kindled Crystals.
  shedFirst: 14,
  shedEvery: 30,
  shedCast: 2.5,
  crystalLife: 20,
  /** Its first ray this long after it rises, then every rayEvery. */
  rayFirst: 1.5,
  rayEvery: 2,
  /** A ray strikes the nearest living player within this; nobody that near,
   *  it goes back into the guardian. */
  rayRange: 10,
  /** Heat a struck ray takes off the guardian, and one sent back adds. */
  rayCool: 3,
  rayBack: 3,
  rayMin: 50,
  rayMax: 65,
  /** A crystal stands this wide (its body; nothing collides). */
  crystalR: 1.6,
  // Crystal Burn.
  burnPct: 0.06,
  burnMax: 20,
  // The channel.
  channelFirst: 20,
  channelEvery: 26,
  channelWarn: 4,
  channelFlow: 6,
  channelHalf: 3,
  channelTick: 0.5,
  channelMin: 90,
  channelMax: 110,
  // Heroic: Knell Embers.
  embersR: 2.5,
  embersLife: 25,
  embersTick: 1,
  embersMin: 70,
  embersMax: 85,
  /** At most this many embers stand; past it the oldest goes. */
  embersCap: 30,
  // Searing Knell: the trash kit's stun (its record holds the numbers; the
  // fight only reads its length to know a fresh one).
  knellStun: 2,
  /** Seconds of plain melee after a bar lands before the next begins. */
  barGap: 1.2,
} as const;

// ---- pure helpers ---------------------------------------------------------------------

/** The heat's rise multiplier with `stacks` of the stoking. */
export function stokeMult(stacks: number): number {
  return 1 + HEAT_TUNING.stokeStep * Math.max(0, stacks);
}

/** The Hearth Pulse's middle damage at `heat` (before the roll's spread and
 *  the difficulty's multiplier). */
export function pulseDamage(heat: number): number {
  const T = HEAT_TUNING;
  return T.pulseBase + T.pulsePerHeat * Math.max(0, Math.min(T.heatMax, heat));
}

/** Crystal Burn's spell damage taken at `stacks` (a fraction). */
export function burnAmp(stacks: number): number {
  return HEAT_TUNING.burnPct * Math.max(0, Math.min(HEAT_TUNING.burnMax, stacks));
}

/** A small integer hash (no rng in a pick). */
export function heatHash(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x2545f491) ^ Math.imul(b | 0, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

// ---- object templates (pure) ----------------------------------------------------------

const tenthsOf = (seconds: number): number => Math.max(0, Math.round(seconds * 10));

function timedOf(prefix: string, templateId: string): number | null {
  if (!templateId.startsWith(prefix)) return null;
  const t = Number(templateId.slice(prefix.length));
  return Number.isInteger(t) && t >= 0 ? t / 10 : null;
}

/** A rise spot's template: its warning's length. */
export function riseTemplate(seconds: number): string {
  return `${HEAT_OBJECTS.risePrefix}${tenthsOf(seconds)}`;
}
export function riseOf(templateId: string): number | null {
  return timedOf(HEAT_OBJECTS.risePrefix, templateId);
}

/** A crystal's template: its life. */
export function crystalTemplate(seconds: number): string {
  return `${HEAT_OBJECTS.crystalPrefix}${tenthsOf(seconds)}`;
}
export function crystalOf(templateId: string): number | null {
  return timedOf(HEAT_OBJECTS.crystalPrefix, templateId);
}

/** Knell Embers' template: their life. */
export function embersTemplate(seconds: number): string {
  return `${HEAT_OBJECTS.embersPrefix}${tenthsOf(seconds)}`;
}
export function embersOf(templateId: string): number | null {
  return timedOf(HEAT_OBJECTS.embersPrefix, templateId);
}

/** The channel's states: still (a dull seam), brimming (the warning), flowing
 *  (it burns, the floor split in two). */
export type HeatChannelState = 'still' | 'warn' | 'flow';

export function channelTemplate(state: HeatChannelState, seconds: number): string {
  return `${HEAT_OBJECTS.channelPrefix}${state}_${tenthsOf(seconds)}`;
}

export function channelOf(templateId: string): { state: HeatChannelState; seconds: number } | null {
  if (!templateId.startsWith(HEAT_OBJECTS.channelPrefix)) return null;
  const [state, t] = templateId.slice(HEAT_OBJECTS.channelPrefix.length).split('_');
  if (state !== 'still' && state !== 'warn' && state !== 'flow') return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= 0 ? { state, seconds: n / 10 } : null;
}
