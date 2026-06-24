// Bountiful (premium / heroic / 1-try) locks used to "jam without user error":
// the offline HUD cached its own board view and froze behind the sim when events
// were not drained between steps, so the next pick chose the wrong depth and the
// single try was lost. The rewrite removed that cache entirely (the board paints
// from world.lockpickState), so the desync is structurally impossible. These
// tests assert the new contract: picking the correct depth for the AUTHORITATIVE
// column always opens the lock, with or without event draining, and the sim's
// session/timeout guards still reject stale input.

import { describe, expect, it } from 'vitest';
import { DELVES } from '../src/sim/data';
import { solveLockActions } from '../src/sim/lockpick';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

const makeSim = (seed = 42) => new Sim({ seed, playerClass: 'warrior', autoEquip: true });

function enterBountifulFinale(sim: Sim) {
  sim.setPlayerLevel(DELVES.collapsed_reliquary.minLevel);
  const door = DELVES.collapsed_reliquary.doorPos;
  sim.player.pos.x = door.x;
  sim.player.pos.z = door.z;
  sim.player.pos.y = terrainHeight(door.x, door.z, sim.cfg.seed);
  sim.player.prevPos = { ...sim.player.pos };
  sim.enterDelve('collapsed_reliquary', 'normal');
  const run = sim.delveRunForPlayer(sim.playerId)!;
  run.bountiful = true;
  run.modules = ['reliquary_finale'];
  run.moduleIndex = 0;
  (sim as any).spawnDelveModule(run);
  const boss = [...sim.entities.values()].find((e) => e.templateId === 'deacon_varric')!;
  (sim as any).dealDamage(sim.player, boss, boss.maxHp + 1, false, 'physical', null, 'hit', true);
  sim.tick();
  const chestId = run.rewardChestId!;
  const chest = sim.entities.get(chestId)!;
  sim.player.pos = { ...chest.pos };
  sim.player.prevPos = { ...chest.pos };
  return { run, chestId };
}

function drain(sim: Sim): SimEvent[] {
  return sim.drainEvents();
}

function curSpec(run: { lockpick: { pages: any[]; pageIndex: number } | null }) {
  return run.lockpick?.pages[run.lockpick?.pageIndex];
}

describe('Bountiful lockpick, flawless sim path', () => {
  it('solver clears all 3 premium pages without failure (sim API only)', () => {
    const sim = makeSim(42);
    const { run, chestId } = enterBountifulFinale(sim);
    sim.lockpickEngage(chestId, 1);
    drain(sim);

    let guard = 0;
    while (run.lockpick && run.lockpick.state === 'IN_PROGRESS' && guard++ < 80) {
      const actions = solveLockActions(curSpec(run))!;
      sim.lockpickAction(actions[run.lockpick.col]);
      const events = drain(sim);
      const step = events.find((e) => e.type === 'lockpickStep') as any;
      if (step) expect(['advanced', 'pageCleared', 'success']).toContain(step.result);
    }
    expect(run.objectState[chestId].looted).toBe(true);
    expect(run.objectState[chestId].lootedTier).toBe('premium');
    expect(run.lockpick).toBeNull();
  });

  it('HUD-style flow (engage + action + drainEvents each step) succeeds', () => {
    const sim = makeSim(7);
    const { run, chestId } = enterBountifulFinale(sim);
    sim.lockpickEngage(chestId, 1);
    drain(sim);

    let guard = 0;
    while (run.lockpick && run.lockpick.state === 'IN_PROGRESS' && guard++ < 80) {
      sim.lockpickAction(solveLockActions(curSpec(run))![run.lockpick.col]!);
      drain(sim);
    }
    expect(run.objectState[chestId].looted).toBe(true);
  });
});

describe('Bountiful lockpick, the old jam is gone (authoritative-state picking)', () => {
  it('opens every seed when each pick reads the live column, with NO drain', () => {
    // This is the headline regression: previously a frozen HUD column jammed
    // most seeds on the single premium try. Reading sim.lockpickState directly
    // (what the rewritten board does) cannot freeze, so every seed opens.
    const N = 80;
    let opened = 0;
    for (let seed = 0; seed < N; seed++) {
      const sim = makeSim(seed);
      const { run, chestId } = enterBountifulFinale(sim);
      sim.lockpickEngage(chestId, 1);
      let guard = 0;
      while (run.lockpick && run.lockpick.state === 'IN_PROGRESS' && guard++ < 200) {
        const col = sim.lockpickState!.col; // authoritative; never stale
        sim.lockpickAction(solveLockActions(curSpec(run))![col]!);
      }
      if (run.objectState[chestId].looted) opened++;
    }
    expect(opened).toBe(N);
  });

  it('first page (16 cols) seats and rolls onto page 2 without any drain', () => {
    const sim = makeSim(99);
    const { run, chestId } = enterBountifulFinale(sim);
    sim.lockpickEngage(chestId, 1);

    const actions = solveLockActions(curSpec(run))!;
    expect(actions.length).toBe(15);
    for (let i = 0; i < actions.length && run.lockpick?.state === 'IN_PROGRESS'; i++) {
      sim.lockpickAction(actions[sim.lockpickState!.col]!);
    }
    expect(run.lockpick?.col).toBe(0); // pageCleared resets col for page 2
    expect(run.lockpick?.pageIndex).toBe(1);
  });
});

describe('Bountiful lockpick, timeout and session guards', () => {
  it('a sim-enforced step timeout fails the premium (1-try) lock and never re-fires once ended', () => {
    const sim = makeSim(42);
    const { run, chestId } = enterBountifulFinale(sim);
    sim.lockpickEngage(chestId, 1);
    drain(sim);
    // The clock is server-authoritative: force the active step's deadline due and
    // tick. The sim, not the client, burns the single premium try -> jam.
    run.lockpick!.stepDeadlineTick = 0;
    sim.tick();
    expect(run.lockpick).toBeNull();
    expect(run.objectState[chestId].attemptAvailable).toBe(false); // chest jammed
    // No live session: the per-tick guard means no further ticks can re-burn.
    for (let i = 0; i < 5; i++) sim.tick();
    expect(run.objectState[chestId].attemptAvailable).toBe(false);
  });

  it('lockpickAction with stale sessionId is rejected (no double fail)', () => {
    const sim = makeSim(42);
    const { run, chestId } = enterBountifulFinale(sim);
    sim.lockpickEngage(chestId, 1);
    drain(sim);
    const sid = run.lockpick?.sessionId;
    const actions = solveLockActions(curSpec(run))!;
    sim.lockpickAction(actions[0], undefined, 'lp_stale');
    expect(run.lockpick?.col).toBe(0); // no advance
    sim.lockpickAction(actions[0], undefined, sid);
    drain(sim);
    expect(run.lockpick?.col).toBeGreaterThan(0);
  });
});
