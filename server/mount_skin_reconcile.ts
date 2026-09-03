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
import type { AccountCosmetics } from '../src/world_api';

/** Whether a character may keep wearing `mountSkinId` given the account's
 *  ownership. No skin worn is always allowed. */
export function wornMountSkinAllowed(
  cosmetics: Pick<AccountCosmetics, 'mountSkinIds'>,
  mountSkinId: string | null | undefined,
): boolean {
  if (!mountSkinId) return true;
  return cosmetics.mountSkinIds.includes(mountSkinId);
}
