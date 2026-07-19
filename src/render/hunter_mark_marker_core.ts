import type { Entity } from '../sim/types';

/** Replicated aura state that owns the overhead Hunter's Mark presentation. */
export function hasVisibleHuntersMark(entity: Pick<Entity, 'dead' | 'auras'>): boolean {
  return !entity.dead && entity.auras.some((aura) => aura.kind === 'hunter_mark');
}
