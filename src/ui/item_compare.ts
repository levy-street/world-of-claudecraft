// Pure item-comparison helper (no DOM), so the stat-delta math can be unit
// tested directly the way xp_bar.ts / player_context_menu.ts are. The HUD turns
// these deltas into coloured tooltip lines; see Hud.itemCompareBlock.
import type { CoreStats, ItemDef, ItemInstancePayload } from '../sim/types';

// Stable stat identifier; the HUD maps it to a localized label via t().
export type CompareStat =
  | 'dps'
  | 'armor'
  | 'str'
  | 'agi'
  | 'sta'
  | 'int'
  | 'spi'
  | 'warfare'
  | 'hitRating'
  | 'critRating'
  | 'hasteRating';

export interface StatDelta {
  stat: CompareStat;
  delta: number; // candidate minus equipped; positive = upgrade
  decimals: number; // formatting precision (weapon DPS is fractional)
}

function weaponDps(w: ItemDef['weapon']): number {
  return w ? (w.min + w.max) / 2 / w.speed : 0;
}

// One side's effective core stat: the def's line plus the copy's baked
// rolled.stats bonus (the recalcPlayerStats merge semantics), so a per-copy
// bake (masterwork, enchant, the Perfected R5 delta) moves the delta the same
// way it moves the worn numbers.
function effectiveStat(
  def: ItemDef,
  instance: ItemInstancePayload | undefined,
  stat: keyof CoreStats,
): number {
  return (def.stats?.[stat] ?? 0) + (instance?.rolled?.stats?.[stat] ?? 0);
}

// Ordered, human-readable stat lines. Only changes worth showing are returned:
// integer stats need a full point of difference, DPS a tenth, so a same-for-
// same swap yields an empty list (the HUD then shows no "If you equip" section).
// `itemInstance` / `equippedInstance` are the per-copy payloads of the two
// sides (the hovered candidate copy and the worn copy); the core-stat rows
// compare MERGED def + rolled stats per side, so a worn copy whose bake makes
// the swap a net loss shows its honest negative delta. Callers without a
// payload in hand omit them and keep the def-only comparison.
export function itemStatDeltas(
  item: ItemDef,
  equipped: ItemDef,
  itemInstance?: ItemInstancePayload,
  equippedInstance?: ItemInstancePayload,
): StatDelta[] {
  const out: StatDelta[] = [];
  const dpsDelta = weaponDps(item.weapon) - weaponDps(equipped.weapon);
  if (Math.abs(dpsDelta) >= 0.05) out.push({ stat: 'dps', delta: dpsDelta, decimals: 1 });

  const stats: Array<keyof CoreStats & CompareStat> = ['armor', 'str', 'agi', 'sta', 'int', 'spi'];
  for (const k of stats) {
    const delta =
      effectiveStat(item, itemInstance, k) - effectiveStat(equipped, equippedInstance, k);
    if (Math.abs(delta) >= 0.5) out.push({ stat: k, delta, decimals: 0 });
  }

  const warfareRating = (def: ItemDef): number =>
    Math.min(def.pvpOffenseRating ?? 0, def.pvpDefenseRating ?? 0);
  const warfareDelta = warfareRating(item) - warfareRating(equipped);
  if (Math.abs(warfareDelta) >= 0.5) {
    out.push({ stat: 'warfare', delta: warfareDelta, decimals: 0 });
  }

  // Combat ratings, in the base item tooltip's affix order. spellPower is
  // deliberately absent: no content item carries it, so a row could never fire.
  const ratings = ['hitRating', 'critRating', 'hasteRating'] as const;
  for (const k of ratings) {
    const delta = (item[k] ?? 0) - (equipped[k] ?? 0);
    if (Math.abs(delta) >= 0.5) out.push({ stat: k, delta, decimals: 0 });
  }
  return out;
}
