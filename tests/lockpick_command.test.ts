// Lockpicking minigame, server-authoritative sim path (engage/action/abort,
// ante→loot-tier, fog boundary, fail-locks-out, abandon-preserves).

import { describe, expect, it } from 'vitest';
import { DELVES } from '../src/sim/data';
import { solveLockActions, stepLock } from '../src/sim/lockpick';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

const makeSim = (seed = 42) => new Sim({ seed, playerClass: 'warrior', autoEquip: true });

function enterFinale(sim: Sim) {
  sim.setPlayerLevel(DELVES.collapsed_reliquary.minLevel);
  const door = DELVES.collapsed_reliquary.doorPos;
  sim.player.pos.x = door.x;
  sim.player.pos.z = door.z;
  sim.player.pos.y = terrainHeight(door.x, door.z, sim.cfg.seed);
  sim.player.prevPos = { ...sim.player.pos };
  sim.enterDelve('collapsed_reliquary', 'normal');
  const run = sim.delveRunForPlayer(sim.playerId)!;
  // Pin the normal chest: these tests exercise the standard ante/tier/fog flow and
  // must not be turned into a Premium-only Bountiful Coffer by the rare roll
  // (seed 42 rolls Bountiful). See the §7.6 coffer tests in delves.test.ts.
  run.bountiful = false;
  run.modules = ['reliquary_finale'];
  run.moduleIndex = 0;
  (sim as any).spawnDelveModule(run);
  return run;
}

function killBoss(sim: Sim, run: ReturnType<typeof enterFinale>) {
  const boss = [...sim.entities.values()].find((e) => e.templateId === 'deacon_varric')!;
  (sim as any).dealDamage(sim.player, boss, boss.maxHp + 1, false, 'physical', null, 'hit', true);
  sim.tick();
  return run;
}

function standOnChest(sim: Sim, run: ReturnType<typeof enterFinale>) {
  const chestId = run.rewardChestId!;
  const chest = sim.entities.get(chestId)!;
  sim.player.pos = { ...chest.pos };
  sim.player.prevPos = { ...chest.pos };
  return chestId;
}

function flush(sim: Sim): SimEvent[] {
  return sim.tick();
}

/** The lock board the pick is currently on (multi-page locks). */
function curSpec(run: { lockpick: { pages: any[]; pageIndex: number } | null }) {
  return run.lockpick?.pages[run.lockpick?.pageIndex];
}

/** Solve every page of a multi-page lock back-to-back (flawless run). */
function solveLock(sim: Sim, run: { lockpick: any }): void {
  let guard = 0;
  while (run.lockpick && run.lockpick.state === 'IN_PROGRESS' && guard++ < 12) {
    const actions = solveLockActions(run.lockpick.pages[run.lockpick.pageIndex])!;
    for (const a of actions) sim.lockpickAction(a);
  }
}

describe('lockpick, engage + ante→tier', () => {
  it('engage at ante 1 emits a session with full board (normal tier) and premium tier', () => {
    const sim = makeSim();
    const run = enterFinale(sim);
    killBoss(sim, run);
    const chestId = standOnChest(sim, run);

    sim.lockpickEngage(chestId, 1);
    const events = flush(sim);
    const sess = events.find((e) => e.type === 'lockpickSession') as any;
    expect(sess).toBeDefined();
    expect(sess.lootTier).toBe('premium');
    expect(sess.page).toBe(1);
    expect(sess.pageCount).toBe(3); // premium = 3-page gauntlet
    expect(run.lockpick).not.toBeNull();
    expect(run.lockpick?.lootTier).toBe('premium');
    expect(run.lockpick?.pages.length).toBe(3);
  });

  it('rejects an invalid ante', () => {
    const sim = makeSim();
    const run = enterFinale(sim);
    killBoss(sim, run);
    const chestId = standOnChest(sim, run);
    sim.lockpickEngage(chestId, 5 as any);
    expect(run.lockpick).toBeNull();
  });

  it('ante 2 grants medium loot tier on success', () => {
    const sim = makeSim();
    const run = enterFinale(sim);
    killBoss(sim, run);
    const chestId = standOnChest(sim, run);
    const marksBefore = sim.delveMarksFor(sim.playerId);
    sim.lockpickEngage(chestId, 2);
    expect(run.lockpick?.pages.length).toBe(2); // medium = 2 pages
    solveLock(sim, run);
    expect(run.objectState[chestId].lootedTier).toBe('medium');
    // base +1 mark + medium bonus +1
    expect(sim.delveMarksFor(sim.playerId)).toBe(marksBefore + 2);
  });
});

describe('lockpick, failure & abandon', () => {
  it('ante 1, one slip → FAILED, chest lost, re-engage rejected until re-clear', () => {
    const sim = makeSim();
    const run = enterFinale(sim);
    killBoss(sim, run);
    const chestId = standOnChest(sim, run);

    sim.lockpickEngage(chestId, 1);
    // Deterministically drive to a single slip/bind: at each step, if any allowed
    // action lands on a ward (or misses a gate), issue it (ante 1 = one slip
    // ends it); otherwise advance safely along the solution path. A slip is
    // always available by the first single-row gate at the latest.
    const allowed = curSpec(run).tier.allowedActions;
    const solution = solveLockActions(curSpec(run))!;
    let guard = 0;
    while (run.lockpick && guard < 50) {
      const s = run.lockpick;
      const slipper = allowed.find((a: any) => {
        const r = stepLock(curSpec(run), s.col, s.row, a);
        return r.result === 'slip' || r.result === 'bind';
      });
      if (slipper) {
        sim.lockpickAction(slipper);
        break;
      }
      sim.lockpickAction(solution[s.col]); // safe advance
      guard++;
    }
    const events = flush(sim);
    expect(
      events.find((e) => e.type === 'lockpickEnd' && (e as any).outcome === 'fail'),
    ).toBeDefined();
    expect(run.lockpick).toBeNull();
    expect(run.objectState[chestId].attemptAvailable).toBe(false);
    expect(run.objectState[chestId].looted).toBeFalsy();

    // Re-engage is rejected (jammed).
    sim.lockpickEngage(chestId, 1);
    expect(run.lockpick).toBeNull();
  });

  it('abort preserves the attempt (re-engage allowed)', () => {
    const sim = makeSim();
    const run = enterFinale(sim);
    killBoss(sim, run);
    const chestId = standOnChest(sim, run);

    sim.lockpickEngage(chestId, 1);
    expect(run.lockpick).not.toBeNull();
    sim.lockpickAction('abort');
    expect(run.lockpick).toBeNull();
    expect(run.objectState[chestId].attemptAvailable).toBe(true);

    // Re-engage works.
    sim.lockpickEngage(chestId, 2);
    expect(run.lockpick).not.toBeNull();
    expect(run.lockpick?.lootTier).toBe('medium');
  });

  it("leaveDelve tears down the leaver's live session (attempt preserved)", () => {
    const sim = makeSim();
    const run = enterFinale(sim);
    killBoss(sim, run);
    const chestId = standOnChest(sim, run);
    sim.lockpickEngage(chestId, 1);
    expect(run.lockpick).not.toBeNull();
    sim.leaveDelve();
    expect(run.lockpick).toBeNull();
    expect(run.objectState[chestId].attemptAvailable).toBe(true);
  });

  it("removePlayer (disconnect) tears down the owner's live session (attempt preserved)", () => {
    const sim = makeSim();
    const run = enterFinale(sim);
    killBoss(sim, run);
    const chestId = standOnChest(sim, run);
    sim.lockpickEngage(chestId, 1);
    expect(run.lockpick).not.toBeNull();
    sim.removePlayer(sim.playerId);
    expect(run.lockpick).toBeNull();
    expect(run.objectState[chestId].attemptAvailable).toBe(true);
  });
});

describe('lockpick, fog boundary (anti-cheat)', () => {
  it('a fogged (heroic) lock never serializes cells beyond the window', () => {
    const sim = makeSim();
    // Enter heroic for the fogged preset (heroic now has a minPlayerLevel gate).
    const heroicTier = DELVES.collapsed_reliquary.tiers.find((t) => t.id === 'heroic');
    sim.setPlayerLevel(heroicTier?.minPlayerLevel ?? DELVES.collapsed_reliquary.minLevel);
    const door = DELVES.collapsed_reliquary.doorPos;
    sim.player.pos.x = door.x;
    sim.player.pos.z = door.z;
    sim.player.pos.y = terrainHeight(door.x, door.z, sim.cfg.seed);
    sim.player.prevPos = { ...sim.player.pos };
    sim.enterDelve('collapsed_reliquary', 'heroic');
    const run = sim.delveRunForPlayer(sim.playerId)!;
    run.bountiful = false; // test the normal heroic lock, not a Premium-only coffer
    run.modules = ['reliquary_finale'];
    run.moduleIndex = 0;
    (sim as any).spawnDelveModule(run);
    killBoss(sim, run);
    const chestId = standOnChest(sim, run);

    sim.lockpickEngage(chestId, 3);
    expect(run.lockpick?.pages.length).toBe(1); // low = single lock
    const win = curSpec(run).tier.visibilityWindow;
    let events = flush(sim);
    const sess = events.find((e) => e.type === 'lockpickSession') as any;
    for (const cell of sess.visible) expect(cell.col).toBeLessThanOrEqual(0 + win);

    // Advance one legal step and check the step payload's window too.
    const actions = solveLockActions(curSpec(run))!;
    sim.lockpickAction(actions[0]);
    events = flush(sim);
    const step = events.find((e) => e.type === 'lockpickStep') as any;
    for (const cell of step.visible) expect(cell.col).toBeLessThanOrEqual(step.col + win);
  });
});

/** Fail the current try once. Advances safely along the solution until a move
 * exists that slips/binds/traps (a gate column always has one), issues it, and
 * returns the drained events of that failing step. */
function forceFail(sim: Sim, run: { lockpick: any }): SimEvent[] {
  let guard = 0;
  while (run.lockpick && run.lockpick.state === 'IN_PROGRESS' && guard++ < 60) {
    const s = run.lockpick;
    const spec = curSpec(run);
    const allowed = spec.tier.allowedActions;
    const slipper = allowed.find((a: any) => {
      const r = stepLock(spec, s.col, s.row, a);
      return r.result === 'slip' || r.result === 'bind' || r.result === 'trap';
    });
    if (slipper) {
      sim.lockpickAction(slipper);
      return flush(sim);
    }
    const solution = solveLockActions(spec)!;
    sim.lockpickAction(solution[s.col]); // safe advance
    flush(sim);
  }
  return [];
}

describe('lockpick, tries (easy 3 / medium 2 / hard 1)', () => {
  it('engage reports the right tries per difficulty', () => {
    const sim = makeSim();
    const run = enterFinale(sim);
    killBoss(sim, run);
    const chestId = standOnChest(sim, run);
    sim.lockpickEngage(chestId, 3); // modest / easy
    expect(run.lockpick?.triesTotal).toBe(3);
    expect(run.lockpick?.triesLeft).toBe(3);
    const sess = flush(sim).find((e) => e.type === 'lockpickSession') as any;
    expect(sess.tries).toBe(3);
    expect(sess.triesTotal).toBe(3);
  });

  it('easy: a failed try resets the board (retry) instead of jamming, until tries run out', () => {
    const sim = makeSim();
    const run = enterFinale(sim);
    killBoss(sim, run);
    const chestId = standOnChest(sim, run);
    sim.lockpickEngage(chestId, 3); // 3 tries
    flush(sim);

    // First failure → retry, 2 tries left, board reset, attempt still available.
    let events = forceFail(sim, run);
    let step = events.find((e) => e.type === 'lockpickStep') as any;
    expect(step.result).toBe('retry');
    expect(step.tries).toBe(2);
    expect(run.lockpick).not.toBeNull();
    expect(run.lockpick?.col).toBe(0);
    expect(run.objectState[chestId].attemptAvailable).toBe(true);

    // Second failure → retry, 1 try left.
    events = forceFail(sim, run);
    step = events.find((e) => e.type === 'lockpickStep') as any;
    expect(step.result).toBe('retry');
    expect(step.tries).toBe(1);
    expect(run.lockpick).not.toBeNull();

    // Third failure → out of tries → FAILED, chest jammed.
    events = forceFail(sim, run);
    expect(
      events.find((e) => e.type === 'lockpickEnd' && (e as any).outcome === 'fail'),
    ).toBeDefined();
    expect(run.lockpick).toBeNull();
    expect(run.objectState[chestId].attemptAvailable).toBe(false);
  });

  it('a retry can still be solved to claim the cache', () => {
    const sim = makeSim();
    const run = enterFinale(sim);
    killBoss(sim, run);
    const chestId = standOnChest(sim, run);
    sim.lockpickEngage(chestId, 3);
    flush(sim);
    forceFail(sim, run); // burn one try, board resets
    expect(run.lockpick?.triesLeft).toBe(2);
    solveLock(sim, run); // solve the fresh board
    expect(run.objectState[chestId].looted).toBe(true);
    expect(run.objectState[chestId].lootedTier).toBe('low');
  });

  it('a sim-enforced step timeout consumes a try (retry while tries remain)', () => {
    const sim = makeSim();
    const run = enterFinale(sim);
    killBoss(sim, run);
    const chestId = standOnChest(sim, run);
    sim.lockpickEngage(chestId, 2); // 2 tries
    flush(sim);
    // Force the per-step deadline due; the sim tick (flush) enforces the timeout.
    run.lockpick!.stepDeadlineTick = 0;
    const events = flush(sim);
    const step = events.find((e) => e.type === 'lockpickStep') as any;
    expect(step.result).toBe('retry');
    expect(step.tries).toBe(1);
    expect(run.lockpick).not.toBeNull();
    // A second timeout exhausts the last try → fail.
    run.lockpick!.stepDeadlineTick = 0;
    const ev2 = flush(sim);
    expect(
      ev2.find((e) => e.type === 'lockpickEnd' && (e as any).outcome === 'fail'),
    ).toBeDefined();
    expect(run.lockpick).toBeNull();
  });
});

describe('lockpick, determinism', () => {
  it('same seed ⇒ same lock + same outcome', () => {
    const run = (seed: number) => {
      const sim = makeSim(seed);
      const r = enterFinale(sim);
      killBoss(sim, r);
      const chestId = standOnChest(sim, r);
      sim.lockpickEngage(chestId, 1);
      const spec = JSON.stringify(r.lockpick?.pages);
      const pageCount = r.lockpick?.pages.length;
      solveLock(sim, r);
      return { spec, tier: r.objectState[chestId].lootedTier, pageCount };
    };
    expect(run(7)).toEqual(run(7));
  });
});
