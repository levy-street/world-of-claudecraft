import type { SimEvent, Vec3 } from '../src/sim/types';

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

// The live-entity lookup eventAnchor scopes entity-anchored events with; the
// broadcast path supplies the sim's entity map.
export type EventAnchorEntities = ReadonlyMap<number, { pos: Vec3 }>;

// Resolves the world position an event interest-scopes from: entity-anchored
// events follow their entity, world-coordinate events anchor at their own
// point, and anchorless events (chat/log etc) broadcast.
export function eventAnchor(ev: SimEvent, entities: EventAnchorEntities): Vec3 | null {
  let id: number | undefined;
  if ('targetId' in ev && typeof ev.targetId === 'number') id = ev.targetId;
  else if ('entityId' in ev && typeof ev.entityId === 'number') id = ev.entityId;
  if (id !== undefined) return entities.get(id)?.pos ?? null;
  // world-coordinate events (spellfxAt: a ground-targeted impact) anchor at
  // their own point so they interest-scope like entity-anchored fx instead
  // of fanning out server-wide (dist2d ignores y)
  if ('x' in ev && 'z' in ev && typeof ev.x === 'number' && typeof ev.z === 'number') {
    return { x: ev.x, y: 0, z: ev.z };
  }
  return null; // chat/log etc: broadcast
}
