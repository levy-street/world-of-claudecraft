// Revocable mount looks are a projection of physical character items, never grants.
import { MOUNT_KEYS } from '../src/sim/content/mounts';
import { ITEMS } from '../src/sim/data';

export interface AccountMountItemsRow {
  characterId: number;
  mountSkinIds: string[];
}

const mountsByItem = new Map(
  Object.values(ITEMS).flatMap((def) =>
    def.kind === 'mount' ? [[def.id, def.mount] as const] : [],
  ),
);
export const MOUNT_ITEM_IDS = [...mountsByItem.keys()];

/** Scan only a dirty character's bags and personal bank. Legacy overcapacity
 * containers are accepted by the game, so quiet probes must never scan them. */
export function characterMountSkinIds(meta: {
  inventory: readonly { itemId: string; count: number }[];
  bank: { inventory: readonly { itemId: string; count: number }[] };
}): string[] {
  const found = new Set<string>();
  for (const slots of [meta.inventory, meta.bank.inventory]) {
    for (const slot of slots) {
      const key = mountsByItem.get(slot.itemId);
      if (key && slot.count > 0) found.add(key);
    }
  }
  return MOUNT_KEYS.filter((id) => found.has(id));
}

/** Live characters supersede their own last autosave, including empty bags. */
export function accountMountSkinIds(
  saved: ReadonlyMap<number, readonly string[]>,
  live: ReadonlyMap<number, readonly string[]>,
): string[] {
  const found = new Set<string>();
  for (const [characterId, ids] of saved) {
    if (!live.has(characterId)) for (const id of ids) found.add(id);
  }
  for (const ids of live.values()) for (const id of ids) found.add(id);
  return MOUNT_KEYS.filter((id) => found.has(id));
}
