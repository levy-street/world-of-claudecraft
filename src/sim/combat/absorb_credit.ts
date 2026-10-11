// Absorb credit: the per-shield "this much damage was soaked, by whose shield"
// event the combat meters and the parse recorder read as healing.
//
// The damage event already reports an aggregate `absorbed` total, but that
// total names no shielder, so a Chronomancer's Temporal Aegis or a priest's
// shield could never appear on the Healing tab. Every soak site in
// combat/damage.ts calls `emitAbsorbCredit` once per shield it drains, with
// the aura's own `sourceId` as the credited healer. Emits nothing for a zero
// soak. Draws no rng and touches no state: `src/sim`-pure.

import type { SimContext } from '../sim_context';
import type { Aura, Entity } from '../types';

export function emitAbsorbCredit(
  ctx: Pick<SimContext, 'emit'>,
  shield: Pick<Aura, 'id' | 'name' | 'sourceId'>,
  target: Pick<Entity, 'id'>,
  soaked: number,
): void {
  if (soaked <= 0) return;
  ctx.emit({
    type: 'absorb',
    sourceId: shield.sourceId,
    targetId: target.id,
    amount: soaked,
    ability: shield.name,
    abilityId: shield.id,
  });
}
