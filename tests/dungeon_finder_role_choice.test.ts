import { describe, expect, it } from 'vitest';
import { type Role, TALENTS } from '../src/sim/content/talents';
import { Sim } from '../src/sim/sim';
import type { PlayerClass } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

const makeSim = () =>
  new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true, world: EMPTY_TEST_WORLD });

function add(sim: Sim, cls: PlayerClass, name: string, spec?: string): number {
  const pid = sim.addPlayer(cls, name);
  sim.setPlayerLevel(8, pid);
  if (spec) sim.setSpec(spec, pid);
  return pid;
}

describe('finder role declarations independent of specialization', () => {
  it('recruits before entry without claiming an instance and keeps the formed party on dungeon entry', () => {
    const sim = makeSim();
    const leader = add(sim, 'warrior', 'Leader', 'arms');
    const helper = add(sim, 'priest', 'Helper');
    sim.dungeonFinderSetRoles(['tank'], leader);
    sim.dungeonFinderSetRoles(['healer'], helper);
    sim.dungeonFinderListingCreate('hollow_crypt_normal', [], leader);
    const listingId = sim.dungeonFinderInfoFor(leader)!.myListing!.id;
    expect(sim.instances.filter((slot) => slot.partyKey !== null)).toHaveLength(0);
    expect(sim.dungeonFinderInfoFor(leader)!.expedition).toBeNull();
    sim.dungeonFinderApply(listingId, helper);
    expect(sim.dungeonFinderInfoFor(leader)!.myListing!.applicants[0]?.pid).toBe(helper);
    sim.dungeonFinderApplicationRespond(helper, true, leader);
    expect(sim.partyOf(leader)?.members).toEqual([leader, helper]);
    expect(sim.instances.filter((slot) => slot.partyKey !== null)).toHaveLength(0);
    expect(sim.enterDungeon('hollow_crypt', leader)).toBe(true);
    sim.dungeonFinderExpeditionOpen(leader);
    expect(sim.partyOf(leader)?.members).toEqual([leader, helper]);
    const expedition = sim.dungeonFinderInfoFor(leader)!.expedition!;
    expect(expedition.open).toBe(true);
    expect(sim.dungeonFinderInfoFor(helper)!.expedition?.exitId).toBe(expedition.exitId);
  });
  it('lets Arms offer tank and damage without changing talents or equipment', () => {
    const sim = makeSim();
    const pid = add(sim, 'warrior', 'ArmsTank', 'arms');
    const before = structuredClone(sim.serializeCharacter(pid));
    if (!before) throw new Error('Character missing before role selection');
    const talentsBefore = structuredClone(sim.players.get(pid)!.talents);
    sim.dungeonFinderSetRoles(['tank', 'dps'], pid);
    const info = sim.dungeonFinderInfoFor(pid)!;
    expect(info.eligibleRoles).toEqual(['tank', 'dps']);
    expect(info.roles).toEqual(['tank', 'dps']);
    const after = sim.serializeCharacter(pid);
    expect(sim.players.get(pid)!.talents).toEqual(talentsBefore);
    if (!after) throw new Error('Character missing after role selection');
    expect(after.equipment).toEqual(before.equipment);
  });

  it('lets an uncommitted warrior queue as tank while still rejecting healer', () => {
    const sim = makeSim();
    const pid = add(sim, 'warrior', 'Uncommitted');
    sim.dungeonFinderSetRoles(['healer'], pid);
    expect(sim.dungeonFinderInfoFor(pid)!.roles).toEqual([]);
    sim.dungeonFinderSetRoles(['tank'], pid);
    sim.dungeonFinderQueueJoin(['hollow_crypt_normal'], pid);
    expect(sim.dungeonFinderInfoFor(pid)!.queue?.activities).toEqual(['hollow_crypt_normal']);
    expect(sim.players.get(pid)!.talents.spec).toBeNull();
  });

  it('forms an exact role group with a DPS warrior as tank and DPS priest as healer', () => {
    const sim = makeSim();
    const tank = add(sim, 'warrior', 'Tank', 'arms');
    const healer = add(
      sim,
      'priest',
      'Healer',
      TALENTS.priest.specs.find((s) => s.role === 'dps')!.id,
    );
    const pids = [
      tank,
      healer,
      ...['First', 'Second', 'Third'].map((name) => add(sim, 'mage', name)),
    ];
    const roles: Role[] = ['tank', 'healer', 'dps', 'dps', 'dps'];
    pids.forEach((pid, i) => {
      sim.dungeonFinderSetRoles([roles[i]], pid);
      sim.dungeonFinderQueueJoin(['hollow_crypt_normal'], pid);
    });
    sim.tick();
    expect(pids.map((pid) => sim.dungeonFinderInfoFor(pid)!.proposal?.role)).toEqual(roles);
    sim.setSpec('fury', tank);
    for (const pid of pids) sim.dungeonFinderRespond(true, pid);
    expect(sim.partyOf(tank)?.members).toEqual(pids);
    expect(sim.players.get(tank)!.talents.spec).toBe('fury');
  });

  it('admits an Arms tank helper through the running-expedition application', () => {
    const sim = makeSim();
    const leader = add(sim, 'warrior', 'Leader', 'arms');
    const helper = add(sim, 'warrior', 'Helper', 'arms');
    expect(sim.enterDungeon('hollow_crypt', leader)).toBe(true);
    sim.dungeonFinderExpeditionOpen(leader);
    const listing = sim.dungeonFinderInfoFor(leader)!.myListing!.id;
    sim.dungeonFinderExpeditionApply(listing, 'tank', helper);
    expect(sim.dungeonFinderInfoFor(leader)!.myListing!.applicants[0]?.roles).toEqual(['tank']);
    sim.dungeonFinderApplicationRespond(helper, true, leader);
    expect(sim.partyOf(helper)?.leader).toBe(leader);
    expect(sim.players.get(helper)!.talents.spec).toBe('arms');
  });
});
