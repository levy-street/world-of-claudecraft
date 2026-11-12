// Which set bonus tiers one gear swap would break or light: the worn counts
// before and after putting `newItemId` in `slot`, read through the same
// lineage-aware counter and tier model the item card's set block uses
// (item_set_tooltip_view.ts), so the warning can never disagree with the
// lit tiers the card shows after the swap.
//
// DOM/Three-free (registered in tests/architecture.test.ts UI_PURE_CORES).

import { ITEM_SETS, ITEMS } from '../sim/data';
import type { EquipSlot } from '../sim/types';
import {
  equippedSetTooltipPieces,
  itemSetMemberCounts,
  itemSetTooltipModel,
} from './item_set_tooltip_view';

export interface SetTierChange {
  setId: string;
  /** The tier's piece threshold. */
  pieces: number;
  /** True when the swap lights the tier, false when it breaks it. */
  gained: boolean;
  /** Worn pieces after the swap, and the set's reachable total. */
  have: number;
  total: number;
}

/** The tiers that flip when `newItemId` replaces whatever `slot` holds. Losses
 *  come first: they are the part a player would otherwise miss. */
export function setTierChangesOnSwap(
  equipment: Partial<Record<EquipSlot, string>>,
  slot: EquipSlot,
  newItemId: string,
): SetTierChange[] {
  const oldSet = ITEMS[equipment[slot] ?? '']?.set;
  const newSet = ITEMS[newItemId]?.set;
  if (oldSet === undefined && newSet === undefined) return [];
  const before = Object.values(equipment);
  const after = Object.values({ ...equipment, [slot]: newItemId });
  const members = itemSetMemberCounts();
  const out: SetTierChange[] = [];
  // Families of one lineage share a ladder and a count, so they are one entry.
  const seen = new Set<string>();
  for (const setId of [oldSet, newSet]) {
    if (setId === undefined) continue;
    const ladder = ITEM_SETS[setId]?.lineage ?? setId;
    if (seen.has(ladder)) continue;
    seen.add(ladder);
    const had = equippedSetTooltipPieces(setId, before);
    const have = equippedSetTooltipPieces(setId, after);
    if (had === have) continue;
    const model = itemSetTooltipModel({
      itemSetId: setId,
      equippedPieces: have,
      itemSetMembers: members,
    });
    if (!model) continue;
    for (const tier of model.bonusTiers) {
      if (had >= tier.pieces === tier.active) continue;
      out.push({
        setId,
        pieces: tier.pieces,
        gained: tier.active,
        have,
        total: model.totalPieces,
      });
    }
  }
  return out.sort((a, b) => Number(a.gained) - Number(b.gained));
}
