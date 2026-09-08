// The rift half of a mid-combat exit (src/sim/rift/runs.ts): walking out through
// the beacon or exit is a classic zone-out. Nothing is remembered: the run's
// mobs give up on the departed player, walk home, and reset to full health with
// an empty hate table, and a return is a fresh pull of a whole pack. The reset
// is the whole cost of leaving; the race clock never pauses for it, and the
// anti-zerg death rule still bars a ghost from walking back into a live fight.

import { describe, expect, it } from 'vitest';
import { isRiftPos } from '../src/sim/data';
import { resetEvadingMob } from '../src/sim/mob/locomotion';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

const SEED = 9001;

type AnySim = Sim & Record<string, any>;
type AnyEntity = Entity & Record<string, any>;

function makeSim(seed = 12321): AnySim {
  return new Sim({
    seed,
    playerClass: 'warrior',
    noPlayer: true,
    world: EMPTY_TEST_WORLD,
  }) as AnySim;
}

function teleport(sim: AnySim, e: AnyEntity, x: number, z: number): void {
  e.pos = { x, y: e.pos.y, z };
  e.prevPos = { ...e.pos };
  sim.rebucket(e);
}

function pull(sim: AnySim, pid: number, damage = 25): { inst: any; mob: AnyEntity } {
  const p = sim.entities.get(pid) as AnyEntity;
  sim.enterRift(SEED, 20, pid);
  const inst = sim.riftInstances.find((i: any) => i.partyKey !== null)!;
  expect(inst.mobIds.length).toBeGreaterThan(0);
  const mob = sim.entities.get(inst.mobIds[0]) as AnyEntity;
  teleport(sim, p, mob.pos.x + 2, mob.pos.z);
  p.maxHp = p.hp = 1_000_000;
  sim.dealDamage(p, mob, damage, false, 'physical', 'Strike', 'hit', true);
  expect(mob.inCombat).toBe(true);
  expect(mob.threat.get(pid)).toBeGreaterThan(0);
  return { inst, mob };
}

describe('rift mid-combat exit is a classic zone-out reset', () => {
  it('leaving, then walking back in, meets a healed, idle pack with an empty hate table', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Ticker');
    const p = sim.entities.get(pid) as AnyEntity;
    sim.enterRift(SEED, 20, pid);
    const inst = sim.riftInstances.find((i: any) => i.partyKey !== null)!;
    const mob = sim.entities.get(inst.mobIds[0]) as AnyEntity;
    teleport(sim, p, mob.pos.x + 2, mob.pos.z);
    p.maxHp = p.hp = 1_000_000;
    sim.dealDamage(p, mob, mob.maxHp - 40, false, 'physical', 'Strike', 'hit', true);
    expect(mob.hp).toBeLessThan(mob.maxHp);
    const epochBefore = mob.evadeEpoch;

    sim.leaveRift(pid);
    expect(isRiftPos(p.pos.x)).toBe(false);

    // The real tick loop: the leaver's teleport to the overworld drags the mob
    // off its target within seconds; it walks home and resets in full.
    for (let i = 0; i < 20 * 30 && mob.evadeEpoch === epochBefore; i++) sim.tick();
    expect(mob.evadeEpoch).toBe(epochBefore + 1);
    expect(mob.hp).toBe(mob.maxHp);
    expect(mob.aiState).toBe('idle');
    expect(mob.inCombat).toBe(false);
    expect(mob.threat.size).toBe(0);

    // A prompt return is a fresh pull of the same live run: nothing is restored.
    sim.enterRift(SEED, 20, pid);
    expect(sim.riftInstances.find((i: any) => i.partyKey !== null)!).toBe(inst);
    sim.tick();
    expect(mob.threat.has(pid)).toBe(false);
    expect(mob.aggroTargetId).toBeNull();
    expect(mob.inCombat).toBe(false);
  });

  it('an out-of-combat beacon walk-out is unchanged: nothing to reset', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Casual');
    sim.enterRift(SEED, 20, pid);
    const inst = sim.riftInstances.find((i: any) => i.partyKey !== null)!;
    const mob = sim.entities.get(inst.mobIds[0]) as AnyEntity;
    sim.leaveRift(pid);
    expect(mob.inCombat).toBe(false);
    expect(mob.threat.size).toBe(0);
  });

  it('a forced evade-home reset heals and clears at once, never deferred', () => {
    const sim = makeSim();
    const a = sim.addPlayer('warrior', 'Wanderer');
    const { mob } = pull(sim, a, 200);
    sim.leaveRift(a);
    resetEvadingMob(sim.ctx, mob);
    expect(mob.inCombat).toBe(false);
    expect(mob.hp).toBe(mob.maxHp);
    expect(mob.threat.size).toBe(0);
  });

  it('the race clock keeps advancing across the whole retreat-and-return (cannot be paused for free)', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Racer');
    const { inst } = pull(sim, pid);
    const startedAt = inst.startedAt;

    sim.leaveRift(pid);
    sim.time += 5;
    sim.enterRift(SEED, 20, pid);

    // Retreating and coming back costs real race time, exactly like before.
    expect(inst.startedAt).toBe(startedAt);
  });

  it('a dead player is still blocked by the in-combat re-entry gate', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Ghosty');
    const p = sim.entities.get(pid) as AnyEntity;
    const { inst, mob } = pull(sim, pid);

    sim.leaveRift(pid);

    // The mob has not yet given up (leaveRift only relocates the leaver), so
    // the existing anti-zerg death rule must still bar a ghost.
    expect(mob.inCombat).toBe(true);
    p.hp = 0;
    p.dead = true;
    p.ghost = true;
    p.pos = { x: inst.returnPos.x, y: 0, z: inst.returnPos.z };
    p.prevPos = { ...p.pos };
    sim.drainEvents();
    sim.enterRift(SEED, 20, pid);

    expect(isRiftPos(p.pos.x), 'the existing in-combat ghost gate still bars entry').toBe(false);
  });
});
