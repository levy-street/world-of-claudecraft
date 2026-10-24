import { isGmHidden } from '../gm_presence';
import { isFeigningDeath } from '../threat';
import type { Entity } from '../types';

// Shared admission at Sim.aggroMob's choke point. Keep these checks in order:
// they precede every aggro mutation, quest gate, bark and social propagation.
export function canStartMobAggro(
  entities: ReadonlyMap<number, Entity>,
  mob: Entity,
  target: Entity,
  mobsFrozen: boolean,
): boolean {
  if (
    mob.dead ||
    mob.aiState === 'evade' ||
    mob.aiState === 'chase' ||
    mob.aiState === 'attack' ||
    mob.aiState === 'flee'
  )
    return false;
  // /dev noaggro and Feign Death prevent proximity, social and retaliation pulls.
  if (target.kind === 'player' && (target.devNoAggro || isFeigningDeath(target))) return false;
  if (isGmHidden(entities, target)) return false;
  // /dev freezemobs blocks acquisition as well as the AI update.
  return !mobsFrozen;
}
