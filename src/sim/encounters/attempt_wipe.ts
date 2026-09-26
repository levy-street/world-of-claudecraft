// The raid-boss wipe rule shared by the scripted encounters (Ignivar, Varkhul):
// an attempt is lost once no PARTICIPANT of that attempt is still alive in the
// room, whoever else happens to be standing there. The encounter roster
// (attemptParticipantIds, recorded every engaged tick) is the authority, not
// "any living player in the room": a raider who zoned in through the inner
// portal in the very tick the last participant died is not part of the fight
// they walked in on, and must not keep the boss engaged at his current health
// (the reported "entered as the last person died, he came at us with no reset").
// The boss resets like any wipe; the entrant then gets a fresh full-health pull.
//
// A roster the snapshot never carried (undefined, older saves) never rules a
// fight lost: the callers' own "nobody alive in the room" arm still applies.
//
// Pure leaf: no SimContext, draws no rng, reads only Entity ids.

import type { Entity } from '../types';

export function attemptLost(
  participantIds: readonly number[] | undefined,
  living: readonly Entity[],
): boolean {
  if (participantIds === undefined) return false;
  for (const player of living) {
    if (!player.dead && participantIds.includes(player.id)) return false;
  }
  return true;
}
