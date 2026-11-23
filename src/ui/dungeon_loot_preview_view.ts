// Preview affinity only: never used for queue admission, rolls or item grants.
import { crucibleCollectionForItem } from '../sim/content/crucible_collections';
import { devKitRole } from '../sim/content/dev_kit_roles';
import { TALENTS } from '../sim/content/talents';
import { ITEMS } from '../sim/data';
import { canEquipItem, canEquipItemInSlot } from '../sim/equipment_rules';
import type { ItemDef, PlayerClass } from '../sim/types';
import type {
  FinderEncounterViewModel,
  FinderLootGroupView,
  FinderLootItemView,
} from './dungeon_finder_view';

export interface LootPreviewSelection {
  cls: PlayerClass;
  spec: string | null;
}

export function validLootPreviewSpec(cls: PlayerClass, spec: string | null): string | null {
  return TALENTS[cls].specs.some((s) => s.id === spec) ? spec : null;
}

/** Legal equipment plus authored role/stat affinity, not an optimal gear score.
 * Stamina-only and statless universal rewards stay visible for every legal class.
 * Uncommitted characters see all usable items for their class. */
export function lootPreviewFits(item: ItemDef, selection: LootPreviewSelection): boolean {
  const { cls } = selection;
  const spec = validLootPreviewSpec(cls, selection.spec);
  if (!canEquipItem(cls, item)) return false;
  if (item.requiredClass && !item.requiredClass.includes(cls)) return false;
  if (!item.slot) return true;
  if (item.slot && !canEquipItemInSlot(cls, item, item.slot === 'ring' ? 'ring1' : item.slot, spec))
    return false;
  const affinity = spec ? devKitRole(cls, spec) : null;
  if (!affinity) return true;
  const collection = crucibleCollectionForItem(item.id);
  const role = affinity.tank
    ? 'tank'
    : affinity.healer
      ? 'healer'
      : affinity.weights.int
        ? 'caster'
        : 'physical';
  if (collection && collection.role !== role) return false;
  const identity = (['str', 'agi', 'int', 'spi'] as const).filter(
    (stat) => (item.stats?.[stat] ?? 0) > 0,
  );
  return identity.length === 0 || identity.some((stat) => (affinity.weights[stat] ?? 0) > 0);
}

export function filterEncounterLoot(
  encounter: FinderEncounterViewModel,
  selection: LootPreviewSelection,
): FinderEncounterViewModel {
  const fits = (row: FinderLootItemView) =>
    !!ITEMS[row.itemId] && lootPreviewFits(ITEMS[row.itemId], selection);
  const groups = (rows: FinderLootGroupView[]) =>
    rows
      .map((group) => ({
        ...group,
        items: group.items.filter(fits),
        previewFiltered: group.items.some((item) => !fits(item)),
      }))
      .filter((group) => group.items.length > 0);
  return {
    ...encounter,
    groups: groups(encounter.groups),
    heroicGroups: groups(encounter.heroicGroups),
    singles: encounter.singles.filter(fits),
    heroicSingles: encounter.heroicSingles.filter(fits),
  };
}
