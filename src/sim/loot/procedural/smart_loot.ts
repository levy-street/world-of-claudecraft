import { canEquipItem } from '../../equipment_rules';
import type { ItemDef, PlayerClass } from '../../types';

export function proceduralLootUsabilityMultiplier(
  item: ItemDef,
  lootRecipientClasses: readonly PlayerClass[],
): number {
  if (lootRecipientClasses.length === 0) return 1;
  const usableRecipients = lootRecipientClasses.filter((cls) => canEquipItem(cls, item)).length;
  return 1 + 2 * (usableRecipients / lootRecipientClasses.length);
}
