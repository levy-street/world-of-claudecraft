// Authoritative bag grouping commands. Inventory-only: no grant, consumption,
// quest credit, resource cost or RNG. Storage/custody still uses its own gates.
import { freePoolSlots } from './bag_pools';
import { bagPools, stackSizeOf } from './bags';
import { ITEMS } from './data';
import { isMaterialItemId, materialItemIds } from './material_ids';
import type { MaterialComposition } from './material_sources';
import { planMaterialStackCombination } from './material_stack_combination';
import type { MaterialStackSelection } from './material_stack_selection';
import { planMaterialStackSeparation } from './material_stack_separation';
import type { SimContext } from './sim_context';

export function changeMaterialStackGrouping(
  ctx: SimContext,
  itemId: string,
  target: MaterialStackSelection,
  mode: 'separate' | 'combine',
  selectedSources?: MaterialComposition,
  pid?: number,
): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const inventory = r.meta.inventory;
  const request = {
    inventory,
    itemId,
    selection: target,
    materialIds: materialItemIds(),
    stackSize: stackSizeOf(ITEMS[itemId]),
  };
  const result =
    mode === 'combine'
      ? planMaterialStackCombination(request)
      : planMaterialStackSeparation({
          ...request,
          selectedSources,
          maxNewSlots: freePoolSlots(inventory, bagPools(r.meta.bags), itemId, isMaterialItemId),
        });
  if (!result.ok) {
    ctx.error(
      r.meta.entityId,
      result.error === 'insufficient-space'
        ? 'That stack cannot be split to fit the space left in your bags.'
        : 'That material selection is no longer available.',
    );
    return;
  }
  inventory.length = result.value.length;
  for (let i = 0; i < result.value.length; i++) inventory[i] = result.value[i];
}
