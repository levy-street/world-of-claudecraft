import type { WeaponSkinType } from '../sim/types';

export interface AccountCosmetics {
  completedQuestIds: string[];
  mechChromaIds: string[];
  // Season 1 Armory weapon skins: account-wide ownership (economy-service grants
  // mirrored into accounts.cosmetics) and the applied-skin-per-weapon-type
  // loadout. Both are account state: every character on the account shares them.
  weaponSkinIds: string[];
  weaponSkinLoadout: Record<string, string>;
}

export interface IWorldCosmetics {
  accountCosmetics: AccountCosmetics;
  changeSkin(skin: number, catalog?: 'class' | 'mech'): void;
  // Lock in a skin from the cosmetic skin-select event overlay. The server
  // re-validates the choice against the rank it rolled (skinEvent) and consumes
  // the event token; the offline Sim resolves it directly.
  claimEventSkin(skin: number): void;
  unequipMechChroma(chromaId: string): void;
  // Apply (skinId) or detach (null + weaponType) a purchased weapon skin. The
  // server enforces account ownership and the equipped-weapon-type match; the
  // offline Sim enforces the type match only (the paid store is online-only).
  changeWeaponSkin(skinId: string | null, weaponType?: WeaponSkinType): void;
}
