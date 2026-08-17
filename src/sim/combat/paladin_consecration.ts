import type { Entity } from '../types';

export const PROTECTION_CONSECRATION_DAMAGE_REDUCTION = 0.1;

type ConsecrationZone = {
  sourceId: number;
  remaining: number;
  radius: number;
  pos: { x: number; z: number };
  consecration?: { protectionDamageReduction?: number };
};

export function protectionConsecrationDamageReduction(
  zones: readonly ConsecrationZone[],
  target: Entity,
): number {
  if (target.kind !== 'player' || target.templateId !== 'paladin') return 0;
  let reduction = 0;
  for (const zone of zones) {
    const value = zone.consecration?.protectionDamageReduction ?? 0;
    if (value <= reduction || zone.sourceId !== target.id || zone.remaining <= 0) continue;
    const dx = target.pos.x - zone.pos.x;
    const dz = target.pos.z - zone.pos.z;
    if (dx * dx + dz * dz <= zone.radius * zone.radius) reduction = value;
  }
  return reduction;
}
