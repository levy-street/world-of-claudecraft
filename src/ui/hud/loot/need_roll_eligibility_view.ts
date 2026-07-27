import { PROCEDURAL_LEGENDARY_POWERS } from '../../../sim/content/procedural_legendary_powers';
import { canEquipItem } from '../../../sim/equipment_rules';
import type { PublicItemInstanceView } from '../../../sim/procedural_item_public';
import type { ItemDef, PlayerClass } from '../../../sim/types';

export type NeedDenialReason = 'item_class' | 'legendary_power';

/** Explain a server-projected canNeed=false using only presentation-safe fields.
 * The server remains authoritative; this mirrors its two class-gating branches. */
export function needDenialReason(
  item: ItemDef | undefined,
  instance: PublicItemInstanceView | undefined,
  playerClass: PlayerClass,
): NeedDenialReason {
  if (!item || !canEquipItem(playerClass, item)) return 'item_class';
  const procedural = instance?.procedural;
  if (procedural?.rarity === 'legendary' && procedural.legendaryPowerId) {
    const power =
      PROCEDURAL_LEGENDARY_POWERS[
        procedural.legendaryPowerId as keyof typeof PROCEDURAL_LEGENDARY_POWERS
      ];
    if (power && 'requiredClass' in power && power.requiredClass !== playerClass) {
      return 'legendary_power';
    }
  }
  return 'item_class';
}
