// Store mounts: the mounts sold for Claudium rather than earned in-world.
//
// The item id doubles as the economy SKU id (kind 'item'), mirroring how a
// weapon skin id doubles as its SKU (content/weapon_skins.ts). The external
// economy service stays authoritative for price and availability; this module
// only names WHICH reins the store may sell and the spend endpoint may grant
// (server/claudium.ts widens its whitelist through it). Ownership then flows
// through the ordinary reins-item model (src/sim/mounts.ts mountOwned): the
// grant lands the soulbound reins in the buyer's bags and every existing
// summon / revalidation / wire path applies unchanged.
//
// Sim-pure data: no DOM, no server imports, safe for all three hosts.

/** Reins item ids purchasable with Claudium. Append-only once shipped. */
export const STORE_MOUNT_ITEM_IDS = ['reins_mech_bird'] as const;

export type StoreMountItemId = (typeof STORE_MOUNT_ITEM_IDS)[number];

export function isStoreMountItemId(id: string): id is StoreMountItemId {
  return (STORE_MOUNT_ITEM_IDS as readonly string[]).includes(id);
}
