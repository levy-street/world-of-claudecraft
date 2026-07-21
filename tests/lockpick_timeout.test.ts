// The per-step lockpick clock is SERVER-AUTHORITATIVE: enforced by the sim tick
// (deterministic, sim-clock based), never by the client. This is the regression
// suite for the production blocker where the OLD client-only countdown burned the
// single premium try the instant a human paused to read the board, jamming page 1
// of an otherwise-correct attempt.
//
// The board itself is provably fair (tests/lockpick_by_sight.test.ts); these tests
// pin the timer behavior: idle past the deadline burns a try, slow-BUT-correct play
// within the (generous) budget still opens, the clock re-arms every move, and a
// tier with no clock is pure request/response.
//
// NOTE: the per-move budget is an ante dial (ANTE_TO_STEP_TIMEOUT_MS: hard 3s /
// medium 6s / easy 9s), so it is read live from the session/view for whichever
// ante was engaged rather than assumed from a delve-band preset.

import { describe, expect, it } from 'vitest';
import { DELVES } from '../src/sim/data';
import type { PickAction } from '../src/sim/lockpick';
import { ANTE_TO_STEP_TIMEOUT_MS, solveLockActions } from '../src/sim/lockpick';
import { Sim } from '../src/sim/sim';
import { DT } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

const makeSim = (seed = 42) => new Sim({ seed, playerClass: 'warrior', autoEquip: true });

/** Boot a Collapsed Reliquary finale, kill the boss, stand the player on the
 * reward chest. */
function enterFinale(sim: Sim): { run: any; chestId: number } {
  sim.setPlayerLevel(DELVES.collapsed_reliquary.minLevel);
  const door = DELVES.collapsed_reliquary.doorPos;
  sim.player.pos.x = door.x;
  sim.player.pos.z = door.z;
  sim.player.pos.y = terrainHeight(door.x, door.z, sim.cfg.seed);
  sim.player.prevPos = { ...sim.player.pos };
  sim.enterDelve('collapsed_reliquary', 'normal');
  const run = sim.delveRunForPlayer(sim.playerId)!;
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
  // Drop the finale's mob swarm so idle ticks stay cheap and the ONLY thing that
  // can end a session during a pause is the per-step clock under test (combat is
  // covered elsewhere). The lockpick timeout is independent of who is on the map.
  for (const [id, e] of [...sim.entities]) {
    if ((e as any).kind === 'mob') sim.entities.delete(id);
  }
  return { run, chestId };
}

function actionForCol(run: any, col: number): PickAction {
  const spec = run.lockpick?.pages[run.lockpick?.pageIndex];
  return solveLockActions(spec)![col]!;
}

/** The live per-step budget in sim ticks, read from the authoritative view (so
 * the test follows whichever preset the chest rolled). */
function budgetTicks(sim: Sim): number {
  const state = sim.lockpickState;
  if (!state) {
    throw new Error('Expected active lockpick state');
  }
  return Math.ceil(state.stepTimeoutMs! / (DT * 1000));
}

/** Advance the sim `n` ticks while keeping the picker alive, so the ONLY thing
 * that can end the session during a pause is the per-step clock (not incidental
 * delve combat). The lockpick clock is independent of player hp. */
function idle(sim: Sim, n: number): void {
  for (let i = 0; i < n; i++) {
    sim.player.hp = sim.player.maxHp;
    sim.tick();
  }
}

describe('lockpick per-step clock is enforced by the sim tick (server-authoritative)', () => {
  it('each difficulty carries its own per-move budget (hard 3s / medium 6s / easy 9s)', () => {
    // The clock is an ante dial: the harder the ante, the tighter the per-move
    // clock. Per-MOVE (re-armed every move), so a slow-but-correct solve still
    // opens; only an idle past the deadline burns a try.
    expect(ANTE_TO_STEP_TIMEOUT_MS[1]).toBe(3000); // premium, hard
    expect(ANTE_TO_STEP_TIMEOUT_MS[2]).toBe(6000); // medium
    expect(ANTE_TO_STEP_TIMEOUT_MS[3]).toBe(9000); // modest, easy
  });

  it('idling past the deadline burns a try (premium = instant jam) with NO client call', () => {
    const sim = makeSim(7);
    const { run, chestId } = enterFinale(sim);
    sim.lockpickEngage(chestId, 1); // premium ante: 1 try
    expect(run.lockpick.state).toBe('IN_PROGRESS');
    // Tick past the deadline without acting. The sim, not the client, fails it.
    idle(sim, budgetTicks(sim) + 2);
    expect(run.lockpick).toBeNull();
    expect(run.objectState[chestId].looted).toBeFalsy();
    expect(run.objectState[chestId].attemptAvailable).toBe(false); // chest jammed
  });

  it('a jammed lockpick opens the surface exit so the player is never stranded', () => {
    const sim = makeSim(7);
    const { run, chestId } = enterFinale(sim);
    sim.lockpickEngage(chestId, 1); // premium ante: a single try
    expect(run.surfaceExitId).toBeNull(); // not open until the pick resolves
    idle(sim, budgetTicks(sim) + 2); // let the try burn -> chest jams
    expect(run.objectState[chestId].attemptAvailable).toBe(false);
    // The boss is dead and the chest is lost, but the way out must still open.
    expect(run.surfaceExitId).not.toBeNull();
    expect(run.objectState[run.surfaceExitId!].kind).toBe('surface_exit');
    expect(run.objectState[run.surfaceExitId!].open).toBe(true);
  });

  it('survives idling right up to (but not past) the deadline', () => {
    const sim = makeSim(7);
    const { run, chestId } = enterFinale(sim);
    sim.lockpickEngage(chestId, 1);
    idle(sim, budgetTicks(sim) - 1);
    expect(run.lockpick?.state).toBe('IN_PROGRESS');
  });

  it('a long pause (just under the deadline) then a correct move advances, never jams', () => {
    // The exact scenario the old client timer broke: a human studies the board
    // for nearly the full budget, then presses the correct depth. It must land.
    const sim = makeSim(42);
    const { run, chestId } = enterFinale(sim);
    sim.lockpickEngage(chestId, 1);
    const startCol = sim.lockpickState!.col;
    idle(sim, budgetTicks(sim) - 1); // ~the whole budget spent reading
    expect(run.lockpick?.state).toBe('IN_PROGRESS'); // survived the pause
    sim.lockpickAction(actionForCol(run, sim.lockpickState!.col));
    expect(sim.lockpickState?.col).toBe(startCol + 1); // correct move landed
    expect(run.lockpick?.state).toBe('IN_PROGRESS');
  });

  it('a full premium solve with a pause before every move still OPENS', () => {
    // Slow-but-correct play across all premium pages: pauses between moves do not
    // burn the single try, so the cache opens.
    const sim = makeSim(42);
    const { run, chestId } = enterFinale(sim);
    sim.lockpickEngage(chestId, 1);
    let guard = 0;
    while (run.lockpick && run.lockpick.state === 'IN_PROGRESS' && guard++ < 120) {
      idle(sim, 15); // a deliberate pause between moves, well under any budget
      expect(run.lockpick, 'a pause well under budget must never time out').not.toBeNull();
      sim.lockpickAction(actionForCol(run, sim.lockpickState!.col));
    }
    expect(run.objectState[chestId].looted).toBe(true);
  });

  it('re-arms the clock on every correct move', () => {
    const sim = makeSim(42);
    const { run, chestId } = enterFinale(sim);
    sim.lockpickEngage(chestId, 1);
    const d0 = run.lockpick.stepDeadlineTick;
    idle(sim, Math.max(1, Math.floor(budgetTicks(sim) / 2)));
    sim.lockpickAction(actionForCol(run, sim.lockpickState!.col));
    expect(run.lockpick.stepDeadlineTick).toBeGreaterThan(d0);
  });

  it('a session with no clock (infinite deadline) never times out', () => {
    const sim = makeSim(7);
    const { run, chestId } = enterFinale(sim);
    sim.lockpickEngage(chestId, 1);
    run.lockpick.stepDeadlineTick = Number.POSITIVE_INFINITY;
    idle(sim, budgetTicks(sim) * 3);
    expect(run.lockpick?.state).toBe('IN_PROGRESS');
  });

  it('exposes the authoritative per-step budget on the view (HUD renders, never decides)', () => {
    const sim = makeSim(7);
    const { run, chestId } = enterFinale(sim);
    sim.lockpickEngage(chestId, 1); // premium ante
    expect(sim.lockpickState?.stepTimeoutMs).toBe(
      ANTE_TO_STEP_TIMEOUT_MS[run.lockpick.ante as 1 | 2 | 3],
    );
    expect(sim.lockpickState?.stepTimeoutMs).toBe(3000);
  });
});
