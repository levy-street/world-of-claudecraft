import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

export function emitRainOfFireStop(ctx: SimContext, caster: Entity): boolean {
  if (caster.castingAbility !== 'rain_of_fire') return false;
  const center = caster.castAim ?? caster.pos;
  ctx.emit({
    type: 'spellfxAt',
    x: center.x,
    z: center.z,
    school: 'fire',
    fx: 'felMeteorRainStop',
    duration: 0,
    sourceId: caster.id,
    ability: 'rain_of_fire',
  });
  return true;
}
