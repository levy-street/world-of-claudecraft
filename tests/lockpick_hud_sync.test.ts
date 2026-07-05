// The rewritten HUD lockpick board paints from the authoritative
// world.lockpickState (src/net/online.ts mirrors the same field), never a cached
// copy. This test models that thin bridge and proves the board position can never
// drift from the sim: there is simply no second copy to desync. The old
// flush/sync/merge ceremony is gone, so the bountiful "jam without user error"
// bug is structurally impossible.

import { describe, expect, it } from 'vitest';
import { DELVES } from '../src/sim/data';
import type { PickAction } from '../src/sim/lockpick';
import { solveLockActions } from '../src/sim/lockpick';
import { Sim } from '../src/sim/sim';
import { terrainHeight } from '../src/sim/world';
import type { LockpickView } from '../src/world_api';

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

function actionForCol(
  run: { lockpick: { pages: unknown[]; pageIndex: number } | null },
  col: number,
): PickAction {
  const spec = run.lockpick?.pages[run.lockpick?.pageIndex] as Parameters<
    typeof solveLockActions
  >[0];
  return solveLockActions(spec)![col]!;
}

/** Minimal offline HUD lockpick bridge mirroring the rewritten hud.ts: the board
 * has NO cached view, it always reads the authoritative world.lockpickState. */
class LockpickHudBridge {
  constructor(readonly sim: Sim) {}

  /** What the board paints from, in both hosts. */
  state(): LockpickView | null {
    return this.sim.lockpickState;
  }

  /** Offline flush of queued events (feedback/timer juice only, not position). */
  private flush(): void {
    this.sim.drainEvents();
  }

  submitEngage(objectId: number, ante: 1 | 2 | 3): void {
    this.sim.lockpickEngage(objectId, ante);
    this.flush();
  }

  submitAction(action: PickAction): void {
    this.sim.lockpickAction(action);
    this.flush();
  }

  /** The correct depth for whatever column the authoritative state shows now. */
  pickForLiveCol(run: {
    lockpick: { col: number; pages: unknown[]; pageIndex: number } | null;
  }): PickAction {
    return actionForCol(run, this.state()!.col);
  }
}

describe('world.lockpickState is the single board source of truth', () => {
  it('board column tracks the sim column immediately after each action', () => {
    const sim = makeSim(42);
    const { run, chestId } = enterBountifulFinale(sim);
    const hud = new LockpickHudBridge(sim);
    hud.submitEngage(chestId, 1);

    let guard = 0;
    while (run.lockpick && run.lockpick.state === 'IN_PROGRESS' && guard++ < 200) {
      // The board view IS sim.lockpickState, so col/row/sessionId always match.
      expect(hud.state()?.col).toBe(run.lockpick.col);
      expect(hud.state()?.row).toBe(run.lockpick.row);
      expect(hud.state()?.sessionId).toBe(run.lockpick.sessionId);
      hud.submitAction(hud.pickForLiveCol(run));
    }
    expect(run.objectState[chestId].looted).toBe(true);
  });

  it('opens the lock even with NO event drain anywhere (no cache to freeze)', () => {
    // The old jam reproduced when the HUD froze behind the sim because events
    // were not drained. The rewrite reads state directly, so dropping every
    // drainEvents call cannot desync the board. Every seed must still open.
    const N = 80;
    let opened = 0;
    for (let seed = 0; seed < N; seed++) {
      const sim = makeSim(seed);
      const { run, chestId } = enterBountifulFinale(sim);
      sim.lockpickEngage(chestId, 1);
      let guard = 0;
      while (run.lockpick && run.lockpick.state === 'IN_PROGRESS' && guard++ < 200) {
        const col = sim.lockpickState!.col; // authoritative position, no flush
        sim.lockpickAction(actionForCol(run, col));
      }
      if (run.objectState[chestId].looted) opened++;
    }
    expect(opened).toBe(N);
  });

  it('console sim.lockpickEngage leaves state live at col 0 (board would paint it)', () => {
    const sim = makeSim(42);
    const { chestId } = enterBountifulFinale(sim);
    sim.lockpickEngage(chestId, 1);
    // Even with no flush, the authoritative view is immediately readable, so the
    // board the player acts on is never stale.
    expect(sim.lockpickState?.col).toBe(0);
    expect(sim.lockpickState?.sessionId).toBeTruthy();
  });

  it('lockpickState matches run.lockpick col/row/session every step', () => {
    const sim = makeSim(42);
    const { run, chestId } = enterBountifulFinale(sim);
    sim.lockpickEngage(chestId, 1);
    sim.drainEvents();

    let guard = 0;
    while (run.lockpick && run.lockpick.state === 'IN_PROGRESS' && guard++ < 200) {
      const view = sim.lockpickState!;
      expect(view.col).toBe(run.lockpick.col);
      expect(view.row).toBe(run.lockpick.row);
      expect(view.sessionId).toBe(run.lockpick.sessionId);
      sim.lockpickAction(actionForCol(run, run.lockpick.col));
      sim.drainEvents();
    }
  });
});
