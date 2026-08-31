// A live delve run must survive a mid-run party membership change: the run's
// partyKey is stamped once at claim time, so accepting an invite or losing the
// only other member flips instanceKeyFor and used to orphan the run (no plates,
// no exit portal, and a permanent corpse on death).

import { beforeEach, describe, expect, it } from 'vitest';
import { BUILTIN_WORLD, DELVES, isDelvePos } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { PlayerClass, WorldContent } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

const DELVE_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
};

function makeSim(seed = 42) {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: true, world: DELVE_TEST_WORLD });
}

function teleport(sim: Sim, pid: number, x: number, z: number) {
  const p = sim.entities.get(pid)!;
  p.pos.x = x;
  p.pos.z = z;
  p.pos.y = terrainHeight(x, z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
  sim.rebucket(p);
}

function enterReliquary(sim: Sim, pid: number) {
  sim.setPlayerLevel(DELVES.collapsed_reliquary.minLevel, pid);
  const door = DELVES.collapsed_reliquary.doorPos;
  teleport(sim, pid, door.x, door.z);
  sim.enterDelve('collapsed_reliquary', 'normal', pid);
}

function addDelver(sim: Sim, cls: PlayerClass, name: string): number {
  return sim.addPlayer(cls, name, { autoEquip: true });
}

function partyUp(sim: Sim, leader: number, member: number) {
  sim.partyInvite(member, leader);
  sim.partyAccept(member);
}

function killPlayerEntity(sim: Sim, pid: number) {
  const p = sim.entities.get(pid)!;
  (sim as any).dealDamage(null, p, p.maxHp + 100, false, 'physical', null, 'hit', true);
}

describe('delve run party-key re-bind', () => {
  let sim: Sim;
  let solo: number;

  beforeEach(() => {
    sim = makeSim();
    solo = sim.playerId;
  });

  it('keeps resolving a solo run after the delver accepts a party invite', () => {
    enterReliquary(sim, solo);
    const run = sim.delveRunForPlayer(solo)!;
    expect(run).toBeTruthy();
    expect(run.partyKey).toBe(`solo:${solo}`);

    const friend = addDelver(sim, 'priest', 'Bet');
    partyUp(sim, friend, solo);
    const partyId = sim.partyOf(solo)!.id;

    expect(sim.delveRunForPlayer(solo)).toBe(run);
    expect(run.partyKey).toBe(`party:${partyId}`);
  });

  it('re-binds the run on the tick sweep even when the delver never moves', () => {
    enterReliquary(sim, solo);
    const run = sim.delveRunForPlayer(solo)!;
    const friend = addDelver(sim, 'priest', 'Bet');
    partyUp(sim, friend, solo);
    const partyId = sim.partyOf(solo)!.id;
    run.partyKey = `solo:${solo}`; // undo the lookup re-bind: pin the sweep alone

    for (let i = 0; i < 21; i++) sim.tick();
    expect(run.partyKey).toBe(`party:${partyId}`);
  });

  it('still opens the exit portal and advances the module after a key flip', () => {
    enterReliquary(sim, solo);
    const run = sim.delveRunForPlayer(solo)!;
    run.modules = ['reliquary_bell_niche', 'reliquary_finale'];
    run.moduleIndex = 0;
    (sim as any).spawnDelveModule(run);
    const exitId = run.objectIds.find((id) => run.objectState[id]?.kind === 'module_exit')!;
    expect(exitId).toBeDefined();

    const friend = addDelver(sim, 'priest', 'Bet');
    partyUp(sim, friend, solo);

    for (const id of [...run.mobIds]) {
      const mob = sim.entities.get(id);
      if (mob && !mob.dead)
        (sim as any).dealDamage(
          sim.player,
          mob,
          mob.maxHp + 1,
          false,
          'physical',
          null,
          'hit',
          true,
        );
    }
    sim.tick();
    expect(run.exitPortalOpen).toBe(true);
    const portal = sim.entities.get(exitId)!;
    sim.player.pos = { ...portal.pos };
    sim.player.prevPos = { ...portal.pos };
    sim.tick();
    expect(run.moduleIndex).toBe(1);
  });

  it('keeps resolving a duo run for the survivor after the other member leaves', () => {
    const mate = addDelver(sim, 'priest', 'Bet');
    partyUp(sim, solo, mate);
    enterReliquary(sim, solo);
    enterReliquary(sim, mate);
    const run = sim.delveRunForPlayer(solo)!;
    expect(sim.delveRunForPlayer(mate)).toBe(run);

    sim.removePlayer(mate);
    expect(sim.partyOf(solo)).toBeNull();

    expect(sim.delveRunForPlayer(solo)).toBe(run);
    expect(run.partyKey).toBe(`solo:${solo}`);
  });

  it('releases an unclaimed delve corpse to a graveyard rather than leaving it dead', () => {
    enterReliquary(sim, solo);
    const run = sim.delveRunForPlayer(solo)!;
    const corpse = { ...sim.player.pos };
    killPlayerEntity(sim, solo);
    // Strand the corpse for real: no run owns this spot any more, which is the
    // state the re-bind cannot repair and the only escape is the graveyard.
    (sim as any).freeDelveRun(run);
    teleport(sim, solo, corpse.x, corpse.z);
    sim.player.dead = true;

    sim.releaseSpirit(solo);
    expect(sim.player.ghost).toBe(true);
    expect(isDelvePos(sim.player.pos.x)).toBe(false);
  });

  it('never lets two runs share one party key when solo delvers group up mid-run', () => {
    const other = addDelver(sim, 'priest', 'Bet');
    enterReliquary(sim, solo);
    enterReliquary(sim, other);
    const soloRun = sim.delveRunForPlayer(solo)!;
    const otherRun = sim.delveRunForPlayer(other)!;
    expect(otherRun).not.toBe(soloRun);

    partyUp(sim, solo, other);
    sim.delveRunForPlayer(solo);
    sim.delveRunForPlayer(other);
    for (let i = 0; i < 21; i++) sim.tick();

    const keys = sim.delveRuns.filter((r) => r.partyKey !== null).map((r) => r.partyKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('respawns a delver whose party key flipped instead of leaving a permanent corpse', () => {
    const mate = addDelver(sim, 'priest', 'Bet');
    partyUp(sim, solo, mate);
    enterReliquary(sim, solo);
    enterReliquary(sim, mate);
    const run = sim.delveRunForPlayer(solo)!;

    sim.removePlayer(mate);
    killPlayerEntity(sim, solo);
    expect(sim.player.dead).toBe(true);
    sim.releaseSpirit(solo);

    expect(sim.player.dead).toBe(false);
    expect(sim.player.ghost).toBe(false);
    expect(isDelvePos(sim.player.pos.x)).toBe(true);
    expect(run.deathsThisRun[solo]).toBe(1);
  });
});
