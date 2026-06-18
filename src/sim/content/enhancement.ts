import { ITEMS } from '../data';
import type { EquipSlot, InvSlot, ItemDef, Stats, WeaponInfo } from '../types';

export const MAX_ENHANCE = 9;

export const ENHANCE_MATERIALS: Record<1 | 2 | 3, string> = {
  1: 'crypt_refinement_shard',
  2: 'bastion_ward_core',
  3: 'gravewyrm_ember',
};

/** Success chance to reach target level (current + 1). */
export const ENHANCE_SUCCESS_RATE: Record<number, number> = {
  1: 0.90, 2: 0.80, 3: 0.70,
  4: 0.60, 5: 0.50, 6: 0.40,
  7: 0.35, 8: 0.25, 9: 0.15,
};

export function enhanceTierForLevel(targetLevel: number): 1 | 2 | 3 {
  if (targetLevel <= 3) return 1;
  if (targetLevel <= 6) return 2;
  return 3;
}

export function materialCostForLevel(targetLevel: number): number {
  return targetLevel >= 7 ? 2 : 1;
}

export function canEnhanceItem(def: ItemDef | undefined): boolean {
  if (!def) return false;
  return def.kind === 'weapon' || def.kind === 'armor';
}

export function stackEnhance(slot: InvSlot): number {
  return slot.enhance ?? 0;
}

/** Gear with +N never merges; consumables/materials merge at enhance 0. */
export function stacksMerge(a: InvSlot, itemId: string, enhance = 0): boolean {
  if (a.itemId !== itemId) return false;
  const ea = stackEnhance(a);
  if (ea > 0 || enhance > 0) return ea === enhance;
  return true;
}

export function findInvIndex(inventory: InvSlot[], itemId: string, enhance?: number): number {
  for (let i = 0; i < inventory.length; i++) {
    const s = inventory[i];
    if (s.itemId !== itemId) continue;
    if (enhance === undefined) return i;
    if (stackEnhance(s) === enhance) return i;
  }
  return -1;
}

export function scaledWeapon(base: WeaponInfo, enhance: number): WeaponInfo {
  if (enhance <= 0) return base;
  const scale = 1 + enhance * 0.02;
  const min = Math.max(base.min + (enhance >= 5 ? 1 : 0), Math.round(base.min * scale));
  const max = Math.max(base.max + (enhance >= 5 ? 1 : 0), Math.round(base.max * scale));
  return { ...base, min, max };
}

export function scaledArmorStats(stats: Partial<Stats> | undefined, enhance: number): Partial<Stats> | undefined {
  if (!stats || enhance <= 0) return stats;
  const out: Partial<Stats> = { ...stats };
  if (stats.armor) out.armor = Math.round(stats.armor * (1 + enhance * 0.03));
  if (enhance >= 3 && enhance % 3 === 0) {
    const bonusKey = (['str', 'agi', 'sta', 'int', 'spi'] as const)
      .filter((k) => (stats[k] ?? 0) > 0)
      .sort((a, b) => (stats[b] ?? 0) - (stats[a] ?? 0))[0];
    if (bonusKey) out[bonusKey] = (out[bonusKey] ?? 0) + 1;
  }
  return out;
}

export function enhanceLabel(level: number): string {
  return level > 0 ? `+${level}` : '';
}

export function materialDefForTier(tier: 1 | 2 | 3): ItemDef | undefined {
  return ITEMS[ENHANCE_MATERIALS[tier]];
}
