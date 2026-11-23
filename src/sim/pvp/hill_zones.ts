// Hill locations are independent of the ordinary zone PvP policy.
import { ZONES } from '../data';
import type { ZoneDef } from '../types';

export const HILL_ZONE_IDS = ['drakelands', 'frostveil', 'amberfall'] as const;

export function hillZones(): ZoneDef[] {
  return ZONES.filter((zone) => HILL_ZONE_IDS.some((id) => id === zone.id));
}
