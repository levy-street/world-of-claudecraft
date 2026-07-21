import type { Entity } from '../sim/types';

export function isVisuallyDead(e: Pick<Entity, 'dead' | 'hp'>): boolean {
  return e.dead || e.hp <= 0;
}
