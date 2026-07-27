import { MAX_LEVEL } from '../types';

// Procedural Legendary effects reach their authored magnitude at the player
// level cap. Items above the cap, including raid item levels, stay at 100%.
// Lower-level signatures remain exciting leveling drops, but their percentage,
// duration, resource, shield, healing, and damage magnitudes cannot substitute
// for an endgame copy of the same named power.
export const LEGENDARY_FULL_POWER_ITEM_LEVEL = MAX_LEVEL;

export function legendaryPowerEffectiveness(itemLevel: number): number {
  if (!Number.isFinite(itemLevel) || itemLevel <= 0) return 0;
  return Math.min(1, itemLevel / LEGENDARY_FULL_POWER_ITEM_LEVEL);
}

export function scaleLegendaryPowerValue(value: number, itemLevel: number): number {
  if (!Number.isFinite(value)) return 0;
  return value * legendaryPowerEffectiveness(itemLevel);
}
