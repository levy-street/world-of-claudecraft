// Join-time rule for the worn mount skin (src/sim/content/mount_skins.ts).
//
// The worn skin is CHARACTER state (PlayerMeta.mountSkinId, persisted in the
// character save) while ownership is ACCOUNT state (AccountCosmetics.mountSkinIds,
// the rollback-safe account_mount_cosmetics row). A save can therefore name a
// skin the account does not own at the moment of join: a revoked entitlement,
// a dev grant made on another realm, or an older binary's mirror that never
// carried the row. Ownership is never inferred from the save (the reverse of
// the worn mech chroma reconcile, which heals ownership from the worn body
// because chromas were once item-borne); the unowned skin simply comes off.
//
// Pure and DOM-free so the decision is unit-testable without a GameServer.
import { isMountSkinId } from '../src/sim/content/mount_skins';
import type { AccountCosmetics } from '../src/world_api';

/** Whether a character may keep wearing `mountSkinId` given the account's
 *  ownership. No skin worn is always allowed. A skin the catalog no longer
 *  carries (RETIRED_MOUNT_SKIN_IDS, or any id from a newer binary) comes off
 *  whatever the ownership row says: the row keeps the grant as dormant data,
 *  the character just stops wearing something the game no longer has. */
export function wornMountSkinAllowed(
  cosmetics: Pick<AccountCosmetics, 'mountSkinIds'>,
  mountSkinId: string | null | undefined,
): boolean {
  if (!mountSkinId) return true;
  if (!isMountSkinId(mountSkinId)) return false;
  // Nullish-tolerant like account_cosmetics_live.ts: an older narrower shape
  // handed over at runtime reads as owning nothing, never as a throw at join.
  return (cosmetics.mountSkinIds ?? []).includes(mountSkinId);
}
