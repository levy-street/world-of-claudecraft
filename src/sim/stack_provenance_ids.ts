// Source accounting is broader than storage taxonomy. Consumables may mix
// makers, but never gain access to material-only bags, vaults or journals.
import { ITEMS } from './data';
import { readonlySetView } from './material_derivation';
import { materialItemIds } from './material_ids';
import type { ItemKind } from './types';

const CONSUMABLE_KINDS: ReadonlySet<ItemKind> = new Set([
  'food',
  'drink',
  'potion',
  'elixir',
  'flask',
  'scroll',
]);
const PROVENANCE_IDS = readonlySetView([
  ...materialItemIds(),
  ...Object.values(ITEMS)
    .filter((item) => CONSUMABLE_KINDS.has(item.kind) && (item.stackSize ?? 20) > 1)
    .map((item) => item.id),
]);

export function stackProvenanceItemIds(): ReadonlySet<string> {
  return PROVENANCE_IDS;
}

export function isStackProvenanceItemId(itemId: string): boolean {
  return PROVENANCE_IDS.has(itemId);
}
