import type { ItemDef } from '../../src/sim/types';
import { itemKindLabel } from '../../src/ui/item_kind_label';

// The older item-kind catalog still calls cosmetic companions buddies.
export function wikiItemKind(item: Pick<ItemDef, 'kind' | 'id'>): string {
  if (item.kind === 'buddy') return 'Companion';
  if (item.kind === 'buddy_cosmetic') return 'Companion cosmetic';
  return itemKindLabel(item.kind, item.id);
}
