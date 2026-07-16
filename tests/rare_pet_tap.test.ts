import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

// Old Greyjaw (a rare with a single camp spawn) is the exploit case: a camper who
// parks an aggressive pet on it can monopolize the tap forever (petPickTarget's
// anti-AFK window re-engages the instant it respawns, well before any other player
// can react). Tap rights stay classic (pet damage taps, exactly like any other
// mob): the fix is that rares ALSO track a permanent damage-contributor roster
// (mirroring world bosses), and a guaranteed personal quest drop (greyjaw_fang,
// chance: 1) is credited to every quest-needing CONTRIBUTOR, not just whoever
// currently holds the tap. That closes both the camping monopoly (the owner still
// gets the fang from a pet-solo kill) and the new tap-snipe theft vector (a
// passerby who steals the tap with one hit cannot deny the fang to the player who
// actually did the work).

function spawnMob(
  sim: Sim,
  id: number,
  templateId: string,
  level: number,
  x: number,
  z: number,
): Entity {
  const mob = createMob(id, MOBS[templateId], level, { x, y: 0, z });
  sim.entities.set(id, mob);
  return mob;
}

describe('rare mob tap and personal-drop credit', () => {
  it('a pet acting alone still taps a rare mob (classic pet-tap rule, unchanged)', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warlock', noPlayer: true });
    const pid = sim.addPlayer('warlock', 'Ashwyn');
    const greyjaw = spawnMob(sim, 90001, 'old_greyjaw', 4, 10, 10);
    const pet = spawnMob(sim, 90002, 'emberkin', 10, 10, 10);
    pet.ownerId = pid;

    sim.dealDamage(pet, greyjaw, 5, false, 'physical', null, 'hit');

    expect(greyjaw.tappedById).toBe(pid);
  });

  it('a pet acting alone still taps an ordinary (non-rare) mob', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warlock', noPlayer: true });
    const pid = sim.addPlayer('warlock', 'Ashwyn');
    const boar = spawnMob(sim, 90004, 'wild_boar', 3, 10, 10);
    const pet = spawnMob(sim, 90005, 'emberkin', 10, 10, 10);
    pet.ownerId = pid;

    sim.dealDamage(pet, boar, 5, false, 'physical', null, 'hit');

    expect(boar.tappedById).toBe(pid);
  });

  it('a pet-solo kill still gets the owner the quest fang (camping monopoly closed by contribution credit)', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warlock', noPlayer: true });
    const pid = sim.addPlayer('warlock', 'Ashwyn');
    const meta = sim.meta(pid)!;
    meta.questLog.set('q_greyjaw', { questId: 'q_greyjaw', state: 'active', counts: [0] });
    const greyjaw = spawnMob(sim, 90006, 'old_greyjaw', 4, 10, 10);
    const pet = spawnMob(sim, 90007, 'emberkin', 10, 10, 10);
    pet.ownerId = pid;

    // The owner never lands a hit themselves; the pet does everything, tap included.
    sim.dealDamage(pet, greyjaw, 100000, false, 'physical', null, 'hit');

    expect(greyjaw.tappedById).toBe(pid);
    expect(greyjaw.dead).toBe(true);
    const fangSlot = greyjaw.loot?.items.find((s) => s.itemId === 'greyjaw_fang');
    expect(fangSlot).toBeDefined();
    expect(fangSlot?.personalFor).toContain(pid);
  });

  it('a one-hit tap-snipe cannot steal the fang from the player who actually farmed the kill', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warlock', noPlayer: true });
    const farmerPid = sim.addPlayer('warlock', 'Ashwyn');
    const farmerMeta = sim.meta(farmerPid)!;
    farmerMeta.questLog.set('q_greyjaw', { questId: 'q_greyjaw', state: 'active', counts: [0] });
    const sniperPid = sim.addPlayer('warrior', 'Sniper');
    const sniper = sim.entities.get(sniperPid)!;
    // The sniper does not need the quest: a bystander with no stake in the fang.

    const greyjaw = spawnMob(sim, 90008, 'old_greyjaw', 4, 10, 10);
    const pet = spawnMob(sim, 90009, 'emberkin', 10, 10, 10);
    pet.ownerId = farmerPid;

    // Greyjaw just respawned: the sniper lands the first hit and grabs the tap
    // outright (classic first-hit-taps rule), before the farmer's pet ever touches it.
    sim.dealDamage(sniper, greyjaw, 1, false, 'physical', null, 'hit');
    expect(greyjaw.tappedById).toBe(sniperPid);
    // The pet then does the rest of the fighting.
    sim.dealDamage(pet, greyjaw, 5, false, 'physical', null, 'hit');

    // The pet finishes the kill. Kill/tap credit (XP, corpse ownership) goes to the
    // sniper, but the guaranteed personal quest drop still credits the farmer, who
    // actually contributed the damage and needs the quest.
    sim.dealDamage(pet, greyjaw, 100000, false, 'physical', null, 'hit');

    expect(greyjaw.dead).toBe(true);
    const fangSlot = greyjaw.loot?.items.find((s) => s.itemId === 'greyjaw_fang');
    expect(fangSlot).toBeDefined();
    expect(fangSlot?.personalFor).toContain(farmerPid);
    expect(fangSlot?.personalFor).not.toContain(sniperPid);
  });

  it('the owner landing their own hit still taps a rare mob and gets the fang from a pet-finished kill', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warlock', noPlayer: true });
    const pid = sim.addPlayer('warlock', 'Ashwyn');
    const owner = sim.entities.get(pid)!;
    const meta = sim.meta(pid)!;
    meta.questLog.set('q_greyjaw', { questId: 'q_greyjaw', state: 'active', counts: [0] });
    const greyjaw = spawnMob(sim, 90010, 'old_greyjaw', 4, 10, 10);
    const pet = spawnMob(sim, 90011, 'emberkin', 10, 10, 10);
    pet.ownerId = pid;

    sim.dealDamage(owner, greyjaw, 5, false, 'physical', null, 'hit');
    expect(greyjaw.tappedById).toBe(pid);
    sim.dealDamage(pet, greyjaw, 100000, false, 'physical', null, 'hit');

    expect(greyjaw.dead).toBe(true);
    expect(greyjaw.loot?.items.some((s) => s.itemId === 'greyjaw_fang')).toBe(true);
  });
});
