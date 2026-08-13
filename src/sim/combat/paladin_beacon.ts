import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

export const BEACON_OF_LIGHT_ID = 'beacon_of_light';
export const BEACON_OF_LIGHT_NAME = 'Beacon of Light';
export const BEACON_HEAL_FRACTION = 0.5;
export const BEACON_TRANSFER_RADIUS = 60;

// Re-casting and death own the real lifetime. This large finite timer keeps the
// existing aura wire serializable while remaining permanent for a play session.
export const BEACON_AURA_DURATION = 2_147_483_647;

export function stripBeaconOfLight(ctx: SimContext, paladinId: number): void {
  for (const entity of ctx.entities.values()) {
    for (let index = entity.auras.length - 1; index >= 0; index--) {
      const aura = entity.auras[index];
      if (aura.kind !== 'beacon_of_light' || aura.sourceId !== paladinId) continue;
      entity.auras.splice(index, 1);
      ctx.emit({ type: 'aura', targetId: entity.id, name: aura.name, gained: false });
    }
  }
}

export function placeBeaconOfLight(ctx: SimContext, paladin: Entity, target: Entity): void {
  stripBeaconOfLight(ctx, paladin.id);
  ctx.applyAura(target, {
    id: BEACON_OF_LIGHT_ID,
    name: BEACON_OF_LIGHT_NAME,
    kind: 'beacon_of_light',
    remaining: BEACON_AURA_DURATION,
    duration: BEACON_AURA_DURATION,
    value: BEACON_HEAL_FRACTION,
    sourceId: paladin.id,
    school: 'holy',
  });
}

export function beaconTransferTarget(
  ctx: SimContext,
  source: Entity,
  healedTarget: Entity,
): Entity | null {
  if (
    source.kind !== 'player' ||
    source.templateId !== 'paladin' ||
    source.dead ||
    healedTarget.dead ||
    healedTarget.id === source.id
  ) {
    return null;
  }

  const party = ctx.partyOf(source.id);
  if (!party?.members.includes(healedTarget.id)) return null;

  for (const candidate of ctx.entities.values()) {
    if (
      candidate.id === healedTarget.id ||
      candidate.dead ||
      !party.members.includes(candidate.id) ||
      !candidate.auras.some(
        (aura) => aura.kind === 'beacon_of_light' && aura.sourceId === source.id,
      )
    ) {
      continue;
    }
    const dx = candidate.pos.x - healedTarget.pos.x;
    const dz = candidate.pos.z - healedTarget.pos.z;
    if (dx * dx + dz * dz <= BEACON_TRANSFER_RADIUS * BEACON_TRANSFER_RADIUS) {
      return candidate;
    }
  }
  return null;
}
