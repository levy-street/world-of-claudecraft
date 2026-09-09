// Ordered kit selection for balance harnesses. Candidate ranking belongs to
// each caller; this leaf applies the real equip rules before accepting a pick,
// so a rejected crafted piece falls back instead of silently leaving a hole.
import {
  type CrucibleCollectionRole,
  crucibleCollectionForItem,
} from '../content/crucible_collections';
import { devKitRole } from '../content/dev_kit_roles';
import {
  canEquipItemInSlot,
  displacedSlotForEquip,
  masterwroughtConflictSlot,
  uniqueEquipConflictSlot,
} from '../equipment_rules';
import type { EquipSlot, ItemDef, PlayerClass } from '../types';

export function collectionRoleForSpec(
  cls: PlayerClass,
  spec: string | null,
): CrucibleCollectionRole | undefined {
  const preset = spec ? devKitRole(cls, spec) : null;
  if (!preset) return undefined;
  if (preset.tank) return 'tank';
  if (preset.healer) return 'healer';
  return preset.weights.int ? 'caster' : 'physical';
}

export function collectionFitsRole(
  item: ItemDef,
  cls: PlayerClass,
  role?: CrucibleCollectionRole,
): boolean {
  const collection = crucibleCollectionForItem(item.id);
  if (!collection) return true;
  return (
    (!item.requiredClass || item.requiredClass.includes(cls)) &&
    (role === undefined || collection.role === role)
  );
}

export function selectLegalGear(
  cls: PlayerClass,
  spec: string | null,
  candidates: readonly (readonly [EquipSlot, readonly ItemDef[]])[],
  lookup: (id: string) => ItemDef | undefined,
): Partial<Record<EquipSlot, string>> {
  return candidates.reduce<Partial<Record<EquipSlot, string>>>((picks, [slot, pool]) => {
    const used = new Set(Object.values(picks));
    const best = pool.find(
      (item) =>
        !used.has(item.id) &&
        canEquipItemInSlot(cls, item, slot, spec) &&
        displacedSlotForEquip(item, slot, picks, lookup, cls, spec) === null &&
        uniqueEquipConflictSlot(item, picks, lookup, [slot]) === null &&
        masterwroughtConflictSlot(item, picks, lookup, [slot]) === null,
    );
    return best ? { ...picks, [slot]: best.id } : picks;
  }, {});
}
