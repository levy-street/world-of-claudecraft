import type { Entity } from '../sim/types';

export function isVisuallyDead(
  e: Pick<Entity, 'dead' | 'hp'> & Partial<Pick<Entity, 'auras'>>,
): boolean {
  return e.dead || e.hp <= 0 || e.auras?.some((aura) => aura.kind === 'feign_death') === true;
}
