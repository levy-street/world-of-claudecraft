import { PROCEDURAL_ITEM_BASES } from '../content/procedural_loot';
import { TWOHAND_DPS_MULT, weaponDpsBudget } from '../item_budget';
import { allProceduralAffixes } from '../procedural_item';
import type { CoreStats, ItemDef, ItemInstancePayload, WeaponInfo } from '../types';

export type ResolvedCoreStats = Record<keyof CoreStats, number>;

export interface ResolvedItemStats {
  stats: ResolvedCoreStats;
  spellPower: number;
  critRating: number;
  hasteRating: number;
  hitRating: number;
  pvpOffenseRating: number;
  pvpDefenseRating: number;
  healthOnKill: number;
  manaOnKill: number;
  blockValue: number;
  weapon?: WeaponInfo;
  legendaryPowerId?: string;
  legendaryRolls?: Record<string, number>;
}

const CORE_STAT_KEYS = ['str', 'agi', 'sta', 'int', 'spi', 'armor'] as const;

function blankCoreStats(): ResolvedCoreStats {
  return { str: 0, agi: 0, sta: 0, int: 0, spi: 0, armor: 0 };
}

function addCoreStats(
  target: ResolvedCoreStats,
  source: Partial<Record<string, number>> | undefined,
): void {
  if (!source) return;
  for (const key of CORE_STAT_KEYS) target[key] += source[key] ?? 0;
}

function proceduralWeapon(itemLevel: number, baseId: string): WeaponInfo | undefined {
  const base = PROCEDURAL_ITEM_BASES[baseId];
  if (!base?.baseWeapon) return undefined;
  const twoHandMultiplier = base.hand === 'twohand' ? TWOHAND_DPS_MULT : 1;
  const dps = weaponDpsBudget(itemLevel) * twoHandMultiplier;
  const averageDamage = dps * base.baseWeapon.speed;
  const spread = Math.max(0, Math.min(0.8, base.baseWeapon.damageSpread));
  return {
    min: Math.max(1, Math.round(averageDamage * (1 - spread))),
    max: Math.max(1, Math.round(averageDamage * (1 + spread))),
    speed: base.baseWeapon.speed,
    ...(base.dagger && { dagger: true }),
  };
}

function scaledProceduralBaseValue(
  itemLevel: number,
  baseId: string,
  value: 'baseArmor' | 'baseBlockValue',
): number | undefined {
  const base = PROCEDURAL_ITEM_BASES[baseId];
  const sourceValue = base?.[value];
  if (!base || sourceValue === undefined) return undefined;
  return Math.max(0, Math.round((sourceValue * itemLevel) / base.sourceLevel));
}

function addProceduralValue(out: ResolvedItemStats, stat: string, value: number): void {
  if (stat === 'str') out.stats.str += value;
  else if (stat === 'agi') out.stats.agi += value;
  else if (stat === 'sta') out.stats.sta += value;
  else if (stat === 'int') out.stats.int += value;
  else if (stat === 'spi') out.stats.spi += value;
  else if (stat === 'armor') out.stats.armor += value;
  else if (stat === 'spellPower') out.spellPower += value;
  else if (stat === 'critRating') out.critRating += value;
  else if (stat === 'hasteRating') out.hasteRating += value;
  else if (stat === 'hitRating') out.hitRating += value;
  else if (stat === 'healthOnKill') out.healthOnKill += value;
  else if (stat === 'manaOnKill') out.manaOnKill += value;
}

export function resolvedItemStats(
  definition: ItemDef,
  instance?: ItemInstancePayload,
): ResolvedItemStats {
  const out: ResolvedItemStats = {
    stats: blankCoreStats(),
    spellPower: definition.spellPower ?? 0,
    critRating: definition.critRating ?? 0,
    hasteRating: definition.hasteRating ?? 0,
    hitRating: definition.hitRating ?? 0,
    pvpOffenseRating: definition.pvpOffenseRating ?? 0,
    pvpDefenseRating: definition.pvpDefenseRating ?? 0,
    healthOnKill: 0,
    manaOnKill: 0,
    blockValue:
      definition.kind === 'armor' && 'blockValue' in definition ? (definition.blockValue ?? 0) : 0,
    ...(definition.weapon && { weapon: { ...definition.weapon } }),
  };
  addCoreStats(out.stats, definition.stats);
  addCoreStats(out.stats, instance?.rolled?.stats);

  const procedural = instance?.procedural;
  if (!procedural) return out;
  if (procedural.baseId !== definition.id)
    throw new Error(
      `procedural base ${procedural.baseId} does not match item definition ${definition.id}`,
    );
  const baseArmor = scaledProceduralBaseValue(procedural.itemLevel, procedural.baseId, 'baseArmor');
  if (baseArmor !== undefined) out.stats.armor = baseArmor;
  const baseBlockValue = scaledProceduralBaseValue(
    procedural.itemLevel,
    procedural.baseId,
    'baseBlockValue',
  );
  if (baseBlockValue !== undefined) out.blockValue = baseBlockValue;
  const weapon = proceduralWeapon(procedural.itemLevel, procedural.baseId);
  if (weapon) out.weapon = weapon;
  for (const affix of allProceduralAffixes(procedural)) {
    for (const [stat, value] of Object.entries(affix.values)) addProceduralValue(out, stat, value);
  }
  if (procedural.legendaryPowerId) out.legendaryPowerId = procedural.legendaryPowerId;
  if (procedural.legendaryRolls) out.legendaryRolls = { ...procedural.legendaryRolls };
  return out;
}

export function resolvedWeaponDps(stats: ResolvedItemStats): number {
  if (!stats.weapon) return 0;
  return (stats.weapon.min + stats.weapon.max) / 2 / stats.weapon.speed;
}
