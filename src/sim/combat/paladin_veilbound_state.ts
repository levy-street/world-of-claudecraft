import type { Entity } from '../types';

export const VEILBOUND_MARCH_ID = 'veilbound_march';

export function isVeilboundMarchActive(entity: Entity): boolean {
  return !entity.dead && entity.auras.some((aura) => aura.id === VEILBOUND_MARCH_ID);
}
