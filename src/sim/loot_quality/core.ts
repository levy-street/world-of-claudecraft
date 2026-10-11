import {
  casterLaneSpTotal,
  healerLaneHpTotal,
  normalizePrimaryStats,
  PRIMARY_STATS,
  primaryStatBudget,
  realizedLineBudget,
  scaleWeaponDamage,
  slotStatMultForItem,
  staminaBaseline,
  statIdentity,
  TWOHAND_DPS_MULT,
  TWOHAND_STAT_MULT,
  tierDeltaStats,
  weaponDpsBudget,
} from '../item_budget';
import type { Rng } from '../rng';
import type { CoreStats, ItemDef, ItemInstancePayload, WeaponInfo } from '../types';
import { isValidLootQuality, type LootQualityDescriptor } from './types';

export function createLootQuality(rng: Rng): LootQualityDescriptor | undefined {
  const draw = rng.int(0, 9999);
  if (draw < 9000) return undefined;
  const tier = draw < 9900 ? 1 : draw < 9990 ? 2 : draw < 9999 ? 3 : 4;
  return {
    version: 1,
    tier,
    weights: [
      rng.int(1, 1000),
      rng.int(1, 1000),
      rng.int(1, 1000),
      rng.int(1, 1000),
      rng.int(1, 1000),
    ],
  };
}

export function isEligibleLootQualityItem(item: ItemDef): boolean {
  return (
    !!item.slot &&
    ['weapon', 'armor', 'held_offhand'].includes(item.kind) &&
    ['uncommon', 'rare', 'epic', 'legendary'].includes(item.quality ?? 'common')
  );
}

export function lootQualityTier(instance?: ItemInstancePayload): 0 | 1 | 2 | 3 | 4 {
  return isValidLootQuality(instance?.lootQuality) ? instance.lootQuality.tier : 0;
}

export function lootQualityItemLevelBonus(instance?: ItemInstancePayload): number {
  return lootQualityTier(instance) * 2;
}

export function qualityLineBudget(item: ItemDef, level: number): number {
  return Math.round(
    primaryStatBudget(level, item.quality, item.slot, slotStatMultForItem(item)) *
      (item.kind === 'weapon' && item.hand === 'twohand' ? TWOHAND_STAT_MULT : 1),
  );
}

/** Highest-averages apportionment keeps a fixed allocation house-monotone. */
export function allocateQualityPoints(
  profile: Partial<CoreStats>,
  weights: readonly number[],
  points: number,
): Record<string, number> {
  const keys = PRIMARY_STATS.filter(
    (k) =>
      (profile[k] ?? 0) > 0 && (statIdentity(profile) !== 'caster' || k === 'int' || k === 'spi'),
  );
  const out: Record<string, number> = {};
  if (!keys.length) return out;
  for (let point = 0; point < points; point++) {
    let best = keys[0];
    for (const key of keys) {
      if (
        weights[PRIMARY_STATS.indexOf(key)] / ((out[key] ?? 0) + 1) >
        weights[PRIMARY_STATS.indexOf(best)] / ((out[best] ?? 0) + 1)
      )
        best = key;
    }
    out[best] = (out[best] ?? 0) + 1;
  }
  return out;
}

/** Add curve deltas to the authored line. Off-budget power and other affixes survive. */
export function qualityPrimaryBonuses(
  item: ItemDef,
  quality: LootQualityDescriptor,
  level: number,
): Record<string, number> {
  const profile = item.stats ?? {};
  const base = realizedLineBudget(profile);
  if (base <= 0) return {};
  const before = qualityLineBudget(item, level);
  const guaranteed = qualityLineBudget(item, level + 2 * (quality.tier - 1));
  const final = qualityLineBudget(item, level + 2 * quality.tier);
  const midLine = base + guaranteed - before;
  const out: Record<string, number> = {
    ...((profile.sta ?? 0) > 0
      ? tierDeltaStats(profile, base, midLine)
      : normalizePrimaryStats(profile, midLine - base)),
  };
  const randomPoints = final - guaranteed;
  const reserveStamina =
    statIdentity(profile) === 'physical' &&
    (profile.sta ?? 0) > 0 &&
    (profile.sta ?? 0) >= staminaBaseline(base)
      ? Math.min(
          randomPoints,
          Math.max(0, staminaBaseline(base + final - before) - (profile.sta ?? 0) - (out.sta ?? 0)),
        )
      : 0;
  const random = allocateQualityPoints(profile, quality.weights, randomPoints - reserveStamina);
  if (reserveStamina) random.sta = (random.sta ?? 0) + reserveStamina;
  for (const [key, value] of Object.entries(random)) out[key] = (out[key] ?? 0) + value;
  // Caster stamina is its separately priced free baseline, never a random affix.
  if (statIdentity(profile) === 'caster' && (profile.sta ?? 0) > 0) {
    out.sta = staminaBaseline(base + final - before) - staminaBaseline(base);
  }
  return Object.fromEntries(
    Object.entries(out).filter(([k, v]) => v > 0 && (profile[k as keyof CoreStats] ?? 0) > 0),
  );
}

export function qualityBonusesAtLevel(
  item: ItemDef,
  quality: LootQualityDescriptor,
  level: number,
): Record<string, number> {
  const bonus = qualityPrimaryBonuses(item, quality, level);
  const increase = quality.tier * 2;
  if ((item.stats?.armor ?? 0) > 0)
    bonus.armor = Math.round((item.stats!.armor! * increase) / level);
  // Preserve the item's fraction of its existing lane, without multiplying gems or enchants.
  if ((item.spellPower ?? 0) > 0)
    bonus.spellPower = Math.round(
      (item.spellPower! * (casterLaneSpTotal(level + increase) - casterLaneSpTotal(level))) /
        casterLaneSpTotal(level),
    );
  if ((item.healPower ?? 0) > 0)
    bonus.healingPower = Math.round(
      (item.healPower! * (healerLaneHpTotal(level + increase) - healerLaneHpTotal(level))) /
        healerLaneHpTotal(level),
    );
  for (const key of [
    'critRating',
    'hasteRating',
    'hitRating',
    'pvpOffenseRating',
    'pvpDefenseRating',
  ] as const) {
    if ((item[key] ?? 0) > 0) bonus[key] = Math.round((item[key]! * increase) / level);
  }
  return bonus;
}

export function qualityWeaponAtLevel(
  item: ItemDef,
  tier: number,
  level: number,
): WeaponInfo | undefined {
  const weapon = item.weapon;
  if (!weapon || !tier) return weapon;
  const dps = (weapon.min + weapon.max) / 2 / weapon.speed;
  const delta =
    (weaponDpsBudget(level + 2 * tier) - weaponDpsBudget(level)) *
    (item.kind === 'weapon' && item.hand === 'twohand' ? TWOHAND_DPS_MULT : 1);
  const scaled = scaleWeaponDamage(weapon, dps + delta);
  return {
    ...weapon,
    min: Math.max(weapon.min, scaled.min),
    max: Math.max(weapon.max, scaled.max),
  };
}
