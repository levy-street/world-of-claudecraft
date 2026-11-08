// The online client's mirror of the server's worn-mount-skin ownership rule
// (server/mount_skin_reconcile.ts wornMountSkinAllowed): a look is wearable when it is
// a store skin the account bought (mountSkinIds) OR a collectible look whose reins sit
// in any character's bags or personal bank (collectibleMountSkinIds, the host's
// revocable projection). ClientWorld.changeMountSkin uses it to skip sending a request
// the server would refuse; the server still decides.
//
// Pure and DOM-free so tests/mount_skin_ownership_client.test.ts can pin it directly.
import type { AccountCosmetics } from '../world_api';

export function accountOwnsMountSkin(
  cosmetics: Pick<AccountCosmetics, 'mountSkinIds' | 'collectibleMountSkinIds'>,
  skinId: string,
): boolean {
  // Nullish-tolerant like the server rule: an older, narrower shape owns nothing.
  return (
    (cosmetics.mountSkinIds ?? []).includes(skinId) ||
    (cosmetics.collectibleMountSkinIds ?? []).includes(skinId)
  );
}
