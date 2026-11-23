import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD, DUNGEONS, dungeonAt } from '../src/sim/data';
import {
  dungeonExitStandingPos,
  instanceClaimContains,
  instanceOriginOf,
  soloInstanceKeyFor,
} from '../src/sim/instances/dungeons';
import {
  belongsInClaim,
  INSTANCE_EVICTED_TEXT,
  INSTANCE_EVICTION_GRACE_SECONDS,
  INSTANCE_EVICTION_REMINDER_SECONDS,
  instanceEvictionWarningText,
  outdoorExitSpot,
} from '../src/sim/instances/instance_group_eviction';
import { durableMemberKey } from '../src/sim/instances/raid_return';
import { type InstanceSlot, Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

const WARNING = instanceEvictionWarningText(INSTANCE_EVICTION_GRACE_SECONDS);

function newSim(): Sim {
  return new Sim({
    seed: 99,
    playerClass: 'warrior',
    noPlayer: true,
    world: { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] },
  });
}

/** A three-player party (so one removal leaves the party standing) with the
 *  leader and the doomed member inside the Hollow Crypt. */
function setup() {
  const sim = newSim();
  const leader = sim.addPlayer('warrior', 'Lead');
  const member = sim.addPlayer('priest', 'Member');
  const third = sim.addPlayer('mage', 'Third');
  for (const pid of [member, third]) {
    sim.partyInvite(pid, leader);
    sim.partyAccept(pid);
  }
  expect(sim.enterDungeon('hollow_crypt', leader)).toBe(true);
  expect(sim.enterDungeon('hollow_crypt', member)).toBe(true);
  const inst = sim.instances.find(
    (i) => i.partyKey !== null && i.dungeonId === 'hollow_crypt',
  ) as InstanceSlot;
  sim.drainEvents();
  return { sim, leader, member, third, inst };
}

function entity(sim: Sim, pid: number): Entity {
  return sim.entities.get(pid) as Entity;
}

/** Run whole seconds of the live tick loop; return each player's error texts. */
function advance(sim: Sim, seconds: number): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (let i = 0; i < seconds * 20; i++) {
    for (const e of sim.tick()) {
      if (e.type !== 'error' || e.pid === undefined) continue;
      const list = out.get(e.pid) ?? [];
      list.push(e.text);
      out.set(e.pid, list);
    }
  }
  return out;
}

function inside(inst: InstanceSlot, p: Entity, sim: Sim): boolean {
  return sim.ctx.instances.includes(inst) && dungeonAt(p.pos.x)?.id === inst.dungeonId;
}

describe('classic group-instance eviction', () => {
  it('warns a kicked member, keeps them for the grace, then sets them down outside', () => {
    const { sim, leader, member, inst } = setup();
    sim.partyKick(member, leader);
    const warned = advance(sim, 1);
    expect(warned.get(member)).toEqual([WARNING]);
    expect(warned.get(leader)).toBeUndefined();

    // Only the reminders, at 30 and 10 seconds left, before the removal.
    const during = advance(sim, INSTANCE_EVICTION_GRACE_SECONDS - 2);
    expect(INSTANCE_EVICTION_REMINDER_SECONDS).toEqual([30, 10]);
    expect(during.get(member)).toEqual([
      instanceEvictionWarningText(30),
      instanceEvictionWarningText(10),
    ]);
    expect(inside(inst, entity(sim, member), sim)).toBe(true);

    const after = advance(sim, 2);
    expect(after.get(member)).toEqual([INSTANCE_EVICTED_TEXT]);
    const p = entity(sim, member);
    expect(dungeonAt(p.pos.x)).toBeNull();
    const spot = outdoorExitSpot(sim.ctx, inst);
    expect(p.pos.x).toBeCloseTo(spot.x, 5);
    expect(p.pos.z).toBeCloseTo(spot.z, 5);
    expect(p.instanceEvictIn).toBeUndefined();
    // The leader, still in the group, never moved.
    expect(inside(inst, entity(sim, leader), sim)).toBe(true);
  });

  it('applies to a member who leaves the party on their own', () => {
    const { sim, member } = setup();
    sim.partyLeave(member);
    advance(sim, INSTANCE_EVICTION_GRACE_SECONDS + 1);
    expect(dungeonAt(entity(sim, member).pos.x)).toBeNull();
  });

  it('cancels the countdown when the member is re-invited in time', () => {
    const { sim, leader, member, inst } = setup();
    sim.partyKick(member, leader);
    advance(sim, 10);
    expect(entity(sim, member).instanceEvictIn).toBeDefined();
    sim.partyInvite(member, leader);
    sim.partyAccept(member);
    const later = advance(sim, INSTANCE_EVICTION_GRACE_SECONDS + 5);
    expect(later.get(member)).toBeUndefined();
    expect(inside(inst, entity(sim, member), sim)).toBe(true);
    expect(entity(sim, member).instanceEvictIn).toBeUndefined();
  });

  it('cancels the countdown when the player walks out first', () => {
    const { sim, leader, member } = setup();
    sim.partyKick(member, leader);
    advance(sim, 5);
    sim.leaveDungeon(member);
    const later = advance(sim, INSTANCE_EVICTION_GRACE_SECONDS);
    expect(later.get(member)).toBeUndefined();
    expect(entity(sim, member).instanceEvictIn).toBeUndefined();
  });

  it('never warns players who still belong to the group', () => {
    const { sim, leader, member } = setup();
    const events = advance(sim, INSTANCE_EVICTION_GRACE_SECONDS + 5);
    expect(events.get(leader)).toBeUndefined();
    expect(events.get(member)).toBeUndefined();
  });

  describe('a group that disbands down to one player', () => {
    /** A duo, both inside the Hollow Crypt. */
    function duo() {
      const sim = newSim();
      const leader = sim.addPlayer('warrior', 'Lead');
      const member = sim.addPlayer('priest', 'Member');
      sim.partyInvite(member, leader);
      sim.partyAccept(member);
      expect(sim.enterDungeon('hollow_crypt', leader)).toBe(true);
      expect(sim.enterDungeon('hollow_crypt', member)).toBe(true);
      const inst = sim.instances.find(
        (i) => i.partyKey !== null && i.dungeonId === 'hollow_crypt',
      ) as InstanceSlot;
      sim.drainEvents();
      return { sim, leader, member, inst };
    }

    it('lets the remaining player keep the run when the other leaves', () => {
      const { sim, leader, member, inst } = duo();
      sim.partyLeave(member);
      const events = advance(sim, INSTANCE_EVICTION_GRACE_SECONDS + 5);
      expect(events.get(leader)).toBeUndefined();
      expect(inside(inst, entity(sim, leader), sim)).toBe(true);
      expect(dungeonAt(entity(sim, member).pos.x)).toBeNull();
    });

    it('lets the leader keep the run after kicking the other player', () => {
      const { sim, leader, member, inst } = duo();
      sim.partyKick(member, leader);
      advance(sim, INSTANCE_EVICTION_GRACE_SECONDS + 5);
      expect(inside(inst, entity(sim, leader), sim)).toBe(true);
      expect(dungeonAt(entity(sim, member).pos.x)).toBeNull();
    });

    it('lets the remaining player keep the run when the other logs out', () => {
      const { sim, leader, member, inst } = duo();
      sim.removePlayer(member);
      const events = advance(sim, INSTANCE_EVICTION_GRACE_SECONDS + 5);
      expect(events.get(leader)).toBeUndefined();
      expect(inside(inst, entity(sim, leader), sim)).toBe(true);
    });

    it('keeps the run theirs after they form a new group', () => {
      const { sim, leader, member, inst } = duo();
      sim.partyLeave(member);
      const friend = sim.addPlayer('mage', 'Friend');
      sim.partyInvite(friend, leader);
      sim.partyAccept(friend);
      advance(sim, INSTANCE_EVICTION_GRACE_SECONDS + 5);
      expect(inside(inst, entity(sim, leader), sim)).toBe(true);
    });

    it('hands them the run: they can walk out and back into the same claim', () => {
      const { sim, leader, member, inst } = duo();
      sim.partyLeave(member);
      expect(inst.partyKey).toBe(sim.ctx.instanceKeyFor(leader));
      sim.leaveDungeon(leader);
      expect(sim.enterDungeon('hollow_crypt', leader)).toBe(true);
      expect(inside(inst, entity(sim, leader), sim)).toBe(true);
    });

    it('saves a kicked duo partner who is re-invited within the grace', () => {
      const { sim, leader, member, inst } = duo();
      sim.partyKick(member, leader);
      advance(sim, 10);
      sim.partyInvite(member, leader);
      sim.partyAccept(member);
      const later = advance(sim, INSTANCE_EVICTION_GRACE_SECONDS + 5);
      expect(later.get(member)).toBeUndefined();
      expect(inside(inst, entity(sim, member), sim)).toBe(true);
    });

    it('keeps the run when the player still has an empty solo run of that dungeon', () => {
      const sim = newSim();
      const leader = sim.addPlayer('warrior', 'Lead');
      const member = sim.addPlayer('priest', 'Member');
      // The member runs it alone first and walks out; that claim lingers.
      expect(sim.enterDungeon('hollow_crypt', member)).toBe(true);
      const old = sim.instances.find(
        (i) => i.partyKey === soloInstanceKeyFor(sim.ctx, member),
      ) as InstanceSlot;
      expect(sim.leaveDungeon(member)).toBe(true);
      sim.partyInvite(member, leader);
      sim.partyAccept(member);
      expect(sim.enterDungeon('hollow_crypt', leader)).toBe(true);
      expect(sim.enterDungeon('hollow_crypt', member)).toBe(true);
      const inst = sim.instances.find((i) => i.partyKey === `party:${sim.ctx.partyOf(member)?.id}`);
      expect(inst).toBeDefined();
      expect(inst).not.toBe(old);
      const partyKey = inst?.partyKey;
      sim.drainEvents();
      sim.partyLeave(leader);
      const events = advance(sim, INSTANCE_EVICTION_GRACE_SECONDS + 5);
      expect(events.get(member)).toBeUndefined();
      expect(inside(inst as InstanceSlot, entity(sim, member), sim)).toBe(true);
      expect(inst?.partyKey).toBe(soloInstanceKeyFor(sim.ctx, member));
      // The old solo run takes the dead party key, so nobody owns it.
      expect(old.partyKey === null || old.partyKey === partyKey).toBe(true);
    });

    it('keeps the old solo run instead when the player is standing in it', () => {
      const { sim, leader, member, inst } = duo();
      const own = sim.instances.find(
        (i) => i !== inst && i.dungeonId === 'hollow_crypt' && i.partyKey === null,
      ) as InstanceSlot;
      own.partyKey = soloInstanceKeyFor(sim.ctx, member); // the member's own solo run
      const p = entity(sim, member);
      // The same spot, carried from the group run into the old solo run.
      const from = instanceOriginOf(inst);
      const to = instanceOriginOf(own);
      p.pos = { ...p.pos, x: p.pos.x - from.x + to.x, z: p.pos.z - from.z + to.z };
      expect(instanceClaimContains(own, p.pos)).toBe(true);
      const partyKey = inst.partyKey;
      sim.partyLeave(leader);
      expect(own.partyKey).toBe(soloInstanceKeyFor(sim.ctx, member));
      expect(inst.partyKey).toBe(partyKey);
    });

    it('hands the run to the partner who stays when the last member is logging out', () => {
      const { sim, leader, member, inst } = duo();
      // The leader disconnects; while their leave save is in flight, the member
      // leaves the party, leaving the logging-out leader as its last member.
      sim.preparePlayerLeave(leader);
      sim.partyLeave(member);
      expect(inst.partyKey).toBe(soloInstanceKeyFor(sim.ctx, member));
      sim.removePlayer(leader);
      const events = advance(sim, INSTANCE_EVICTION_GRACE_SECONDS + 5);
      expect(events.get(member)).toBeUndefined();
      expect(inside(inst, entity(sim, member), sim)).toBe(true);
    });

    it('does not pass a raid on to its last raider', () => {
      const { sim, leader, member, inst } = duo();
      // A real conversion needs five; the disband reads only the flag.
      const party = sim.ctx.partyOf(leader);
      if (party) party.raid = true;
      const partyKey = inst.partyKey;
      sim.partyLeave(member);
      expect(inst.partyKey).toBe(partyKey);
    });
  });

  it('leaves a solo claim owner alone after they form a party', () => {
    const sim = newSim();
    const solo = sim.addPlayer('warrior', 'Solo');
    const friend = sim.addPlayer('priest', 'Friend');
    expect(sim.enterDungeon('hollow_crypt', solo)).toBe(true);
    sim.partyInvite(friend, solo);
    sim.partyAccept(friend);
    const events = advance(sim, INSTANCE_EVICTION_GRACE_SECONDS + 5);
    expect(events.get(solo)).toBeUndefined();
    expect(dungeonAt(entity(sim, solo).pos.x)?.id).toBe('hollow_crypt');
  });

  it('exempts a GM', () => {
    const { sim, leader, member } = setup();
    sim.setGm(member, true);
    sim.partyKick(member, leader);
    const events = advance(sim, INSTANCE_EVICTION_GRACE_SECONDS + 5);
    expect(events.get(member)).toBeUndefined();
    expect(dungeonAt(entity(sim, member).pos.x)?.id).toBe('hollow_crypt');
  });

  it("moves a released ghost's corpse out of the claim to the door", () => {
    const { sim, leader, member, inst } = setup();
    const p = entity(sim, member);
    p.dead = true;
    p.hp = 0;
    sim.releaseSpirit(member);
    expect(p.ghost).toBe(true);
    expect(p.corpseInstanceId).toBe(inst.exitId);
    sim.partyKick(member, leader);
    advance(sim, INSTANCE_EVICTION_GRACE_SECONDS + 1);
    const spot = outdoorExitSpot(sim.ctx, inst);
    expect(p.corpseInstanceId).toBeNull();
    expect(p.corpsePos?.x).toBeCloseTo(spot.x, 5);
    expect(p.corpsePos?.z).toBeCloseTo(spot.z, 5);
    // On the surface a living player stands on there, not the bare terrain.
    expect(p.corpsePos?.y).toBeCloseTo(dungeonExitStandingPos(sim.ctx, spot).y, 5);
    expect(p.ghost).toBe(true);
  });

  it('releases an unreleased body, then moves its corpse out', () => {
    const { sim, leader, member, inst } = setup();
    const p = entity(sim, member);
    p.dead = true;
    p.hp = 0;
    sim.partyKick(member, leader);
    advance(sim, INSTANCE_EVICTION_GRACE_SECONDS + 1);
    expect(p.ghost).toBe(true);
    expect(dungeonAt(p.pos.x)).toBeNull();
    expect(p.corpseInstanceId).toBeNull();
    expect(p.corpsePos && dungeonAt(p.corpsePos.x)).toBeNull();
    expect(sim.ctx.instances.includes(inst)).toBe(true);
  });

  it("frees a queued difficulty change the removed player's presence was holding", () => {
    const { sim, leader, member, inst } = setup();
    sim.leaveDungeon(leader);
    // Kicked first: a member leaving cancels an already-queued change by design
    // (tests/difficulty_selection.test.ts), so the leader queues it afterwards,
    // while the removed member still holds the claim.
    sim.partyKick(member, leader);
    sim.setDungeonDifficulty('heroic', leader);
    expect(sim.ctx.pendingDifficultyChanges.has(leader)).toBe(true);
    advance(sim, INSTANCE_EVICTION_GRACE_SECONDS + 2);
    expect(inst.difficulty).toBe('heroic');
    expect(sim.ctx.pendingDifficultyChanges.size).toBe(0);
  });

  describe('leaving the world', () => {
    it('sets a removed player down outside at once, before the leave save', () => {
      const { sim, leader, member, inst } = setup();
      sim.partyKick(member, leader);
      advance(sim, 5);
      expect(inside(inst, entity(sim, member), sim)).toBe(true);
      sim.preparePlayerLeave(member);
      const p = entity(sim, member);
      expect(dungeonAt(p.pos.x)).toBeNull();
      expect(p.instanceEvictIn).toBeUndefined();
      const saved = sim.serializeCharacter(member);
      expect(saved && dungeonAt(saved.pos.x)).toBeNull();
      const spot = outdoorExitSpot(sim.ctx, inst);
      expect(saved?.pos.x).toBeCloseTo(spot.x, 5);
      expect(saved?.pos.z).toBeCloseTo(spot.z, 5);
    });

    it('applies even before the first warning has gone out', () => {
      const { sim, leader, member } = setup();
      sim.partyKick(member, leader);
      sim.preparePlayerLeave(member);
      expect(dungeonAt(entity(sim, member).pos.x)).toBeNull();
    });

    it('leaves a player who still belongs to the group where they are', () => {
      const { sim, member, inst } = setup();
      sim.preparePlayerLeave(member);
      expect(inside(inst, entity(sim, member), sim)).toBe(true);
    });

    it("moves a removed ghost's corpse out with them", () => {
      const { sim, leader, member } = setup();
      const p = entity(sim, member);
      p.dead = true;
      p.hp = 0;
      sim.releaseSpirit(member);
      sim.partyKick(member, leader);
      sim.preparePlayerLeave(member);
      expect(p.corpseInstanceId).toBeNull();
      expect(p.corpsePos && dungeonAt(p.corpsePos.x)).toBeNull();
    });
    it('releases an unreleased body at leave and saves the corpse at the door', () => {
      const { sim, leader, member, inst } = setup();
      const p = entity(sim, member);
      p.dead = true;
      p.hp = 0;
      sim.partyKick(member, leader);
      sim.preparePlayerLeave(member);
      expect(p.ghost).toBe(true);
      expect(dungeonAt(p.pos.x)).toBeNull();
      expect(p.corpseInstanceId).toBeNull();
      const spot = outdoorExitSpot(sim.ctx, inst);
      expect(p.corpsePos?.x).toBeCloseTo(spot.x, 5);
      expect(p.corpsePos?.z).toBeCloseTo(spot.z, 5);
    });

    it('acts once when the leave is prepared twice, as the server does', () => {
      const { sim, leader, member } = setup();
      sim.partyKick(member, leader);
      sim.drainEvents();
      sim.preparePlayerLeave(member);
      const at = { ...entity(sim, member).pos };
      sim.preparePlayerLeave(member);
      expect(entity(sim, member).pos).toEqual(at);
      const removed = sim
        .drainEvents()
        .filter((e) => e.type === 'error' && e.pid === member && e.text === INSTANCE_EVICTED_TEXT);
      expect(removed).toHaveLength(1);
    });

    it('leaves an exempt GM inside at leave', () => {
      const { sim, leader, member, inst } = setup();
      sim.setGm(member, true);
      sim.partyKick(member, leader);
      sim.preparePlayerLeave(member);
      expect(inside(inst, entity(sim, member), sim)).toBe(true);
    });

    it('runs through the offline removePlayer path too', () => {
      const { sim, leader, member } = setup();
      sim.partyKick(member, leader);
      sim.drainEvents();
      sim.removePlayer(member);
      const removed = sim
        .drainEvents()
        .filter((e) => e.type === 'error' && e.pid === member && e.text === INSTANCE_EVICTED_TEXT);
      expect(removed).toHaveLength(1);
      expect(sim.entities.has(member)).toBe(false);
    });
  });

  describe('raid returner exemption (the door return rule, not the bare ledger)', () => {
    const KEY = 'party:9999';
    const LOCKED_UNTIL_FOREVER = Number.POSITIVE_INFINITY;
    function raid() {
      const sim = newSim();
      const pid = sim.addPlayer('warrior', 'Returner');
      const slot = (id: string) => sim.instances.find((i) => i.dungeonId === id) as InstanceSlot;
      const lift = slot('ignivar_forge_lift');
      const crucible = slot('ignivar_inner_crucible');
      for (const claim of [lift, crucible]) claim.partyKey = KEY;
      const ledger = durableMemberKey(sim.ctx, pid);
      const lock = (roomId: string) =>
        sim.ctx.players.get(pid)?.raidLockouts.set(roomId, LOCKED_UNTIL_FOREVER);
      return { sim, pid, p: entity(sim, pid), lift, crucible, ledger, lock };
    }

    it('admits a returner in a room they cleared and are still locked to', () => {
      const { sim, pid, p, crucible, ledger, lock } = raid();
      expect(belongsInClaim(sim.ctx, pid, p, crucible)).toBe(false);
      crucible.raidReturnKeys.add(ledger);
      expect(belongsInClaim(sim.ctx, pid, p, crucible)).toBe(false); // no live lockout
      lock('ignivar_inner_crucible');
      expect(belongsInClaim(sim.ctx, pid, p, crucible)).toBe(true);
    });

    it('admits them in an earlier room on the way out of the one they cleared', () => {
      const { sim, pid, p, lift, crucible, ledger, lock } = raid();
      crucible.raidReturnKeys.add(ledger);
      lock('ignivar_inner_crucible');
      expect(belongsInClaim(sim.ctx, pid, p, lift)).toBe(true);
    });

    it('does not shelter a raider kicked in a later room after an earlier kill', () => {
      const { sim, pid, p, lift, crucible, ledger, lock } = raid();
      lift.raidReturnKeys.add(ledger);
      lock('ignivar_forge_lift');
      expect(belongsInClaim(sim.ctx, pid, p, lift)).toBe(true);
      expect(belongsInClaim(sim.ctx, pid, p, crucible)).toBe(false);
    });
  });

  it.each(Object.values(DUNGEONS).map((d) => [d.id]))(
    'sets a player removed from %s down outdoors',
    (dungeonId) => {
      const sim = newSim();
      const slot = sim.instances.find((i) => i.dungeonId === dungeonId);
      if (!slot) return; // a dungeon with no instance slots has nothing to evict from
      expect(dungeonAt(outdoorExitSpot(sim.ctx, slot).x)).toBeNull();
    },
  );
});
