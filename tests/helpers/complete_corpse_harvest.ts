// Shared driver for the public corpse-harvest cast (Intentional Gathering,
// PR3): starts a real `sim.harvestCorpse(id, pid)` cast and ticks the real
// sim until it clears, mirroring the TICKS_PER_CAST idiom every reviewed
// corpse-harvest suite already uses (tests/corpse_harvest_cast.test.ts,
// tests/corpse_harvest_command.test.ts). No claim mutation, no clock
// skipping, no bypass of admission or completion: it is a thin wrapper over
// the public command plus the ordinary tick loop.

import { HARVEST_CAST_SECONDS } from '../../src/sim/professions/harvest_admission';
import type { Sim } from '../../src/sim/sim';
import { DT, type SimEvent } from '../../src/sim/types';
import { expectDefined } from './defined';

export const HARVEST_TICKS_PER_CAST = Math.round(HARVEST_CAST_SECONDS / DT);

export interface CompleteCorpseHarvestResult {
  /** The admission result: false means the cast never started and nothing ticked. */
  readonly started: boolean;
  readonly events: SimEvent[];
}

/**
 * Starts a real `harvestCorpse` cast for `pid` on `mobId` and ticks the real
 * sim until the cast clears (completed or cancelled), draining every event
 * along the way. A refused admission (`started: false`) never ticks.
 */
export function completeCorpseHarvest(
  sim: Sim,
  mobId: number,
  pid: number,
  maxTicks = HARVEST_TICKS_PER_CAST + 5,
): CompleteCorpseHarvestResult {
  const started = sim.harvestCorpse(mobId, pid);
  const events: SimEvent[] = [];
  if (!started) return { started, events };
  const actor = expectDefined(sim.entities.get(pid), `player entity ${pid}`);
  for (let i = 0; i < maxTicks && actor.castingAbility; i++) {
    events.push(...sim.tick());
  }
  return { started, events };
}
