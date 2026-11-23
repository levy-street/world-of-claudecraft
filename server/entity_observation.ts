import type { Sim } from '../src/sim/sim';
import { stealthDetectionRadius } from '../src/sim/threat';
import type { Entity } from '../src/sim/types';
import { vaultPortalVisibleToPlayer } from '../src/sim/vault_visibility';
import { INTEREST_RADIUS, isStealthed } from './interest_policy';

function inViewerGroup(sim: Sim, viewer: Entity, entity: Entity): boolean {
  // A raid is the same Party record with `raid` set, so one roster covers both,
  // and a battleground team is welded into one (formBgTeamParty).
  return sim.partyOf(viewer.id)?.members.includes(entity.id) ?? false;
}

/** Viewer-specific admission, re-evaluated even for already-known entities. */
export function canObserveEntity(sim: Sim, viewer: Entity, entity: Entity, d2: number): boolean {
  if (entity.vaultOwnerPid !== undefined && !vaultPortalVisibleToPlayer(sim.ctx, entity, viewer.id))
    return false;
  if (entity.kind !== 'player') return true;
  // A released spirit is seen only by its own party or raid, everywhere: a
  // ghost cannot be attacked, so a stranger's ghost is a free scout. Other
  // ghosts still see it (the classic graveyard crowd): one spirit learns
  // nothing about the living from another. The body before release stays
  // visible to everyone.
  if (entity.ghost && !viewer.ghost && !inViewerGroup(sim, viewer, entity)) return false;
  if (!isStealthed(entity)) return true;
  if (sim.isHostileTo(viewer, entity)) return false;
  const sameParty = inViewerGroup(sim, viewer, entity);
  const duel = sim.duelFor(viewer.id);
  const duelingEachOther = duel !== null && (duel.a === entity.id || duel.b === entity.id);
  if (sameParty && !duelingEachOther) return true;
  // isHostileTo is false for every dead viewer, so without this a corpse or a
  // ghost would fall through to the friendly detection radius below and see
  // stealthed enemies a living enemy never sees.
  if (viewer.dead) return false;
  const radius = stealthDetectionRadius(viewer, entity, INTEREST_RADIUS);
  return d2 <= radius * radius;
}
