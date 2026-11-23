// The entity wire's player presence bits, moved out of the GameServer
// coordinator (monolith ratchet): what every nearby client paints on a
// player's nameplate and target frame. The decode side is
// src/net/entity_presence_wire.ts. Each key is written only when set, so an
// ordinary player's record stays byte-identical to before the key existed.
import type { Entity } from '../src/sim/types';

export function writeEntityPresenceBits(out: Record<string, unknown>, e: Entity): void {
  if (e.afk) out.ak = 1; // /afk display bit: other clients tag the nameplate + presence dot
  if (e.pvpFlag) out.pvp = 1; // /pvp flag bit: nameplate + target-frame hostility colour
  // King of the Hill bounty (src/sim/pvp/hill_bounty.ts): the Honor this player
  // is worth while a kill streak lifts it, for the nameplate + target-frame tag.
  // NOT `hb`: that key is the $WOC holder balance on the identity record, and
  // the full record joins identity and dynamic fields into one object.
  if (e.hillBounty) out.hbn = e.hillBounty;
}
