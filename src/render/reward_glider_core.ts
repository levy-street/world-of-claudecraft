import type { Entity } from '../sim/types';

/** The aura's replicated value latches takeoff; client movement fields are not mirrored. */
export function rewardGliderVisible(entity: Pick<Entity, 'kind' | 'dead' | 'auras'>): boolean {
  return (
    entity.kind === 'player' &&
    !entity.dead &&
    entity.auras.some(
      (aura) => aura.id === 'rift_feather_glider' && aura.remaining > 0 && aura.value > 0,
    )
  );
}
