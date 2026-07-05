// Direct unit tests for src/sim/mob/locomotion.ts (M2). The four moved functions are
// exercised by importing the module and calling them with a real Sim.ctx (so the
// SimContext callbacks resolve to the still-on-Sim methods), proving the slice runs
// behind the seam and that the thin Sim delegates route to it.

import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import {
  blockedTowardSpawn,
  recoverFromFlee,
  resetEvadingMob,
  updateMob,
} from '../src/sim/mob/locomotion';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { MELEE_RANGE } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

type AnyEntity = ReturnType<typeof createMob> & Record<string, any>;

function makeSim() {
  return new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
}
const ctxOf = (sim: Sim): SimContext => (sim as unknown as { ctx: SimContext }).ctx;

describe('mob/locomotion: recoverFromFlee (pure helper, no ctx)', () => {
  it('returns to chase out of melee, attack in melee; clears the flee timer', () => {
    const mob = createMob(1, MOBS.forest_wolf, 5, { x: 0, y: 0, z: 0 }) as AnyEntity;
    const target = createMob(2, MOBS.forest_wolf, 5, {
      x: MELEE_RANGE + 10,
      y: 0,
      z: 0,
    }) as AnyEntity;
    mob.fleeTimer = 3;
    recoverFromFlee(mob, target, 45, mob.spawnPos);
    expect(mob.aiState).toBe('chase');
    expect(mob.fleeTimer).toBe(0);

    target.pos = { x: 1, y: 0, z: 0 }; // now inside melee range
    recoverFromFlee(mob, target, 45, mob.spawnPos);
    expect(mob.aiState).toBe('attack');
  });

  it('grants the leash-return grace only when recovering at the leash edge', () => {
    const mob = createMob(1, MOBS.forest_wolf, 5, { x: 0, y: 0, z: 0 }) as AnyEntity;
    const target = createMob(2, MOBS.forest_wolf, 5, { x: 1, y: 0, z: 0 }) as AnyEntity;
    recoverFromFlee(mob, target, 45, { x: 0, y: 0, z: 0 }); // at anchor: no grace
    expect(mob.fleeReturnTimer).toBe(0);
    recoverFromFlee(mob, target, 45, { x: 50, y: 0, z: 0 }); // 50 >= 45-1: grace set
    expect(mob.fleeReturnTimer).toBeGreaterThan(0);
  });
});

describe('mob/locomotion: resetEvadingMob', () => {
  it('full-heals, drops combat, clears threat/auras, and re-arms the telegraph timers', () => {
    const sim = makeSim();
    const mob = createMob(900001, MOBS.korgath_the_bound, 20, { x: 0, y: 0, z: 0 }) as AnyEntity;
    (sim as any).addEntity(mob);
    mob.hp = 1;
    mob.aiState = 'evade';
    mob.inCombat = true;
    mob.hasFled = true;
    mob.stompTimer = 0;
    mob.auras.push({
      id: 'x',
      name: 'X',
      kind: 'stun',
      remaining: 5,
      duration: 5,
      value: 0,
      sourceId: 0,
      school: 'physical',
    });
    mob.threat.set(123, 50);

    resetEvadingMob(ctxOf(sim), mob);

    expect(mob.hp).toBe(mob.maxHp);
    expect(mob.aiState).toBe('idle');
    expect(mob.inCombat).toBe(false);
    expect(mob.hasFled).toBe(false);
    expect(mob.auras.length).toBe(0);
    expect(mob.threat.size).toBe(0);
    expect(mob.stompTimer).toBe(MOBS.korgath_the_bound.stomp!.every);
  });
});

describe('mob/locomotion: blockedTowardSpawn', () => {
  it('reports not-blocked when the mob is already at its destination', () => {
    const sim = makeSim();
    const mob = createMob(900002, MOBS.forest_wolf, 5, { x: 0, y: 0, z: 0 }) as AnyEntity;
    (sim as any).addEntity(mob);
    expect(blockedTowardSpawn(ctxOf(sim), mob, { ...mob.pos })).toBe(false);
  });
});

describe('mob/locomotion: updateMob', () => {
  it('an idle mob out of aggro range picks a wander target via the rng', () => {
    const sim = makeSim();
    const pos = { x: 500, y: terrainHeight(500, 500, (sim as any).cfg.seed), z: 500 };
    const mob = createMob(900003, MOBS.forest_wolf, 5, pos) as AnyEntity;
    (sim as any).addEntity(mob);
    mob.aiState = 'idle';
    mob.wanderTarget = null;
    mob.wanderTimer = 0;
    updateMob(ctxOf(sim), mob);
    expect(mob.wanderTarget).not.toBeNull();
  });

  it('the thin Sim delegate routes to the module (sim.updateMob === updateMob(ctx,...))', () => {
    // A dead, lootable, non-instance mob whose timers have run: the dead prologue
    // counts the corpse down. Driving it through the delegate must mutate identically
    // to driving the module directly.
    const drive = (viaDelegate: boolean): number => {
      const sim = makeSim();
      const mob = createMob(900004, MOBS.forest_wolf, 5, { x: 0, y: 0, z: 0 }) as AnyEntity;
      (sim as any).addEntity(mob);
      mob.dead = true;
      mob.corpseTimer = 5;
      mob.respawnTimer = 5;
      if (viaDelegate) (sim as any).updateMob(mob);
      else updateMob(ctxOf(sim), mob);
      return mob.corpseTimer;
    };
    expect(drive(true)).toBe(drive(false));
    expect(drive(true)).toBeLessThan(5); // the prologue decremented it
  });
});
