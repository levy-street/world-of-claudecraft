// Who fights whom in a Graveyard Shift run: the Morthen owner against the run's
// adventurers, both ways; adventurers stay friendly to each other. Pure leaf
// keyed on the two entities' auras, so the sim's isHostileTo and the client's
// hostility readouts (pvp_hostile_core, interactions) apply the same rule.
// Owned mobs resolve to their owner before this is asked.

import type { Aura, Entity } from '../types';
import { hasMorthenIdentity } from './morthen_identity';

export const GSHIFT_ADVENTURER_AURA_ID = 'gshift_adventurer';

export function isGraveyardShiftAdventurer(e: Pick<Entity, 'auras'> | undefined): boolean {
  return e?.auras?.some((a) => a.id === GSHIFT_ADVENTURER_AURA_ID) ?? false;
}

export function graveyardShiftPairHostile(a: Entity, b: Entity): boolean {
  return (
    (hasMorthenIdentity(a) && isGraveyardShiftAdventurer(b)) ||
    (isGraveyardShiftAdventurer(a) && hasMorthenIdentity(b))
  );
}

/** Sim.isHostileTo's player arm: free while no run exists. */
export function shiftPairHostile(
  runs: ReadonlyMap<number, unknown>,
  a: Entity,
  b: Entity,
): boolean {
  return runs.size > 0 && graveyardShiftPairHostile(a, b);
}

// Permanent and undispellable: only the run's teardown removes an adventurer.
export function adventurerMarkerAura(botId: number): Aura {
  return {
    id: GSHIFT_ADVENTURER_AURA_ID,
    name: 'Adventurer',
    kind: 'gshift_adventurer',
    remaining: 0,
    duration: 0,
    permanent: true,
    undispellable: true,
    value: 0,
    sourceId: botId,
    school: 'physical',
  };
}
