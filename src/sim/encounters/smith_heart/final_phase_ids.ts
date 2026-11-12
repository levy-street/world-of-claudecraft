// The Masterless Strength's part 2 leaf (docs/design/raid/smith_heart.md
// section 7.5, the owner's approved design of 28 Oct 2026): the
// intermissions at 70 and 40 percent with their Splinters, the elements a
// surviving Splinter pours into the boss, and the final phase at 15 percent
// with its soft enrage. Every id the sim, the renderer, the HUD, the dev
// helpers and the tests key on, the per-difficulty rules, the ONE tuning
// table (FINAL_PHASES), and the pure helpers. No SimContext, no rng.
//
// What every client reads (no wire or IWorld change; all of it rides
// existing entity fields):
//   - the phase: an aura on the boss (`value` the stage code, `value2` the
//     awake quarters' mask, `value3` the call's or the enrage's seconds left,
//     `stacks` the living Splinters);
//   - Gathered Strength (the boss's shield) and each poured element: auras on
//     the boss (a poured element's `stacks` how many times it was poured);
//     Masterless Fury: an aura on the boss, its stacks the ramp;
//   - the Splinters: real mobs (threat, nameplates, the target frame), their
//     bars real cast bars (Rime Toll kickable);
//   - the Quenching Rings: objects (`<prefix><gaps>_<seed>`, the gaps hashed
//     from the seed by `quenchRingGaps`); the Cinder Trail: the kit's burning pools;
//   - the marks: auras on players; the moments: `spellfx` cues.
//
// Names: IP-checked on 28 Oct 2026 (design doc 7.5): Splinter of the Heat,
// Quench, Breath and Hammer, Splintered Strength, Shearing Blow, Bursting
// Coal, Rime Toll, Quenching Ring, Mounting Weight, Gale Pounce,
// Wind-Tethered, Buffeting Gale, Gathered Strength, Call of the Quarters,
// Poured Heat, Quench, Breath and Hammer, Masterless Fury: no game use found.
// Cinder Trail and Storm Orb are the raid's own, already checked.

import { HEART_ROOM, type SmithHeartVein } from '../../content/smith_heart_layout';
import {
  HEART_QUARTER_ORDER,
  HEART_QUARTERS,
  heartQuarterAt,
} from '../../content/smith_heart_quarters';
import type { Aura } from '../../types';
import type { FinalDifficulty } from './final_ids';

// ---- the Splinters ---------------------------------------------------------------------

/** The Splinters' mob templates (one per quarter). */
export const FINAL_ADD_MOBS: Readonly<Record<SmithHeartVein, string>> = {
  heat: 'heart_final_splinter_heat',
  quench: 'heart_final_splinter_quench',
  breath: 'heart_final_splinter_breath',
  hammer: 'heart_final_splinter_hammer',
};

/** The vein a Splinter template carries, or null. */
export function finalAddVein(templateId: string): SmithHeartVein | null {
  for (const v of HEART_QUARTER_ORDER) if (FINAL_ADD_MOBS[v] === templateId) return v;
  return null;
}

// ---- casts, auras, objects, cues ---------------------------------------------------------

export const FINAL_PHASE_CASTS = {
  /** Call of the Quarters: the boss's channel through an intermission. */
  call: 'heart_final_call',
  /** Shearing Blow: every Splinter's frontal at its target. */
  shear: 'heart_final_shearing_blow',
  /** Rime Toll: the Quench Splinter's kickable bar. */
  toll: 'heart_final_rime_toll',
  /** Gale Pounce: the Breath Splinter's leap bar, on its victim. */
  pounce: 'heart_final_gale_pounce',
} as const;

/** The final's kickable bars and the school a kick locks (registered in
 *  mob/healer_channel.ts SCRIPTED_INTERRUPTIBLE_CHANNELS). */
export const FINAL_KICK_SCHOOLS: Record<string, { school: Aura['school'] }> = {
  [FINAL_PHASE_CASTS.toll]: { school: 'frost' },
};

export const FINAL_PHASE_AURAS = {
  /** On the boss: the stage (`value`), the awake mask (`value2`), the
   *  seconds left (`value3`), the living Splinters (`stacks`). */
  phase: 'heart_final_phase',
  /** On the boss: Gathered Strength (nothing harms it). */
  shield: 'heart_final_shield',
  /** On the boss: Masterless Fury (stacks: the enrage's ramp). */
  fury: 'heart_final_fury',
  /** On a rising Splinter: still climbing out (nothing harms it). */
  rising: 'heart_final_rising',
  /** On players: Bursting Coal (the Heat Splinter's bomb). */
  coal: 'heart_final_coal',
  /** On players: Wind-Tethered (the Breath Splinter's quarry). */
  tether: 'heart_final_tethered',
  /** On players: chilled by a Quenching Ring (a slow). */
  chill: 'heart_final_ring_chill',
  /** On the boss through the collapse (Mythic): the Unmade Anvil. `value`
   *  the fallen quarters' mask, `value2` what falls next (hiddenNextCode),
   *  `value3` the seconds until it does. */
  hidden: 'heart_final_hidden',
  /** On a player going down with the floor (an unbreakable stun: final_plunge.ts). */
  plunge: 'heart_final_plunge',
} as const;

/** One poured element's aura id on the boss. */
export function pouredAuraId(vein: SmithHeartVein): string {
  return `heart_final_poured_${vein}`;
}

/** Mounting Weight: the Hammer Splinter's stacking hit, the mob swing
 *  kernel's own stacking-poison aura id (mob/mob_swing.ts). */
export const MOUNTING_WEIGHT_AURA = `stackpoison_${FINAL_ADD_MOBS.hammer}`;

export const FINAL_PHASE_OBJECTS = {
  /** A Quenching Ring: `<prefix><gaps>_<seed>`, its centre the object's
   *  spot, its reach in `scale`. */
  ringPrefix: 'sh_final_qring_',
} as const;

/** A Quenching Ring's template from its gap count and seed. */
export function quenchRingTemplate(gaps: number, seed: number): string {
  return `${FINAL_PHASE_OBJECTS.ringPrefix}${Math.max(1, Math.round(gaps))}_${Math.max(0, Math.floor(seed)) % 100000}`;
}

/** A Quenching Ring's gap count and seed, or null when the template is not
 *  one. */
export function quenchRingOf(templateId: string): { gaps: number; seed: number } | null {
  if (!templateId.startsWith(FINAL_PHASE_OBJECTS.ringPrefix)) return null;
  const [g, n] = templateId.slice(FINAL_PHASE_OBJECTS.ringPrefix.length).split('_');
  const gaps = Number(g);
  const seed = Number(n);
  if (!Number.isInteger(gaps) || gaps < 1 || !Number.isInteger(seed) || seed < 0) return null;
  return { gaps, seed };
}

/** Each vein's school on a cue (the element a sound or a light reads). */
export const FINAL_VEIN_SCHOOL: Readonly<
  Record<SmithHeartVein, 'fire' | 'frost' | 'nature' | 'physical'>
> = {
  heat: 'fire',
  quench: 'frost',
  breath: 'nature',
  hammer: 'physical',
};

export const FINAL_PHASE_CUES = {
  /** The boss strides into the centre (spellfxAt at the centre). */
  leap: 'heart_final_leap',
  /** Gathered Strength closes round it (spellfx 'nova' on the boss). */
  shield: 'heart_final_shield_up',
  /** A Splinter climbs out of its quarter (spellfxAt at its spot). */
  rise: 'heart_final_splinter_rise',
  /** A surviving Splinter pours into the boss (spellfx 'beam', add to boss). */
  pour: 'heart_final_pour',
  /** Shearing Blow lands (spellfx 'nova' on the Splinter). */
  shear: 'heart_final_shear',
  /** Bursting Coal bursts (spellfxAt at its player). */
  coal: 'heart_final_coal_burst',
  /** Rime Toll rings out (spellfx 'nova' on the Splinter). */
  toll: 'heart_final_toll',
  /** Gale Pounce lands (spellfxAt at its victim). */
  pounce: 'heart_final_pounce',
  /** Buffeting Gale round the Breath Splinter (spellfx 'nova' on it). */
  buffet: 'heart_final_buffet',
  /** Splintered Strength pulses (spellfx 'nova' on a Splinter). */
  splinter: 'heart_final_splintered',
  /** The shield breaks and the boss rises (spellfx 'nova' on the boss). */
  release: 'heart_final_release',
  /** The final phase: all four quarters wake (spellfxAt at the centre). */
  awaken: 'heart_final_awaken',
  /** Masterless Fury pulses (spellfx 'nova' on the boss). */
  fury: 'heart_final_fury',
  /** Mythic, 1 percent: it kneels, the room goes dark (spellfxAt, centre). */
  kneel: 'heart_final_kneel',
  /** The Heart beats and drinks the quarters (spellfxAt at the centre). */
  rebirth: 'heart_final_rebirth',
  /** Healed, the Anvil starts to break (spellfxAt at the centre). */
  unmade: 'heart_final_unmade',
  /** A quarter's warning cracks (spellfxAt at its middle). */
  quarterCrack: 'heart_final_quarter_crack',
  /** A quarter breaks and falls (spellfxAt at its middle). */
  quarterFall: 'heart_final_quarter_fall',
  /** A body falls with the floor (spellfxAt where it stood). */
  bodyFall: 'heart_final_body_fall',
  /** The central ring starts cracking (spellfxAt at the centre). */
  ringCrack: 'heart_final_ring_crack',
  /** The central ring breaks: the wipe (spellfxAt at the centre). */
  ringBreak: 'heart_final_ring_break',
  /** A turn of the final phase's mix begins (spellfxAt at the centre, its
   *  school the turn's element: FINAL_VEIN_SCHOOL). */
  mixTurn: 'heart_final_mix_turn',
} as const;

/** The damage, aura and mob names (combat log, nameplates, the buff bar;
 *  re-localized by src/ui/sim_i18n.ts and src/ui/world_entity_i18n.ts). */
export const FINAL_PHASE_NAMES = {
  heat: 'Splinter of the Heat',
  quench: 'Splinter of the Quench',
  breath: 'Splinter of the Breath',
  hammer: 'Splinter of the Hammer',
  phase: 'Call of the Quarters',
  shield: 'Gathered Strength',
  splinter: 'Splintered Strength',
  shear: 'Shearing Blow',
  coal: 'Bursting Coal',
  trail: 'Cinder Trail',
  toll: 'Rime Toll',
  ring: 'Quenching Ring',
  weight: 'Mounting Weight',
  pounce: 'Gale Pounce',
  tether: 'Wind-Tethered',
  buffet: 'Buffeting Gale',
  fury: 'Masterless Fury',
  unmade: 'Unmade Anvil',
  anvilEnd: "Anvil's End",
  /** A fall with a quarter: the fall's own name (breath_void.ts). */
  falling: 'Falling',
  poured: {
    heat: 'Poured Heat',
    quench: 'Poured Quench',
    breath: 'Poured Breath',
    hammer: 'Poured Hammer',
  },
} as const;

// ---- the stages --------------------------------------------------------------------------

/** The fight's stage:
 *  fight      the quarter fight (part 1's rules and kits);
 *  leap       an intermission begins: the boss strides into the centre;
 *  call       shielded in the centre, it channels while its Splinters live;
 *  finalLeap  15 percent: it strides into the centre;
 *  final      the final phase: all four quarters awake, the mix, the enrage;
 *  kneel      Mythic, 1 percent: the fake death, nothing harms it;
 *  rebirth    the Heart beats and heals it, nothing harms it;
 *  collapse   the quarters fall one by one, then the ring. */
export type FinalStage =
  | 'fight'
  | 'leap'
  | 'call'
  | 'finalLeap'
  | 'final'
  | 'kneel'
  | 'rebirth'
  | 'collapse';

export const FINAL_STAGE_CODES: Readonly<Record<FinalStage, number>> = {
  fight: 0,
  leap: 1,
  call: 2,
  finalLeap: 3,
  final: 4,
  kneel: 5,
  rebirth: 6,
  collapse: 7,
};

/** The stage a phase aura's code names (unknown: the fight). */
export function finalStageOf(code: number | undefined): FinalStage {
  const i = Math.round(code ?? 0);
  for (const [k, v] of Object.entries(FINAL_STAGE_CODES)) if (v === i) return k as FinalStage;
  return 'fight';
}

/** A quarter's bit in the awake mask (HEART_QUARTER_ORDER's index). */
export function quarterBit(vein: SmithHeartVein): number {
  return 1 << HEART_QUARTER_ORDER.indexOf(vein);
}

/** The quarters a mask names, in bearing order. */
export function veinsOfMask(mask: number): SmithHeartVein[] {
  return HEART_QUARTER_ORDER.filter((v) => (mask & quarterBit(v)) !== 0);
}

/** Every quarter awake (the final phase). */
export const ALL_QUARTERS_MASK = 0b1111;

// ---- difficulty --------------------------------------------------------------------------

export interface FinalPhaseRules {
  /** Splinters per intermission (one per awakened quarter). */
  adds: number;
  /** A Splinter's health (its whole pool, this tier's). */
  addHealth: number;
  /** Bursting Coal: players marked at once. */
  coalMarks: number;
  /** A Quenching Ring's gaps (fewer is harder). */
  ringGaps: number;
  /** Mounting Weight: each stack's share of a harder swing. */
  weightStep: number;
  /** Gale Pounce's Storm Orbs round the Breath Splinter. */
  pounceOrbs: number;
  /** The hidden phase (final_hidden.ts): he stops at 1 percent, rises to 20
   *  and the Anvil falls apart under the raid. False: he dies at 0. */
  hiddenPhase: boolean;
}

export const FINAL_PHASE_DIFFICULTY: Readonly<Record<FinalDifficulty, FinalPhaseRules>> = {
  normal: {
    adds: 2,
    // 6,500 until the balance pass of 2026-11-12: Normal's Splinter took
    // longer to clear at its tier's damage than Heroic's, with worse gear.
    addHealth: 5000,
    coalMarks: 1,
    ringGaps: 3,
    weightStep: 0.15,
    pounceOrbs: 2,
    hiddenPhase: false,
  },
  heroic: {
    adds: 3,
    // 7,000 until the Heroic pass of 2026-11-05: three Splinters' pulses
    // (Splintered Strength, growing each pulse) outran a decent raid's two
    // healers inside 25 s while its damage needed 32 s to clear them; 5,500
    // ends the call before the pulses run away, still more to kill than
    // Normal's two (5,000 each since 2026-11-12).
    addHealth: 5500,
    coalMarks: 1,
    ringGaps: 2,
    weightStep: 0.18,
    pounceOrbs: 2,
    hiddenPhase: false,
  },
  mythic: {
    adds: 4,
    addHealth: 7500,
    coalMarks: 2,
    ringGaps: 2,
    weightStep: 0.2,
    pounceOrbs: 3,
    hiddenPhase: true,
  },
};

// ---- the ONE tuning table ------------------------------------------------------------------

/** Every number of part 2 (SKETCHES until the bot raid measures them,
 *  anchored like part 1's: a ten-player level-20 raid, about 400 to 460
 *  damage a second, cloth at about 1,135 to 1,345 health). Each mechanic's
 *  damage takes the tier's damageMult (FINAL_DIFFICULTY) on top. */
export const FINAL_PHASES = {
  // -- the thresholds --
  /** The intermissions, as shares of its health (in order). */
  intermissionAt: [0.7, 0.4] as readonly number[],
  /** The final phase's share (content/smith_heart_quarters.ts
   *  HEART_FINAL_PHASE_SHARE's value; pinned equal by the tests). */
  finalAt: 0.15,

  // -- the intermission's flow --
  /** It strides to the centre this fast (yards a second), shielded. */
  leapSpeed: 16,
  /** Its stride never takes longer than this (it lands on the centre). */
  leapMaxSeconds: 3,
  /** Call of the Quarters: the channel's length. Its Splinters alive at its
   *  end pour their elements into it. */
  callSeconds: 40,
  /** A Splinter climbs out of its quarter this long (nothing harms it, it
   *  strikes nobody). */
  riseSeconds: 2.5,
  /** How far from the centre a Splinter rises (the middle of its quarter). */
  riseR: 32,
  /** After the shield breaks Heart Unbound holds this long: it walks out to
   *  its tank, never punished for the centre it was called to. */
  releaseGrace: 8,

  // -- every Splinter --
  /** Splintered Strength: every Splinter alive pulses the raid this often,
   *  `splinterMin`..`splinterMax` growing by `splinterRise` of that for every
   *  pulse of this intermission. */
  splinterEvery: 3,
  splinterMin: 30,
  splinterMax: 36,
  splinterRise: 0.3,
  /** Shearing Blow: its frontal at its target, a bar telegraphed on the
   *  floor; its target takes the tank's share, anyone else in it the
   *  lethal one. */
  shearFirst: 5,
  shearEvery: 11,
  shearCast: 2,
  shearArcDeg: 100,
  shearRange: 10,
  shearTankMin: 1100,
  shearTankMax: 1250,
  shearOtherMin: 4200,
  shearOtherMax: 4600,

  // -- the Heat Splinter --
  /** Cinder Trail: a burning patch every `trailStep` yards it is dragged. */
  trailStep: 3,
  trailR: 3,
  trailLife: 18,
  trailMin: 110,
  trailMax: 130,
  trailCap: 14,
  /** Bursting Coal: the marked carry it out of the group; it bursts on
   *  everyone else within `coalReach` (the marked take a little). */
  coalFirst: 7,
  coalEvery: 15,
  coalSeconds: 6,
  coalReach: 8,
  coalSelfMin: 280,
  coalSelfMax: 320,
  coalMin: 1600,
  coalMax: 1800,

  // -- the Quench Splinter --
  /** Rime Toll: a kickable bar; rung out, it strikes the whole raid. A kick
   *  locks its school (the kicker's lockout): no toll begins while locked. */
  tollFirst: 6,
  tollEvery: 12,
  tollCast: 2.5,
  tollMin: 650,
  tollMax: 720,
  /** Quenching Ring: a ring of frost expands from it; crossing it outside
   *  its gaps chills and hurts. */
  ringFirst: 3,
  ringEvery: 9,
  ringStart: 2,
  ringSpeed: 7,
  ringReach: 42,
  /** Each gap's width (degrees). */
  ringGapDeg: 30,
  ringMin: 380,
  ringMax: 420,
  chillSlow: 0.5,
  chillSeconds: 3,

  // -- the Hammer Splinter --
  /** Mounting Weight: every landed swing a stack on its target (the swing
   *  kernel's stacking poison: `weightPerTick` a second a stack), and its
   *  swings land `weightStep` (FINAL_PHASE_DIFFICULTY) harder for each stack
   *  its target carries: the tanks swap. */
  weightPerTick: 6,
  weightSeconds: 25,
  weightMaxStacks: 15,
  /** The stacks a tank should swap at (the tooltip says it). */
  weightSwap: 5,

  // -- the Breath Splinter --
  /** Gale Pounce: a bar on a hashed player (never its tank), then it leaps
   *  onto them and hunts them: its quarry drags it out of the group. */
  pounceFirst: 6,
  pounceEvery: 14,
  pounceCast: 1.5,
  pounceMin: 300,
  pounceMax: 340,
  tetherSeconds: 8,
  /** Buffeting Gale: while it hunts, everyone else this near it every
   *  second. */
  buffetReach: 7,
  buffetMin: 240,
  buffetMax: 280,
  /** Its circles: Storm Orbs round it (solo soaks) on their own clock. */
  orbFirst: 9,
  orbEvery: 13,

  // -- the poured elements (for the rest of the fight) --
  /** Each poured element's normal-tier signature fires wherever the boss
   *  stands, this often (seconds), divided by the times it was poured.
   *  The Quench's cold runs everywhere at this share of its rise (times the
   *  pours, never past whole). */
  pouredHeatEvery: 26,
  pouredBreathEvery: 22,
  pouredHammerEvery: 20,
  pouredColdShare: 0.5,

  // -- the final phase --
  /** One ability of each element in turn, this far apart: Fire Whirls,
   *  Groaning Ice, Leaping Bolt, Weight of the Anvil. */
  mixFirst: 4,
  mixEvery: 7,
  /** The soft enrage: this long after the final phase begins, Masterless
   *  Fury pulses the raid every `furyEvery` seconds, `furyMin`..`furyMax`
   *  growing by `furyRise` of that each pulse. */
  enrageAfter: 120,
  enrageWarnAt: 10,
  furyEvery: 2,
  furyMin: 120,
  furyMax: 140,
  furyRise: 0.35,

  // -- the hidden phase (Mythic; Jose's numbers: 1, 20, 30 and the 120 s they
  // add up to; the scene's and the warnings' lengths are sketches) --
  /** Its share where it stops and kneels. */
  hiddenAt: 0.01,
  /** The fake death: it kneels this long, the room dark and still. */
  kneelSeconds: 4,
  /** The rebirth: the Heart beats this long, healing it to `rebirthTo`. */
  rebirthSeconds: 6,
  rebirthTo: 0.2,
  /** A quarter falls every this long from the collapse's start. */
  fallEvery: 30,
  /** Its warning cracks this long before (its floor still safe). */
  fallWarn: 5,
  /** The ring cracks this long after the last quarter, then breaks. */
  ringWarn: 5,
  /** The ring's lip past `ringR`: the dais's outer foot, where a fallen
   *  quarter's edge is drawn and where it starts to kill. */
  ringLip: 0.4,
  /** How a quarter's floor goes, from the wall in toward the ring (seconds): each
   *  stretch gives this long, the wall's starts after `cellFirst`, the ring's
   *  `cellSpread` later, and each scatters by up to `cellScatter`. The kit's break
   *  (heart_collapse_core.ts) and the fall of a body on it read the same numbers. */
  cellGive: 0.42,
  cellFirst: 0.05,
  cellSpread: 1.05,
  cellScatter: 0.3,
  /** A body whose floor has gone: its fall (yards a second squared, as the kit's
   *  stone) and how long until it is dead, by then deep in the dark over the heart. */
  plungeGravity: 21,
  plungeSeconds: 2.4,
} as const;

/** The final phase's mix, in turn. */
export const FINAL_MIX: readonly SmithHeartVein[] = ['heat', 'quench', 'breath', 'hammer'];

// ---- pure helpers -------------------------------------------------------------------------

/** The quarters whose Splinters rise: the `n` fullest Overload bars, ties to
 *  the quarter it stood in last, then clockwise from it (bearing order).
 *  Pure and deterministic. */
export function pickAddQuarters(
  overload: Readonly<Record<SmithHeartVein, number>>,
  lastQuarter: SmithHeartVein | null,
  n: number,
): SmithHeartVein[] {
  const order = HEART_QUARTER_ORDER;
  const from = lastQuarter ? order.indexOf(lastQuarter) : 0;
  const rank = (v: SmithHeartVein) => (order.indexOf(v) - from + 4) % 4;
  return [...order]
    .sort((a, b) => {
      // Bars are compared in whole percent: a hair of drift never decides.
      const fa = Math.round(overload[a] * 100);
      const fb = Math.round(overload[b] * 100);
      return fb !== fa ? fb - fa : rank(a) - rank(b);
    })
    .slice(0, Math.max(0, Math.min(4, n)));
}

/** The order the quarters fall in: the frozen Overload bars, fullest first,
 *  ties as the Splinters' (the quarter it stood in last, then clockwise). */
export function hiddenFallOrder(
  bars: Readonly<Record<SmithHeartVein, number>>,
  lastQuarter: SmithHeartVein | null,
): SmithHeartVein[] {
  return pickAddQuarters(bars, lastQuarter, 4);
}

/** Is instance-local (x, z) over a fallen quarter (`mask`: quarterBit)? The
 *  one test the kill, the placements and the painter share. */
export function hiddenFallenAt(mask: number, x: number, z: number): boolean {
  if (mask === 0) return false;
  const zone = heartQuarterAt(x, z);
  if (zone === 'ring') return false;
  // The dais's foot is still the ring's.
  const r = Math.hypot(x - HEART_ROOM.x, z - HEART_ROOM.z);
  return (mask & quarterBit(zone)) !== 0 && r >= HEART_QUARTERS.ringR + FINAL_PHASES.ringLip;
}

/** How many seconds after its quarter falls the floor `r` yards from the room's centre
 *  has gone from under a body: the wall's first, the ring's last, in the middle of each
 *  stretch's scatter. */
export function hiddenCellGoes(r: number): number {
  const { ringR, rimR } = HEART_QUARTERS;
  const u = Math.max(0, Math.min(1, (r - ringR) / (rimR - ringR)));
  const P = FINAL_PHASES;
  return P.cellGive + P.cellFirst + (1 - u) * P.cellSpread + P.cellScatter / 2;
}

/** The code of what falls next on the hidden aura: 0 nothing, 1 to 4 a
 *  quarter (HEART_QUARTER_ORDER's index plus one), 5 the ring. */
export function hiddenNextCode(next: SmithHeartVein | 'ring' | null): number {
  if (next === null) return 0;
  return next === 'ring' ? 5 : HEART_QUARTER_ORDER.indexOf(next) + 1;
}

/** What a code names. */
export function hiddenNextOf(code: number | undefined): SmithHeartVein | 'ring' | null {
  const i = Math.round(code ?? 0);
  if (i === 5) return 'ring';
  return i >= 1 && i <= 4 ? HEART_QUARTER_ORDER[i - 1] : null;
}

/** Splintered Strength's scale on its `k`-th pulse (0 the first). */
export function splinterScale(k: number): number {
  return 1 + FINAL_PHASES.splinterRise * Math.max(0, k);
}

/** Masterless Fury's scale at `stacks` (1 the first pulse). */
export function furyScale(stacks: number): number {
  return 1 + FINAL_PHASES.furyRise * Math.max(0, stacks - 1);
}

/** A small integer hash (no rng in a pick). */
function hash2(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x2545f491) ^ Math.imul(b | 0, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** A Quenching Ring's gaps from its seed: `count` bearings (radians, sim
 *  facing: 0 = +z) spread round it, never two within a third of the circle
 *  of each other's ideal spot. Pure: the sim and the painter read the same. */
export function quenchRingGaps(seed: number, count: number): number[] {
  const n = Math.max(1, Math.min(4, Math.round(count)));
  const base = ((hash2(seed, 11) % 3600) / 3600) * Math.PI * 2;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const jitter = (((hash2(seed, 23 + i) % 1000) / 1000 - 0.5) * Math.PI) / (2 * n);
    out.push(base + (i * Math.PI * 2) / n + jitter);
  }
  return out;
}

/** Is the bearing `angle` (radians, sim facing) inside one of `gaps`? */
export function inRingGap(
  angle: number,
  gaps: readonly number[],
  gapDeg = FINAL_PHASES.ringGapDeg,
): boolean {
  const half = (gapDeg * Math.PI) / 360;
  for (const g of gaps) {
    const d = Math.atan2(Math.sin(angle - g), Math.cos(angle - g));
    if (Math.abs(d) <= half) return true;
  }
  return false;
}

/** A Quenching Ring's front (yards from its centre) `age` seconds old. */
export function quenchRingFront(age: number): number {
  return FINAL_PHASES.ringStart + FINAL_PHASES.ringSpeed * Math.max(0, age);
}

/** How long a Quenching Ring lives (its front reaches its reach). */
export const QUENCH_RING_LIFE =
  (FINAL_PHASES.ringReach - FINAL_PHASES.ringStart) / FINAL_PHASES.ringSpeed;
