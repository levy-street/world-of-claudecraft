import { DUNGEON_X_THRESHOLD, ZONES, zoneAt } from '../src/sim/data';
import type { Entity } from '../src/sim/types';

export const MOB_ZONE_PHASE_PREFIX = 'sim.mob.z:';
const MOB_ZONE_PHASE_INSTANCE = `${MOB_ZONE_PHASE_PREFIX}instance`;
const MOB_ZONE_PHASE_OTHER = `${MOB_ZONE_PHASE_PREFIX}other`;
const MOB_ZONE_PHASE_BY_ID = new Map<string, string>(
  ZONES.map((zone) => [zone.id, `${MOB_ZONE_PHASE_PREFIX}${zone.id}`]),
);

export const SIM_MOB_ZONE_PHASES = [
  ...ZONES.map((zone) => `${MOB_ZONE_PHASE_PREFIX}${zone.id}`),
  MOB_ZONE_PHASE_INSTANCE,
  MOB_ZONE_PHASE_OTHER,
];

/** Returns the pre-interned profiler bucket for one mob's current zone. */
export function mobZonePhase(mob: Entity): string {
  if (mob.pos.x > DUNGEON_X_THRESHOLD) return MOB_ZONE_PHASE_INSTANCE;
  return MOB_ZONE_PHASE_BY_ID.get(zoneAt(mob.pos.x, mob.pos.z).id) ?? MOB_ZONE_PHASE_OTHER;
}
