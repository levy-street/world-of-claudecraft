// "In town": a position inside a zone's hub settlement circle.
//
// There is no built-out town/crafting-station system; every zone carries a
// `hub` settlement circle (`ZoneDef.hub`: x/z/radius/name, e.g. Eastbrook,
// Fenbridge, Highwatch), the same footprint the world generator flattens into
// a plateau and the road/prop generation treats as town. That hub circle IS
// the town-tag stand-in every "in town" rule uses: a lightweight zone-tag
// check, not a real crafting-station build-out. Pure leaf: no Sim, no
// SimContext, no rng; the caller supplies the position and the zone.

import type { ZoneDef } from './types';

export function isInTownZone(pos: { x: number; z: number }, zone: ZoneDef): boolean {
  const dx = pos.x - zone.hub.x;
  const dz = pos.z - zone.hub.z;
  return dx * dx + dz * dz <= zone.hub.radius * zone.hub.radius;
}
