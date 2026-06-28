// Direct unit test of the moved lockpick controller (I2b): drives
// src/sim/delves/lockpick_controller.ts behind the SimContext seam (calling its
// EXPORTED functions with sim.ctx, like the I1 dungeons / E1 roster module tests),
// proving the session state machine is usable independently of the Sim facade
// delegates. Setup (enter delve, kill the boss, spawn the reward chest) uses the Sim
// facade; every lockpick OPERATION under test goes through the module directly.

import { describe, expect, it } from 'vitest';
import { DELVES } from '../src/sim/data';
import * as lockpick from '../src/sim/delves/lockpick_controller';
import { solveLockActions } from '../src/sim/lockpick';
import { Sim } from '../src/sim/sim';
import { terrainHeight } from '../src/sim/world';

const makeSim = (seed = 42) => new Sim({ seed, playerClass: 'warrior', autoEquip: true });

/** Boot the Collapsed Reliquary finale, kill the boss, stand the player on the
 * reward chest. Returns the run + chestId. Pins bountiful=false unless asked. */
function setup(sim: Sim, opts: { bountiful?: boolean } = {}): { run: any; chestId: number } {
  sim.setPlayerLevel(DELVES.collapsed_reliquary.minLevel);
  const door = DELVES.collapsed_reliquary.doorPos;
  sim.player.pos.x = door.x;
  sim.player.pos.z = door.z;
  sim.player.pos.y = terrainHeight(door.x, door.z, sim.cfg.seed);
  sim.player.prevPos = { ...sim.player.pos };
  sim.enterDelve('collapsed_reliquary', 'normal');
  const run = sim.delveRunForPlayer(sim.playerId)!;
  run.bountiful = opts.bountiful ?? false;
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

/** Solve every page of the active lock back-to-back THROUGH the controller. */
function solve(sim: Sim, run: { lockpick: any }): void {
  let guard = 0;
  while (run.lockpick && run.lockpick.state === 'IN_PROGRESS' && guard++ < 12) {
    const actions = solveLockActions(run.lockpick.pages[run.lockpick.pageIndex])!;
    for (const a of actions) lockpick.lockpickAction(sim.ctx, a);
  }
}

describe('lockpick controller (I2b module), engage', () => {
  it('engage at ante 1 builds a premium 3-page session and emits a fogged lockpickSession', () => {
    const sim = makeSim();
    const { run, chestId } = setup(sim);

    lockpick.lockpickEngage(sim.ctx, chestId, 1);
    expect(run.lockpick).not.toBeNull();
    expect(run.lockpick.lootTier).toBe('premium');
    expect(run.lockpick.pages.length).toBe(3); // premium = 3-page gauntlet
    expect(run.lockpick.triesTotal).toBe(1); // hard: one try

    const sess = sim.tick().find((e) => e.type === 'lockpickSession') as any;
    expect(sess).toBeDefined();
    expect(sess.pageCount).toBe(3);
    expect(sess.lootTier).toBe('premium');
    // Only the fog window is ever serialized (never the full board).
    const win = run.lockpick.pages[0].tier.visibilityWindow;
    for (const cell of sess.visible) expect(cell.col).toBeLessThanOrEqual(sess.col + win);
  });

  it('rejects an invalid ante (no session created)', () => {
    const sim = makeSim();
    const { run, chestId } = setup(sim);
    lockpick.lockpickEngage(sim.ctx, chestId, 5 as any);
    expect(run.lockpick).toBeNull();
  });
});

describe('lockpick controller (I2b module), success', () => {
  it('a flawless premium solve across page boundaries claims loot, marks, and opens the exit', () => {
    const sim = makeSim();
    const { run, chestId } = setup(sim);
    const marksBefore = sim.delveMarksFor(sim.playerId);

    lockpick.lockpickEngage(sim.ctx, chestId, 1);
    expect(run.lockpick.pages.length).toBe(3);
    solve(sim, run); // walks all 3 pages via lockpick.lockpickAction(sim.ctx, ...)

    expect(run.lockpick).toBeNull();
    const st = run.objectState[chestId];
    expect(st.looted).toBe(true);
    expect(st.lootedTier).toBe('premium');
    expect(st.lootOwnerId).toBe(sim.playerId); // picker owns the loot (no front-run)
    expect(st.pendingLoot.length).toBeGreaterThan(0);
    expect(run.surfaceExitId).not.toBeNull(); // exit opened on success
    expect(sim.delveMarksFor(sim.playerId)).toBeGreaterThan(marksBefore); // bonus marks granted

    const events = sim.tick();
    expect(
      events.find((e) => e.type === 'delveChestLoot' && (e as any).chestId === chestId),
    ).toBeDefined();
    expect(
      events.find((e) => e.type === 'lockpickEnd' && (e as any).outcome === 'success'),
    ).toBeDefined();
    expect(events.find((e) => e.type === 'lockpickBonus')).toBeDefined();
  });

  it('lockpickViewFor returns the fogged projection the lockpickState accessor delegates to', () => {
    const sim = makeSim();
    const { run, chestId } = setup(sim);
    lockpick.lockpickEngage(sim.ctx, chestId, 1);

    const view = lockpick.lockpickViewFor(sim.ctx, sim.playerId);
    expect(view).not.toBeNull();
    expect(view!.sessionId).toBe(run.lockpick.sessionId);
    expect(view!.pageCount).toBe(3);
    // The Sim accessor delegates to the same module fn -> identical projection.
    expect(sim.lockpickState).toEqual(view);
    const win = run.lockpick.pages[0].tier.visibilityWindow;
    for (const cell of view!.visible) expect(cell.col).toBeLessThanOrEqual(view!.col + win);
  });
});

describe('lockpick controller (I2b module), fail / abandon', () => {
  it('tickLockpickTimeout burns the single premium try -> chest jams + surface exit opens', () => {
    const sim = makeSim(7);
    const { run, chestId } = setup(sim);
    lockpick.lockpickEngage(sim.ctx, chestId, 1); // premium: one try
    expect(run.lockpick.state).toBe('IN_PROGRESS');

    // Force the per-step deadline due, then run the controller clock directly.
    run.lockpick.stepDeadlineTick = 0;
    lockpick.tickLockpickTimeout(sim.ctx, run);

    expect(run.lockpick).toBeNull();
    expect(run.objectState[chestId].attemptAvailable).toBe(false); // jammed (lost until re-clear)
    expect(run.objectState[chestId].looted).toBeFalsy();
    expect(run.surfaceExitId).not.toBeNull(); // the party is never stranded
    expect(
      sim.tick().find((e) => e.type === 'lockpickEnd' && (e as any).outcome === 'fail'),
    ).toBeDefined();
  });

  it('abandonLockpick (leave/disconnect teardown) PRESERVES the attempt (re-pickable)', () => {
    const sim = makeSim();
    const { run, chestId } = setup(sim);
    lockpick.lockpickEngage(sim.ctx, chestId, 1);
    expect(run.lockpick).not.toBeNull();

    lockpick.abandonLockpick(sim.ctx, run);
    expect(run.lockpick).toBeNull();
    expect(run.objectState[chestId].attemptAvailable).toBe(true); // unlike a fail, preserved
    expect(
      sim.tick().find((e) => e.type === 'lockpickEnd' && (e as any).outcome === 'abandoned'),
    ).toBeDefined();

    // Re-engage is allowed (attempt preserved).
    lockpick.lockpickEngage(sim.ctx, chestId, 2);
    expect(run.lockpick.lootTier).toBe('medium');
  });

  it('lockpickAbort (player-initiated) abandons the attempt, preserving the chest', () => {
    const sim = makeSim();
    const { run, chestId } = setup(sim);
    lockpick.lockpickEngage(sim.ctx, chestId, 1);
    const sid = run.lockpick.sessionId;
    lockpick.lockpickAbort(sim.ctx, sim.playerId, sid);
    expect(run.lockpick).toBeNull();
    expect(run.objectState[chestId].attemptAvailable).toBe(true);
  });
});

describe('lockpick controller (I2b module), guards', () => {
  it('rejects an action when there is no active session', () => {
    const sim = makeSim();
    setup(sim);
    lockpick.lockpickAction(sim.ctx, 'set', sim.playerId);
    expect(
      sim
        .tick()
        .find((e) => e.type === 'error' && (e as any).text === 'No lock attempt in progress.'),
    ).toBeDefined();
  });

  it('rejects a stale sessionId without touching the live session', () => {
    const sim = makeSim();
    const { run, chestId } = setup(sim);
    lockpick.lockpickEngage(sim.ctx, chestId, 1);
    const sid = run.lockpick.sessionId;
    const col = run.lockpick.col;
    lockpick.lockpickAction(sim.ctx, 'set', sim.playerId, 'lp_stale_999');
    expect(run.lockpick.sessionId).toBe(sid); // unchanged: rejected
    expect(run.lockpick.state).toBe('IN_PROGRESS');
    expect(run.lockpick.col).toBe(col);
  });

  it('§7.6 Bountiful Coffer: only ante 1 (heroic) is accepted; antes 2 and 3 are rejected', () => {
    const sim = makeSim();
    const { run, chestId } = setup(sim, { bountiful: true });
    lockpick.lockpickEngage(sim.ctx, chestId, 2);
    expect(run.lockpick).toBeNull();
    lockpick.lockpickEngage(sim.ctx, chestId, 3);
    expect(run.lockpick).toBeNull();
    // Ante 1 opens it (heroic preset, premium loot tier).
    lockpick.lockpickEngage(sim.ctx, chestId, 1);
    expect(run.lockpick).not.toBeNull();
    expect(run.lockpick.lootTier).toBe('premium');
  });
});
