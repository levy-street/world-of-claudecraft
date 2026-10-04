// Neutralize a Graveyard Shift run's opening (run_opening.ts) for a test whose
// subject is something else: drop the pack fighting the party and the
// cleared-room corpses, and put the party back to waiting. Call it right after
// the shift starts, before any tick, so the run behaves as it did before the
// opening existed (the party waits until Morthen comes close or lands a hit).
import type { GraveyardShiftRun } from '../../src/sim/graveyard_shift';
import { GRAVEYARD_SHIFT_ALLY_TEMPLATE } from '../../src/sim/graveyard_shift/run_allies';
import { instanceOriginOf } from '../../src/sim/instances/dungeons';
import type { Sim } from '../../src/sim/sim';

// A point down the nave from the throne within SAY_RANGE of every party spot
// and past the notice radius of each: what the arrival point was to the party
// before the opening moved it into the next room.
export const EARSHOT_OF_THE_PARTY = { x: 0, z: 78 } as const;

/** Stand Morthen within earshot of the whole party, unseen by it. */
export function placeMorthenInEarshot(sim: Sim, run: GraveyardShiftRun): void {
  const origin = instanceOriginOf(run.slot);
  const p = sim.player;
  p.pos = sim.ctx.groundPos(origin.x + EARSHOT_OF_THE_PARTY.x, origin.z + EARSHOT_OF_THE_PARTY.z);
  p.prevPos = { ...p.pos };
  sim.ctx.rebucket(p);
}

export function clearGraveyardShiftOpening(sim: Sim, run: GraveyardShiftRun): void {
  const drop = (id: number) => sim.ctx.dropEntity(id);
  for (let i = run.allyIds.length - 1; i >= 0; i--) {
    const ally = sim.entities.get(run.allyIds[i]);
    if (ally?.templateId === GRAVEYARD_SHIFT_ALLY_TEMPLATE) continue;
    if (ally) drop(ally.id);
    run.allyIds.splice(i, 1);
  }
  for (const id of run.corpseIds) if (sim.entities.has(id)) drop(id);
  run.corpseIds.length = 0;
  run.engaged = false;
  run.noticed = false;
}
