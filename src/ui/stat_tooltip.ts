// Pure, host-agnostic model for the character-screen stat hover tooltips.
//
// Given the player's class and live derived stats, it returns WHICH effect lines a
// stat contributes and their CURRENT numeric values, so the HUD can render a rich,
// class-aware, accurate breakdown (the same idea as the `unit_portrait.ts` core +
// thin DOM consumer split). There is no DOM and no i18n here: the HUD maps the
// structured model to t() keys + formatNumber.
//
// Every coefficient below mirrors the one place the sim derives stats,
// `recalcPlayerStats` in src/sim/entity.ts (armor reduction is imported outright).
// tests/stat_tooltip.test.ts cross-checks this module against real
// recalcPlayerStats output so the numbers cannot silently drift.
import { armorReduction, type PlayerClass, type Stats, type WeaponInfo } from '../sim/types';
import { CLASSES } from '../sim/data';

// The unarmed default weapon the sim falls back to (src/sim/entity.ts recalcPlayerStats),
// so an unarmed character still reads its real fist damage instead of a flat 0.
const DEFAULT_WEAPON: WeaponInfo = { min: 1, max: 2, speed: 2 };

/** Damage-per-second the character sheet shows for a stat cell and its tooltip:
 *  average swing (weapon roll + the AP contribution) over the weapon's speed. Pure
 *  and shared so the panel cell and the tooltip can never drift. Mirrors the sim's
 *  default-weapon fallback so an unarmed player reflects actual output, not 0. */
export function weaponDps(weapon: WeaponInfo | null | undefined, attackPower: number): number {
  const w = weapon ?? DEFAULT_WEAPON;
  return ((w.min + w.max) / 2 + (attackPower / AP_PER_DPS) * w.speed) / w.speed;
}

/** The ten cells on the character sheet, in their itemUi.stats.* id form. */
export type StatId =
  | 'str' | 'agi' | 'sta' | 'int' | 'spi'
  | 'armor' | 'attackPower' | 'dps' | 'critChance' | 'dodge';

/** A single contribution line. `value` is already in the unit the line displays
 *  (attack power as an integer, percents as a percent number like 1.1, etc.). */
export type StatEffectKind =
  | 'attackPower'
  | 'rangedAttackPower'
  | 'critPct'
  | 'dodgePct'
  | 'armor'
  | 'maxHealth'
  | 'maxMana'
  | 'spellCritPct'
  | 'healthRegen'
  | 'manaRegen'
  | 'damageReduction'
  | 'dpsFromAp';

export interface StatEffect {
  kind: StatEffectKind;
  value: number;
  /** Only set for `damageReduction`: the reference attacker level. */
  level?: number;
}

export interface StatTooltipModel {
  stat: StatId;
  /** Left-column primary stats (str/agi/sta/int/spi) get a "From your N {stat}:"
   *  header above their breakdown; derived right-column stats do not. */
  isPrimary: boolean;
  /** The stat's current displayed value (header / informational). */
  statValue: number;
  effects: StatEffect[];
  /** Show "Of little benefit to your class." (Int/Spi on a non-mana class). */
  minorForClass: boolean;
  /** Show "Includes a 5% base chance..." (crit / dodge). */
  baseChanceNote: boolean;
  /** Show the "estimate, excludes crits/abilities" note (the dps cell). */
  dpsApproxNote: boolean;
}

export interface StatTooltipInput {
  cls: PlayerClass;
  /** Final stats as shown on the sheet (post gear / auras / talents). */
  stats: Stats;
  level: number;
  /** entity.attackPower (already folds in buffs / talents). */
  attackPower: number;
  /** entity.critChance, 0..1. */
  critChance: number;
  /** entity.dodgeChance, 0..1. */
  dodgeChance: number;
  /** Weapon damage-per-second exactly as the panel computes it. */
  dps: number;
}

// --- coefficients, mirroring src/sim/entity.ts recalcPlayerStats ------------
const AGI_ARMOR_PER_POINT = 2; // entity.ts: s.armor += s.agi * 2
const AGI_CRIT_PER_POINT = 0.0005; // entity.ts: critChance = 0.05 + s.agi * 0.0005
const AGI_DODGE_PER_POINT = 0.0005; // entity.ts: dodgeChance = 0.05 + s.agi * 0.0005
const HUNTER_RANGED_AP_PER_AGI = 2; // entity.ts: rangedPower = s.agi * 2 (hunter)
const INT_SPELLCRIT_PER_POINT = 0.0008; // sim.ts spellCrit(): 0.05 + int * 0.0008
const AP_PER_DPS = 14; // sim.ts: attackPower / 14 = bonus dps
// updateRegen (sim.ts) ticks every 2s out of combat; 5s is ~2.5 ticks. The "per
// 5 sec" framing is the classic MP5/HP5 convention players expect.
const REGEN_TICKS_PER_5S = 2.5;

/** Mana classes are the only ones Intellect (mana pool) and Spirit (mana regen)
 *  meaningfully serve; rage/energy classes get the "minor benefit" note.
 *
 *  This keys off the BASE class definition, not the live `resourceType`, on
 *  purpose. A druid is fundamentally a mana class whose Intellect and Spirit
 *  govern the mana pool it casts from; while shapeshifted into a bear/cat form
 *  that pool is parked (`savedMana`), not gone, and returns when the druid leaves
 *  the form. The character sheet describes those enduring attributes, so it keeps
 *  showing the mana lines in every form. Reading the transient form resource here
 *  would wrongly tell a shifted druid its casting stats are "of little benefit." */
export function isManaClass(cls: PlayerClass): boolean {
  return CLASSES[cls].resourceType === 'mana';
}

/** Melee attack power gained per point of Strength (entity.ts apFromStats):
 *  2 for warrior/paladin/shaman/druid, 1 for everyone else. */
export function strApPerPoint(cls: PlayerClass): number {
  return cls === 'warrior' || cls === 'paladin' || cls === 'shaman' || cls === 'druid' ? 2 : 1;
}

/** Melee attack power gained per point of Agility: 1 for rogue/hunter, else 0. */
export function agiMeleeApPerPoint(cls: PlayerClass): number {
  return cls === 'rogue' || cls === 'hunter' ? 1 : 0;
}

/** First 20 stamina give 1 hp each, the rest 10 (entity.ts hpFromStamina). */
export function healthFromStamina(sta: number): number {
  const s = Math.max(0, sta);
  return Math.min(s, 20) + Math.max(0, s - 20) * 10;
}

/** First 20 intellect give 1 mana each, the rest 15 (entity.ts manaFromIntellect). */
export function manaFromIntellect(int: number): number {
  const i = Math.max(0, int);
  return Math.min(i, 20) + Math.max(0, i - 20) * 15;
}

/** Out-of-combat health regen, expressed per 5 sec (sim.ts updateRegen: hp gains
 *  round(sta * 0.3 + 2) every 2s). Note this game derives health regen from Stamina.
 *  We round the PER-TICK amount first (as the engine does), then scale by 2.5 ticks,
 *  so the displayed figure tracks what the sim actually adds. */
export function restingHealthPer5s(sta: number): number {
  return Math.round(Math.round(Math.max(0, sta) * 0.3 + 2) * REGEN_TICKS_PER_5S);
}

/** Out-of-combat mana regen, per 5 sec (sim.ts updateRegen, five-second rule:
 *  mana gains round(spi / 3 + 4 + floor(level / 5)) every 2s). Per-tick rounded
 *  first to match the engine, then scaled by 2.5 ticks. */
export function restingManaPer5s(spi: number, level: number): number {
  return Math.round(Math.round(Math.max(0, spi) / 3 + 4 + Math.floor(level / 5)) * REGEN_TICKS_PER_5S);
}

/** Build the structured breakdown for one stat cell. Pure: no DOM, no i18n.
 *
 *  The primary-stat effect lines are BASE-STAT ATTRIBUTION: "what this point pool of
 *  Strength/Agility itself contributes" (str*coeff attack power, agi*0.0005 crit, agi*2
 *  armor), which is exactly what the "From your N {stat}:" header states. They are NOT a
 *  reconciliation of the derived cell: with a talent AP%/crit/dodge bonus or a buff
 *  (buff_ap, mods.stats.crit, buff_dodge, druid forms) the cell folds in those extra
 *  layers, so the per-stat lines deliberately do not sum to the cell total. The derived
 *  cells that DO reconcile exactly (attackPower -> dpsFromAp, armor -> damageReduction)
 *  read the final entity values, so they stay correct under buffs. */
export function buildStatTooltip(stat: StatId, input: StatTooltipInput): StatTooltipModel {
  const { cls, stats, level } = input;
  const mana = isManaClass(cls);
  const effects: StatEffect[] = [];
  let minorForClass = false;
  let baseChanceNote = false;
  let dpsApproxNote = false;
  let isPrimary = true;
  let statValue = 0;

  switch (stat) {
    case 'str': {
      statValue = stats.str;
      effects.push({ kind: 'attackPower', value: stats.str * strApPerPoint(cls) });
      break;
    }
    case 'agi': {
      statValue = stats.agi;
      const meleeAp = agiMeleeApPerPoint(cls);
      if (meleeAp) effects.push({ kind: 'attackPower', value: stats.agi * meleeAp });
      if (cls === 'hunter') {
        effects.push({ kind: 'rangedAttackPower', value: stats.agi * HUNTER_RANGED_AP_PER_AGI });
      }
      effects.push({ kind: 'critPct', value: stats.agi * AGI_CRIT_PER_POINT * 100 });
      effects.push({ kind: 'dodgePct', value: stats.agi * AGI_DODGE_PER_POINT * 100 });
      effects.push({ kind: 'armor', value: stats.agi * AGI_ARMOR_PER_POINT });
      break;
    }
    case 'sta': {
      statValue = stats.sta;
      effects.push({ kind: 'maxHealth', value: healthFromStamina(stats.sta) });
      effects.push({ kind: 'healthRegen', value: restingHealthPer5s(stats.sta) });
      break;
    }
    case 'int': {
      statValue = stats.int;
      if (mana) {
        effects.push({ kind: 'maxMana', value: manaFromIntellect(stats.int) });
        effects.push({ kind: 'spellCritPct', value: stats.int * INT_SPELLCRIT_PER_POINT * 100 });
      } else {
        minorForClass = true;
      }
      break;
    }
    case 'spi': {
      statValue = stats.spi;
      if (mana) {
        effects.push({ kind: 'manaRegen', value: restingManaPer5s(stats.spi, level) });
      } else {
        minorForClass = true;
      }
      break;
    }
    case 'armor': {
      isPrimary = false;
      statValue = stats.armor;
      effects.push({ kind: 'damageReduction', value: armorReduction(stats.armor, level) * 100, level });
      break;
    }
    case 'attackPower': {
      isPrimary = false;
      statValue = input.attackPower;
      effects.push({ kind: 'dpsFromAp', value: input.attackPower / AP_PER_DPS });
      break;
    }
    case 'dps': {
      isPrimary = false;
      statValue = input.dps;
      dpsApproxNote = true;
      break;
    }
    case 'critChance': {
      isPrimary = false;
      statValue = input.critChance * 100;
      baseChanceNote = true;
      break;
    }
    case 'dodge': {
      isPrimary = false;
      statValue = input.dodgeChance * 100;
      baseChanceNote = true;
      break;
    }
  }

  return { stat, isPrimary, statValue, effects, minorForClass, baseChanceNote, dpsApproxNote };
}
