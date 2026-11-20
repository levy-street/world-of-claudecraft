// The Masterless Strength's OWN elemental mechanics (Jose's brief of
// 2026-11-19 (b), docs/design/raid/smith_heart.md section 7.5 "Its own
// elements"): the leaf every part of them keys on (the sim, the painter, the
// HUD's tooltips, the bots, the tests). No SimContext, no rng.
//
//   Elemental Strike    the tank swap (final_strike.ts): every 8 s the boss
//                       strikes its tank and leaves a stacking debuff of the
//                       element of the quarter it stands in (Searing Burn,
//                       Biting Frost, Static Charge, Cracked Armor); from 4
//                       stacks the tanks swap.
//   Elemental Fusion    on every quarter change (final_fusion.ts): a 3 s bar
//                       fusing the quarter it left with the one it entered,
//                       then the pair's combo (six unordered pairs: Scalding
//                       Steam, Magma Rift, Firestorm, Hailstorm, Avalanche,
//                       Storm Spires).
//   Opposing Elements   polarity pairs (final_opposites.ts): non-tanks marked
//                       Fire, Ice, Earth or Lightning; touch your opposite to
//                       cancel both, any other meeting explodes.
//
// What every client reads (no wire or IWorld change): the debuffs and marks
// as player auras (the stack count in `stacks`, the polarity's element in
// `value`), the fusion's pair on the boss's fusion aura (`value` the quarter
// it left, `value2` the one it entered, FINAL_ZONE_CODES), every footprint as
// an object (radius in `scale`, heading in `facing`, a state and its numbers
// in the template), the moments as `spellfx` cues.
//
// Names (IP check of 2026-11-19, exact phrase on the major game wikis and a
// general search): Elemental Strike (a generic phrase: a Divine Divinity and a
// Planescape: Torment mage spell, no boss mechanic), Elemental Fusion (a
// generic phrase: an Aion 2 player skill) and Opposing Elements are Jose's own
// plain-English names; Searing Burn, Biting Frost, Static Charge, Cracked
// Armor, Frozen Solid, Scalding Steam, Magma Rift, Lava Pool, Firestorm,
// Hailstorm, Avalanche, Storm Spire, Elemental Residue, Clashing Elements and
// Unbalanced Elements are plain English, no game's coined term. None is Kurog
// Grimtotem's (Primal Shift, Elemental Surge, Sundering Strike...).
//
// EVERY number is a SKETCH, measured only by the headless tests and the bot
// raid of 2026-11-19 (anchored like the rest of the fight: ten level-20
// players, a cloth pool of about 1,135 to 1,345).

import type { SmithHeartVein } from '../../content/smith_heart_layout';
import type { FinalDifficulty } from './final_ids';

// ---- ids ------------------------------------------------------------------------------

/** The fusion's bar (planted, like the fight's other bars). */
export const ELEMENT_CASTS = {
  fusion: 'heart_final_fusion',
} as const;

/** The stacking tank debuffs, one per element (the stack count rides
 *  `stacks`; a strike in another element re-forges the stacks into its own). */
export const STRIKE_AURAS: Readonly<Record<SmithHeartVein, string>> = {
  heat: 'heart_final_strike_heat',
  quench: 'heart_final_strike_quench',
  breath: 'heart_final_strike_breath',
  hammer: 'heart_final_strike_hammer',
};

export const ELEMENT_AURAS = {
  /** Biting Frost's fifth stack: frozen solid (a stun), when its Hardening
   *  Frost closes on whoever still stands in it. */
  frozen: 'heart_final_strike_frozen',
  /** Hardening Frost: the tank whose Biting Frost reached the freeze wears it
   *  through the ring's warning (their arrow: step out). */
  rime: 'heart_final_rime_mark',
  /** On the boss through the fusion's bar: `value` the quarter it left,
   *  `value2` the one it entered (FINAL_ZONE_CODES). */
  fusion: 'heart_final_fusion',
  /** Magma Rift: a fissure erupts under this player when it runs out (its
   *  arrow and ring for them). */
  magmaMark: 'heart_final_magma_mark',
  /** Opposing Elements: `value` the element (POLARITY_CODES). */
  polarity: 'heart_final_polarity',
} as const;

/** The four polarities (Fire and Ice opposite, Earth and Lightning). */
export type Polarity = 'fire' | 'ice' | 'earth' | 'lightning';
export const POLARITY_ORDER: readonly Polarity[] = ['fire', 'ice', 'earth', 'lightning'];
export const POLARITY_CODES: Readonly<Record<Polarity, number>> = {
  fire: 0,
  ice: 1,
  earth: 2,
  lightning: 3,
};
const OPPOSITE: Readonly<Record<Polarity, Polarity>> = {
  fire: 'ice',
  ice: 'fire',
  earth: 'lightning',
  lightning: 'earth',
};

/** The polarity a code names (an unknown code reads fire). */
export function polarityOf(code: number | undefined): Polarity {
  const i = Math.round(code ?? 0);
  return POLARITY_ORDER[i >= 0 && i < 4 ? i : 0];
}

/** Do `a` and `b` cancel (opposites)? */
export function polaritiesCancel(a: Polarity, b: Polarity): boolean {
  return OPPOSITE[a] === b;
}

/** The six combos (an unordered pair of quarters each). */
export type FusionCombo = 'steam' | 'magma' | 'firestorm' | 'hail' | 'avalanche' | 'spires';
export const FUSION_COMBOS: readonly FusionCombo[] = [
  'steam',
  'magma',
  'firestorm',
  'hail',
  'avalanche',
  'spires',
];

/** The combo two quarters fuse into (unordered), or null for the same one. */
export function fusionCombo(a: SmithHeartVein, b: SmithHeartVein): FusionCombo | null {
  if (a === b) return null;
  const has = (v: SmithHeartVein) => a === v || b === v;
  if (has('heat') && has('quench')) return 'steam';
  if (has('heat') && has('hammer')) return 'magma';
  if (has('heat') && has('breath')) return 'firestorm';
  if (has('quench') && has('breath')) return 'hail';
  if (has('quench') && has('hammer')) return 'avalanche';
  return 'spires';
}

/** The combo's element of its Mythic residue (the paint and the school). */
export const COMBO_RESIDUE: Readonly<Record<FusionCombo, 'fire' | 'frost' | 'storm' | 'stone'>> = {
  steam: 'fire',
  magma: 'fire',
  firestorm: 'fire',
  hail: 'frost',
  avalanche: 'frost',
  spires: 'storm',
};

/** The fight's new objects (radius in `scale`). */
export const ELEMENT_OBJECTS = {
  /** A steam cloud: `<prefix><warn|live>`, drifting. */
  steamPrefix: 'sh_final_steam_',
  /** A lava pool (Magma Rift): plain. */
  lava: 'sh_final_lava',
  /** A Firestorm lane: `<prefix><warn|burn>_<length tenths>_<half tenths>`,
   *  the object at its MIDDLE, the wall sweeping along `facing`. */
  firePrefix: 'sh_final_firestorm_',
  /** A hailstone's spot: `<prefix><tenths>` of warning. */
  hailPrefix: 'sh_final_hail_',
  /** An Avalanche lane: `<prefix><warn|run>_<length tenths>_<half tenths>`,
   *  the object at its MIDDLE, the spikes running along `facing` (rim to
   *  centre). */
  avalanchePrefix: 'sh_final_avalanche_',
  /** A Storm Spire: `<prefix><charge|fire>_<index>_<count>_<group>`; its
   *  links run index to index + 1 (and the last back to the first when four
   *  or more stand). */
  spirePrefix: 'sh_final_spire_',
  /** Mythic's lingering residue: `<prefix><fire|frost|storm|stone>`. */
  residuePrefix: 'sh_final_residue_',
  /** Hardening Frost's ring, planted at the tank's feet: `<prefix><tenths>`
   *  of warning (timed). */
  rimePrefix: 'sh_final_rime_',
  /** DEV ONLY (`/dev heart final opposites` with nobody to pair): a practice
   *  echo of the opposite element standing on the floor,
   *  `<prefix><POLARITY_CODES code>`. Never laid in play. */
  echoPrefix: 'sh_final_polarity_echo_',
} as const;

/** The spellfx moments. */
export const ELEMENT_CUES = {
  /** Elemental Strike lands on the tank (spellfx 'nova', its school). */
  strike: 'heart_final_elemental_strike',
  /** Static Charge arcs from the tank to an ally (spellfx 'beam'). */
  staticArc: 'heart_final_static_arc',
  /** Biting Frost freezes the tank solid (spellfx 'nova'). */
  frozen: 'heart_final_frozen_solid',
  /** Hardening Frost's ring closes (spellfxAt, its radius). */
  rime: 'heart_final_rime_close',
  /** The fusion's bar begins (spellfx 'nova' on the boss). */
  fusionStart: 'heart_final_fusion_start',
  /** The fusion lands: its combo begins (spellfx 'nova' on the boss). */
  fusion: 'heart_final_fusion',
  /** Scalding Steam scalds a player inside a cloud (spellfx 'nova', cloud
   *  to them). */
  steam: 'heart_final_steam',
  /** A Magma Rift erupts (spellfxAt, its radius). */
  magma: 'heart_final_magma',
  /** A Firestorm's wall sets off along its lane (spellfxAt at its start). */
  firestorm: 'heart_final_firestorm',
  /** The wall strikes a player (spellfx 'nova', lane to them). */
  firestormHit: 'heart_final_firestorm_hit',
  /** A hailstone lands (spellfxAt, its radius). */
  hail: 'heart_final_hail',
  /** An Avalanche lane's spikes run (spellfxAt at its start). */
  avalanche: 'heart_final_avalanche',
  /** A Storm Spire link discharges (spellfx 'beam', spire to spire). */
  spire: 'heart_final_spire_link',
  /** Two opposite marks meet and cancel (spellfxAt between them). */
  balance: 'heart_final_polarity_balance',
  /** A wrong meeting explodes (spellfxAt between them, its reach). */
  clash: 'heart_final_polarity_clash',
  /** A mark runs out uncancelled (spellfx 'nova' on its player). */
  unbalanced: 'heart_final_polarity_unbalanced',
} as const;

/** The damage, aura and object names (re-localized by src/ui/sim_i18n.ts). */
export const ELEMENT_NAMES = {
  strike: 'Elemental Strike',
  heat: 'Searing Burn',
  quench: 'Biting Frost',
  breath: 'Static Charge',
  hammer: 'Cracked Armor',
  frozen: 'Frozen Solid',
  rime: 'Hardening Frost',
  fusion: 'Elemental Fusion',
  steam: 'Scalding Steam',
  magma: 'Magma Rift',
  lava: 'Lava Pool',
  firestorm: 'Firestorm',
  hail: 'Hailstorm',
  avalanche: 'Avalanche',
  spire: 'Storm Spire',
  residue: 'Elemental Residue',
  polarity: 'Opposing Elements',
  clash: 'Clashing Elements',
  unbalanced: 'Unbalanced Elements',
} as const;

// ---- the per-difficulty rules ---------------------------------------------------------

export interface ElementRules {
  /** Elemental Strike's own hit at one stack (before the tier's damageMult)
   *  and how much each further stack adds of it. */
  strikeMin: number;
  strikeMax: number;
  strikeGrowth: number;
  /** Searing Burn: fire every second per stack. */
  burnPerStack: number;
  /** Biting Frost: the slow per stack (a share), and its cap. */
  frostSlowPerStack: number;
  /** Static Charge: an arc's damage to each ally near the tank (at the first
   *  arcing stack; each further stack adds `arcGrowth` of it). */
  arcMin: number;
  arcMax: number;
  /** Cracked Armor: the tank's armour lost per stack (a share of its own). */
  armorPerStack: number;
  // -- Elemental Fusion --
  steamClouds: number;
  steamMin: number;
  steamMax: number;
  magmaMarks: number;
  magmaMin: number;
  magmaMax: number;
  lavaMin: number;
  lavaMax: number;
  fireLanes: number;
  fireHalf: number;
  fireMin: number;
  fireMax: number;
  /** Hailstones a wave (half of them on players' spots). */
  hailPerWave: number;
  hailMin: number;
  hailMax: number;
  avalancheLanes: number;
  avalancheHalf: number;
  /** Mythic: a second run of spikes in the gaps the first left. */
  avalancheWaves: number;
  avalancheMin: number;
  avalancheMax: number;
  spires: number;
  /** Mythic: the spires discharge this many times in a row. */
  spireDischarges: number;
  spireMin: number;
  spireMax: number;
  /** Mythic: the combo leaves its residue on the floor. */
  residue: boolean;
  // -- Opposing Elements --
  polarityMarks: number;
  /** A wrong meeting: who it strikes ('pair' both, 'around' everyone within
   *  clashR) and how hard. */
  clashReach: 'pair' | 'around';
  clashMin: number;
  clashMax: number;
  /** A mark uncancelled at its end: on its player alone, or on the raid
   *  once per FAILED PAIR (the marks left, two to a pair, rounded up). */
  unbalancedOn: 'player' | 'raid';
  unbalancedMin: number;
  unbalancedMax: number;
}

export const ELEMENT_DIFFICULTY: Readonly<Record<FinalDifficulty, ElementRules>> = {
  normal: {
    strikeMin: 330,
    strikeMax: 370,
    strikeGrowth: 0.45,
    burnPerStack: 11,
    frostSlowPerStack: 0.08,
    arcMin: 150,
    arcMax: 170,
    armorPerStack: 0.1,
    steamClouds: 3,
    steamMin: 95,
    steamMax: 110,
    magmaMarks: 3,
    magmaMin: 260,
    magmaMax: 290,
    lavaMin: 80,
    lavaMax: 95,
    fireLanes: 1,
    fireHalf: 5,
    fireMin: 380,
    fireMax: 420,
    hailPerWave: 2,
    hailMin: 200,
    hailMax: 225,
    avalancheLanes: 5,
    avalancheHalf: 2.5,
    avalancheWaves: 1,
    avalancheMin: 340,
    avalancheMax: 380,
    spires: 3,
    spireDischarges: 1,
    spireMin: 320,
    spireMax: 355,
    residue: false,
    polarityMarks: 4,
    clashReach: 'pair',
    clashMin: 260,
    clashMax: 290,
    unbalancedOn: 'player',
    unbalancedMin: 520,
    unbalancedMax: 580,
  },
  heroic: {
    strikeMin: 330,
    strikeMax: 370,
    strikeGrowth: 0.6,
    burnPerStack: 15,
    frostSlowPerStack: 0.1,
    arcMin: 200,
    arcMax: 225,
    armorPerStack: 0.13,
    steamClouds: 4,
    steamMin: 150,
    steamMax: 170,
    magmaMarks: 4,
    magmaMin: 420,
    magmaMax: 470,
    lavaMin: 140,
    lavaMax: 160,
    fireLanes: 2,
    fireHalf: 5.5,
    fireMin: 520,
    fireMax: 580,
    hailPerWave: 3,
    hailMin: 300,
    hailMax: 340,
    avalancheLanes: 6,
    avalancheHalf: 2.7,
    avalancheWaves: 1,
    avalancheMin: 460,
    avalancheMax: 510,
    spires: 4,
    spireDischarges: 1,
    spireMin: 430,
    spireMax: 480,
    residue: false,
    // Every living non-tank (the manager's feedback of 2026-11-20), always
    // an even count: polarityCount drops an odd one out.
    polarityMarks: 40,
    clashReach: 'pair',
    clashMin: 480,
    clashMax: 530,
    unbalancedOn: 'raid',
    unbalancedMin: 300,
    unbalancedMax: 340,
  },
  mythic: {
    strikeMin: 330,
    strikeMax: 370,
    strikeGrowth: 0.7,
    burnPerStack: 19,
    frostSlowPerStack: 0.1,
    arcMin: 230,
    arcMax: 260,
    armorPerStack: 0.15,
    steamClouds: 5,
    steamMin: 160,
    steamMax: 180,
    magmaMarks: 5,
    magmaMin: 450,
    magmaMax: 500,
    lavaMin: 150,
    lavaMax: 170,
    fireLanes: 2,
    fireHalf: 6,
    fireMin: 760,
    fireMax: 840,
    hailPerWave: 4,
    hailMin: 320,
    hailMax: 360,
    avalancheLanes: 6,
    avalancheHalf: 2.7,
    avalancheWaves: 2,
    avalancheMin: 640,
    avalancheMax: 700,
    spires: 4,
    spireDischarges: 2,
    spireMin: 560,
    spireMax: 620,
    residue: true,
    polarityMarks: 40,
    clashReach: 'around',
    clashMin: 700,
    clashMax: 780,
    unbalancedOn: 'raid',
    // Per FAILED PAIR on the whole raid (the manager's feedback of
    // 2026-11-20): at Mythic's x1.3 about 884-923, so one failed pair leaves
    // a level-20 cloth pool (about 1,040-1,140) alive and hurting, and two
    // (about 1,770-1,850) kill even a plate tank (about 1,670-1,740).
    unbalancedMin: 680,
    unbalancedMax: 710,
  },
};

// ---- tuning (every tier) ----------------------------------------------------------------

export const ELEMENT_TUNING = {
  // -- Elemental Strike --
  /** Every this often (first this long into the pull) on its tank, every
   *  tier the same. */
  strikeEvery: 8,
  strikeFirst: 8,
  /** Its tank must stand this near (yards, past the body's reach). */
  strikeReach: 12,
  /** A stack lasts this long (each strike refreshes it). */
  stackSeconds: 30,
  stackCap: 9,
  /** The swap: from this many stacks the tank should hand the boss over. */
  swapAt: 4,
  /** Biting Frost: the slow's cap, and the stack that freezes. */
  frostSlowCap: 0.45,
  freezeAt: 5,
  freezeSeconds: 2,
  /** Hardening Frost (Jose's playtest of 2026-11-20: the freeze landed at
   *  once as the boss entered the Quench): from `freezeAt` a strike plants a
   *  ring of frost this wide at the tank's feet, closing this long later on
   *  whoever still stands in it. Never on the strike that re-forges older
   *  stacks into Biting Frost. */
  rimeR: 3.5,
  rimeWarn: 3,
  /** Static Charge: from this many stacks it arcs every `arcEvery` to every
   *  ally within `arcReach` of the tank. */
  arcFrom: 3,
  arcEvery: 2,
  arcReach: 6,
  arcGrowth: 0.3,
  /** Cracked Armor's floor: never under this share of its own. */
  armorFloor: 0.25,

  // -- Elemental Fusion --
  fusionCast: 3,
  /** Every combo's footprints stay inside the quarter it entered; the quarter
   *  kit holds its clocks through the bar. */
  steamWarn: 1.5,
  steamLife: 13,
  steamR: 4.5,
  steamSpeed: 1.6,
  steamTurnEvery: 3,
  steamTick: 1,
  magmaMarkSeconds: 3,
  magmaR: 3.5,
  lavaLife: 20,
  lavaTick: 1,
  fireWarn: 3,
  /** The wall's run along its lane (yards a second). */
  fireSpeed: 28,
  /** A lane rim to rim through its aim. */
  fireLength: 108,
  hailSeconds: 6,
  hailWaveEvery: 0.6,
  hailWarn: 1.2,
  hailR: 2.6,
  avalancheWarn: 2.5,
  /** The spikes' run from the rim to its end (seconds). */
  avalancheRun: 1.2,
  avalancheLength: 40,
  /** Lane spacing, centre to centre (the gaps between are safe). */
  avalancheSpacing: 9.5,
  /** Mythic's second wave, this long after the first runs. */
  avalancheWaveGap: 1.8,
  spireR: 1.4,
  spireCharge: 4,
  /** The links show on the floor from this long into the charge. */
  spireShowAt: 0.6,
  spireLinkHalf: 1.5,
  /** Mythic's second discharge, this long after the first. */
  spireGap: 1.6,
  spireMinGap: 9,
  spireMaxGap: 22,
  /** Mythic's residue: radius, life, the bite every second (before the
   *  tier's damageMult). */
  residueR: 3,
  residueLife: 15,
  residueMin: 70,
  residueMax: 80,
  residueCap: 14,

  // -- Opposing Elements --
  /** First this long into the pull (after the first swap), then every this
   *  often; held off while the fusion or the Anvil is near. */
  polarityFirst: 42,
  polarityEvery: 48,
  polaritySeconds: 10,
  /** No meeting counts this long after the marks land: players standing
   *  together when marked step apart first (the bot raid of 2026-11-19: a
   *  stacked melee clashed on the first tick). */
  polarityGrace: 1.5,
  /** Two marked players this near (yards) meet. */
  meetR: 3,
  /** A wrong meeting's reach on Mythic. */
  clashR: 8,
  /** Held off while the Anvil's bar is this near (a round's length and a
   *  breath) or a fusion runs. */
  polarityAnvilClear: 12,
} as const;

// ---- pure helpers -----------------------------------------------------------------------

/** Elemental Strike's hit at `stacks` (after the strike), before the roll's
 *  spread is applied by the caller: `min..max` scaled by the growth. */
export function strikeScale(stacks: number, growth: number): number {
  return 1 + growth * Math.max(0, stacks - 1);
}

/** Biting Frost's slow at `stacks`. */
export function frostSlow(stacks: number, perStack: number): number {
  return Math.min(ELEMENT_TUNING.frostSlowCap, perStack * Math.max(0, stacks));
}

/** Static Charge's arc factor at `stacks` (0 below its first arcing stack). */
export function arcScale(stacks: number): number {
  const T = ELEMENT_TUNING;
  if (stacks < T.arcFrom) return 0;
  return 1 + T.arcGrowth * (stacks - T.arcFrom);
}

/** Cracked Armor's share of armour kept at `stacks`. */
export function armorKept(stacks: number, perStack: number): number {
  return Math.max(ELEMENT_TUNING.armorFloor, 1 - perStack * Math.max(0, stacks));
}

/** The marked count for `free` living non-tanks and the tier's cap: always
 *  even, never more than the free players can pair. */
export function polarityCount(free: number, cap: number): number {
  const n = Math.min(Math.max(0, free), Math.max(0, cap));
  return n - (n % 2);
}

/** The element of the `k`-th mark: the pairs alternate Fire/Ice then
 *  Earth/Lightning, so marks 2j and 2j+1 are always opposites. */
export function polarityFor(k: number): Polarity {
  const pair = Math.floor(k / 2) % 2;
  const half = k % 2;
  return POLARITY_ORDER[pair * 2 + half];
}

const tenths = (v: number): number => Math.max(0, Math.round(v * 10));

/** A steam cloud's template. */
export function steamTemplate(state: 'warn' | 'live'): string {
  return `${ELEMENT_OBJECTS.steamPrefix}${state}`;
}
export function steamOf(templateId: string): 'warn' | 'live' | null {
  if (!templateId.startsWith(ELEMENT_OBJECTS.steamPrefix)) return null;
  const s = templateId.slice(ELEMENT_OBJECTS.steamPrefix.length);
  return s === 'warn' || s === 'live' ? s : null;
}

/** A lane's template (Firestorm, Avalanche): `<prefix><state>_<len>_<half>`. */
export function elementLaneTemplate(
  prefix: string,
  state: string,
  length: number,
  half: number,
): string {
  return `${prefix}${state}_${tenths(length)}_${tenths(half)}`;
}

/** A lane's state, length and half width, or null. */
export function elementLaneOf(
  prefix: string,
  templateId: string,
): { state: string; length: number; half: number } | null {
  if (!templateId.startsWith(prefix)) return null;
  const [state, l, h] = templateId.slice(prefix.length).split('_');
  const L = Number(l);
  const H = Number(h);
  if (!state || !Number.isInteger(L) || !Number.isInteger(H) || L < 0 || H < 0) return null;
  return { state, length: L / 10, half: H / 10 };
}

/** A Storm Spire's template. */
export function spireTemplate(
  state: 'charge' | 'fire',
  index: number,
  count: number,
  group: number,
): string {
  return `${ELEMENT_OBJECTS.spirePrefix}${state}_${index}_${count}_${group}`;
}
export function spireOf(
  templateId: string,
): { state: 'charge' | 'fire'; index: number; count: number; group: number } | null {
  if (!templateId.startsWith(ELEMENT_OBJECTS.spirePrefix)) return null;
  const [state, i, n, g] = templateId.slice(ELEMENT_OBJECTS.spirePrefix.length).split('_');
  const index = Number(i);
  const count = Number(n);
  const group = Number(g);
  if (state !== 'charge' && state !== 'fire') return null;
  if (![index, count, group].every((v) => Number.isInteger(v) && v >= 0)) return null;
  return { state, index, count, group };
}

/** The links of a group of `count` spires (index pairs): a chain, closed
 *  into a loop from four. */
export function spireLinks(count: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < count; i++) out.push([i, i + 1]);
  if (count >= 3) out.push([count - 1, 0]);
  return out;
}

/** A residue's template and its element. */
export function residueTemplate(el: 'fire' | 'frost' | 'storm' | 'stone'): string {
  return `${ELEMENT_OBJECTS.residuePrefix}${el}`;
}
export function residueOf(templateId: string): 'fire' | 'frost' | 'storm' | 'stone' | null {
  if (!templateId.startsWith(ELEMENT_OBJECTS.residuePrefix)) return null;
  const s = templateId.slice(ELEMENT_OBJECTS.residuePrefix.length);
  return s === 'fire' || s === 'frost' || s === 'storm' || s === 'stone' ? s : null;
}

/** Hardening Frost's ring (timed). */
export function rimeTemplate(seconds: number): string {
  return `${ELEMENT_OBJECTS.rimePrefix}${tenths(seconds)}`;
}
export function rimeOf(templateId: string): number | null {
  if (!templateId.startsWith(ELEMENT_OBJECTS.rimePrefix)) return null;
  const t = Number(templateId.slice(ELEMENT_OBJECTS.rimePrefix.length));
  return Number.isInteger(t) && t >= 0 ? t / 10 : null;
}

/** A dev practice echo (its polarity), or null. */
export function echoTemplate(p: Polarity): string {
  return `${ELEMENT_OBJECTS.echoPrefix}${POLARITY_CODES[p]}`;
}
export function echoOf(templateId: string): Polarity | null {
  if (!templateId.startsWith(ELEMENT_OBJECTS.echoPrefix)) return null;
  const c = Number(templateId.slice(ELEMENT_OBJECTS.echoPrefix.length));
  return Number.isInteger(c) && c >= 0 && c < 4 ? POLARITY_ORDER[c] : null;
}

/** A hailstone's spot (timed). */
export function hailTemplate(seconds: number): string {
  return `${ELEMENT_OBJECTS.hailPrefix}${tenths(seconds)}`;
}
export function hailOf(templateId: string): number | null {
  if (!templateId.startsWith(ELEMENT_OBJECTS.hailPrefix)) return null;
  const t = Number(templateId.slice(ELEMENT_OBJECTS.hailPrefix.length));
  return Number.isInteger(t) && t >= 0 ? t / 10 : null;
}

/** Distance from (px, pz) to the segment a to b. */
export function segmentDistance(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 1e-9 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2)) : 0;
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}
