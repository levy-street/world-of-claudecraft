// Active hoards follow their summoner's current party. Finished reward rosters
// are immutable so party changes cannot rewrite an outcome awaiting persistence.
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import type { RiftInstance } from './types';

export function hoardOwnerPid(
  ctx: SimContext,
  ownerPid: number,
  ownerCharacterId?: number,
): number | undefined {
  if (ownerCharacterId === undefined) return ctx.players.has(ownerPid) ? ownerPid : undefined;
  return [...ctx.players.values()].find((meta) => meta.characterId === ownerCharacterId)?.entityId;
}

/** Corpse recovery retains the run's identity; combat is checked by enterRift. */
export function mayRecoverHoardCorpse(ctx: SimContext, portal: Entity, pid: number): boolean {
  if (!ctx.entities.get(pid)?.dead) return false;
  const characterId = ctx.players.get(pid)?.characterId;
  return ctx.riftInstances.some(
    (inst) =>
      inst.partyKey !== null &&
      inst.portalId === portal.id &&
      inst.seed === portal.riftSeed &&
      inst.vault?.ownerCharacterId === portal.vaultOwnerCharacterId &&
      inst.vault?.attemptId === portal.vaultAttemptId &&
      (inst.memberIds.has(pid) ||
        (characterId !== undefined &&
          [...(inst.vault?.memberCharacterIds?.values() ?? [])].includes(characterId))),
  );
}

/** Reclaim departed guests' slots before admission and before freezing rewards. */
export function reconcileHoardParty(
  ctx: SimContext,
  inst: RiftInstance,
  evict: (pid: number) => void,
  entrantPid?: number,
): void {
  const vault = inst.vault;
  if (!vault || inst.outcome !== 'active') return;
  const owner = hoardOwnerPid(ctx, vault.ownerPid, vault.ownerCharacterId);
  // A disconnected owner cannot admit guests. The existing group can still
  // finish and retain its bounded reward roster while the owner is offline.
  if (owner === undefined) return;
  vault.ownerPid = owner;
  const allowed = new Set(ctx.partyOf(owner)?.members ?? [owner]);
  allowed.add(owner);
  const onlineCharacters = new Set([...ctx.players.values()].map((meta) => meta.characterId));
  const offline = (pid: number): boolean => {
    const characterId = vault.memberCharacterIds?.get(pid);
    return characterId === undefined ? !ctx.players.has(pid) : !onlineCharacters.has(characterId);
  };
  const forget = (pid: number, removeClaim = false): void => {
    evict(pid);
    const characterId = vault.memberCharacterIds?.get(pid);
    inst.memberIds.delete(pid);
    vault.memberCharacterIds?.delete(pid);
    if (removeClaim && characterId !== undefined) vault.entrantSnapshots?.delete(characterId);
  };
  for (const pid of inst.memberIds) {
    if (allowed.has(pid) || offline(pid)) continue;
    forget(pid);
  }
  const characters = new Set([...allowed].map((pid) => ctx.players.get(pid)?.characterId));
  if (vault.ownerCharacterId !== undefined) characters.add(vault.ownerCharacterId);
  for (const id of vault.entrantSnapshots?.keys() ?? []) {
    if (!characters.has(id) && onlineCharacters.has(id)) vault.entrantSnapshots?.delete(id);
  }
  // A disconnect alone does not forfeit a claim. Release only slots actually
  // needed by a new entrant; reentry and clear retain offline guests.
  if (entrantPid === undefined) return;
  const entrantCharacterId = ctx.players.get(entrantPid)?.characterId;
  for (const pid of inst.memberIds) {
    if (!hoardRosterFull(inst, entrantPid, entrantCharacterId)) break;
    if (
      pid !== owner &&
      (vault.ownerCharacterId === undefined ||
        vault.memberCharacterIds?.get(pid) !== vault.ownerCharacterId) &&
      offline(pid)
    )
      forget(pid, true);
  }
}

/** The owner always occupies one of the five reward slots, even outside the room. */
export function hoardRosterFull(inst: RiftInstance, pid: number, characterId?: number): boolean {
  const vault = inst.vault;
  if (
    !vault ||
    inst.memberIds.has(pid) ||
    pid === vault.ownerPid ||
    (characterId !== undefined &&
      (characterId === vault.ownerCharacterId || vault.entrantSnapshots?.has(characterId)))
  )
    return false;
  const members = inst.memberIds.size + (inst.memberIds.has(vault.ownerPid) ? 0 : 1);
  return Math.max(members, vault.entrantSnapshots?.size ?? 0) >= 5;
}
