// Revocable mount looks are a projection of physical character items, never grants.
import { MOUNT_KEYS } from '../src/sim/content/mounts';
import { ITEMS } from '../src/sim/data';

export interface AccountMountItemsRow {
  characterId: number;
  mountSkinIds: string[];
  /** Lossless database update stamp, including the row's transaction version. */
  version?: string;
}

export interface AccountMountItemsRefreshRow {
  characterId: number;
  version?: string;
  /** Missing means unchanged; an empty array authoritatively removes ownership. */
  mountSkinIds?: string[];
}

/** A complete ID manifest with projections only for changed characters. */
export function mergeAccountMountItemsRows(
  saved: Map<number, readonly string[]>,
  versions: Map<number, string>,
  rows: readonly AccountMountItemsRefreshRow[],
): boolean {
  const present = new Set<number>();
  let changed = false;
  for (const row of rows) {
    present.add(row.characterId);
    if (row.mountSkinIds !== undefined) {
      changed ||= (saved.get(row.characterId)?.join(',') ?? '') !== row.mountSkinIds.join(',');
      saved.set(row.characterId, row.mountSkinIds);
    }
    if (row.version !== undefined) versions.set(row.characterId, row.version);
    else versions.delete(row.characterId);
  }
  for (const [id, skins] of saved) {
    if (present.has(id)) continue;
    changed ||= skins.length > 0;
    saved.delete(id);
    versions.delete(id);
  }
  return changed;
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
