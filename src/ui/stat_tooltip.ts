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

import { CLASSES } from '../sim/data';
import {
  type AuraKind,
  armorReduction,
  type CoreStats,
  type PlayerClass,
  SPELL_POWER_PER_INT,
  type Stats,
  type WeaponInfo,
} from '../sim/types';

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

/** The cells on the character sheet, in their itemUi.stats.* id form. */
export type StatId =
  | 'str'
  | 'agi'
  | 'sta'
  | 'int'
  | 'spi'
  | 'armor'
  | 'attackPower'
  | 'spellPower'
  | 'dps'
  | 'critChance'
  | 'dodge'
  | 'critRating'
  | 'hasteRating'
  | 'hitRating'
  | 'parry'
  | 'warfare';

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

// --- upstream source breakdown ("what FEEDS this stat") ---------------------
// The complement of StatEffect (which is "what this stat feeds DOWNSTREAM"): one
// line per origin of the stat's value, so a hover answers "where did my 358
// Attack Power come from?". The lines are built to RECONCILE - they always sum
// to the displayed cell value - by computing the nameable origins (base, the
// attribute conversion, gear total, each active buff by name) and folding
// everything else (talent flats + percents, item-set bonuses, druid forms) into
// a single `talents` remainder. That keeps the sum exact without the model
// needing the talent-modifier internals, the same reconcile-by-remainder trick
// the existing effect lines use against recalcPlayerStats.
export type StatSourceKind = 'base' | 'attributes' | 'gear' | 'buff' | 'talents';

export interface StatSource {
  kind: StatSourceKind;
  /** Signed contribution in the stat's displayed unit (integer for stats / AP /
   *  Spell Power, a percent number like 1.5 for crit / dodge). */
  value: number;
  /** `buff` lines carry the localized aura name the HUD resolved; `attributes`
   *  lines may carry the primary stat they derive from (renders "From Agility"). */
  name?: string;
  fromStat?: StatId;
}

/** One equipped item's stat contribution, as the HUD reads it from ITEMS. */
export interface GearStatSource {
  name: string;
  stats?: Partial<CoreStats>;
  spellPower?: number;
}

/** One active aura's stat contribution, with the localized buff name. */
export interface BuffStatSource {
  kind: AuraKind;
  value: number;
  name: string;
}

export interface StatTooltipModel {
  stat: StatId;
  /** Left-column primary stats (str/agi/sta/int/spi) get a "From your N {stat}:"
   *  header above their breakdown; derived right-column stats do not. */
  isPrimary: boolean;
  /** The stat's current displayed value (header / informational). */
  statValue: number;
  /** The two live effects summarized by the single player-facing Warfare stat. */
  warfareDamageIncrease?: number;
  warfareDamageReduction?: number;
  effects: StatEffect[];
  /** Show "Of little benefit to your class." (Int/Spi on a non-mana class). */
  minorForClass: boolean;
  /** Show "Includes a 5% base chance..." (crit / dodge). */
  baseChanceNote: boolean;
  /** Show the "estimate, excludes crits/abilities" note (the dps cell). */
  dpsApproxNote: boolean;
  /** Upstream "what feeds this stat" lines (base / attributes / gear / each buff
   *  by name / talents remainder). Sums to `statValue`. Empty for the dps cell. */
  sources: StatSource[];
}

export interface StatTooltipInput {
  cls: PlayerClass;
  /** Final stats as shown on the sheet (post gear / auras / talents). */
  stats: Stats;
  level: number;
  /** entity.attackPower (already folds in buffs / talents). */
  attackPower: number;
  /** entity.spellPower (Intellect conversion + flat gear / buff Spell Power). */
  spellPower: number;
  /** entity.critChance, 0..1. */
  critChance: number;
  /** entity.dodgeChance, 0..1. */
  dodgeChance: number;
  /** entity.critRating, the accumulated crit rating from gear + set bonuses. */
  critRating: number;
  /** entity.hasteRating, the accumulated haste rating from gear + set bonuses. */
  hasteRating: number;
  /** entity.hitRating, the accumulated hit rating from gear + set bonuses. */
  hitRating: number;
  /** The warrior's front-arc parry chance, 0..1 (warriorParryChance from
   *  Strength); every other class stays at 0. */
  parryChance: number;
  /** Weapon damage-per-second exactly as the panel computes it. */
  dps: number;
  /** Equipped items contributing stats, for the gear source line (HUD maps from
   *  the equipment slots through ITEMS). */
  gear?: GearStatSource[];
  /** Active auras contributing stats, for the per-buff source lines (HUD maps
   *  from the player's live auras, resolving each name). */
  buffs?: BuffStatSource[];
}

// --- coefficients, mirroring src/sim/entity.ts recalcPlayerStats ------------
const AGI_ARMOR_PER_POINT = 2; // entity.ts: s.armor += s.agi * 2
const AGI_CRIT_PER_POINT = 0.0005; // entity.ts: critChance = 0.05 + s.agi * 0.0005
const AGI_DODGE_PER_POINT = 0.0005; // entity.ts: dodgeChance = 0.05 + s.agi * 0.0005
const STR_PARRY_PER_POINT = 0.0005; // warrior_hit_table.ts: parry = 0.05 + str * 0.0005
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
  return Math.round(
    Math.round(Math.max(0, spi) / 3 + 4 + Math.floor(level / 5)) * REGEN_TICKS_PER_5S,
  );
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
  let warfareDamageIncrease: number | undefined;
  let warfareDamageReduction: number | undefined;

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
      effects.push({
        kind: 'damageReduction',
        value: armorReduction(stats.armor, level) * 100,
        level,
      });
      break;
    }
    case 'attackPower': {
      isPrimary = false;
      statValue = input.attackPower;
      effects.push({ kind: 'dpsFromAp', value: input.attackPower / AP_PER_DPS });
      break;
    }
    case 'spellPower': {
      isPrimary = false;
      statValue = input.spellPower;
      // Spell Power matters only to the mana classes that cast; melee/energy
      // classes still see the cell but get the "minor benefit" note.
      if (!mana) minorForClass = true;
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
    case 'parry': {
      // Front-only avoidance, shown as a percent like dodge (the warrior starts
      // at a base chance and scales with Strength; other classes stay at 0).
      isPrimary = false;
      statValue = input.parryChance * 100;
      baseChanceNote = input.parryChance > 0;
      break;
    }
    case 'critRating': {
      isPrimary = false;
      statValue = input.critRating;
      break;
    }
    case 'hasteRating': {
      isPrimary = false;
      statValue = input.hasteRating;
      break;
    }
    case 'hitRating': {
      isPrimary = false;
      statValue = input.hitRating;
      break;
    }
    case 'warfare': {
      isPrimary = false;
      statValue = stats.pvpOffense * 100;
      warfareDamageIncrease = stats.pvpOffense * 100;
      warfareDamageReduction = stats.pvpDefense * 100;
      break;
    }
  }

  return {
    stat,
    isPrimary,
    statValue,
    warfareDamageIncrease,
    warfareDamageReduction,
    effects,
    minorForClass,
    baseChanceNote,
    dpsApproxNote,
    sources: buildStatSources(stat, input),
  };
}

// --- upstream source attribution --------------------------------------------
// Primary attributes (str/agi/sta/int/spi) have no flat per-class buff aura except
// agi/sta/int/spi/armor and the all-stats buff; Strength is only ever raised by the
// all-stats buff. This maps each primary to the aura kinds that feed it directly.
const PRIMARY_BUFF_KINDS: Record<'str' | 'agi' | 'sta' | 'int' | 'spi' | 'armor', AuraKind[]> = {
  str: ['buff_allstats'],
  agi: ['buff_agi', 'buff_allstats'],
  sta: ['buff_sta', 'buff_allstats'],
  int: ['buff_int', 'buff_allstats'],
  spi: ['buff_spi', 'buff_allstats'],
  armor: ['buff_armor'],
};

/** Base value of a primary attribute (or armor) from class + level, before any
 *  gear / buff / talent layer. Mirrors recalcPlayerStats' opening derivation. */
function basePrimary(cls: PlayerClass, key: keyof CoreStats, level: number): number {
  const def = CLASSES[cls];
  return def.baseStats[key] + def.statsPerLevel[key] * (level - 1);
}

/** Sum the contribution of one attribute (or spellPower) across equipped gear. */
function gearTotal(gear: GearStatSource[], key: keyof CoreStats | 'spellPower'): number {
  let total = 0;
  for (const g of gear) {
    if (key === 'spellPower') total += g.spellPower ?? 0;
    else total += g.stats?.[key] ?? 0;
  }
  return total;
}

/** Per-buff source lines for the auras whose kind feeds `key`, each with its
 *  resolved name so the tooltip can read "Mark of the Wild: +12". */
function buffLines(buffs: BuffStatSource[], kinds: AuraKind[]): StatSource[] {
  return buffs
    .filter((b) => kinds.includes(b.kind) && b.value !== 0)
    .map((b) => ({ kind: 'buff' as const, value: b.value, name: b.name }));
}

/** Build the upstream "what feeds this stat" lines so they sum to `final`. The
 *  nameable origins (base, the attribute conversion, gear total, each buff) are
 *  computed explicitly; whatever remains (talent flats + percent multipliers,
 *  item-set bonuses, druid form bonuses) folds into one `talents` line so the
 *  breakdown always reconciles to the displayed cell value. */
export function buildStatSources(stat: StatId, input: StatTooltipInput): StatSource[] {
  const { cls, stats, level } = input;
  const gear = input.gear ?? [];
  const buffs = input.buffs ?? [];
  const sources: StatSource[] = [];

  // Append the reconciling remainder (label it talents/effects) unless it rounds
  // away. `eps` is the smallest meaningful unit: 1 point for whole stats, 0.1 for
  // the crit/dodge percents.
  const finish = (final: number, eps: number): StatSource[] => {
    const explained = sources.reduce((sum, s) => sum + s.value, 0);
    const remainder = final - explained;
    if (Math.abs(remainder) >= eps) sources.push({ kind: 'talents', value: remainder });
    return sources;
  };

  switch (stat) {
    case 'str':
    case 'agi':
    case 'sta':
    case 'int':
    case 'spi': {
      sources.push({ kind: 'base', value: basePrimary(cls, stat, level) });
      const g = gearTotal(gear, stat);
      if (g !== 0) sources.push({ kind: 'gear', value: g });
      sources.push(...buffLines(buffs, PRIMARY_BUFF_KINDS[stat]));
      return finish(stats[stat], 1);
    }
    case 'armor': {
      sources.push({ kind: 'base', value: basePrimary(cls, 'armor', level) });
      // recalcPlayerStats adds armor from Agility (agi * 2) BEFORE druid Cat Form raises
      // Agility, so the Agility that actually feeds armor excludes the Cat Form bonus
      // (entity.ts). Subtract it when shifted so the "From Agility" line is honest; the Cat
      // Form bonus still shows in the remainder of the Agility cell's own breakdown. (Crit
      // and dodge read Agility AFTER the form bonus, so they need no such adjustment.)
      const catAgiBonus = buffs.some((b) => b.kind === 'form_cat')
        ? Math.max(2, Math.floor(level / 2))
        : 0;
      const fromAgi = (stats.agi - catAgiBonus) * AGI_ARMOR_PER_POINT;
      if (fromAgi !== 0) sources.push({ kind: 'attributes', value: fromAgi, fromStat: 'agi' });
      const g = gearTotal(gear, 'armor');
      if (g !== 0) sources.push({ kind: 'gear', value: g });
      sources.push(...buffLines(buffs, PRIMARY_BUFF_KINDS.armor));
      return finish(stats.armor, 1);
    }
    case 'attackPower': {
      // Attack power comes from the str/agi conversion (which already folds in
      // gear / buff stats), the flat attack-power buffs by name, then talents /
      // forms / the apPct multiplier in the remainder.
      const meleeAp = stats.str * strApPerPoint(cls) + stats.agi * agiMeleeApPerPoint(cls);
      sources.push({ kind: 'attributes', value: meleeAp });
      sources.push(...buffLines(buffs, ['buff_ap']));
      for (const b of buffs) {
        if (b.kind === 'debuff_ap' && b.value !== 0) {
          sources.push({ kind: 'buff', value: -b.value, name: b.name });
        }
      }
      return finish(input.attackPower, 1);
    }
    case 'spellPower': {
      const fromInt = Math.round(stats.int * SPELL_POWER_PER_INT);
      sources.push({ kind: 'attributes', value: fromInt, fromStat: 'int' });
      const g = gearTotal(gear, 'spellPower');
      if (g !== 0) sources.push({ kind: 'gear', value: g });
      sources.push(...buffLines(buffs, ['buff_spellpower']));
      return finish(input.spellPower, 1);
    }
    case 'critChance': {
      sources.push({ kind: 'base', value: 5 });
      const fromAgi = stats.agi * AGI_CRIT_PER_POINT * 100;
      if (fromAgi !== 0) sources.push({ kind: 'attributes', value: fromAgi, fromStat: 'agi' });
      return finish(input.critChance * 100, 0.1);
    }
    case 'dodge': {
      sources.push({ kind: 'base', value: 5 });
      const fromAgi = stats.agi * AGI_DODGE_PER_POINT * 100;
      if (fromAgi !== 0) sources.push({ kind: 'attributes', value: fromAgi, fromStat: 'agi' });
      for (const b of buffLines(buffs, ['buff_dodge'])) {
        sources.push({ ...b, value: b.value * 100 });
      }
      return finish(input.dodgeChance * 100, 0.1);
    }
    case 'parry': {
      // Warrior-only: base 5% plus Strength scaling (warrior_hit_table.ts).
      // Non-parry classes show a bare 0 with no misleading base line.
      if (input.parryChance > 0) {
        sources.push({ kind: 'base', value: 5 });
        const fromStr = stats.str * STR_PARRY_PER_POINT * 100;
        if (fromStr !== 0) sources.push({ kind: 'attributes', value: fromStr, fromStat: 'str' });
      }
      return finish(input.parryChance * 100, 0.1);
    }
    // The dps cell is an estimate the panel computes from weapon + AP; it has no
    // clean per-source attribution, so it shows none (just its approximate note).
    case 'dps':
      return sources;
    // Rating stats come straight off gear/set bonuses; the value plus its
    // description carries the meaning, so no per-source breakdown line.
    case 'critRating':
    case 'hasteRating':
    case 'hitRating':
    case 'warfare':
      return sources;
  }
}
