// Pure item-comparison helper (no DOM), so the stat-delta math can be unit
// tested directly the way xp_bar.ts / player_context_menu.ts are. The HUD turns
// these deltas into coloured tooltip lines; see Hud.itemCompareBlock.
import { aggregateItemEnhancements } from '../sim/item_enhancements';
import type { ItemDef, Stats } from '../sim/types';

// Stable stat identifier; the HUD maps it to a localized label via t().
export type CompareStat = 'dps' | 'armor' | 'str' | 'agi' | 'sta' | 'int' | 'spi';

export interface StatDelta {
  stat: CompareStat;
  delta: number; // candidate minus equipped; positive = upgrade
  decimals: number; // formatting precision (weapon DPS is fractional)
}

function weaponDps(w: ItemDef['weapon']): number {
  return w ? (w.min + w.max) / 2 / w.speed : 0;
}

// Ordered, human-readable stat lines. Only changes worth showing are returned:
// integer stats need a full point of difference, DPS a tenth — so a same-for-
// same swap yields an empty list (the HUD then shows no "If you equip" section).
export function itemStatDeltas(item: ItemDef, equipped: ItemDef): StatDelta[] {
  const out: StatDelta[] = [];
  const dpsDelta = weaponDps(item.weapon) - weaponDps(equipped.weapon);
  if (Math.abs(dpsDelta) >= 0.05) out.push({ stat: 'dps', delta: dpsDelta, decimals: 1 });

  const itemEnhancements = aggregateItemEnhancements(item);
  const equippedEnhancements = aggregateItemEnhancements(equipped);
  const stats: Array<keyof Stats & CompareStat> = ['armor', 'str', 'agi', 'sta', 'int', 'spi'];
  for (const k of stats) {
    const delta =
      (item.stats?.[k] ?? 0) +
      itemEnhancements.stats[k] -
      ((equipped.stats?.[k] ?? 0) + equippedEnhancements.stats[k]);
    if (Math.abs(delta) >= 0.5) out.push({ stat: k, delta, decimals: 0 });
  }
  return out;
}
