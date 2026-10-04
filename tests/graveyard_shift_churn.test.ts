// Shift after shift on one realm: every way a run ends (an abort, a dev win
// through the Staff Exit, a grave loss with Tibbs' consolation, a leaver) hands
// back every player, entity, book entry and the Crypt slot it took, so a
// long-lived server never accumulates what its runs leave behind.
import { describe, expect, it } from 'vitest';
import { CORPSE_RETURN_TICKS } from '../src/sim/graveyard_shift/corpse_run';
import { GRAVE_ENTITY_ID, TIBBS_IDLE_SECONDS } from '../src/sim/graveyard_shift/grave_entry';
import {
  graveyardShiftResolveLeave,
  startGraveyardShift,
} from '../src/sim/graveyard_shift/run_lifecycle';
import { graveyardShiftRunFor, isGraveyardShiftRunKey } from '../src/sim/graveyard_shift/run_state';
import { LOSS_OUTRO_TICKS } from '../src/sim/graveyard_shift/shift_end_marks';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { TICK_RATE } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

function realm() {
  const sim = new Sim({
    seed: 42,
    playerClass: 'warrior',
    devCommands: true,
    offlineHost: true,
    world: EMPTY_TEST_WORLD,
  });
  sim.setPlayerLevel(15);
  sim.ctx.players.get(sim.playerId)!.deedsEarned.set('dgn_hollow_crypt', '2026-10-01');
  return sim;
}

function ticks(sim: Sim, n: number) {
  for (let i = 0; i < n; i++) sim.tick();
}

function census(sim: Sim) {
  const book = sim.ctx.graveyardShiftRuns;
  return {
    players: sim.ctx.players.size,
    entities: sim.entities.size,
    runs: book.size,
    tibbs: book.tibbs.size,
    botPids: book.botPids.size,
    claimedSlots: sim.ctx.instances.filter((i) => isGraveyardShiftRunKey(i.partyKey)).length,
  };
}

function lethal(sim: Sim, source: Entity | null, target: Entity) {
  (sim as any).dealDamage(source, target, target.maxHp + 50, false, 'shadow', null, 'hit', true);
}

function start(sim: Sim, entry: 'dev' | 'grave') {
  expect(startGraveyardShift(sim.ctx, sim.playerId, entry)).toBeNull();
  const run = graveyardShiftRunFor(sim.ctx, sim.playerId)!;
  ticks(sim, 20);
  expect(census(sim).botPids).toBe(5);
  expect(census(sim).claimedSlots).toBe(1);
  return run;
}

describe('Graveyard Shift churn', () => {
  it('several shifts back to back leave the realm as they found it', () => {
    const sim = realm();
    sim.tick();
    expect(sim.entities.has(GRAVE_ENTITY_ID)).toBe(true);
    const baseline = census(sim);
    expect(baseline).toMatchObject({ runs: 0, tibbs: 0, botPids: 0, claimedSlots: 0 });

    // An abort.
    let run = start(sim, 'dev');
    run.pendingOutcome = 'aborted';
    ticks(sim, 2);
    expect(census(sim)).toEqual(baseline);

    // A dev win, out through the Staff Exit.
    run = start(sim, 'dev');
    for (const b of run.bots) lethal(sim, sim.player, sim.entities.get(b.pid)!);
    ticks(sim, CORPSE_RETURN_TICKS + 1);
    for (const b of run.bots) lethal(sim, sim.player, sim.entities.get(b.pid)!);
    sim.tick();
    expect(run.outro?.kind).toBe('won');
    const exit = sim.entities.get(run.outro!.portalId!)!;
    sim.player.pos = { ...exit.pos };
    sim.player.prevPos = { ...exit.pos };
    sim.ctx.rebucket(sim.player);
    ticks(sim, 2);
    expect(graveyardShiftRunFor(sim.ctx, sim.playerId)).toBeNull();
    expect(census(sim)).toEqual(baseline);

    // A grave loss: Tibbs rises with his consolation, then goes back down.
    run = start(sim, 'grave');
    lethal(sim, null, sim.player);
    ticks(sim, LOSS_OUTRO_TICKS + 2);
    expect(graveyardShiftRunFor(sim.ctx, sim.playerId)).toBeNull();
    expect(census(sim).tibbs).toBe(1);
    ticks(sim, TIBBS_IDLE_SECONDS * TICK_RATE + 2);
    expect(census(sim)).toEqual(baseline);

    // A leaver mid-fight, then a grave abort.
    start(sim, 'grave');
    graveyardShiftResolveLeave(sim.ctx, sim.playerId);
    ticks(sim, 2);
    expect(census(sim)).toEqual(baseline);
    run = start(sim, 'grave');
    run.pendingOutcome = 'aborted';
    ticks(sim, 2);
    expect(census(sim)).toEqual(baseline);
  });
});
