// A Sim entity id belongs to one connection, not a character. Keep the live
// rift roster keyed to current entities while remembering stable identities for
// vault entrants, so reconnecting cannot create a phantom extra participant.

import { VAULT_GUEST_PAYOUTS_PER_CYCLE } from '../content/treasure_maps';
import { mountOwned } from '../mounts';
import type { SimContext } from '../sim_context';
import { VAULT_MOUNT_KEY } from '../treasure_vault';
import type { Entity } from '../types';
import type { RiftInstance } from './types';

/** Replace a departed entrant's pid before run matching and head-count scaling. */
export function rebindVaultEntrant(ctx: SimContext, portal: Entity | null, pid: number): void {
  const characterId = ctx.players.get(pid)?.characterId;
  if (portal?.vaultOwnerCharacterId === undefined || characterId === undefined) return;
  for (const inst of ctx.riftInstances) {
    const vault = inst.vault;
    if (
      !vault ||
      vault.ownerCharacterId !== portal.vaultOwnerCharacterId ||
      inst.portalId !== portal.id ||
      inst.seed !== portal.riftSeed ||
      inst.partyKey === null
    )
      continue;
    const identities = vault.memberCharacterIds;
    if (!identities) continue;
    for (const [previousPid, previousCharacterId] of identities) {
      if (previousCharacterId !== characterId || previousPid === pid) continue;
      identities.delete(previousPid);
      identities.set(pid, characterId);
      inst.memberIds.delete(previousPid);
      inst.memberIds.add(pid);
      const chest = vault.chest;
      if (chest) {
        chest.eligible = chest.eligible.map((candidate) =>
          candidate === previousPid ? pid : candidate,
        );
        chest.claimed = chest.claimed.map((candidate) =>
          candidate === previousPid ? pid : candidate,
        );
      }
      if (vault.ownerCharacterId === characterId) vault.ownerPid = pid;
      break;
    }
  }
  if (portal.vaultOwnerCharacterId === characterId) portal.vaultOwnerPid = pid;
}

/** Record a newly admitted entrant only after the run has been selected. */
export function rememberVaultEntrant(ctx: SimContext, inst: RiftInstance, pid: number): void {
  const characterId = ctx.players.get(pid)?.characterId;
  if (inst.vault?.memberCharacterIds && characterId !== undefined) {
    inst.vault.memberCharacterIds.set(pid, characterId);
    if (!inst.vault.entrantSnapshots) inst.vault.entrantSnapshots = new Map();
    const snapshots = inst.vault.entrantSnapshots;
    const capture = (entrantPid: number): void => {
      const meta = ctx.players.get(entrantPid);
      const player = ctx.entities.get(entrantPid);
      if (!meta || !player || meta.characterId === undefined || snapshots.has(meta.characterId))
        return;
      snapshots.set(meta.characterId, {
        characterId: meta.characterId,
        name: meta.name,
        cls: meta.cls,
        level: player.level,
        mountOwned: mountOwned(meta, VAULT_MOUNT_KEY),
        guestCapped:
          meta.vaultGuestCycle === meta.worldQuestCycle &&
          (meta.vaultGuestPayouts ?? 0) >= VAULT_GUEST_PAYOUTS_PER_CYCLE,
        guestCycle: meta.worldQuestCycle,
      });
    };
    capture(pid);
    // The map owner is entitled even if a guest is first through the portal.
    const owner = [...ctx.players.values()].find(
      (meta) => meta.characterId === inst.vault?.ownerCharacterId,
    );
    if (owner) capture(owner.entityId);
  }
}
