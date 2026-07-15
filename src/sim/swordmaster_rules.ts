import type { Entity, PlayerClass } from './types';

export const SWORDMASTER_BASE_MOVE_MULT = 1.08;

export function classBaseMoveSpeedMult(entity: Pick<Entity, 'kind' | 'templateId'>): number {
  return entity.kind === 'player' && entity.templateId === 'swordmaster'
    ? SWORDMASTER_BASE_MOVE_MULT
    : 1;
}

export function usesFastGcd(cls: PlayerClass): boolean {
  return cls === 'rogue' || cls === 'swordmaster';
}
