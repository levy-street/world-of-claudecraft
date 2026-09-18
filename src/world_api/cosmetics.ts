import type { SkinCatalog, WeaponSkinType } from '../sim/types';

export interface AccountCosmetics {
  completedQuestIds: string[];
  mechChromaIds: string[];
  // Season 1 Armory weapon skins: account-wide ownership (economy-service grants
  // mirrored into accounts.cosmetics) and the applied-skin-per-weapon-type
  // loadout. Both are account state: every character on the account shares them.
  weaponSkinIds: string[];
  weaponSkinLoadout: Record<string, string>;
  // Mount skins (src/sim/content/mount_skins.ts): account-wide ownership,
  // mirrored from the economy service's grant ledger. The WORN skin is per
  // character (Entity.mountSkinId), not account state, so it is not here.
  mountSkinIds: string[];
  // Founder Pack full-body skin entitlements (The Founder Salesman,
  // sim/content/founder_pack.ts): account-wide ownership of a
  // FULL_BODY_SKIN_CATALOGS id, granted on claim. Every character on the
  // account may wear an owned one via changeSkin; the mech-chroma precedent.
  // Optional (unlike the fields above) so the many existing AccountCosmetics
  // fixtures across the test suite predating this feature stay valid; every
  // reader defaults absent to the empty/unclaimed state.
  founderSkinIds?: string[];
  // The Founder Pack tier this account has claimed, ever (null/absent =
  // none). The WHOLE pack (mounts, bag, title, Claudium credit) is a single
  // lifetime claim per account; only the skin-pick sub-reward repeats,
  // budgeted by the claimed tier's allowance (3/6/9) against
  // founderSkinIds.length.
  founderPackTier?: 'uncommon' | 'rare' | 'epic' | null;
  // Local placeholder credit only (this game server has no authority to mint
  // the real Claudium balance, which lives in the external economy service).
  founderPackClaudium?: number;
}

export interface IWorldCosmetics {
  accountCosmetics: AccountCosmetics;
  // catalog is 'class'/'mech' (unrestricted) or a founder skin id, gated on
  // accountCosmetics.founderSkinIds ownership (server-enforced; the offline
  // Sim enforces the same ownership check locally).
  changeSkin(skin: number, catalog?: SkinCatalog): void;
  // Lock in a skin from the cosmetic skin-select event overlay. The server
  // re-validates the choice against the rank it rolled (skinEvent) and consumes
  // the event token; the offline Sim resolves it directly.
  claimEventSkin(skin: number): void;
  unequipMechChroma(chromaId: string): void;
  // Apply (skinId) or detach (null + weaponType) a purchased weapon skin. The
  // server enforces account ownership and the equipped-weapon-type match; the
  // offline Sim enforces the type match only (the paid store is online-only).
  changeWeaponSkin(skinId: string | null, weaponType?: WeaponSkinType): void;
  // Wear (skinId) or take off (null) a mount skin on THIS character. The server
  // enforces account ownership (accountCosmetics.mountSkinIds); the offline Sim
  // gates on its own mirror. Cosmetic only: the ridden mount keeps its stats.
  changeMountSkin(skinId: string | null): void;
  // Z-key sheathe toggle: held weapons render stowed on the back (cosmetic; the
  // sim clears it on any deliberate combat action, WoW-style).
  toggleWeaponStow(): void;
  // Paperdoll eye toggle: render the composed body without its kit's head piece.
  // A standing wardrobe preference that rides the entity wire (`hh`) so peers
  // and portraits present the chosen look, and persists per character through
  // the sim's own save. Explicit boolean, not a toggle, so it is idempotent.
  setHelmHidden(hidden: boolean): void;
  // The Founder Salesman's one-time, wallet-gated whole-pack claim (mounts,
  // bag item, title, Claudium credit, epic-only Golden Aura). Online only:
  // the real $WOC balance check needs a linked wallet and the server's own
  // RPC credential, so the offline Sim always refuses. mountPicks must match
  // the tier's mountPicks count exactly, from FOUNDER_PACK_MOUNT_PICKS.
  claimFounderPack(tier: string, mountPicks: readonly string[]): void;
  // One skin pick from FOUNDER_SKIN_CATALOG, repeatable up to the claimed
  // tier's skinPicks budget; refused if the account has not claimed a tier,
  // the class does not match, or the budget is spent. Online only, same
  // reason as claimFounderPack (the claim is gated on having claimed a tier
  // for real, which only the server's persisted account state can answer).
  claimFounderSkin(catalog: string): void;
}
