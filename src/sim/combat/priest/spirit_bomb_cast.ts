import type { SimContext } from '../../sim_context';
import type { AbilityDef, Entity } from '../../types';
import { SPIRIT_BOMB_ID, SPIRIT_BOMB_REQUIRED_GENERATION, spiritBombProgress } from './spirit_bomb';
import { spiritBombBlockedByRaidPull } from './spirit_bomb_raid';

/** Rechecked at admission and completion so a pull cannot leave an armed cast. */
export function spiritBombCastError(
  ctx: SimContext,
  priest: Entity,
  target: Entity | null,
  ability: AbilityDef,
): string | null {
  if (ability.id !== SPIRIT_BOMB_ID) return null;
  const blast = ability.effects.find((effect) => effect.type === 'aoeDamage');
  if (
    !target ||
    spiritBombProgress(priest) < SPIRIT_BOMB_REQUIRED_GENERATION ||
    !blast ||
    spiritBombBlockedByRaidPull(ctx, priest, target, blast.radius)
  )
    return 'That ability is not ready yet.';
  return null;
}
