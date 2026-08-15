import type { Entity } from '../types';

export const VALKYRS_CALLING_FLIGHT_AURA_ID = 'valkyrs_calling_flight';

export function isValkyrsCallingAirborne(entity: Entity): boolean {
  return entity.valkyrsCalling != null;
}

export function hasValkyrsCallingFlightAura(entity: Pick<Entity, 'auras'>): boolean {
  return entity.auras.some((aura) => aura.id === VALKYRS_CALLING_FLIGHT_AURA_ID);
}
