// The sim emits a `bossWarn` telegraph event a few seconds BEFORE a timer-based
// boss mechanic resolves, so the client raid-warnings panel can count it down.
// Additive only: it never changes the mechanic's timing, damage, or RNG. Drives
// the moved locomotion updateMob against a real Sim's SimContext (sim.ctx).
import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { updateMob } from '../src/sim/mob/locomotion';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';

const makeSim = () => new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });

function engagedStomper(sim: Sim): Entity {
  const mob = createMob(900200, MOBS.korgath_the_bound, 20, { ...sim.player.pos });
  mob.spawnPos = { ...sim.player.pos };
  mob.aiState = 'attack';
  mob.aggroTargetId = sim.playerId;
  mob.inCombat = true;
  sim.addEntity(mob);
  return mob;
}

describe('boss mechanic telegraph (bossWarn)', () => {
  it('warns ahead of War Stomp, before the slam lands, anchored on the boss', () => {
    const sim = makeSim();
    sim.player.maxHp = 1_000_000;
    sim.player.hp = 1_000_000;
    const mob = engagedStomper(sim);
    mob.stompTimer = 6; // a few seconds out

    let warn: SimEvent | undefined;
    for (let i = 0; i < 200 && !warn; i++) {
      sim.events = [];
      updateMob(sim.ctx, mob);
      warn = sim.events.find((e: SimEvent) => e.type === 'bossWarn');
    }
    expect(warn).toBeDefined();
    expect(warn).toMatchObject({ type: 'bossWarn', mechanic: 'stomp', entityId: mob.id });
    // it's a real lead-time warning: eta > 0 and the slam hasn't fired yet
    expect((warn as { eta: number }).eta).toBeGreaterThan(0);
    expect(mob.stompTimer).toBeGreaterThan(0);
  });

  it('only fires once per cast (the telegraph is one-shot)', () => {
    const sim = makeSim();
    sim.player.maxHp = 1_000_000;
    sim.player.hp = 1_000_000;
    const mob = engagedStomper(sim);
    mob.stompTimer = 6;
    let warns = 0;
    // run from 6s down to ~1s remaining (before it slams at 0)
    for (let i = 0; i < 100; i++) {
      sim.events = [];
      updateMob(sim.ctx, mob);
      warns += sim.events.filter((e: SimEvent) => e.type === 'bossWarn').length;
      if (mob.stompTimer <= 1) break;
    }
    expect(warns).toBe(1);
  });
});
