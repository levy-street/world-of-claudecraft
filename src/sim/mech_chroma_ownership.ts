import type { AccountCosmetics } from '../world_api';
import { mechChromaForSkin, mechChromaSkinIndex } from './content/skins';
import type { ItemInstancePayload, ItemUseResult, SkinCatalog } from './types';

export function wornMechChromaId(catalog: SkinCatalog | undefined, skin: number): string | null {
  if (catalog !== 'mech') return null;
  return mechChromaForSkin(skin)?.id ?? null;
}

export function accountCosmeticsWithWornMechChroma(
  cosmetics: AccountCosmetics,
  catalog: SkinCatalog | undefined,
  skin: number,
): AccountCosmetics {
  const chromaId = wornMechChromaId(catalog, skin);
  if (!chromaId || cosmetics.mechChromaIds.includes(chromaId)) return cosmetics;
  return { ...cosmetics, mechChromaIds: [...cosmetics.mechChromaIds, chromaId] };
}

/** The Sim surface the ownership mutations touch; Sim satisfies it structurally
 *  (every member is public on Sim). Moved out of sim.ts under the monolith
 *  ratchet beside the pure worn-chroma helpers above. */
export interface MechChromaOwnershipHost {
  accountCosmetics: AccountCosmetics;
  countItem(itemId: string, pid?: number): number;
  removeItem(
    itemId: string,
    count: number,
    pid?: number,
  ): readonly (ItemInstancePayload | undefined)[];
  setPlayerSkin(pid: number, skin: number, catalog?: SkinCatalog): boolean;
}

/** `onSpent` receives the removed plate's payloads, so the caller can write
 *  the spent copy's ledger row (cosmetic_token_spend.ts useMechChromaPlate). */
export function unlockMechChromaFromItem(
  host: MechChromaOwnershipHost,
  owner: { entityId: number },
  itemId: string,
  chromaId: string,
  onSpent?: (spent: readonly (ItemInstancePayload | undefined)[]) => void,
): ItemUseResult | undefined {
  const skin = mechChromaSkinIndex(chromaId);
  if (skin < 0) return undefined;
  if (host.countItem(itemId, owner.entityId) <= 0) return undefined;
  const spent = host.removeItem(itemId, 1, owner.entityId);
  onSpent?.(spent);
  const mechChromaIds = host.accountCosmetics.mechChromaIds.includes(chromaId)
    ? host.accountCosmetics.mechChromaIds
    : [...host.accountCosmetics.mechChromaIds, chromaId];
  host.accountCosmetics = { ...host.accountCosmetics, mechChromaIds };
  host.setPlayerSkin(owner.entityId, skin, 'mech');
  return { type: 'mechChroma', chromaId };
}

/** Take the mech chroma off the resolved player's own current appearance,
 *  reverting to the class body. The account-wide unlock
 *  (accountCosmetics.mechChromaIds) is permanent, exactly like a purchased
 *  Season 1 Armory weapon skin: this only changes what is CURRENTLY
 *  displayed, never revokes ownership, so any character on the account can
 *  freely re-select it later via changeSkin with no item involved. */
export function unequipWornMechChroma(
  host: MechChromaOwnershipHost,
  meta: { entityId: number; skinCatalog?: SkinCatalog; skin: number },
  chromaId: string,
): boolean {
  const skin = mechChromaSkinIndex(chromaId);
  if (skin < 0) return false;
  if (meta.skinCatalog !== 'mech' || meta.skin !== skin) return false;
  host.setPlayerSkin(meta.entityId, 0, 'class');
  return true;
}
