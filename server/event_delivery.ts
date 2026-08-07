import type { SimEvent } from '../src/sim/types';

type CombatEventParty = {
  members: readonly number[];
};

/**
 * Resolve an entity's controller, or null when it has none. The broadcast path
 * supplies a lookup over the live entity map; a miss degrades to the pre-pet
 * behavior rather than throwing inside the per-session fan-out.
 */
export type CombatEventOwnerLookup = (entityId: number) => number | null;

function principalOf(entityId: number, ownerOf: CombatEventOwnerLookup): number {
  return ownerOf(entityId) ?? entityId;
}

function isViewerCombatParticipant(
  sourceId: number,
  targetId: number,
  viewerPid: number,
  viewerParty: CombatEventParty | null,
  ownerOf: CombatEventOwnerLookup,
): boolean {
  const source = principalOf(sourceId, ownerOf);
  const target = principalOf(targetId, ownerOf);
  if (source === viewerPid || target === viewerPid) return true;
  return (
    viewerParty?.members.includes(source) === true || viewerParty?.members.includes(target) === true
  );
}

export function shouldDeliverCombatEventToViewer(
  ev: SimEvent,
  viewerPid: number,
  viewerParty: CombatEventParty | null,
  ownerOf: CombatEventOwnerLookup,
): boolean {
  if (ev.type === 'damage')
    return isViewerCombatParticipant(ev.sourceId, ev.targetId, viewerPid, viewerParty, ownerOf);
  if (ev.type === 'heal2')
    return isViewerCombatParticipant(ev.sourceId, ev.targetId, viewerPid, viewerParty, ownerOf);
  return true;
}
