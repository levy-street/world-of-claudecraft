// The classification table behind the class power tuner: which numeric field of
// which AbilityEffect belongs to which tuning channel, and how that number
// responds to a slider (see TuningValueKind in channels.ts).
//
// This is the ONE place a new tunable number is declared. When a class rework
// adds an effect field, add its row here and the tuner surfaces the slider for
// every ability that carries it, in both the dashboard and the apply path,
// with no UI work. `tests/class_tuning_coverage.test.ts` walks every live
// ability and FAILS on a numeric field this table does not classify, so a
// rework cannot quietly ship an untunable number.
//
// Deliberately unclassified (a row here would be a bug, not a feature):
//   - cadence fields (`interval`) and tick counts: scaling how often a DoT or a
//     zone pulses re-times the effect rather than changing its power, and the
//     duration channel already moves the total.
//   - identity/behavior fields (`auraId`, `abilities`, `templateId`, booleans,
//     `guaranteedCritLevel`): not magnitudes.
//   - `absorb.spellPowerCoeff`: the spell_power channel owns power scaling as a
//     single def-level knob (see ability_knobs.ts), so walking the authored
//     coefficient too would double-scale the same shield.
//
// Pure leaf: no SimContext, no rng, no clock.

import type { AuraKind } from '../types';
import type { TuningChannel, TuningValueKind } from './channels';

export interface TunedFieldSpec {
  channel: TuningChannel;
  kind: TuningValueKind;
}

// A path into one effect object. `[]` marks an array hop, so `stages[].min`
// visits the `min` of every empowered-cone stage.
export type TunedFieldTable = Readonly<Record<string, TunedFieldSpec>>;

const linear = (channel: TuningChannel): TunedFieldSpec => ({ channel, kind: 'linear' });
const deviation = (channel: TuningChannel): TunedFieldSpec => ({ channel, kind: 'deviation' });
const fraction = (channel: TuningChannel): TunedFieldSpec => ({ channel, kind: 'fraction' });
const multiplier = (channel: TuningChannel): TunedFieldSpec => ({ channel, kind: 'multiplier' });

/**
 * Effect type to its tunable fields. Covers the whole `AbilityEffect` union,
 * including variants no shipped ability uses yet, so a rework that reaches for
 * one is tunable the day it lands.
 */
export const EFFECT_TUNED_FIELDS: Readonly<Record<string, TunedFieldTable>> = {
  // --- weapon and direct damage ---------------------------------------------
  weaponDamage: { bonus: linear('damage_direct') },
  weaponStrike: {
    bonus: linear('damage_direct'),
    weaponMult: multiplier('damage_direct'),
  },
  directDamage: {
    min: linear('damage_direct'),
    max: linear('damage_direct'),
    vsRootedMult: deviation('damage_direct'),
    restoreMana: linear('resource_gain'),
    selfHealDamageFrac: fraction('heal_direct'),
  },
  finisherDamage: {
    base: linear('damage_finisher'),
    perCombo: linear('damage_finisher'),
    variance: linear('damage_finisher'),
  },
  judgement: {
    dmgMult: multiplier('damage_direct'),
    flat: linear('damage_direct'),
  },
  imbue: {
    bonus: linear('damage_direct'),
    judgeMin: linear('damage_direct'),
    judgeMax: linear('damage_direct'),
    duration: linear('duration_effect'),
  },
  consumeAura: {
    'deal.min': linear('damage_direct'),
    'deal.max': linear('damage_direct'),
    'heal.min': linear('heal_direct'),
    'heal.max': linear('heal_direct'),
  },

  // --- damage over time -----------------------------------------------------
  dot: {
    total: linear('damage_dot'),
    perCombo: linear('damage_dot'),
    // Classic finisher bleeds author their combo scaling twice over: one shape
    // buys bigger ticks (baseTotal + perComboTotal at a fixed duration), the
    // other buys a longer bleed (baseDuration + perComboDuration). Each half
    // moves with the channel its own number feeds, so a damage nerf lands on
    // the totals and a duration nerf on the durations.
    baseTotal: linear('damage_dot'),
    perComboTotal: linear('damage_dot'),
    baseDuration: linear('duration_effect'),
    perComboDuration: linear('duration_effect'),
    duration: linear('duration_effect'),
    leechPct: fraction('heal_direct'),
    directPct: fraction('damage_direct'),
  },
  drainTick: {
    min: linear('damage_dot'),
    max: linear('damage_dot'),
    healFrac: fraction('heal_direct'),
  },
  extendDot: {
    seconds: linear('duration_effect'),
    maxBonus: linear('duration_effect'),
  },

  // --- area damage ----------------------------------------------------------
  aoeDamage: {
    // a frontal cone's half-angle: the same shape lever empoweredCone.angle is
    frontalHalfAngle: linear('radius'),
    min: linear('damage_aoe'),
    max: linear('damage_aoe'),
    radius: linear('radius'),
    stunSec: linear('duration_control'),
    softCap: linear('targets'),
    'rageOnHit.base': linear('resource_gain'),
    'rageOnHit.perTarget': linear('resource_gain'),
    'rageOnHit.capTargets': linear('targets'),
  },
  chainDamage: {
    min: linear('damage_aoe'),
    max: linear('damage_aoe'),
    jumps: linear('targets'),
    falloff: fraction('damage_aoe'),
    radius: linear('radius'),
  },
  groundAoE: {
    min: linear('damage_aoe'),
    max: linear('damage_aoe'),
    radius: linear('radius'),
    duration: linear('duration_effect'),
    allyBuffPct: fraction('effect_magnitude'),
    igniteFrac: fraction('damage_dot'),
    slowMult: deviation('effect_magnitude'),
    slowDuration: linear('duration_control'),
    devotionOnFirstHit: linear('resource_gain'),
  },
  frozenOrb: {
    min: linear('damage_aoe'),
    max: linear('damage_aoe'),
    radius: linear('radius'),
    duration: linear('duration_effect'),
  },
  empoweredCone: {
    angle: linear('radius'),
    slowMult: deviation('effect_magnitude'),
    slowDuration: linear('duration_control'),
    'stages[].range': linear('range'),
    'stages[].min': linear('damage_aoe'),
    'stages[].max': linear('damage_aoe'),
    'stages[].angle': linear('radius'),
    'stages[].rootDuration': linear('duration_control'),
    'stages[].incapacitateDuration': linear('duration_control'),
  },
  repositionToAim: {
    'landingAoe.min': linear('damage_aoe'),
    'landingAoe.max': linear('damage_aoe'),
    'landingAoe.radius': linear('radius'),
  },

  // --- healing, absorbs, resurrection ---------------------------------------
  heal: {
    min: linear('heal_direct'),
    max: linear('heal_direct'),
    // a heal authored as a share of the CASTER's pool instead of a roll
    casterMaxHpPct: fraction('heal_direct'),
  },
  aoeHeal: {
    min: linear('heal_direct'),
    max: linear('heal_direct'),
    radius: linear('radius'),
  },
  chainHeal: {
    min: linear('heal_direct'),
    max: linear('heal_direct'),
    jumps: linear('targets'),
    falloff: fraction('heal_direct'),
    radius: linear('radius'),
  },
  hot: { total: linear('heal_hot'), duration: linear('duration_effect') },
  selfHealPctMax: { pct: fraction('heal_direct') },
  selfHotPctMax: { pct: fraction('heal_hot'), duration: linear('duration_effect') },
  absorb: {
    amount: linear('absorb'),
    duration: linear('duration_effect'),
    casterMaxHpPct: fraction('absorb'),
  },
  aoeAllyAbsorb: {
    amount: linear('absorb'),
    duration: linear('duration_effect'),
    radius: linear('radius'),
    maxTargets: linear('targets'),
  },
  absorbSpentResource: {
    // absorb minted per point of resource spent: a rate, not a whole number
    mult: multiplier('absorb'),
    duration: linear('duration_effect'),
  },
  resurrectAlly: { hpFrac: fraction('heal_direct') },
  massResurrectGroup: { hpFrac: fraction('heal_direct') },
  rewind: {
    fraction: fraction('heal_direct'),
    maxHpFraction: fraction('heal_direct'),
    windowSec: linear('duration_effect'),
    radius: linear('radius'),
  },
  temporalEcho: { duration: linear('duration_effect') },
  massTemporalEcho: {
    duration: linear('duration_effect'),
    radius: linear('radius'),
    maxTargets: linear('targets'),
    'heal.min': linear('heal_direct'),
    'heal.max': linear('heal_direct'),
  },
  temporalHourglass: {
    duration: linear('duration_effect'),
    groundDuration: linear('duration_effect'),
    hostilePveDuration: linear('duration_control'),
    hostilePvpDuration: linear('duration_control'),
    selfRadius: linear('radius'),
    captureRadius: linear('radius'),
    healMaxHpPct: fraction('heal_direct'),
    selfCooldownRate: deviation('effect_magnitude'),
    allyCooldownRate: deviation('effect_magnitude'),
  },
  dispel: {
    count: linear('targets'),
    selfHealPctMaxOnDispel: fraction('heal_direct'),
  },

  // --- control and impairment ----------------------------------------------
  stun: { duration: linear('duration_control') },
  root: { duration: linear('duration_control') },
  silence: { duration: linear('duration_control') },
  incapacitate: { duration: linear('duration_control') },
  polymorph: { duration: linear('duration_control') },
  faerieFire: { duration: linear('duration_control') },
  interrupt: {
    lockout: linear('duration_control'),
    rageOnInterrupt: linear('resource_gain'),
  },
  slow: { mult: deviation('effect_magnitude'), duration: linear('duration_control') },
  aoeSlow: {
    mult: deviation('effect_magnitude'),
    duration: linear('duration_control'),
    radius: linear('radius'),
  },
  aoeFear: {
    duration: linear('duration_control'),
    radius: linear('radius'),
    maxTargets: linear('targets'),
  },
  aoeRoot: {
    duration: linear('duration_control'),
    radius: linear('radius'),
    min: linear('damage_aoe'),
    max: linear('damage_aoe'),
    'ring.duration': linear('duration_effect'),
    'ring.innerRadius': linear('radius'),
    'trap.armTime': linear('duration_effect'),
    'trap.lifetime': linear('duration_effect'),
    // how much damage the root survives before it breaks: the root's staying
    // power, so it moves with the other magnitudes rather than its durations
    'breakOnDamage.maxHpPct': fraction('effect_magnitude'),
    'breakOnDamage.min': linear('effect_magnitude'),
    'breakOnDamage.max': linear('effect_magnitude'),
  },
  aoeKnockback: {
    radius: linear('radius'),
    distance: linear('distance'),
    dazeMult: deviation('effect_magnitude'),
    dazeDuration: linear('duration_control'),
  },
  finisherStun: {
    base: linear('duration_control'),
    perCombo: linear('duration_control'),
  },

  // --- auras, buffs, debuffs -----------------------------------------------
  // `value` is routed by aura KIND (see AURA_VALUE_FIELDS below), because the
  // same field means reflect damage on a thorns aura and a speed multiplier on
  // a movement aura.
  selfBuff: {
    duration: linear('duration_effect'),
    charges: linear('targets'),
    internalCooldown: linear('cooldown'),
    // the running upkeep and the floor it shuts off at
    healthDrainPctMax: fraction('resource_cost'),
    disableBelowHpPct: fraction('effect_magnitude'),
    // Secondary aura payloads. Unlike `value`, these are not routed by aura
    // kind (they carry a different meaning per kind: a judgement's min/max, an
    // aftereffect's damage reduction, a form's second and third bonus), so they
    // take the generic magnitude channel rather than a guessed one.
    value2: linear('effect_magnitude'),
    value3: linear('effect_magnitude'),
  },
  buffTarget: {
    duration: linear('duration_effect'),
    value2: linear('effect_magnitude'),
  },
  petBuff: { duration: linear('duration_effect') },
  applyDebuff: { duration: linear('duration_control') },
  debuffTargetSource: { duration: linear('duration_control') },
  aoeAttackSpeed: {
    mult: deviation('effect_magnitude'),
    duration: linear('duration_control'),
    radius: linear('radius'),
  },
  aoeAttackPower: {
    amount: linear('effect_magnitude'),
    pct: fraction('effect_magnitude'),
    duration: linear('duration_control'),
    radius: linear('radius'),
  },
  aoeAllyAttackPower: {
    amount: linear('effect_magnitude'),
    // Integer percent POINTS (Trueshot Aura ships 10 = +10%), consumed as
    // value / 100 by the buff_ap_pct stat pass, so it scales linearly. NOT a
    // 0..1 share: `fraction` would clamp the points to 1, collapsing the buff
    // to +1% the moment any factor moved it.
    apPct: linear('effect_magnitude'),
    duration: linear('duration_effect'),
    radius: linear('radius'),
  },
  aoeAllyHaste: {
    mult: deviation('effect_magnitude'),
    duration: linear('duration_effect'),
    radius: linear('radius'),
  },
  aoeAllyDamage: {
    pct: fraction('effect_magnitude'),
    duration: linear('duration_effect'),
    radius: linear('radius'),
  },
  aoeAllySureCrit: {
    charges: linear('targets'),
    duration: linear('duration_effect'),
    radius: linear('radius'),
  },
  aoeAllyMaxHp: {
    pct: fraction('effect_magnitude'),
    duration: linear('duration_effect'),
    radius: linear('radius'),
  },
  partyMeleeBuff: {
    attackSpeedMult: deviation('effect_magnitude'),
    dmgPct: fraction('effect_magnitude'),
    duration: linear('duration_effect'),
  },
  greaterInvisibility: {
    duration: linear('duration_effect'),
    afterDuration: linear('duration_effect'),
    linger: linear('duration_effect'),
    drValue: fraction('effect_magnitude'),
    removeDotCount: linear('targets'),
  },
  enrageChance: {
    chance: fraction('effect_magnitude'),
    duration: linear('duration_effect'),
  },
  finisherHaste: {
    mult: deviation('effect_magnitude'),
    basedur: linear('duration_effect'),
    perCombo: linear('duration_effect'),
  },

  // --- threat, resources, utility ------------------------------------------
  sunder: { armor: linear('threat'), maxStacks: linear('targets') },
  aoeTaunt: { radius: linear('radius') },
  gainResource: { amount: linear('resource_gain') },
  lifeTap: { hp: linear('resource_cost'), mana: linear('resource_gain') },
  selfDamagePctMax: { pct: fraction('resource_cost') },
  selfDamagePctCurrent: { pct: fraction('resource_cost') },
  selfAbsorbPctMax: { pct: fraction('absorb'), duration: linear('duration_effect') },
  blinkForward: { distance: linear('distance') },

  // --- hunter kits (Fieldcraft / Packlord / Coldsight) ---------------------
  // These resolve their own numbers rather than going through spell_scaling's
  // powerScale, so each carries its own Ranged Attack Power coefficient. That
  // coefficient IS the ability's power scaling, so it takes the spell_power
  // channel here instead of the def-level powerCoeffMult knob (which never
  // reaches these effects, so nothing double-scales).
  hunterBloodhook: {
    bleedTotal: linear('damage_dot'),
    bleedDuration: linear('duration_effect'),
    rangedPowerCoeff: multiplier('spell_power'),
    damageMult: multiplier('damage_direct'),
  },
  hunterShrapnel: {
    primaryMin: linear('damage_direct'),
    primaryMax: linear('damage_direct'),
    splashMin: linear('damage_aoe'),
    splashMax: linear('damage_aoe'),
    radius: linear('radius'),
    maxTargets: linear('targets'),
    spreadTotal: linear('damage_dot'),
    spreadDuration: linear('duration_effect'),
    damageMult: multiplier('damage_direct'),
  },
  hunterStampede: {
    beasts: linear('targets'),
    duration: linear('duration_effect'),
    // A summoned beast's swing timer is a real output lever (its total is
    // duration / interval x hit, not a fixed authored total), so unlike a DoT
    // cadence field it belongs on the swing channel rather than untuned.
    attackInterval: linear('swing_speed'),
    min: linear('damage_direct'),
    max: linear('damage_direct'),
    rangedPowerCoeff: multiplier('spell_power'),
  },
  packCommand: {
    min: linear('damage_direct'),
    max: linear('damage_direct'),
    focus: linear('resource_gain'),
    ferocityDuration: linear('duration_effect'),
  },
  unleashBeast: {
    primaryMin: linear('damage_direct'),
    primaryMax: linear('damage_direct'),
    clapMin: linear('damage_aoe'),
    clapMax: linear('damage_aoe'),
    // the share secondary targets take of the clap, authored above 1
    secondaryClapMult: multiplier('damage_aoe'),
    radius: linear('radius'),
    frenzyDuration: linear('duration_effect'),
  },
  hunterPackRally: { duration: linear('duration_effect'), radius: linear('radius') },
  hunterTrailbreak: { distance: linear('distance') },
  howlingRage: { duration: linear('duration_effect') },
  frostjawTrap: {
    radius: linear('radius'),
    armTime: linear('duration_effect'),
    lifetime: linear('duration_effect'),
    rootDuration: linear('duration_control'),
    slowMult: deviation('effect_magnitude'),
    slowDuration: linear('duration_control'),
  },

  // --- druid engine payoffs -------------------------------------------------
  druidMarrowbreakGuard: {
    // the health fraction the guard triggers under: the same kind of window
    // lever as an execute's requiresTargetHpBelow, so it is tunable
    belowFrac: fraction('effect_magnitude'),
    absorbPctMaxHp: fraction('absorb'),
    rage: linear('resource_gain'),
  },
  druidOverbloom: { harvestPct: fraction('heal_direct') },

  // --- paladin kit ----------------------------------------------------------
  // Aegis is a HEALING cooldown: its ticks and its finale both run through
  // applyHeal, so they take the healing channels rather than damage ones.
  paladinAegis: {
    radius: linear('radius'),
    tickMin: linear('heal_hot'),
    tickMax: linear('heal_hot'),
    finalMin: linear('heal_direct'),
    finalMax: linear('heal_direct'),
    damageReduction: fraction('effect_magnitude'),
    speedMult: deviation('effect_magnitude'),
    speedDuration: linear('duration_effect'),
  },
  sunGodVerdict: {
    duration: linear('duration_effect'),
    charges: linear('targets'),
    singleTargetMin: linear('damage_direct'),
    singleTargetMax: linear('damage_direct'),
    areaMin: linear('damage_aoe'),
    areaMax: linear('damage_aoe'),
    areaRadius: linear('radius'),
    areaSoftCap: linear('targets'),
    stunDuration: linear('duration_control'),
  },
  valkyrsCalling: {
    min: linear('damage_aoe'),
    max: linear('damage_aoe'),
    radius: linear('radius'),
    softCap: linear('targets'),
  },
  veilboundMarch: {
    duration: linear('duration_effect'),
    speedMult: deviation('effect_magnitude'),
    // Integer percent POINTS (ships 30 = +30% armor), consumed as value / 100
    // by the buff_armor_pct stat pass: linear, same reasoning as
    // aoeAllyAttackPower.apPct above.
    armorPct: linear('effect_magnitude'),
  },
  duskfireClaim: { duration: linear('duration_effect') },
  grantDevotion: { amount: linear('resource_gain') },

  // --- warlock: necromancy --------------------------------------------------
  armyOfDead: { duration: linear('duration_effect') },
  commandUndead: {
    duration: linear('duration_effect'),
    dmgPct: fraction('effect_magnitude'),
    hastePct: fraction('effect_magnitude'),
  },
  empowerUndeadArmy: {
    duration: linear('duration_effect'),
    dmgPct: fraction('effect_magnitude'),
    hastePct: fraction('effect_magnitude'),
  },
  sacrificeUndead: { healPctMax: fraction('heal_direct') },
  summonPyreColossus: { duration: linear('duration_effect') },
  summonSoulwell: { duration: linear('duration_effect') },
  gainSoulFragments: { amount: linear('resource_gain') },
  necromancyOssuaryMark: {
    duration: linear('duration_effect'),
    storedDamagePct: fraction('effect_magnitude'),
    soulLanceBonusPct: fraction('effect_magnitude'),
    deathRadius: linear('radius'),
  },
  warlockUmbralAnchor: {
    duration: linear('duration_effect'),
    maxRange: linear('range'),
  },
  ruinousBrand: { duration: linear('duration_effect'), charges: linear('targets') },

  // --- warlock: affliction (Doom is a resource meter, so it moves on the
  // resource channels rather than effect_magnitude) --------------------------
  afflictionCoven: {
    duration: linear('duration_effect'),
    radius: linear('radius'),
    maxSecondary: linear('targets'),
  },
  afflictionCruelPact: {
    // paid in the caster's own health, refunded as mana and Doom
    healthPct: fraction('resource_cost'),
    manaPctMax: fraction('resource_gain'),
    doom: linear('resource_gain'),
  },
  afflictionJudgment: {
    duration: linear('duration_effect'),
    doom: linear('resource_gain'),
    refund: linear('resource_gain'),
  },
  afflictionLitany: {
    duration: linear('duration_effect'),
    radius: linear('radius'),
    maxTargets: linear('targets'),
    damage: linear('damage_aoe'),
  },
  afflictionPossession: {
    // taking an enemy over is control, not a buff window
    duration: linear('duration_control'),
    doom: linear('resource_gain'),
  },
  afflictionVicarious: {
    duration: linear('duration_effect'),
    maxDoom: linear('resource_gain'),
  },
  afflictionViolence: {
    duration: linear('duration_effect'),
    charges: linear('targets'),
    doomPerProc: linear('resource_gain'),
    damage: linear('damage_direct'),
  },

  // --- shared utility -------------------------------------------------------
  threatPulse: { amount: linear('threat'), radius: linear('radius') },
  pullTarget: {
    stopDistance: linear('distance'),
    travelSpeed: linear('effect_magnitude'),
    slowMult: deviation('effect_magnitude'),
    slowDuration: linear('duration_control'),
    maxTargets: linear('targets'),
  },

  // --- Vale Cup boarball moves (no damage, but still authored magnitudes) ---
  ballKick: { power: linear('distance'), loft: linear('distance') },
  ballPass: { power: linear('distance'), loft: linear('distance') },
  ballShoot: { power: linear('distance'), loft: linear('distance') },
  sportDash: { distance: linear('distance') },
  sportShove: { distance: linear('distance') },
};

// Aura kinds whose `value` is a MARKER, not a magnitude: a stance flag, a
// one-shot empower token, a form toggle. Scaling one changes nothing useful and
// can only break a predicate that reads it, so the tuner never offers a slider.
export const MARKER_AURA_KINDS: ReadonlySet<string> = new Set<string>([
  'aoe_echo',
  'battle_stance',
  'berserker_stance',
  'cast_shield',
  'combustion',
  'form_metamorph',
  'form_moonkin',
  'next_attack_crit',
  'next_cast_cheap',
  'next_cast_free',
  'next_cast_instant',
  'next_execute_free',
  'sated',
  'cauterize_fatigue',
  'stasis',
  'sweeping_strikes',
  'overpower_charge',
  // presence-only kinds: no consumer reads their `value`, so a slider over it
  // would be a control that provably does nothing
  'buff_aura_mastery',
  'form_lich',
  'hunter_bloodtrail',
  'hunter_cold_focus',
  'ice_floes',
]);

// Aura kinds whose `value` is a multiplier around 1 (a 1.4 speed aura is +40%,
// a 0.9 stance is -10%), so the slider must move the DEVIATION, not the number.
// A kind absent from this set is treated as a plain magnitude, which is the
// right default for the flat/fractional majority (`buff_ap`, `thorns`,
// `buff_dodge`, `buff_dr`, ...).
export const MULTIPLIER_AURA_KINDS: ReadonlySet<string> = new Set<string>([
  'attackspeed',
  'buff_haste',
  'buff_speed',
  'buff_spellhaste_mult',
  'defensive_stance',
  'form_bear',
  'form_cat',
  'form_fireball',
  'form_travel',
  'righteous_fury',
  // stealth's value is the sneak-walk movement multiplier (0.5 = half speed),
  // consumed by the same Math.min the slow auras feed (player_motion.ts), so
  // the slider moves its deviation from 1 like every other slow.
  'stealth',
]);

// Aura kinds whose `value` IS damage the wearer deals back per hit. The tuner
// gives these their own channel so a druid's Briarguard reads as "reflect
// damage per hit" rather than a generic aura magnitude.
export const REFLECT_AURA_KINDS: ReadonlySet<string> = new Set<string>(['thorns']);

// Aura kinds whose `value` is a PLAIN MAGNITUDE (a flat stat amount, a 0..1
// share, integer percent points): the linear default is the DECIDED semantics
// for them, declared here rather than assumed. Every aura kind a live ability
// applies must appear in exactly one of the four sets; the coverage guard
// (tests/class_tuning_coverage.test.ts) fails on an undeclared kind, so a new
// aura cannot silently fall through to linear without anyone deciding whether
// its value is really a magnitude and not a multiplier around 1.
export const MAGNITUDE_AURA_KINDS: ReadonlySet<string> = new Set<string>([
  // flat stat amounts and percent-point buffs (the stat pass divides the
  // percent-point kinds by 100)
  'buff_ap',
  'buff_ap_pct',
  'buff_armor',
  'buff_armor_pct',
  'buff_block',
  'buff_crit',
  'buff_dodge',
  'buff_int_pct',
  'buff_spelldmg',
  'buff_spellpower',
  'buff_sta',
  'buff_sta_pct',
  'buff_stats_pct',
  // 0..1 shares added onto a rate or a pool fraction
  'bleed_vuln', // pctValue share added to bleed tick amp
  'buff_avatar', // damageDone share in dealDamage
  'buff_dmg_done',
  'buff_dr',
  'buff_dr_phys',
  'buff_heal_done',
  'buff_healing_done',
  'buff_mana_grace',
  'buff_reckless',
  'buff_spellhaste',
  'die_by_sword', // dodge share plus damage-reduction share
  'guardian_ward', // maxHp share restored on the death-save trigger
  'mortal_wound', // healing-taken reduction share (mult *= 1 - value)
  'overload', // next-cast amp share (amp = 1 + value)
  'power_echo', // echoed-damage share of the resolved amount
  'sacred_form', // healing-bonus share (bonus += value)
  'shield_wall', // damage-reduction share (paladinAegis stamps its
  // damageReduction fraction here too)
  'vuln_source', // per-source damage-taken share (1 + sum)
  // flat amounts outside the stat pass
  'form_shadow', // shadow-damage percent POINTS (1 + value / 100)
  'heal_echo', // flat heal repaid when the wearer drops low
  'paladin_debt_of_light', // flat soak cap the answer is bounded by
  'resource_sap', // flat resource restored per tick
]);

/**
 * The spec for an aura-carrying effect's `value` field, or null when the aura
 * is a marker and must not be scaled.
 */
export function auraValueFieldSpec(kind: AuraKind | string): TunedFieldSpec | null {
  if (MARKER_AURA_KINDS.has(kind)) return null;
  if (REFLECT_AURA_KINDS.has(kind)) return linear('damage_reflect');
  if (MULTIPLIER_AURA_KINDS.has(kind)) return deviation('effect_magnitude');
  return linear('effect_magnitude');
}

// Effect types whose `value` field carries an aura kind (routed above).
export const AURA_VALUE_EFFECTS: ReadonlySet<string> = new Set<string>([
  'selfBuff',
  'buffTarget',
  'petBuff',
  'applyDebuff',
  'debuffTargetSource',
]);

// Numeric effect fields that are deliberately NOT tunable, listed so the
// coverage guard can tell "classified as skip" from "nobody thought about it".
export const UNTUNED_EFFECT_FIELDS: ReadonlySet<string> = new Set<string>([
  // tick cadence: the duration channel moves the total, re-timing the pulses
  // would change the effect's shape rather than its power
  'dot.interval',
  'hot.interval',
  'groundAoE.interval',
  'frozenOrb.interval',
  'selfHotPctMax.interval',
  'hunterBloodhook.bleedInterval',
  'hunterShrapnel.spreadInterval',
  // the def-level spell_power channel owns power scaling for the whole ability
  'absorb.spellPowerCoeff',
  'directDamage.spellPowerCoeff',
  // crit-behavior switch expressed as a level, not a magnitude
  'empoweredCone.guaranteedCritLevel',
]);

// DEF-level numeric fields the walker deliberately leaves alone, for the same
// coverage guard. These are structure and progression, not power: moving them
// would change when or how an ability exists rather than how strong it is.
export const UNTUNED_DEF_FIELDS: ReadonlySet<string> = new Set<string>([
  'learnLevel',
  'empowerStages',
  'excludeSpecsAtLevel',
  'requiresAuraStacks',
  // the stack threshold an action-replacement rule arms at: a gate on WHICH
  // ability a button resolves to, not how strong either one is
  'actionReplacement.minStacks',
  'actionReplacement[].minStacks',
  'channel.ticks',
  'color',
]);

// RANK-level numeric fields the walker deliberately leaves alone (it reaches a
// rank's cost, castTime and threatFlat, plus everything inside its effects).
// These two are progression identity, not power: which rank this is and the
// level it is learned at. A NEW numeric field on AbilityRank outside this set
// and the walked trio fails the coverage guard until somebody classifies it.
export const UNTUNED_RANK_FIELDS: ReadonlySet<string> = new Set<string>(['rank', 'level']);
