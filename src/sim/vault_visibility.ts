import { mayRecoverHoardCorpse } from './rift/hoard_party';
import type { SimContext } from './sim_context';
import type { Entity } from './types';

/** Current party only. Prior admission/reward entitlement does not grant visibility. */
export function vaultPortalVisible(
  portal: Pick<Entity, 'vaultOwnerPid' | 'vaultOwnerCharacterId'>,
  viewerPid: number,
  party: readonly (number | { pid: number })[] | null,
  characterIdFor?: (pid: number) => number | undefined,
): boolean {
  if (portal.vaultOwnerPid === undefined) return true;
  const isOwner = (pid: number): boolean =>
    portal.vaultOwnerCharacterId !== undefined && characterIdFor
      ? characterIdFor(pid) === portal.vaultOwnerCharacterId
      : pid === portal.vaultOwnerPid;
  return (
    isOwner(viewerPid) ||
    (party?.some((member) => isOwner(typeof member === 'number' ? member : member.pid)) ?? false)
  );
}

/** Live admission also preserves an already-bound ghost's corpse-recovery route. */
export function vaultPortalVisibleToPlayer(ctx: SimContext, portal: Entity, pid: number): boolean {
  return (
    vaultPortalVisible(
      portal,
      pid,
      ctx.partyOf(pid)?.members ?? null,
      (id) => ctx.players.get(id)?.characterId,
    ) || mayRecoverHoardCorpse(ctx, portal, pid)
  );
}
