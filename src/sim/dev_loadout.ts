// Dev/playtest "god loadout": the strongest item this class can wear in every
// gear slot, ranked by the game's own itemScore. The editor Playtest uses it to
// drop a maker straight into a maxed, best-in-slot character so they can test
// their map, especially a world boss, without dying to it or grinding gear
// first (see main.ts startOffline). Pure: reads the item tables, returns ids.

import { ITEMS } from './data';
import { canEquipItem } from './equipment_rules';
import { itemScore } from './item_level';
import type { PlayerClass } from './types';

export interface GodLoadout {
  /** One best item id per non-ring gear slot (mainhand, helmet, neck, chest…). */
  slots: string[];
  /** The two best distinct rings (both ring slots). */
  rings: string[];
}

/** The best-in-slot item this class can equip in every gear slot, by itemScore.
 *  Ties break on id so the selection is deterministic regardless of table
 *  iteration order. Rings are collected separately (two slots). */
export function bestGodLoadout(cls: PlayerClass): GodLoadout {
  const bestBySlot = new Map<string, { id: string; score: number }>();
  const rings: { id: string; score: number }[] = [];
  for (const def of Object.values(ITEMS)) {
    // Only wearable gear: weapons + armor (rings/necks/cloaks are 'armor').
    if (def.kind !== 'weapon' && def.kind !== 'armor') continue;
    if (!def.slot) continue;
    if (!canEquipItem(cls, def)) continue;
    const score = itemScore(def);
    if (def.slot === 'ring') {
      rings.push({ id: def.id, score });
      continue;
    }
    const cur = bestBySlot.get(def.slot);
    if (!cur || score > cur.score || (score === cur.score && def.id < cur.id)) {
      bestBySlot.set(def.slot, { id: def.id, score });
    }
  }
  rings.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return {
    slots: [...bestBySlot.values()].map((v) => v.id),
    rings: rings.slice(0, 2).map((r) => r.id),
  };
}
