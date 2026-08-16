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
  // Z-key sheathe toggle: held weapons render stowed on the back (cosmetic; the
  // sim clears it on any deliberate combat action, WoW-style).
  toggleWeaponStow(): void;
  // Paperdoll eye toggle: render the composed body without its kit's head piece.
  // A standing wardrobe preference that rides the entity wire (`hh`) so peers
  // and portraits present the chosen look, and persists per character through
  // the sim's own save. Explicit boolean, not a toggle, so it is idempotent.
  setHelmHidden(hidden: boolean): void;
  // Buy one character-redesign credit from the Stylist for gold, priced by the
  // buyer's level band (src/sim/content/redesign_pricing.ts). Server-
  // authoritative: the Sim re-validates NPC identity, range, liveness, the credit
  // cap, and funds, then charges and increments in one tick. The credit is spent
  // later at character select, not here, so there is no success payload; failure
  // arrives as the usual vendor error toast.
  buyRedesignCredit(npcId: number): void;
}
