// The WOC Store's two inspect overlays (the Armory's weapon-skin panel and
// the Machine Stable's mount-skin panel) built over the window's seams. The
// window keeps the overlay instances and their open/close lifecycle (the
// Armory lifecycle is pinned by tests/armory_preview_lifecycle.test.ts); this
// module states, once, WHAT each overlay reads and does, so the window is a
// thin consumer and the wiring is unit-tested against a fake world.
//
// One appearance rule serves both rigs: the player's real in-world look, body
// and both hands, wearing the Armory skin the world renders on the mainhand.

import type { PreviewAppearance } from '../render/characters/preview_appearance';
import { resolveActiveWeaponSkin } from '../sim/content/weapon_skin_rules';
import type { PlayerClass, WeaponSkinType } from '../sim/types';
import type { IWorld } from '../world_api';
import type { ArmoryInspectDeps } from './armory_inspect';
import type { MountInspectDeps } from './mount_inspect_controller';
import { mountInspectRow } from './mount_inspect_view';
import type { StoreSpendControllers } from './store_spend_controllers';
import type { ArmorySkinRow } from './woc_store_view';

/** The subset of IWorld the two previews read. */
export type StoreInspectWorld = Pick<
  IWorld,
  'player' | 'accountCosmetics' | 'ownedMounts' | 'changeMountSkin' | 'changeWeaponSkin'
>;

export function storePreviewAppearance(world: StoreInspectWorld): PreviewAppearance {
  const player = world.player;
  return {
    cls: player.templateId as PlayerClass,
    skin: player.skin,
    skinCatalog: player.skinCatalog,
    mainhandItemId: player.mainhandItemId,
    offhandItemId: player.offhandItemId ?? null,
    weaponSkinId: resolveActiveWeaponSkin(
      player.templateId,
      player.mainhandItemId,
      world.accountCosmetics.weaponSkinLoadout,
      player.skinCatalog ?? 'class',
    ),
  };
}

export interface StoreInspectSeams {
  world(): StoreInspectWorld;
  spend: StoreSpendControllers;
}

export interface ArmoryInspectSeams extends StoreInspectSeams {
  /** Re-project + repaint after an optimistic apply/detach (the window's). */
  afterArmoryChange(skinId: string): void;
  /** The skin the open Armory panel shows, for the detach refresh. */
  openArmorySkinId(): string | null;
}

export function armoryInspectDeps(seams: ArmoryInspectSeams): ArmoryInspectDeps {
  return {
    appearance: () => storePreviewAppearance(seams.world()),
    requestBuy: (target: ArmorySkinRow) => seams.spend.armory.request(target),
    applySkin: (skinId) => {
      seams.world().changeWeaponSkin(skinId);
      seams.afterArmoryChange(skinId);
    },
    detachSkin: (weaponType: WeaponSkinType) => {
      seams.world().changeWeaponSkin(null, weaponType);
      const open = seams.openArmorySkinId();
      if (open) seams.afterArmoryChange(open);
    },
  };
}

/** The mount panel's row unions the store's last snapshot (price, when the
 *  store has fetched one) with the account mirror and the acting character,
 *  so the same overlay serves the store card and the Cosmetics window. */
export function mountInspectDeps(seams: StoreInspectSeams): MountInspectDeps {
  return {
    appearance: () => storePreviewAppearance(seams.world()),
    row: (skinId) => {
      const world = seams.world();
      return mountInspectRow(skinId, seams.spend.mounts.rowById(skinId), {
        ownedMountSkinIds: world.accountCosmetics.mountSkinIds,
        wornMountSkinId: world.player.mountSkinId ?? null,
        ownsAnyMount: world.ownedMounts().length > 0,
      });
    },
    requestBuy: (skinId) => seams.spend.mounts.request(skinId),
    wear: (skinId) => seams.world().changeMountSkin(skinId),
    takeOff: () => seams.world().changeMountSkin(null),
  };
}
