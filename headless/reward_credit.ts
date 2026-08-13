import type { Entity, SimEvent } from '../src/sim/types';

/** Damage dealt by controlled mobs that the player's own session counter excludes. */
export function ownedPetDamageForReward(
  events: readonly SimEvent[],
  entities: ReadonlyMap<number, Entity>,
  ownerId: number,
): number {
  let total = 0;
  for (const event of events) {
    if (event.type !== 'damage' || event.kind !== 'hit' || event.amount <= 0) continue;
    const source = entities.get(event.sourceId);
    if (source?.kind === 'mob' && source.ownerId === ownerId) total += event.amount;
  }
  return total;
}
