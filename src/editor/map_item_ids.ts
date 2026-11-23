// Permanent ids for the items a change-only push tracks (map_merge_core.ts):
// placements (MapPlacement.uid), terrain stamps (HeightStamp.id) and grass
// clearings (GrassClearCircle.id). An id is minted once and then rides the
// item through saves, publishes and pushes, so two copies of a map can tell
// which items are the same item.
//
// ensureMapItemIds fills in what is missing and splits accidental twins: a
// duplicate or paste copies its source's id, so when two items share one,
// the FIRST (the original, earlier in the list) keeps it and the later copy
// gets a fresh one. Editor-only: ids come from crypto, never the sim's Rng.
//
// ensureMapItemIdsFromContent instead derives a missing id from the item's
// own content. The editor's load-time upgrades (map_load_upgrades.ts) add
// items to a map, and a push re-runs them on the base: content ids make both
// runs name those items alike, so they never read as the maker's own change.

import type { CustomMap } from './custom_map';

/** 12 hex characters (48 bits): a collision inside one map is vanishingly
 *  rare, and ensureMapItemIds splits one if it ever happens. */
export function mintMapItemId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Mints an id for `item`; `attempt` counts up while the result is taken. */
type ItemMint = (item: object, attempt: number) => string;

function ensureIds<T extends object>(
  items: T[] | undefined,
  get: (item: T) => string | undefined,
  set: (item: T, id: string) => void,
  mint: ItemMint,
): number {
  if (!items) return 0;
  // Every id already held counts as taken first, so a minted id can never
  // land on one an item further down the list still carries.
  const held = new Set<string>();
  for (const item of items) {
    const id = get(item);
    if (id) held.add(id);
  }
  const seen = new Set<string>();
  let minted = 0;
  for (const item of items) {
    let id = get(item);
    if (!id || seen.has(id)) {
      let attempt = 0;
      do id = mint(item, attempt++);
      while (seen.has(id) || held.has(id));
      set(item, id);
      minted++;
    }
    seen.add(id);
  }
  return minted;
}

/** FNV-1a over the text, twice with different offsets: 48 bits as 12 hex. */
function contentHash(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x01000193);
  }
  return (
    (a >>> 0).toString(16).padStart(8, '0') + ((b >>> 0) & 0xffff).toString(16).padStart(4, '0')
  );
}

/** A missing id derived from the item's content (its own id field left out),
 *  so the same item minted on two copies of a map gets the same id. */
const contentMint: ItemMint = (item, attempt) => {
  const { uid: _uid, id: _id, ...rest } = item as { uid?: unknown; id?: unknown };
  return contentHash(`${attempt}:${JSON.stringify(rest)}`);
};

/** Give every tracked item a unique permanent id, in place. Returns how many
 *  ids were minted (0 when the map already carries them all). */
export function ensureMapItemIds(map: CustomMap, mint: () => string = mintMapItemId): number {
  return ensureAllIds(map, () => mint());
}

/** ensureMapItemIds with content-derived ids (see the file comment). */
export function ensureMapItemIdsFromContent(map: CustomMap): number {
  return ensureAllIds(map, contentMint);
}

function ensureAllIds(map: CustomMap, mint: ItemMint): number {
  return (
    ensureIds(
      map.placements,
      (p) => p.uid,
      (p, id) => {
        p.uid = id;
      },
      mint,
    ) +
    ensureIds(
      map.terrainEdits,
      (s) => s.id,
      (s, id) => {
        s.id = id;
      },
      mint,
    ) +
    ensureIds(
      map.grassClear,
      (c) => c.id,
      (c, id) => {
        c.id = id;
      },
      mint,
    )
  );
}
