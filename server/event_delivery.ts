import { SERVER_ONLY_SIM_EVENT_TYPES } from '../src/sim/economy_events';
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
  // Server-only output never reaches a client socket. The economy audit row
  // rides the personal event path so it carries attribution, but no client
  // decodes it and shipping it would spend player bandwidth on operator data.
  // The check belongs HERE rather than at the routeEvents call site: this is
  // the module that owns 'may this viewer see this event', and putting it in
  // the loop would grow server/game.ts, which the monolith ratchet forbids.
  if (SERVER_ONLY_SIM_EVENT_TYPES.has(ev.type)) return false;
  if (ev.type === 'damage')
    return isViewerCombatParticipant(ev.sourceId, ev.targetId, viewerPid, viewerParty, ownerOf);
  if (ev.type === 'heal2')
    return isViewerCombatParticipant(ev.sourceId, ev.targetId, viewerPid, viewerParty, ownerOf);
  return true;
}
