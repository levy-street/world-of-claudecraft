import type { Entity } from '../sim/types';

export function characterSoulRendActive(e: Entity): boolean {
  return e.auras.some((a) => a.id === 'nythraxis_soul_rend');
}
