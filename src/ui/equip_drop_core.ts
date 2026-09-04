// Pure, host-agnostic core for dragging an item from the bags onto a paperdoll
// slot (the character window's equip sockets) and for the drag-out-to-destroy
// gesture that replaced right-click-destroys.
//
// It answers the two questions the drag needs, DOM-free, so both the desktop
// HTML5 drag and the touch pointer drag share one rule set and the hover feedback
// can never disagree with what the sim will actually do: the sim's own equip path
// (src/sim/items.ts equipItem) re-validates every drop through the SAME leaves
// (slotAcceptsItem / canEquipItem / meetsLevelRequirement), so this core is
// feedback, never authority.
//
// DOM/Three-free (registered in tests/architecture.test.ts UI_PURE_CORES).

import { ITEMS } from '../sim/data';
import {
  canEquipItem,
  canEquipItemInSlot,
  displacedSlotForEquip,
  equipCandidateIndex,
  equipCandidateInstance,
  equipCandidateQuality,
  masterwroughtConflictSlot,
  slotAcceptsItem,
  uniqueEquipConflictSlot,
} from '../sim/equipment_rules';
import { itemCopyPin } from '../sim/item_copy_ref';
import { meetsLevelRequirement, requiredLevelFor } from '../sim/item_level_req';
import type { EquipSlot, InvSlot, ItemDef, ItemInstancePayload, PlayerClass } from '../sim/types';

/** The identity a drag captures at PICK-UP: where the copy sat, and what it was.
 *  `copyPin` is itemCopyPin of the source slot, empty when the source could name
 *  no copy (a sorted or filtered grid names no position at all). */
export interface DraggedCopyRef {
  index: number | null;
  copyPin: string;
}

/** Where the picked-up copy is NOW.
 *
 *  `held` carries the copy's CURRENT index, which may differ from the one it was
 *  picked up at; `gone` means it has left the bags and the gesture must refuse;
 *  `unpinned` means the drag captured no identity, so every consumer keeps its
 *  pre-existing id-only behavior unchanged. */
export type DraggedCopyResolution =
  | { kind: 'held'; index: number }
  | { kind: 'gone' }
  | { kind: 'unpinned' };

/**
 * Re-resolve a dragged copy against the LIVE bags, so a drop consumes the copy
 * the player picked up rather than whatever now sits at the index it started at.
 *
 * A drag is a WINDOW during which the bags can move underneath it: a snapshot
 * lands, a stack merges, an earlier slot empties and everything above it shifts
 * down. Resolving by index-plus-id at drop time then has two failure modes, and
 * one of them is silent. The loud one is the stale index naming a cell that no
 * longer holds this id at all, which the drop refuses (`blockedSelection`) after
 * the socket already lit, because the highlight was computed before the shift.
 * The quiet one is worse: the stale index still names THIS id, but a different
 * COPY of it, so the drop succeeds and equips the plain duplicate instead of the
 * enchanted piece the player dragged.
 *
 * The pin closes both. It covers the item id, the instance payload, and the
 * crafted provenance, i.e. everything that distinguishes two copies of one id,
 * and it survives ClientWorld replacing the whole inventory array on a snapshot,
 * which reference identity (the bagStackIndex idiom the click paths use) does
 * not. Two copies with the SAME pin are by definition interchangeable, so
 * resolving to either is correct.
 *
 * Preference order, and it is deliberate: the pick-up index first, so an
 * untouched drag resolves to exactly where it started and nothing moves; then
 * the lowest matching index, which is stable and does not depend on how the
 * bags happened to shift.
 */
export function resolveDraggedCopy(
  inventory: readonly InvSlot[],
  itemId: string,
  ref: DraggedCopyRef,
): DraggedCopyResolution {
  if (!ref.copyPin) return { kind: 'unpinned' };
  const matches = (slot: InvSlot | undefined): boolean =>
    !!slot && slot.count >= 1 && slot.itemId === itemId && itemCopyPin(slot) === ref.copyPin;
  if (ref.index !== null && ref.index >= 0 && ref.index < inventory.length) {
    if (matches(inventory[ref.index])) return { kind: 'held', index: ref.index };
  }
  for (let i = 0; i < inventory.length; i++) {
    if (matches(inventory[i])) return { kind: 'held', index: i };
  }
  return { kind: 'gone' };
}

/** The `slotIndex` a drag should send, or null when the gesture must refuse.
 *  Folds the three-way resolution into what every drop consumer actually needs:
 *  `undefined` keeps the id-only fallback for an unpinned drag, a number names
 *  the copy, and null is the refusal. */
export function draggedCopySlotIndex(
  inventory: readonly InvSlot[],
  itemId: string,
  ref: DraggedCopyRef,
): number | undefined | null {
  const resolved = resolveDraggedCopy(inventory, itemId, ref);
  if (resolved.kind === 'unpinned')
    return ref.index !== null && ref.index >= 0 ? ref.index : undefined;
  return resolved.kind === 'held' ? resolved.index : null;
}

/** What dropping a bag item on a paperdoll slot does. The blocked* variants are
 *  refusals the painter surfaces (a rejecting drop target + an error toast), and
 *  each names the ONE reason, checked in the sim's own order: a named bag cell
 *  that no longer holds this item (the sim's early invalid-selection gate in
 *  items.ts equipItem, checked before everything else the mirror can see),
 *  then wrong socket (a helm on a ring finger), then class proficiency, then
 *  the level gate, then the unique-equipped rule (a second worn copy of a
 *  legendary), then the two Masterwrought counted-family caps (the family's
 *  worn budget, then the one legendary allowed inside it). */
export type PaperdollDropAction =
  | 'equip'
  | 'blockedSelection'
  | 'blockedSlot'
  | 'blockedClass'
  | 'blockedLevel'
  | 'blockedUnique'
  | 'blockedMasterwroughtCap'
  | 'blockedMasterwroughtLegendary';

/** Decide what dropping `item` on the `slot` paperdoll socket does for a `cls`
 *  character of `level`. Mirrors src/sim/items.ts equipItem's guard order, so a
 *  drop this returns 'equip' for is one the sim accepts. `equipment` is the worn
 *  set the unique-equipped rule reads; callers pass the live map (omitted, the
 *  unique arm is skipped, for legacy call shapes only: every paperdoll surface
 *  passes it). `instances` is the worn per-copy payloads, which decide whether a
 *  worn Masterwrought piece counts as legendary; `inventory` is the mirrored
 *  bags, from which this PREDICTS the copy the sim will actually consume by
 *  running the sim's own selection rule (equipCandidateQuality) over it. That
 *  prediction is the whole point: the sim consumes the dragged bag copy when
 *  the drag names one (`slotIndex`, the same optional selection the equip
 *  command sends) and the highest-index matching unit otherwise, so reading
 *  any other unit would disagree with the authority in both directions.
 *  Omitted, the def's quality rules. */
export function paperdollDropAction(
  item: ItemDef,
  slot: EquipSlot,
  cls: PlayerClass,
  level: number,
  spec?: string | null,
  equipment?: Partial<Record<EquipSlot, string>>,
  instances?: Partial<Record<EquipSlot, ItemInstancePayload>>,
  inventory?: readonly InvSlot[],
  slotIndex?: number,
): PaperdollDropAction {
  // Only real gear equips; a consumable or material declares no slot at all, and
  // a bag equips into its own bar socket, never the paperdoll.
  if (item.kind !== 'weapon' && item.kind !== 'armor' && item.kind !== 'held_offhand')
    return 'blockedSlot';
  // A drag that NAMES a bag cell which no longer holds a valid copy of this
  // item id is refused outright, mirroring the sim's own early gate (items.ts
  // equipItem refuses before its first write): equipCandidateIndex answers
  // the named index only for a valid cell, so any other answer means the
  // selection is stale. Never fall back to the highest-index unit here; the
  // fallback is for an ABSENT slotIndex only (the id-only click path).
  if (
    slotIndex !== undefined &&
    inventory &&
    equipCandidateIndex(inventory, item.id, slotIndex) !== slotIndex
  ) {
    return 'blockedSelection';
  }
  if (!slotAcceptsItem(item, slot)) return 'blockedSlot';
  if (!canEquipItem(cls, item)) return 'blockedClass';
  if (!meetsLevelRequirement(level, item)) return 'blockedLevel';
  if (!canEquipItemInSlot(cls, item, slot, spec)) return 'blockedClass';
  if (equipment) {
    // The same exemptions the sim applies: the target slot and the slot this
    // equip displaces are both emptied by the swap, so a copy worn there never
    // coexists with the incoming one.
    const displaced = displacedSlotForEquip(item, slot, equipment, (id) => ITEMS[id], cls, spec);
    const ignore = displaced ? [slot, displaced] : [slot];
    // Instance-aware since phase 13 (the sim's own call shape in items.ts
    // equipItem): the worn payloads and the PREDICTED candidate copy's payload
    // ride along, so a promoted legendary-rolled copy counts on either side.
    // The candidate is the same slotIndex-honoring unit-selection peek the
    // Masterwrought sub-cap below makes over the mirrored bags. The peek runs
    // unguarded for EVERY item on purpose (mirror parity with the sim's own
    // call; a masterwrought-only guard would desync the mirror on def-legendary
    // items).
    if (
      uniqueEquipConflictSlot(
        item,
        equipment,
        (id) => ITEMS[id],
        ignore,
        instances,
        inventory ? equipCandidateInstance(inventory, item.id, slotIndex) : undefined,
      )
    ) {
      return 'blockedUnique';
    }
    // The Masterwrought counted family, over the same exempt slots. The
    // incoming copy's effective quality comes from the sim's own unit-selection
    // rule run over the mirrored bags, so the mirror and the equip path read
    // the SAME unit. Online, all three inputs ride one heavy self-snapshot
    // block, so they are never internally inconsistent with each other, but
    // the mirror as a whole can lag the authority by a snapshot: a verdict
    // here is feedback, and the sim's own re-validation is what decides.
    const mw = masterwroughtConflictSlot(
      item,
      equipment,
      (id) => ITEMS[id],
      ignore,
      instances,
      item.masterwrought && inventory
        ? equipCandidateQuality(inventory, item.id, item, slotIndex)
        : undefined,
    );
    if (mw) {
      return mw.reason === 'cap' ? 'blockedMasterwroughtCap' : 'blockedMasterwroughtLegendary';
    }
  }
  return 'equip';
}

/** The level a refused 'blockedLevel' drop names in its toast. Re-exported from
 *  the sim leaf so the painter never re-derives the gate. */
export function dropRequiredLevel(item: ItemDef): number {
  return requiredLevelFor(item);
}

/** Whether an item can be dragged onto the paperdoll at all: the tooltip's
 *  "drag onto your character to equip" hint and the drag payload gate on this,
 *  so a stack of cloth never advertises an equip it cannot do. Slot legality per
 *  socket is still paperdollDropAction's call. */
export function isPaperdollDraggable(item: ItemDef): boolean {
  return (
    (item.kind === 'weapon' || item.kind === 'armor' || item.kind === 'held_offhand') && !!item.slot
  );
}
