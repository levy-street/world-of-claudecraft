// Shared-world Rift race state. Runtime dungeon state remains in one independent
// RiftInstance per group; this module owns only the atomic first-clear claim on
// the common RiftEvent. Sim ticks are single-threaded, so the check+write below
// is one indivisible authoritative operation inside a realm process.

import type { SimContext } from '../sim_context';
import type { RiftEvent, RiftInstance } from './types';

export interface RiftFirstClearClaim {
  won: boolean;
  event: RiftEvent | null;
}

export function markRiftEventActive(ctx: SimContext, eventId: string | null): RiftEvent | null {
  if (eventId === null) return null;
  const event = ctx.riftEvents.find((candidate) => candidate.eventId === eventId) ?? null;
  if (event?.status === 'open') event.status = 'active';
  return event;
}

export function claimRiftFirstClear(
  ctx: SimContext,
  inst: RiftInstance,
  memberIds: readonly number[],
): RiftFirstClearClaim {
  // Dev portals are deliberately outside the global race. Their existing
  // lifecycle still completes normally, but they never create a world winner.
  if (inst.eventId === null) return { won: true, event: null };

  const event = ctx.riftEvents.find((candidate) => candidate.eventId === inst.eventId) ?? null;
  if (!event || (event.status !== 'open' && event.status !== 'active')) {
    return { won: false, event };
  }

  const uniqueIds = [...new Set(memberIds)];
  const memberNames = uniqueIds
    .map((pid) => ctx.players.get(pid)?.name)
    .filter((name): name is string => typeof name === 'string');
  event.status = 'cleared';
  event.firstClear = {
    partyKey: inst.partyKey ?? `instance:${inst.instanceId}`,
    memberIds: uniqueIds,
    memberNames,
    duration: Math.max(0, ctx.time - inst.startedAt),
    clearedAt: ctx.time,
  };
  return { won: true, event };
}
