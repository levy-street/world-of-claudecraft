// The Masterless Strength's leaf (docs/design/raid/smith_heart.md section
// 7.5, the owner's approved fight design of 28 Oct 2026): every id the final
// fight's sim, its renderer, its HUD, its dev helpers and its tests key on,
// the per-difficulty rules, the tuning, and the pure template-id helpers of
// its encounter objects. No SimContext, no rng.
//
// The boss fights on the Anvil of the World's four quarters
// (content/smith_heart_quarters.ts). The quarter it stands in is the strength
// it drinks: its kit is that quarter's (Heat, Quench, Breath, Hammer), and the
// four rules (the Overload bars, the shockwave on switching, Taking Root, the
// centre off-limits) push the tanks to drag it from quarter to quarter.
//
// EVERY number here is a SKETCH, unmeasured: anchored to the guardians'
// (level 20 elite, ten players, a measured bot raid of about 400 to 460 damage
// a second, the level-20 cloth reference of about 1,135 to 1,345 health), so
// the final is the raid's hardest fight but fair. Every tunable lives in
// FINAL_TUNING and FINAL_DIFFICULTY, so a change is one number.
//
// What every client reads (no wire or IWorld change; all of it rides
// existing entity fields):
//   - the fight's state: an aura on the boss (`value` the zone it stands in,
//     `value2` its base form, `value3` the switch mark's seconds left);
//   - the four Overload bars: one aura each on the boss (`value` the bar,
//     0 to 100, `value2` its trend: 1 filling, -1 draining, 0 still);
//   - Taking Root: a root aura on the boss, its clock in `remaining`;
//   - Heart Unbound: an aura on the boss, its stacks the ramp;
//   - every footprint: objects (a radius in `scale`, a heading in `facing`,
//     a state and its clock in the template);
//   - the marks: auras on players;
//   - the moments: `spellfx` cues (FINAL_CUES).
//
// Names: the Heat's fist and swells, the Quench's cold, Encased in Rime,
// Groaning Ice and Under the Ice, the Breath's Bellows Wind, Pressed to the
// Rim, Leaping Bolt and Drawn Lightning are the guardians' own (the compressed
// echo of each strength, already IP-checked). The new names were IP-checked
// on 28 Oct 2026 (design doc 7.5): none is another game's coined term, none
// is Kurog Grimtotem's.

import type { SmithHeartVein } from '../../content/smith_heart_layout';
import { HEART_QUARTER_ORDER, type HeartQuarterZone } from '../../content/smith_heart_quarters';

/** The boss (template id, frozen: the seal and the arrival read it). */
export const FINAL_BOSS = 'heart_masterless_strength';

// ---- casts, auras, objects, cues --------------------------------------------------

/** The boss's bars. Basalt Fist reuses the Heat guardian's cast id (its
 *  name, its look and its body pose come with it). */
export const FINAL_CASTS = {
  /** Basalt Fist (the Heat quarter): planted, its facing on the spot. */
  fist: 'heart_heat_fist',
  /** Leaping Bolt (the Breath quarter): on its first target. */
  bolt: 'heart_final_leaping_bolt',
  /** Weight of the Anvil (the Hammer quarter): the soak's bar. */
  anvil: 'heart_final_anvil',
} as const;

/** The auras the fight puts on players and on the boss. */
export const FINAL_AURAS = {
  /** On the boss: the zone (`value`, FINAL_ZONE_CODES), the base form
   *  (`value2`), the switch mark's seconds left (`value3`, 0 none). */
  state: 'heart_final_state',
  /** On the boss: Taking Root (a root, its clock the remaining time). */
  root: 'heart_final_root',
  /** On the boss: Heart Unbound (stacks: the centre's ramp). */
  unbound: 'heart_final_unbound',
  /** On players (Heroic): Vein-Shaken, the switch's mark. */
  shaken: 'heart_final_shaken',
  /** On players: the Quench quarter's cold (`value` 0 to 100, `value2`
   *  its trend). */
  cold: 'heart_final_cold',
  /** On players: Encased in Rime (an unbreakable stun). */
  frozen: 'heart_final_frozen',
  /** On players: Under the Ice (fallen through a breaking crack). */
  underIce: 'heart_final_under_ice',
  /** On players (Mythic): Numbing Frost, the frontal's slow. */
  numbing: 'heart_final_numbing',
  /** On players (Heroic): Ember Mark, embers drop at their feet. */
  ember: 'heart_final_ember_mark',
  /** On players: Bellows Wind (the wind kernel's own id: the push). */
  wind: 'wind_drift',
  /** On players (Heroic): Drawn Lightning (keep 8 yd from everyone). */
  drawn: 'heart_final_drawn',
  /** On players (Heroic): Stone Shell (a heal absorb). */
  shell: 'heart_final_shell',
  /** On players (Heroic): Crushed (a soaker sits the next Anvil out). */
  crushed: 'heart_final_crushed',
} as const;

/** One Overload bar's aura id on the boss (`value` 0 to 100). */
export function overloadAuraId(vein: SmithHeartVein): string {
  return `heart_final_overload_${vein}`;
}

/** The zone codes the state aura carries (`value`): the quarters in bearing
 *  order, then the ring. */
export const FINAL_ZONE_CODES: Readonly<Record<HeartQuarterZone, number>> = {
  breath: HEART_QUARTER_ORDER.indexOf('breath'),
  quench: HEART_QUARTER_ORDER.indexOf('quench'),
  hammer: HEART_QUARTER_ORDER.indexOf('hammer'),
  heat: HEART_QUARTER_ORDER.indexOf('heat'),
  ring: 4,
};

/** The zone a state aura's code names (an unknown code reads the ring). */
export function finalZoneOf(code: number | undefined): HeartQuarterZone {
  const i = Math.round(code ?? 4);
  return i >= 0 && i < 4 ? HEART_QUARTER_ORDER[i] : 'ring';
}

/** The fight's object templates (a radius rides `scale`). Basalt Fist's spot
 *  and its Molten Swells reuse the Heat guardian's objects (heat_ids.ts
 *  HEAT_OBJECTS), so they look the same. */
export const FINAL_OBJECTS = {
  /** A Fire Whirl: `<prefix><warn|live>`, moving; its radius in `scale`. */
  whirlPrefix: 'sh_final_whirl_',
  /** A burning pool: `<prefix><ember|forge|trail>`; its radius in `scale`. */
  poolPrefix: 'sh_final_pool_',
  /** A Groaning Ice crack: `<prefix><tenths>` to its break. */
  crackPrefix: 'sh_final_crack_',
  /** The wind: `<prefix><warn|blow>_<tenths>`, its heading in `facing`. */
  windPrefix: 'sh_final_wind_',
  /** A Storm Orb: `<prefix><tenths>` to its burst; its radius in `scale`. */
  orbPrefix: 'sh_final_orb_',
  /** A Tremor Crack: `<prefix><tenths>` to its eruption. */
  tremorPrefix: 'sh_final_tremor_',
  /** Weight of the Anvil's mark: `<prefix><tenths>` to its fall (it moves on
   *  Mythic); its radius in `scale`. */
  anvilPrefix: 'sh_final_anvil_',
} as const;

/** The spellfx ability ids of the fight's moments. */
export const FINAL_CUES = {
  /** An Overload pulse (spellfx 'nova' on the boss). */
  pulse: 'heart_final_overload_pulse',
  /** A bar bursts (spellfx 'nova' on the boss). */
  burst: 'heart_final_overload_burst',
  /** The boss crosses into another quarter (spellfxAt at the crossing). */
  shock: 'heart_final_vein_shock',
  /** It takes root (spellfx 'nova' on the boss). */
  root: 'heart_final_root',
  /** Heart Unbound pulses (spellfx 'nova' on the boss). */
  unbound: 'heart_final_unbound',
  /** A Fire Whirl strikes a player (spellfx 'nova', whirl to them). */
  whirl: 'heart_final_whirl',
  /** Embers fall at a marked player's feet (spellfxAt). */
  embers: 'heart_final_embers',
  /** The frontal leaves a pool (spellfxAt, Mythic). */
  forgeFire: 'heart_final_forge_fire',
  /** A player is Encased in Rime (spellfx 'nova' on them). */
  freeze: 'heart_final_freeze',
  /** A crack breaks (spellfxAt). */
  iceBreak: 'heart_final_ice_break',
  /** A bolt's jump (spellfx 'beam', from the last struck to the next). */
  bolt: 'heart_final_bolt',
  /** Drawn Lightning arcs (spellfx 'beam', marked to struck). */
  arc: 'heart_final_arc',
  /** A Storm Orb is taken (spellfxAt) or bursts (spellfxAt, big radius). */
  orbTaken: 'heart_final_orb_taken',
  orbBurst: 'heart_final_orb_burst',
  /** A Tremor Crack erupts (spellfxAt). */
  tremor: 'heart_final_tremor',
  /** Weight of the Anvil falls (spellfxAt, its radius). */
  anvil: 'heart_final_anvil_fall',
  /** Stone Shell closes on a player (spellfx 'nova' on them). */
  shell: 'heart_final_shell',
  /** The fight is over (spellfx 'nova' on the boss). */
  settle: 'heart_final_settle',
} as const;

/** The damage, aura and object names (combat log, floating text, the buff
 *  bar; re-localized by src/ui/sim_i18n.ts through the mechanic reverse map).
 *  The reused ones keep the guardians' keys. */
export const FINAL_NAMES = {
  state: 'The Masterless Strength',
  overload: 'Overload',
  pulse: 'Overload Pulse',
  burst: 'Overload Burst',
  shock: 'Vein Shock',
  shaken: 'Vein-Shaken',
  root: 'Taking Root',
  unbound: 'Heart Unbound',
  fist: 'Basalt Fist',
  swell: 'Molten Swell',
  whirl: 'Fire Whirl',
  ember: 'Ember Mark',
  embers: 'Smouldering Embers',
  forgeFire: 'Forge Fire',
  cold: 'Quenching Cold',
  frozen: 'Encased in Rime',
  crack: 'Groaning Ice',
  underIce: 'Under the Ice',
  numbing: 'Numbing Frost',
  wind: 'Bellows Wind',
  rim: 'Pressed to the Rim',
  bolt: 'Leaping Bolt',
  drawn: 'Drawn Lightning',
  orb: 'Storm Orb',
  tremor: 'Tremor Crack',
  anvil: 'Weight of the Anvil',
  shell: 'Stone Shell',
  crushed: 'Crushed',
} as const;

// ---- difficulty -----------------------------------------------------------------------

/** The fight's difficulty: one FINAL_DIFFICULTY row each (a new tier is a
 *  row, never a branch on a tier's name). */
export type FinalDifficulty = 'normal' | 'heroic' | 'mythic';

export interface FinalDifficultyRules {
  /** Every mechanic's damage, on top of the claim's own multiplier. */
  damageMult: number;
  /** The boss's health pool against the template's, set at the pull
   *  (tier_health.ts). */
  healthMult: number;
  /** How a full Overload bar's burst reads on this tier (FINAL_OVERLOAD
   *  holds its numbers): survivable with healing, heavy, or lethal. */
  burstTier: 'survivable' | 'heavy' | 'lethal';
  /** A quarter change hits the raid and leaves Vein-Shaken. */
  switchShock: boolean;
  /** Heat: embers drop at ranged players' feet. */
  embers: boolean;
  /** Heat: the frontal (Forge Fist) leaves fire pools. */
  forgeFire: boolean;
  /** Quench: marked players' floor cracks. */
  breakingIce: boolean;
  /** Quench: the frontal slows by 75 percent. */
  numbingFrost: boolean;
  /** Breath: marked players arc to anyone within reach. */
  drawnLightning: boolean;
  /** Breath: Storm Orbs to step on alone. */
  stormOrbs: boolean;
  /** Hammer: Stone Shell's heal absorbs. */
  stoneShell: boolean;
  /** Hammer: the Anvil's soakers are Crushed for the next one. */
  crushed: boolean;
  /** Hammer: the Anvil's mark turns round the boss through its bar. */
  rotatingAnvil: boolean;
  /** Tremor Cracks laid at once. */
  tremors: number;
}

export const FINAL_DIFFICULTY: Readonly<Record<FinalDifficulty, FinalDifficultyRules>> = {
  normal: {
    damageMult: 1,
    healthMult: 1,
    burstTier: 'survivable',
    switchShock: false,
    embers: false,
    forgeFire: false,
    breakingIce: false,
    numbingFrost: false,
    drawnLightning: false,
    stormOrbs: false,
    stoneShell: false,
    crushed: false,
    rotatingAnvil: false,
    tremors: 3,
  },
  heroic: {
    // 1.2 until the Heroic pass of 2026-11-05: the bot raid in the previous
    // tier's best came out of the 70 percent call too low to outlast the
    // Overload pulses, Vein Shock and the Anvil on two healers.
    damageMult: 1.1,
    healthMult: 2.1,
    burstTier: 'heavy',
    switchShock: true,
    embers: true,
    forgeFire: false,
    breakingIce: true,
    numbingFrost: false,
    drawnLightning: true,
    stormOrbs: false,
    stoneShell: true,
    crushed: true,
    rotatingAnvil: false,
    tremors: 4,
  },
  mythic: {
    damageMult: 1.3,
    healthMult: 2.1,
    burstTier: 'lethal',
    switchShock: true,
    embers: true,
    forgeFire: true,
    breakingIce: true,
    numbingFrost: true,
    drawnLightning: true,
    stormOrbs: true,
    stoneShell: true,
    crushed: true,
    rotatingAnvil: true,
    tremors: 4,
  },
};

// ---- the Overload bars: their one tuning table -----------------------------------------

/** Every number of the four Overload bars (Jose's playtest of 28 Oct 2026:
 *  the sketch's 40 s fill ran too fast; a full bar on Mythic must be a wipe).
 *
 *  The pace: empty to full in 60 s in its quarter, draining at a third of
 *  that (180 s from full) away from it. With the 10 s root and a drag of a
 *  few seconds, a visit lasts 15 s or more and fills a quarter of the bar:
 *  bouncing between two quarters gains about a sixth of a bar every round
 *  trip and bursts within about two and a half minutes, while a rotation
 *  through all four never climbs past one visit's fill and a rotation
 *  through three (visits of up to 20 s) stays clear of full for a six-minute
 *  fight (pinned by tests/smith_heart_final.test.ts).
 *
 *  The burst, per difficulty (the level-20 cloth reference is about 1,135
 *  to 1,345 health): Normal 700 to 800, survivable with healing; Heroic
 *  1,050 to 1,200, heavy (top the raid up and use defensives); Mythic 4,500
 *  to 5,200, lethal (only a big personal defensive lives: effectively a
 *  wipe). These are the final numbers: the tier's damageMult is NOT
 *  applied on top (the body's own mechanic factor still is). */
export const FINAL_OVERLOAD = {
  /** Empty to full while the boss stands in its quarter. */
  fillSeconds: 60,
  /** Away, it drains at this share of its fill speed. */
  drainShare: 1 / 3,
  /** The active bar pulses the raid this often. */
  pulseEvery: 4,
  /** A pulse: this much at an empty bar, rising by `pulseRise` at a full one
   *  (harder each pulse while it fills). */
  // 60 to 70 until the bot raid of 2026-11-04: even an empty bar's pulse on
  // all ten was as much as two level-20 healers put out, before any kit.
  pulseMin: 35,
  pulseMax: 40,
  // 300 until the bot raid of 2026-11-04: a bar two thirds full pulsed about
  // 250 every 4 s on everyone, which wiped a raid that moved the boss on time.
  pulseRise: 70,
  /** A bar this full (0 to 1) warns the raid once per fill. */
  warnAt: 0.85,
  /** The burst of a full bar, per difficulty (then it is empty again). */
  burst: {
    normal: { min: 700, max: 800 },
    heroic: { min: 1050, max: 1200 },
    mythic: { min: 4500, max: 5200 },
  },
} as const satisfies {
  burst: Readonly<Record<FinalDifficulty, { min: number; max: number }>>;
  [k: string]: unknown;
};

// ---- tuning ---------------------------------------------------------------------------

export const FINAL_TUNING = {
  // -- the rules (the Overload bars' numbers are FINAL_OVERLOAD's) --
  /** Heroic: the shockwave of a quarter change, and the mark it leaves. */
  shockMin: 180,
  shockMax: 220,
  shakenSeconds: 20,
  /** A change while marked hits this many times as hard. */
  shakenMult: 3,
  /** Taking Root: on entering a new quarter (the pull's too), it cannot
   *  move. 10 s, down from the sketch's 15 (Jose's playtest of 28 Oct 2026:
   *  the long root read as a boss that will not follow). */
  rootSeconds: 10,
  /** After the root lets go, no planted bar begins for this long: the
   *  tank's window to start the drag. */
  dragGrace: 3,
  /** A free boss whose tank stands in another zone closes on its tank to
   *  this far (yards), past its long melee reach: the drag always carries
   *  it over the ridge. */
  dragCloseR: 2,
  /** Heart Unbound: in the central ring above the final phase, a stack every
   *  second and a raid pulse of `unboundPerStack` a stack every second. */
  unboundEvery: 1,
  unboundPerStack: 45,
  unboundMax: 20,
  /** A quarter's kit begins this long after the boss enters it. */
  kitDelay: 3,

  // -- the Heat quarter --
  fistFirst: 5,
  fistEvery: 16,
  fistCast: 3,
  fistR: 6,
  fistMin: 2200,
  fistMax: 2400,
  // The Molten Swells are the Heat guardian's own (HEAT_TUNING: their
  // lanes, speed, wall and damage), so they look and strike the same.
  whirlFirst: 8,
  whirlEvery: 13,
  whirlCount: 3,
  whirlWarn: 1.5,
  whirlLife: 9,
  whirlR: 3,
  whirlSpeed: 4,
  /** A whirl strikes one player at most this often. */
  whirlHitEvery: 1,
  whirlMin: 300,
  whirlMax: 340,
  emberFirst: 10,
  emberEvery: 22,
  emberMarks: 3,
  /** A ranged player stands at least this far from the boss. */
  emberRanged: 12,
  emberSeconds: 6,
  emberR: 5,
  emberLife: 30,
  poolTick: 1,
  emberMin: 150,
  emberMax: 170,
  /** Burning pools at once at most (the oldest goes out first). */
  poolCap: 10,
  forgeFireR: 4,
  forgeFireLife: 20,
  forgeFireMin: 140,
  forgeFireMax: 160,

  // -- the Quench quarter --
  /** The cold: alone (fewer than `coldAllies` other players within
   *  `coldReach` yd) it rises `coldRise` a second; huddled it falls. */
  coldReach: 10,
  coldAllies: 2,
  coldRise: 20,
  coldFall: 25,
  coldMax: 100,
  freezeSeconds: 4,
  freezeMin: 300,
  freezeMax: 340,
  iceFirst: 7,
  iceEvery: 18,
  iceMarks: 2,
  iceWarn: 3,
  iceR: 4,
  iceMin: 600,
  iceMax: 680,
  underIceSeconds: 3,
  numbingSlow: 0.25,
  numbingSeconds: 6,

  // -- the Breath quarter --
  windFirst: 4,
  windEvery: 20,
  windWarn: 2,
  windBlow: 8,
  windSpeed: 3.5,
  /** Within this far of the rim while it blows, the storm strikes. */
  rimBand: 5,
  rimTick: 1,
  rimMin: 220,
  rimMax: 260,
  boltFirst: 6,
  boltEvery: 11,
  boltCast: 2,
  /** The bolt jumps to every player this near a struck one. */
  boltJump: 6,
  boltMin: 300,
  boltMax: 340,
  /** Each jump hits this much harder than the last. */
  boltGrowth: 0.5,
  boltMaxStruck: 10,
  drawnFirst: 12,
  drawnEvery: 22,
  drawnMarks: 2,
  drawnSeconds: 6,
  drawnReach: 8,
  drawnTick: 1,
  drawnMin: 200,
  drawnMax: 230,
  orbFirst: 15,
  orbEvery: 25,
  orbCount: 3,
  orbLife: 8,
  orbR: 2,
  orbMin: 250,
  orbMax: 280,
  orbBurstMin: 450,
  orbBurstMax: 500,

  // -- the Hammer quarter --
  tremorFirst: 4,
  tremorEvery: 10,
  tremorWarn: 2.5,
  tremorR: 4,
  tremorMin: 500,
  tremorMax: 560,
  anvilFirst: 10,
  anvilEvery: 25,
  anvilCast: 6,
  anvilR: 6,
  /** The whole blow, split between everyone under it. */
  anvilTotal: 9000,
  /** Fewer soakers than this: each takes half as much again. */
  anvilMinSoakers: 3,
  /** Nobody under it: the whole raid takes this. */
  anvilMissMin: 1500,
  anvilMissMax: 1600,
  /** Heroic: a Crushed soaker under the next Anvil takes its share this many
   *  times over. */
  crushedSeconds: 30,
  crushedMult: 3,
  /** Mythic: the mark turns round the boss at this radius and speed. */
  anvilOrbitR: 11,
  anvilOrbitDegPerSec: 25,
  shellFirst: 8,
  shellEvery: 20,
  shellMarks: 3,
  shellAbsorb: 600,
  shellSeconds: 20,

  /** Seconds of plain melee after a bar lands before the next begins. */
  barGap: 1.2,
} as const;

// ---- pure helpers -------------------------------------------------------------------------

/** A small integer hash (no rng in a pick). */
export function finalHash(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x2545f491) ^ Math.imul(b | 0, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** An Overload pulse's damage before the roll's spread (`fill` 0 to 1). */
export function pulseScale(fill: number): number {
  return 1 + (FINAL_OVERLOAD.pulseRise / FINAL_OVERLOAD.pulseMin) * Math.max(0, Math.min(1, fill));
}

/** One bar's step over `dt` seconds (0 to 1): filling while the boss stands
 *  in its quarter, else draining at FINAL_OVERLOAD's share of that. */
export function overloadStep(fill: number, active: boolean, dt: number): number {
  const rate = 1 / FINAL_OVERLOAD.fillSeconds;
  const next = active ? fill + rate * dt : fill - rate * FINAL_OVERLOAD.drainShare * dt;
  return Math.max(0, Math.min(1, next));
}

/** What each soaker of Weight of the Anvil takes (pure), before the roll:
 *  the whole split between them, half as much again when too few stand
 *  under it, a Crushed soaker's share `crushedMult` times over. */
export function anvilShare(soakers: number, crushed: boolean): number {
  const T = FINAL_TUNING;
  const n = Math.max(1, soakers);
  const base = T.anvilTotal / n;
  const short = n < T.anvilMinSoakers ? 1.5 : 1;
  return Math.round(base * short * (crushed ? T.crushedMult : 1));
}

/** Leaping Bolt's damage on its `k`-th struck body (0 the first). */
export function boltScale(k: number): number {
  return 1 + FINAL_TUNING.boltGrowth * Math.max(0, k);
}

const tenthsOf = (seconds: number): number => Math.max(0, Math.round(seconds * 10));

/** A timed object's template (`<prefix><tenths>`). */
export function finalTimed(prefix: string, seconds: number): string {
  return `${prefix}${tenthsOf(seconds)}`;
}

/** A timed object's seconds, or null when the template is not one. */
export function finalTimedOf(prefix: string, templateId: string): number | null {
  if (!templateId.startsWith(prefix)) return null;
  const t = Number(templateId.slice(prefix.length));
  return Number.isInteger(t) && t >= 0 ? t / 10 : null;
}

/** A Fire Whirl's template by its state. */
export function whirlTemplate(state: 'warn' | 'live'): string {
  return `${FINAL_OBJECTS.whirlPrefix}${state}`;
}

/** A Fire Whirl's state, or null when the template is not one. */
export function whirlOf(templateId: string): 'warn' | 'live' | null {
  if (!templateId.startsWith(FINAL_OBJECTS.whirlPrefix)) return null;
  const s = templateId.slice(FINAL_OBJECTS.whirlPrefix.length);
  return s === 'warn' || s === 'live' ? s : null;
}

/** A burning pool's kind: Ember Mark's, Forge Fire's, or the Heat
 *  Splinter's Cinder Trail (part 2). */
export type FinalPoolKind = 'ember' | 'forge' | 'trail';

/** A burning pool's template by its kind. */
export function poolTemplate(kind: FinalPoolKind): string {
  return `${FINAL_OBJECTS.poolPrefix}${kind}`;
}

/** A burning pool's kind, or null when the template is not one. */
export function poolOf(templateId: string): FinalPoolKind | null {
  if (!templateId.startsWith(FINAL_OBJECTS.poolPrefix)) return null;
  const s = templateId.slice(FINAL_OBJECTS.poolPrefix.length);
  return s === 'ember' || s === 'forge' || s === 'trail' ? s : null;
}

/** The wind's template (`<prefix><warn|blow>_<tenths>`). */
export function windTemplate(state: 'warn' | 'blow', seconds: number): string {
  return `${FINAL_OBJECTS.windPrefix}${state}_${tenthsOf(seconds)}`;
}

/** The wind's state and seconds, or null when the template is not one. */
export function windOf(templateId: string): { state: 'warn' | 'blow'; seconds: number } | null {
  if (!templateId.startsWith(FINAL_OBJECTS.windPrefix)) return null;
  const [state, n] = templateId.slice(FINAL_OBJECTS.windPrefix.length).split('_');
  const t = Number(n);
  if ((state !== 'warn' && state !== 'blow') || !Number.isInteger(t) || t < 0) return null;
  return { state, seconds: t / 10 };
}
