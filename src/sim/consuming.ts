// The one Consuming builder (Masterwrought 11c, ruling 11c-A2-BUILDER): turns
// a food or drink def into the record the eating/drinking slot holds. Both
// real writers route through it: src/sim/items.ts useItem's food/drink arm
// and src/sim/professions/feast.ts's bite (whose old hand-built copy of the
// items.ts construction silently dropped the wellFed carry, so the feast
// restored health and minted nothing). Two hand-built copies of one shape is
// a defect CLASS, not one missing line: a third writer would forget the field
// again, so the shape is built in exactly one place.
//
// A pure leaf (no SimContext, no rng, no clock): a Vitest imports it
// directly. The TWO deliberate non-writers are the dev-scenario zero-rate
// meals in src/sim/sim.ts ('dev_cascade_freeze', 'dev_sandbox_freeze'): they
// have no item def, exist only to trip the natural-regen freeze, must never
// mint a buff, and hold a sentinel `remaining`, so they hand-build their
// records and stay OUT of this builder by design (named in the 11c ledger).

import {
  CONSUME_DURATION,
  CONSUME_TICKS,
  type Consuming,
  type TimedStatBuffPayload,
} from './types';

/** The def facts the builder reads; FoodItemDef and every drink def satisfy
 *  it structurally, so the module stays a leaf with no ItemDef union import.
 *  `kind` is a separate argument because the two callers know it differently:
 *  useItem's arm narrows the def's own discriminant, while the feast bite
 *  serves its dish as a meal by contract (the dish IS food; the bite has
 *  always hardcoded the slot kind). */
export interface ConsumableDefFacts {
  id: string;
  foodHp?: number;
  drinkMana?: number;
  wellFed?: TimedStatBuffPayload;
}

/** Build the Consuming record for one sit-down: per-2s rates off
 *  CONSUME_TICKS, the full CONSUME_DURATION clock, and the wellFed carry.
 *  The payload rides the MEAL rather than being re-read from the catalog at
 *  completion, so the grant is decided by what was eaten; it is a REFERENCE
 *  to the def's record, not a copy (house style, same as `def.elixir`):
 *  read-only by every consumer. The kind guard on the carry is the D15
 *  food-only contract enforced at the one build site: only FoodItemDef can
 *  spell wellFed (types beat guards), and even a drink-shaped caller could
 *  not smuggle a payload into gulp completion through here. */
export function buildConsuming(kind: 'food' | 'drink', def: ConsumableDefFacts): Consuming {
  return {
    itemId: def.id,
    kind,
    hpPer2s: def.foodHp ? Math.round(def.foodHp / CONSUME_TICKS) : 0,
    manaPer2s: def.drinkMana ? Math.round(def.drinkMana / CONSUME_TICKS) : 0,
    remaining: CONSUME_DURATION,
    ticksElapsed: 0,
    ...(kind === 'food' && def.wellFed ? { wellFed: def.wellFed } : {}),
  };
}
