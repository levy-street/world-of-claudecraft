import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

const DRAIN_LIFE_ID = 'drain_life';

export function startChannelVisual(
  ctx: SimContext,
  caster: Entity,
  target: Entity | null,
  abilityId: string,
  duration: number,
): void {
  if (abilityId !== DRAIN_LIFE_ID || !target) return;
  ctx.emit({
    type: 'spellfx',
    sourceId: caster.id,
    targetId: target.id,
    school: 'shadow',
    fx: 'drainBeam',
    ability: abilityId,
    duration,
  });
}

export function stopChannelVisual(ctx: SimContext, caster: Entity): void {
  if (caster.castingAbility !== DRAIN_LIFE_ID || caster.castTargetId === null) return;
  ctx.emit({
    type: 'spellfx',
    sourceId: caster.id,
    targetId: caster.castTargetId,
    school: 'shadow',
    fx: 'drainBeam',
    ability: DRAIN_LIFE_ID,
    duration: 0,
  });
}
