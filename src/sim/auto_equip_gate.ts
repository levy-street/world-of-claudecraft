import {
  equipCandidateInstance,
  equipCandidateQuality,
  masterwroughtConflictSlot,
  uniqueEquipConflictSlot,
} from './equipment_rules';
import type { EquipSlot, InvSlot, ItemDef, ItemInstancePayload } from './types';

// The worn-family half of auto-equip's silent-skip gate, extracted from
// Sim.maybeAutoEquip so it is a pure predicate a Vitest drives directly against
// the same rules the explicit equip path enforces.
//
// Auto-equip is a CONVENIENCE: where an explicit equip would be refused it must
// decline quietly, because the refusal toast belongs to the path the player
// actually chose. That makes agreement with the explicit rules the whole
// contract, and a peek that reads LESS state than the equip it predicts is the
// way that agreement rots: this gate used to pass the unique rule no instance
// context at all, so a promoted legendary-ROLLED copy (whose def is not itself
// unique-equipped) counted on neither side of a rule the explicit path in
// items.ts has judged instance-aware since phase 13.

/** The player state both rules read; a structural slice, not PlayerMeta, so the
 *  gate stays a leaf with no host dependency. */
export interface AutoEquipWornState {
  equipment: Partial<Record<EquipSlot, string>>;
  equipmentInstance?: Partial<Record<EquipSlot, ItemInstancePayload>>;
  inventory: readonly InvSlot[];
}

/**
 * True when an explicit equip of `itemId` would be refused by a worn-family
 * rule: the unique-equipped (legendary) family, or the Masterwrought counted
 * cap and its legendary sub-cap.
 *
 * `ignoreSlots` is empty on BOTH rules by design. An explicit equip exempts the
 * target slot and any slot its swap displaces, because those are emptied by the
 * swap; auto-equip has chosen no target yet, so it declines rather than
 * reasoning about which worn piece a swap would free. That makes this gate
 * strictly more conservative than the explicit path, never less.
 *
 * The incoming copy is peeked with NO slotIndex, matching auto-equip's own
 * consume: it lifts the highest-index matching unit, so that is the copy whose
 * payload and rolled quality both rules must judge.
 */
export function autoEquipFamilyConflict(
  def: ItemDef,
  itemId: string,
  worn: AutoEquipWornState,
  lookup: (id: string) => ItemDef | undefined,
): boolean {
  if (
    uniqueEquipConflictSlot(
      def,
      worn.equipment,
      lookup,
      [],
      worn.equipmentInstance,
      equipCandidateInstance(worn.inventory, itemId),
    )
  ) {
    return true;
  }
  return (
    masterwroughtConflictSlot(
      def,
      worn.equipment,
      lookup,
      [],
      worn.equipmentInstance,
      def.masterwrought ? equipCandidateQuality(worn.inventory, itemId, def) : undefined,
    ) !== null
  );
}
