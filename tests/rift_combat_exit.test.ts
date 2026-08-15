// Direct unit tests for the rift half of issue #2653 (src/sim/rift/runs.ts):
// a mid-combat beacon/exit walk-out is remembered for a short window so a party
// cannot chain exits into a free, instant, unengaged combat reset. Unlike the
// dungeon door (instances/dungeons.ts, see tests/dungeons.test.ts), leaveRift
// never explicitly scrubs threat (the issue's own finding), so these tests
// simulate the passive reset (the mob's hate table going idle once it gives up
// chasing a target that teleported to the overworld) directly rather than
// reproducing its exact tick timing, which is unrelated pre-existing behavior.

import { describe, expect, it } from 'vitest';
import { isRiftPos } from '../src/sim/data';
import { COMBAT_EXIT_MEMORY_SECONDS } from '../src/sim/instance_exit_memory';
import { resetEvadingMob } from '../src/sim/mob/locomotion';
import { descendRift } from '../src/sim/rift/runs';
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

// Model the mob's hate table having gone idle by the time the player returns
// (whatever passive mechanism did it: the mob giving up and leashing home once
// its target teleported out of the run). This is pre-existing rift behavior,
// unrelated to the combat-exit memory fix under test here, so it is asserted
// directly rather than re-derived through however many real ticks it takes.
function simulateNaturalReset(mob: AnyEntity): void {
  mob.threat.clear();
  mob.aggroTargetId = null;
  mob.aiState = 'idle';
  mob.inCombat = false;
}

describe('rift combat-exit memory (issue #2653, no free combat reset)', () => {
  it('re-entering the same run within the memory window resumes the fight', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Fickle');
    const p = sim.entities.get(pid) as AnyEntity;
    sim.enterRift(SEED, 20, pid);
    const inst = sim.riftInstances.find((i: any) => i.partyKey !== null)!;
    expect(inst.mobIds.length).toBeGreaterThan(0);

    const mob = sim.entities.get(inst.mobIds[0]) as AnyEntity;
    teleport(sim, p, mob.pos.x + 2, mob.pos.z);
    p.maxHp = p.hp = 1_000_000;
    sim.dealDamage(p, mob, 25, false, 'physical', 'Strike', 'hit', true);
    expect(mob.inCombat).toBe(true);
    const priorThreat = mob.threat.get(pid);
    expect(priorThreat).toBeGreaterThan(0);

    sim.leaveRift(pid);
    expect(isRiftPos(p.pos.x)).toBe(false);
    expect(inst.combatExitMemory.get(pid)?.mobThreat).toEqual([[mob.id, priorThreat, 0]]);

    // The run's mob gives up on the departed player and settles before anyone
    // returns: a genuinely fresh, unengaged pack is what a walk-in would meet
    // WITHOUT the memory fix.
    simulateNaturalReset(mob);

    sim.time += 5;
    sim.enterRift(SEED, 20, pid);

    expect(sim.riftInstances.find((i: any) => i.partyKey !== null)!).toBe(inst); // same live run
    expect(mob.threat.get(pid)).toBe(priorThreat); // resumed, not a fresh pull
    expect(mob.aggroTargetId).toBe(pid);
    expect(mob.aiState).toBe('chase');
    expect(mob.inCombat).toBe(true);
    expect(inst.combatExitMemory.size).toBe(0); // consumed, not left dangling
  });

  it('waiting past the memory window earns a genuine reset, not a resumed fight', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Patient');
    const p = sim.entities.get(pid) as AnyEntity;
    sim.enterRift(SEED, 20, pid);
    const inst = sim.riftInstances.find((i: any) => i.partyKey !== null)!;
    const mob = sim.entities.get(inst.mobIds[0]) as AnyEntity;
    teleport(sim, p, mob.pos.x + 2, mob.pos.z);
    p.maxHp = p.hp = 1_000_000;
    sim.dealDamage(p, mob, 25, false, 'physical', 'Strike', 'hit', true);
    expect(mob.threat.get(pid)).toBeGreaterThan(0);

    sim.leaveRift(pid);
    simulateNaturalReset(mob);

    sim.time += COMBAT_EXIT_MEMORY_SECONDS + 1;
    sim.enterRift(SEED, 20, pid);

    expect(mob.threat.has(pid)).toBe(false); // no restore: a real fresh pull
    expect(mob.aggroTargetId).toBeNull();
    expect(mob.aiState).toBe('idle');
  });

  it('an out-of-combat beacon walk-out leaves no combat-exit memory (mob never aggroed)', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Casual');
    sim.enterRift(SEED, 20, pid);
    const inst = sim.riftInstances.find((i: any) => i.partyKey !== null)!;
    expect(inst.combatExitMemory.size).toBe(0);

    sim.leaveRift(pid);

    expect(inst.combatExitMemory.size).toBe(0);
  });

  it('a full party chaining exits and returning within the window resumes the SAME hate split, not a fresh pull', () => {
    const sim = makeSim();
    const a = sim.addPlayer('warrior', 'Left1');
    const b = sim.addPlayer('mage', 'Left2');
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    sim.enterRift(SEED, 20, a);
    const inst = sim.riftInstances.find((i: any) => i.partyKey !== null)!;
    sim.enterRift(SEED, 20, b);
    const ea = sim.entities.get(a) as AnyEntity;
    const eb = sim.entities.get(b) as AnyEntity;

    const mob = sim.entities.get(inst.mobIds[0]) as AnyEntity;
    teleport(sim, ea, mob.pos.x + 2, mob.pos.z);
    teleport(sim, eb, mob.pos.x - 2, mob.pos.z);
    ea.maxHp = ea.hp = 1_000_000;
    eb.maxHp = eb.hp = 1_000_000;
    sim.dealDamage(ea, mob, 100, false, 'physical', 'Strike', 'hit', true);
    sim.dealDamage(eb, mob, 10, false, 'fire', 'Bolt', 'hit', true);
    expect(mob.aggroTargetId).toBe(a);
    const threatA = mob.threat.get(a);
    const threatB = mob.threat.get(b);

    // Chained exits: both leave, and the run settles out of combat entirely.
    sim.leaveRift(a);
    sim.leaveRift(b);
    simulateNaturalReset(mob);

    sim.time += 5;
    sim.enterRift(SEED, 20, a);
    sim.enterRift(SEED, 20, b);

    expect(mob.threat.get(a)).toBe(threatA);
    expect(mob.threat.get(b)).toBe(threatB);
    expect(mob.aggroTargetId).toBe(a); // still the higher-threat attacker
    expect(mob.inCombat).toBe(true);
  });

  it('the race clock keeps advancing across the whole retreat-and-return (cannot be paused for free)', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Racer');
    const p = sim.entities.get(pid) as AnyEntity;
    sim.enterRift(SEED, 20, pid);
    const inst = sim.riftInstances.find((i: any) => i.partyKey !== null)!;
    const startedAt = inst.startedAt;
    const mob = sim.entities.get(inst.mobIds[0]) as AnyEntity;
    teleport(sim, p, mob.pos.x + 2, mob.pos.z);
    p.maxHp = p.hp = 1_000_000;
    sim.dealDamage(p, mob, 25, false, 'physical', 'Strike', 'hit', true);

    sim.leaveRift(pid);
    simulateNaturalReset(mob);
    sim.time += 5;
    sim.enterRift(SEED, 20, pid);

    // The exit-memory fix never touches the run clock: retreating and coming
    // back costs real race time, exactly like before.
    expect(inst.startedAt).toBe(startedAt);
  });

  it('a dead player is still blocked by the in-combat re-entry gate even with a live combat-exit memory record', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Ghosty');
    const p = sim.entities.get(pid) as AnyEntity;
    sim.enterRift(SEED, 20, pid);
    const inst = sim.riftInstances.find((i: any) => i.partyKey !== null)!;
    const mob = sim.entities.get(inst.mobIds[0]) as AnyEntity;
    teleport(sim, p, mob.pos.x + 2, mob.pos.z);
    p.maxHp = p.hp = 1_000_000;
    sim.dealDamage(p, mob, 25, false, 'physical', 'Strike', 'hit', true);
    expect(mob.inCombat).toBe(true);

    sim.leaveRift(pid);
    expect(inst.combatExitMemory.has(pid)).toBe(true); // a live memory record exists

    // The mob never stopped fighting (leaveRift only relocates the leaver, not
    // the mob), so the existing anti-zerg death rule must still bar a ghost.
    p.hp = 0;
    p.dead = true;
    p.ghost = true;
    p.pos = { x: inst.returnPos.x, y: 0, z: inst.returnPos.z };
    p.prevPos = { ...p.pos };
    sim.drainEvents();
    sim.enterRift(SEED, 20, pid);

    expect(isRiftPos(p.pos.x), 'the existing in-combat ghost gate still bars entry').toBe(false);
    expect(inst.combatExitMemory.has(pid), 'the blocked attempt never consumed the memory').toBe(
      true,
    );
  });

  it('a forced evade-home reset is deferred while a live exit memory could still apply, so a mid-window fresh re-pull can never happen', () => {
    const sim = makeSim();
    const a = sim.addPlayer('warrior', 'Wanderer');
    sim.enterRift(SEED, 20, a);
    const inst = sim.riftInstances.find((i: any) => i.partyKey !== null)!;
    const mob = sim.entities.get(inst.mobIds[0]) as AnyEntity;
    const ea = sim.entities.get(a) as AnyEntity;
    teleport(sim, ea, mob.pos.x + 2, mob.pos.z);
    ea.maxHp = ea.hp = 1_000_000;
    sim.dealDamage(ea, mob, mob.maxHp - 40, false, 'physical', 'Strike', 'hit', true);
    expect(mob.threat.get(a)).toBeGreaterThan(0);

    sim.leaveRift(a);
    expect(inst.combatExitMemory.size).toBe(1);

    // Something (a stray leash break, a manual call) tries to run the
    // evade-home reset while A's exit memory is still live: it must defer
    // rather than heal/clear the pack out from under a same-run return.
    resetEvadingMob(sim.ctx, mob);
    expect(mob.inCombat).toBe(true);
    expect(mob.hp).toBeLessThan(mob.maxHp); // never healed

    // A returns inside the window: the exact fight resumes, HP included.
    sim.time += 5;
    sim.enterRift(SEED, 20, a);

    expect(mob.threat.get(a)).toBeGreaterThan(0);
    expect(mob.aggroTargetId).toBe(a);
    expect(mob.inCombat).toBe(true);
  });

  it('re-entering after a REAL tick loop (leave, natural leash-and-evade reset, return before expiry) resumes the exact fight, not a fresh healed pull', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Ticker');
    const p = sim.entities.get(pid) as AnyEntity;
    sim.enterRift(SEED, 20, pid);
    const inst = sim.riftInstances.find((i: any) => i.partyKey !== null)!;
    const mob = sim.entities.get(inst.mobIds[0]) as AnyEntity;
    teleport(sim, p, mob.pos.x + 2, mob.pos.z);
    p.maxHp = p.hp = 1_000_000;
    sim.dealDamage(p, mob, mob.maxHp - 40, false, 'physical', 'Strike', 'hit', true);
    const damagedHp = mob.hp;
    expect(damagedHp).toBeLessThan(mob.maxHp);
    const priorThreat = mob.threat.get(pid);
    expect(priorThreat).toBeGreaterThan(0);

    sim.leaveRift(pid);

    // Run the REAL tick loop: the leaver's teleport to the overworld drags the
    // mob past its leash within a few seconds (issue #2653's own finding for
    // rifts), well inside the memory window.
    for (let i = 0; i < 20 * 15; i++) sim.tick();

    // Held, not reset: no heal, no idle, no dropped hate table.
    expect(mob.hp).toBe(damagedHp);
    expect(mob.aiState).toBe('evade');
    expect(mob.inCombat).toBe(true);

    // Structurally unpullable while held: an 'evade' mob is damage-immune
    // (combat/damage.ts).
    const strangerPid = sim.addPlayer('warrior', 'Stranger');
    sim.enterRift(SEED, 20, strangerPid);
    const stranger = sim.entities.get(strangerPid) as AnyEntity;
    teleport(sim, stranger, mob.pos.x + 2, mob.pos.z);
    stranger.maxHp = stranger.hp = 1_000_000;
    sim.dealDamage(stranger, mob, 25, false, 'physical', 'Strike', 'hit', true);
    expect(mob.threat.has(strangerPid)).toBe(false);
    expect(mob.hp).toBe(damagedHp);

    sim.enterRift(SEED, 20, pid);

    expect(mob.threat.get(pid)).toBe(priorThreat);
    expect(mob.aggroTargetId).toBe(pid);
    expect(mob.aiState).toBe('chase');
    expect(mob.hp).toBe(damagedHp); // the exact fight resumed, not a fresh healed pack
  });

  it('re-entering after a REAL tick loop past the full window earns a genuine reset (full heal, idle, empty hate table)', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'TooLate');
    const p = sim.entities.get(pid) as AnyEntity;
    sim.enterRift(SEED, 20, pid);
    const inst = sim.riftInstances.find((i: any) => i.partyKey !== null)!;
    const mob = sim.entities.get(inst.mobIds[0]) as AnyEntity;
    teleport(sim, p, mob.pos.x + 2, mob.pos.z);
    p.maxHp = p.hp = 1_000_000;
    sim.dealDamage(p, mob, mob.maxHp - 40, false, 'physical', 'Strike', 'hit', true);
    expect(mob.hp).toBeLessThan(mob.maxHp);

    sim.leaveRift(pid);

    // Tick well past COMBAT_EXIT_MEMORY_SECONDS: the hold lapses and the
    // deferred reset finally fires.
    for (let i = 0; i < 20 * (COMBAT_EXIT_MEMORY_SECONDS + 10); i++) sim.tick();

    expect(mob.hp).toBe(mob.maxHp);
    expect(mob.aiState).toBe('idle');
    expect(mob.inCombat).toBe(false);

    sim.enterRift(SEED, 20, pid);
    expect(mob.threat.has(pid)).toBe(false); // a real fresh pull, no restore
    expect(inst.combatExitMemory.size).toBe(0); // the lapsed record was consumed, not left dangling
  });

  it('descending a floor clears any dangling combat-exit memory from the cleared floor', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Descender');
    sim.enterRift(SEED, 20, pid);
    const inst = sim.riftInstances.find((i: any) => i.partyKey !== null)!;

    // A dangling record left behind by some other party member (e.g. one who
    // exited mid-combat and never returned before the floor was cleared and
    // descended) must not survive the floor teardown, or a lucky reissued id
    // on the next floor could resolve a lookup against it.
    inst.combatExitMemory.set(999, {
      expiresAt: sim.time + COMBAT_EXIT_MEMORY_SECONDS,
      mobThreat: [[inst.mobIds[0], 500, 0]],
    });
    expect(inst.combatExitMemory.size).toBe(1);

    inst.descentOpen = true;
    inst.floorIndex = 0;
    descendRift(sim.ctx, pid);

    expect(inst.combatExitMemory.size).toBe(0);
  });
});
