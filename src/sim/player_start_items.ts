import type { InvSlot } from './types';

interface StarterItemClass {
  readonly startItems: readonly { readonly itemId: string; readonly count: number }[];
}

export function addClassStartItems(inventory: InvSlot[], classDef: StarterItemClass): void {
  for (const it of classDef.startItems) {
    inventory.push({ itemId: it.itemId, count: it.count });
  }
}
