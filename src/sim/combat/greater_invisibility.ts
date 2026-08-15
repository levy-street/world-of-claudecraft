// Greater Invisibility's damage reduction is an aftereffect, not part of the
// vanish itself. The stealth aura carries its configured reduction in value2
// and its aftereffect duration in value3 so every normal removal path can apply
// the same authoritative result without a parallel timer or per-frame work.

import type { SimContext } from '../sim_context';
import type { Aura, Entity } from '../types';

const GREATER_INVISIBILITY_ID = 'greater_invisibility';

// The aftereffect's aura id. Exported because the recast path clears an
// outstanding aftereffect before re-entering the vanish, and spelling the id
// there too would let a rename split the two silently: the cleanup would stop
// finding the aura and a reset-assisted recast would carry the old reduction in.
export const GREATER_INVISIBILITY_DR_AURA_ID = `${GREATER_INVISIBILITY_ID}_dr`;

export function applyGreaterInvisibilityAftereffect(
  ctx: SimContext,
  target: Entity,
  removedAura: Aura,
): void {
  if (target.dead || removedAura.id !== GREATER_INVISIBILITY_ID || removedAura.kind !== 'stealth') {
    return;
  }
  const reduction = removedAura.value2 ?? 0;
  const duration = removedAura.value3 ?? 0;
  if (reduction <= 0 || duration <= 0) return;

  ctx.applyAura(target, {
    id: GREATER_INVISIBILITY_DR_AURA_ID,
    name: removedAura.name,
    kind: 'buff_dr',
    remaining: duration,
    duration,
    value: reduction,
    sourceId: removedAura.sourceId,
    school: removedAura.school,
  });
}
