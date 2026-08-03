// Pure decision core for the mobile Mount/Dismount quick-access button (the
// More tray's #mobile-mounts control; wiring lives in src/main.ts, the
// callback contract in src/game/mobile_controls.ts).
//
// Reins are items with no persisted "selected mount" (src/world_api/mounts.ts):
// the shared IWorldMounts.toggleMounted() the desktop/gamepad keybind and this
// same mobile button both call only ever DISMOUNTS or (mid riding lesson) lends
// the training steed. It deliberately never regains a summon path for an owned
// mount (tests/mounts.test.ts pins that: "the toggle does NOT summon"), so a
// single mobile tap that should SUMMON has to go through the reins item itself
// (IWorldInventory.useItem), the same path a bag tap or an action-bar click
// already uses. This module only decides WHICH action a tap should take; the
// caller performs it against the live IWorld. DOM-free, IWorld-free (the caller
// reads the two IWorld values and passes them in).

import type { MountKey } from '../sim/content/mounts';
import { mountItemId } from '../sim/mounts';

export type MobileMountAction =
  // Already riding: dismount via the shared toggleMounted() (unchanged, never gated).
  | { kind: 'dismount' }
  // Unmounted and owns at least one mount: use its reins directly.
  | { kind: 'summon'; itemId: string }
  // Unmounted and owns no mount (or riding is untrained): fall back to the
  // shared toggleMounted(), which preserves today's exact no-op / "must learn
  // to ride" toast for that case.
  | { kind: 'fallback' };

/** Decide what a tap of the mobile Mount/Dismount button should do.
 *  `mountedKey` is the live Entity.mountKey ('' when unmounted). `bagOwned` is
 *  `sim/mounts.ts` `bagOwnedMounts(world.inventory)`'s value, already in
 *  catalog order: BAGS ONLY, deliberately narrower than the wider
 *  `IWorldMounts.ownedMounts()` (bags + bank), because the summon this
 *  decides feeds `IWorldInventory.useItem`, which gates on `Sim.countItem`
 *  (bags-only). Picking from the wider list can hand `useItem` a bank-only
 *  itemId it refuses with "You don't have that item.", or skip past a
 *  bagged mount sorting after a bank-only one (#2739 followup). The first
 *  entry is the deterministic pick when more than one mount is bagged, since
 *  there is no persisted favorite to prefer over another. */
export function mobileMountAction(
  mountedKey: string,
  bagOwned: readonly MountKey[],
): MobileMountAction {
  if (mountedKey) return { kind: 'dismount' };
  const key = bagOwned[0];
  const itemId = key ? mountItemId(key) : null;
  return itemId ? { kind: 'summon', itemId } : { kind: 'fallback' };
}
