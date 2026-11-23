// Decode of the entity wire's player presence bits (server/entity_presence_wire.ts),
// moved out of the ClientWorld coordinator (monolith ratchet). Every bit is
// sent only while set, so its absence on a record means "off": these are the
// per-record display mirrors, never delta-guarded.
import type { Entity } from '../sim/types';

// biome-ignore lint/suspicious/noExplicitAny: mirrors online.ts's own LooseJson wire-record idiom
export function applyEntityPresenceBits(e: Entity, w: any): void {
  e.afk = !!w.ak; // /afk display bit: drives the nameplate tag + social presence dot
  e.pvpFlag = !!w.pvp; // /pvp flag bit: nameplate + target-frame hostility colour
  // King of the Hill bounty (`hbn`; `hb` is the $WOC holder balance): a positive
  // whole Honor value, or nothing.
  if (typeof w.hbn === 'number' && w.hbn > 0) e.hillBounty = w.hbn;
  else delete e.hillBounty;
}
