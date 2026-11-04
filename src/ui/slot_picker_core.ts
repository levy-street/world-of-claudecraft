// The character-sheet slot picker: click a paperdoll slot, see every bag copy
// that would go on there, best first.
//
// "Would go on" is not re-derived here. The caller injects the paperdoll's own
// drop verdict (equip_drop_core.ts paperdollDropAction, the decision the drag
// and the lit drop targets already share), so the picker lists exactly the
// copies a drag onto that slot would equip, and never offers one the sim then
// refuses (wrong class, too high a level, a unique already worn).
//
// "Best" is the copy's own item level (item_level.ts itemInstanceLevel, which
// counts a Perfected or rift-upgraded copy), highest first, then quality, then
// name. The delta is against the piece worn in that slot, so the player reads
// +14 or -3 at a glance; an empty slot or a piece with no level shows none.
//
// DOM/Three-free (registered in tests/architecture.test.ts UI_PURE_CORES).

import { itemCopyPin } from '../sim/item_copy_ref';
import { itemInstanceLevel } from '../sim/item_level';
import type { InvSlot, ItemDef, ItemInstancePayload } from '../sim/types';
import { type ItemLookup, qualityRank } from './bag_filter';

export interface SlotPickerCandidate {
  /** The copy's bag index NOW: the equip command's named-copy target. */
  bagIndex: number;
  slot: InvSlot;
  item: ItemDef;
  /** The copy's item level, when it has one. */
  itemLevel?: number;
  /** itemLevel minus the worn piece's, when both have one. */
  delta?: number;
}

export interface SlotPickerInput {
  inventory: readonly InvSlot[];
  lookup: ItemLookup;
  /** The paperdoll drop verdict for this slot, for the copy at `bagIndex`. */
  canEquip(item: ItemDef, bagIndex: number): boolean;
  /** The piece worn in the slot now, and its payload, for the delta. */
  worn?: { item: ItemDef; instance?: ItemInstancePayload };
  /** A copy's item level. Defaults to itemInstanceLevel; injectable for tests. */
  levelOf?: (item: ItemDef, instance?: ItemInstancePayload) => number | undefined;
}

/** Every bag copy the slot would take, best first. Identical copies (same id and
 *  the same copy pin, so the same stats) are listed once, at their first index:
 *  two stacks of one plain ring are one choice, not two. */
export function buildSlotPickerCandidates(input: SlotPickerInput): SlotPickerCandidate[] {
  const levelOf = input.levelOf ?? itemInstanceLevel;
  const wornLevel = input.worn ? levelOf(input.worn.item, input.worn.instance) : undefined;
  const seen = new Set<string>();
  const out: SlotPickerCandidate[] = [];
  input.inventory.forEach((slot, bagIndex) => {
    if (slot.count < 1) return;
    const item = input.lookup(slot.itemId);
    if (!item || !input.canEquip(item, bagIndex)) return;
    const pin = `${slot.itemId}\u0000${itemCopyPin(slot)}`;
    if (seen.has(pin)) return;
    seen.add(pin);
    const level = levelOf(item, slot.instance);
    out.push({
      bagIndex,
      slot,
      item,
      ...(level !== undefined ? { itemLevel: level } : {}),
      ...(level !== undefined && wornLevel !== undefined ? { delta: level - wornLevel } : {}),
    });
  });
  out.sort(
    (a, b) =>
      (b.itemLevel ?? -1) - (a.itemLevel ?? -1) ||
      qualityRank(a.item) - qualityRank(b.item) ||
      a.item.name.localeCompare(b.item.name) ||
      a.bagIndex - b.bagIndex,
  );
  return out;
}

/** Re-find the picked copy at click time: the bags can shift between opening the
 *  picker and choosing a row, after which the captured index names a different
 *  stack, or nothing. The same slot object wins when it is still held; otherwise
 *  the first copy with the same id and copy pin (the same stats). Null when the
 *  copy left the bags, which the caller refuses with the sim's not-held toast. */
export function resolveSlotPickerIndex(
  inventory: readonly InvSlot[],
  candidate: Pick<SlotPickerCandidate, 'slot'>,
): number | null {
  const same = inventory.indexOf(candidate.slot);
  if (same >= 0) return same;
  const pin = itemCopyPin(candidate.slot);
  const index = inventory.findIndex(
    (s) => s.itemId === candidate.slot.itemId && s.count > 0 && itemCopyPin(s) === pin,
  );
  return index >= 0 ? index : null;
}

/** How the delta badge reads: up, down, or level (also when there is none). */
export function slotPickerDeltaTone(delta: number | undefined): 'up' | 'down' | 'same' {
  if (delta === undefined || delta === 0) return 'same';
  return delta > 0 ? 'up' : 'down';
}
