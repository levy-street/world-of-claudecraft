// The per-entity display status bits every nearby client reads off a player's
// dynamic record: /afk (`ak`), the World PvP flag (`pvp`) and the World PvP
// bounty (`bty`). Each rides only while set, so an entity without one
// serializes exactly as before the bit existed, and the dynamic record is
// re-sent whole, so an absent key means unset. Written into dynamicFields
// (server/game.ts); src/net/entity_status_wire.ts is the decode side. Keep the
// keys byte-identical on both sides.
import type { Entity } from '../src/sim/types';
import { writeEntityPresenceBits } from './entity_presence_wire';

/** Every key this emitter may write, for the unit pin. */
export const ENTITY_STATUS_KEYS = ['ak', 'pvp', 'bty', 'hbn'] as const;

export function writeEntityStatusWire(e: Entity, out: Record<string, unknown>): void {
  writeEntityPresenceBits(out, e);
  if (e.bounty) out.bty = 1; // World PvP bounty bit: the blood-red name tag
}
