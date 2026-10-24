// The decode side of server/entity_status_wire.ts: the per-entity display
// status bits on a player's dynamic record. The dynamic record is re-sent whole
// in every full or lite record, so an absent key decodes to unset (never "keep
// the prior value"). Keep the keys byte-identical on both sides.
import type { Entity } from '../sim/types';

// biome-ignore lint/suspicious/noExplicitAny: mirrors online.ts's own LooseJson wire-record idiom
export function applyEntityStatusWire(e: Entity, w: any): void {
  e.afk = !!w.ak; // /afk display bit: drives the nameplate tag + social presence dot
  e.pvpFlag = !!w.pvp; // /pvp flag bit: nameplate + target-frame hostility colour
  e.bounty = !!w.bty; // World PvP bounty bit: the blood-red name tag
}
