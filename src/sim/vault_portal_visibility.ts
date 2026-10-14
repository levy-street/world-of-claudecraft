import type { Entity } from './types';

export interface VaultPortalPartyInfo {
  members: readonly { pid: number }[];
}

/** Client-side visibility for private treasure-vault portals.
 *  The server remains authoritative for entry; this mirrors the visible affordance
 *  so owners and eligible guests can see the portal they are allowed to enter. */
export function vaultPortalVisible(
  entity: Pick<Entity, 'vaultOwnerPid' | 'vaultOwnerCharacterId' | 'vaultInitialPartyCharacterIds'>,
  playerId: number | undefined,
  partyInfo?: VaultPortalPartyInfo | null,
  viewerCharacterId?: number,
): boolean {
  const ownerPid = entity.vaultOwnerPid;
  if (ownerPid === undefined) return true;
  if (playerId === undefined) return false;
  if (ownerPid === playerId) return true;

  const ownerCharacterId = entity.vaultOwnerCharacterId;
  if (ownerCharacterId !== undefined && viewerCharacterId === ownerCharacterId) return true;
  if (
    viewerCharacterId !== undefined &&
    entity.vaultInitialPartyCharacterIds?.includes(viewerCharacterId)
  )
    return true;

  if (partyInfo?.members.some((member) => member.pid === ownerPid)) return true;
  return false;
}
