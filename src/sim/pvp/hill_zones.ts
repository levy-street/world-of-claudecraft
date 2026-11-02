// Hill locations are independent of the ordinary zone PvP policy.
import { ZONES } from '../data';
import type { ZoneDef } from '../types';

// The Quartered Isle joined as the fourth: when the draw picks it, the hill
// always rises in its Challengers' Ring (ZoneDef.hillArena).
export const HILL_ZONE_IDS = ['drakelands', 'frostveil', 'amberfall', 'quartered_isle'] as const;

export function hillZones(): ZoneDef[] {
  return ZONES.filter((zone) => HILL_ZONE_IDS.some((id) => id === zone.id));
}
