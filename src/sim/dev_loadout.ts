// Dev/playtest "god loadout": the strongest item this class can wear in every
// gear slot, ranked by the game's own itemScore. The editor Playtest uses it to
// drop a maker straight into a maxed, best-in-slot character so they can test
// their map, especially a world boss, without dying to it or grinding gear
// first (see main.ts startOffline). Pure: reads the item tables, returns ids.

import { ITEMS } from './data';
import { canEquipItem, MASTERWROUGHT_EQUIP_CAP, weaponHand } from './equipment_rules';
import { itemScore } from './item_level';
import type { PlayerClass } from './types';

export interface GodLoadout {
  /** One best item id per non-ring gear slot (mainhand, helmet, neck, chest…). */
  slots: string[];
  /** The two best distinct rings (both ring slots). */
  rings: string[];
}

interface Candidate {
  id: string;
  score: number;
  masterwrought: boolean;
  legendary: boolean;
}

const byScore = (a: Candidate, b: Candidate): number =>
  b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The best-in-slot item this class can equip in every gear slot, by itemScore.
 *  Ties break on id so the selection is deterministic regardless of table
 *  iteration order. Rings are collected separately (two slots). The picks
 *  honour the same wear rules the equip path enforces: at most
 *  MASTERWROUGHT_EQUIP_CAP Masterwrought pieces (one legendary), each demoted
 *  slot refilled with its best plain piece, and no off-hand beside a
 *  two-handed main hand. */
export function bestGodLoadout(cls: PlayerClass): GodLoadout {
  const bySlot = new Map<string, Candidate[]>();
  for (const def of Object.values(ITEMS)) {
    // Only wearable gear: weapons + armor (rings/necks/cloaks are 'armor').
    if (def.kind !== 'weapon' && def.kind !== 'armor') continue;
    if (!def.slot) continue;
    if (!canEquipItem(cls, def)) continue;
    const list = bySlot.get(def.slot) ?? [];
    list.push({
      id: def.id,
      score: itemScore(def),
      masterwrought: def.masterwrought === true,
      legendary: def.quality === 'legendary',
    });
    bySlot.set(def.slot, list);
  }
  const picks: { slot: string; pick: Candidate }[] = [];
  for (const [slot, list] of bySlot) {
    list.sort(byScore);
    const count = slot === 'ring' ? 2 : 1;
    for (const pick of list.slice(0, count)) picks.push({ slot, pick });
  }
  // Keep the highest-scoring Masterwrought picks within the caps; refill every
  // demoted slot with its best plain piece not already picked.
  let kept = 0;
  let keptLegendary = 0;
  const flagged = picks.filter((p) => p.pick.masterwrought).sort((a, b) => byScore(a.pick, b.pick));
  for (const entry of flagged) {
    if (kept < MASTERWROUGHT_EQUIP_CAP && (!entry.pick.legendary || keptLegendary < 1)) {
      kept++;
      if (entry.pick.legendary) keptLegendary++;
      continue;
    }
    const taken = new Set(picks.map((p) => p.pick.id));
    const refill = (bySlot.get(entry.slot) ?? []).find((c) => !c.masterwrought && !taken.has(c.id));
    if (refill) entry.pick = refill;
    else picks.splice(picks.indexOf(entry), 1);
  }
  // A two-handed main hand fills both hands: equipping an off-hand after it
  // would unequip the weapon, so the off-hand pick is dropped.
  const mainhand = picks.find((p) => p.slot === 'mainhand');
  const mainDef = mainhand ? ITEMS[mainhand.pick.id] : undefined;
  if (mainDef?.kind === 'weapon' && weaponHand(mainDef) === 'twohand') {
    const offhand = picks.findIndex((p) => p.slot === 'offhand');
    if (offhand >= 0) picks.splice(offhand, 1);
  }
  return {
    slots: picks.filter((p) => p.slot !== 'ring').map((p) => p.pick.id),
    rings: picks.filter((p) => p.slot === 'ring').map((p) => p.pick.id),
  };
}
