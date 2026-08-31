// Strongbox storage SKUs: the Claudium-purchasable bank-capacity catalog, the
// storage twin of src/sim/content/weapon_skins.ts. The economy service is
// authoritative for price and availability; these ids double as the service
// SKU item id (kind 'storage') and must stay in lockstep with the service
// catalog (Bank Storage phase 10). Each entry carries the id, the slot grant,
// and, for a single-rung SKU, the ladder index it purchases, and NOTHING
// else: no price, no display name, no store copy. Display names are t() keys
// (phase 12) and prices live only in the service catalog, exactly the
// weapon-skin philosophy. Pinned by tests/storage_charters.test.ts.
//
// Grants are whole rungs of the gold ladder (BANK_EXPANSION_SLOTS = 6):
// a rung SKU grants one rung, and the four charter bundles grant 2, 4, 8,
// and 12 rungs. The server sells a rung SKU only when it is the acting
// character's NEXT unpurchased rung, and any SKU only when the FULL grant
// still fits under the purchasable ceiling (12 rungs, 72 slots); the one
// enforcement point is bankGrantStorageSlots (src/sim/bank.ts).

export interface StorageSkuDef {
  /** The service catalog item id (kind 'storage'); also the registry key. */
  id: string;
  /** Slots this SKU grants, always a whole number of 6-slot ladder rungs. */
  grantSlots: number;
  /** Single-rung SKUs only: the BANK_EXPANSION_PRICES index this rung
   *  purchases (0-based), what the next-rung gate compares against the
   *  character's ladder position. Absent on the charter bundles. */
  ladderIndex?: number;
}

export const STORAGE_SKUS: Record<string, StorageSkuDef> = {
  strongbox_charter_1: { id: 'strongbox_charter_1', grantSlots: 12 },
  strongbox_charter_2: { id: 'strongbox_charter_2', grantSlots: 24 },
  strongbox_charter_3: { id: 'strongbox_charter_3', grantSlots: 48 },
  strongbox_charter_complete: { id: 'strongbox_charter_complete', grantSlots: 72 },
  strongbox_rung_01: { id: 'strongbox_rung_01', grantSlots: 6, ladderIndex: 0 },
  strongbox_rung_02: { id: 'strongbox_rung_02', grantSlots: 6, ladderIndex: 1 },
  strongbox_rung_03: { id: 'strongbox_rung_03', grantSlots: 6, ladderIndex: 2 },
  strongbox_rung_04: { id: 'strongbox_rung_04', grantSlots: 6, ladderIndex: 3 },
  strongbox_rung_05: { id: 'strongbox_rung_05', grantSlots: 6, ladderIndex: 4 },
  strongbox_rung_06: { id: 'strongbox_rung_06', grantSlots: 6, ladderIndex: 5 },
  strongbox_rung_07: { id: 'strongbox_rung_07', grantSlots: 6, ladderIndex: 6 },
  strongbox_rung_08: { id: 'strongbox_rung_08', grantSlots: 6, ladderIndex: 7 },
  strongbox_rung_09: { id: 'strongbox_rung_09', grantSlots: 6, ladderIndex: 8 },
  strongbox_rung_10: { id: 'strongbox_rung_10', grantSlots: 6, ladderIndex: 9 },
  strongbox_rung_11: { id: 'strongbox_rung_11', grantSlots: 6, ladderIndex: 10 },
  strongbox_rung_12: { id: 'strongbox_rung_12', grantSlots: 6, ladderIndex: 11 },
};

export const STORAGE_SKU_LIST: readonly StorageSkuDef[] = Object.values(STORAGE_SKUS);

/** The game-side allowlist gate: the service can never mint a storage SKU the
 *  registry does not carry (the isKnownWeaponSkinId pattern). */
export function isKnownStorageSkuId(itemId: string): boolean {
  return Object.hasOwn(STORAGE_SKUS, itemId);
}

/** The single-rung SKU that buys ladder index `ladderIndex`, or undefined when
 *  no rung sits there (a ladder position past the last rung, which is what a
 *  fully purchased ladder reads as).
 *
 *  This is the REGISTRY answer to "which SKU is the next rung", and it exists
 *  so no surface has to spell a `strongbox_rung_NN` literal to name one. The
 *  caller supplies the index, which keeps this file free of the ladder
 *  constants it deliberately carries no copy of: the one derivation of an
 *  index from a slot count is `Math.floor(purchasedSlots / BANK_EXPANSION_SLOTS)`,
 *  the same expression the server's own next-rung join uses
 *  (nextRungClaudiumPriceFor in server/storage_store_cache.ts). The bundles are
 *  invisible here by construction: they carry no ladderIndex at all, which is
 *  the exact complement of the filter the store category uses to keep rungs out
 *  of its grid. */
export function storageRungSkuForLadderIndex(ladderIndex: number): StorageSkuDef | undefined {
  return STORAGE_SKU_LIST.find((sku) => sku.ladderIndex === ladderIndex);
}
