import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { PlayerClass } from '../src/sim/types';
import type { ExpeditionSettings } from '../src/world_api/dungeon_finder';
import { EMPTY_TEST_WORLD } from './sim_shared';

const recruit: ExpeditionSettings = {
  kind: 'recruit',
  activityId: 'hollow_crypt_normal',
  role: 'tank',
  details: { purpose: 'first_time', note: '  Learning together  ' },
};
function setup() {
  const sim = new Sim({
    seed: 42,
    playerClass: 'warrior',
    noPlayer: true,
    world: EMPTY_TEST_WORLD,
  });
  const add = (cls: PlayerClass = 'warrior', level = 8) => {
    const pid = sim.addPlayer(cls, `Player${sim.players.size}`);
    sim.setPlayerLevel(level, pid);
    sim.dungeonFinderSetRoles(['dps'], pid);
    return pid;
  };
  return { sim, add, leader: add() };
}
function join(sim: Sim, leader: number, mate: number) {
  sim.partyInvite(mate, leader);
  sim.partyAccept(mate);
}

describe('atomic compact recruitment', () => {
  it('publishes one ordinary listing with its role and copied server details together', () => {
    const { sim, leader } = setup();
    sim.dungeonFinderExpeditionConfigure(recruit, leader);
    expect(sim.dungeonFinderInfoFor(leader)).toMatchObject({
      roles: ['tank'],
      myListing: {
        id: 1,
        activityId: 'hollow_crypt_normal',
        tags: [],
        details: { purpose: 'first_time', note: 'Learning together' },
      },
    });
    expect(sim.dungeonFinderBoardView()).toMatchObject([
      {
        members: [{ role: 'tank' }],
        details: { purpose: 'first_time', note: 'Learning together' },
        needed: { tank: 0, healer: 1, dps: 3 },
      },
    ]);
    expect(sim.dungeonFinderBoardView()[0].expedition).toBeUndefined();
    if (recruit.kind === 'recruit') recruit.details.note = 'Changed by caller';
    expect(sim.dungeonFinderInfoFor(leader)?.myListing?.details?.note).toBe('Learning together');
    if (recruit.kind === 'recruit') recruit.details.note = '  Learning together  ';
  });

  it('admits a party leader and lets only that leader edit ordinary listing details', () => {
    const { sim, add, leader } = setup();
    const mate = add();
    join(sim, leader, mate);
    sim.dungeonFinderExpeditionConfigure(recruit, leader);
    expect(sim.dungeonFinderBoardView()[0].size).toBe(2);
    const settings: ExpeditionSettings = {
      kind: 'details',
      details: { purpose: 'relaxed', note: '  No rush  ' },
    };
    sim.dungeonFinderExpeditionConfigure(settings, mate);
    expect(sim.dungeonFinderBoardView()[0].details?.purpose).toBe('first_time');
    sim.dungeonFinderExpeditionConfigure(settings, leader);
    expect(sim.dungeonFinderInfoFor(leader)?.myListing?.details).toEqual({
      purpose: 'relaxed',
      note: 'No rush',
    });
  });

  it('accepts and copies a note at the exact 120-character limit', () => {
    const { sim, leader } = setup();
    const note = 'n'.repeat(120);
    const settings: ExpeditionSettings = {
      ...recruit,
      details: { purpose: 'relaxed', note },
    };
    sim.dungeonFinderExpeditionConfigure(settings, leader);
    expect(sim.dungeonFinderInfoFor(leader)?.myListing?.details).toEqual({
      purpose: 'relaxed',
      note,
    });
    settings.details.note = 'Caller changed the note';
    expect(sim.dungeonFinderBoardView()[0].details?.note).toBe(note);
    expect(sim.dungeonFinderInfoFor(leader)?.myListing?.details?.note).toHaveLength(120);
  });

  it.each(['activity', 'role', 'details', 'leader', 'capacity', 'level', 'leaving'])(
    'refuses invalid %s without changing roles or creating a listing',
    (guard) => {
      const { sim, add, leader } = setup();
      let target = leader;
      let settings = recruit;
      if (guard === 'activity') settings = { ...recruit, activityId: 'unknown' };
      if (guard === 'role') settings = { ...recruit, role: 'healer' };
      if (guard === 'details')
        settings = { ...recruit, details: { purpose: 'clear', note: 'a\nb' } };
      if (guard === 'leader') {
        target = add();
        join(sim, leader, target);
      }
      if (guard === 'capacity') for (let i = 0; i < 4; i++) join(sim, leader, add());
      if (guard === 'level') join(sim, leader, add('warrior', 6));
      if (guard === 'leaving') {
        const mate = add();
        join(sim, leader, mate);
        sim.players.get(mate)!.leaving = true;
      }
      sim.dungeonFinderExpeditionConfigure(settings, target);
      expect(sim.dungeonFinderInfoFor(target)?.roles).toEqual(['dps']);
      expect(sim.dungeonFinderBoardView()).toEqual([]);
    },
  );

  it.each(['listing', 'queue', 'proposal', 'application', 'expedition', 'current_expedition'])(
    'preserves existing %s and sticky roles when publication is refused',
    (guard) => {
      const { sim, add, leader } = setup();
      if (guard === 'listing')
        sim.dungeonFinderListingCreate('hollow_crypt_normal', ['learning'], leader);
      if (guard === 'queue') sim.dungeonFinderQueueJoin(['hollow_crypt_normal'], leader);
      if (guard === 'proposal') {
        const tank = add();
        const healer = add('priest');
        const dps = [leader, add('mage'), add('rogue')];
        sim.dungeonFinderSetRoles(['tank'], tank);
        sim.dungeonFinderSetRoles(['healer'], healer);
        for (const pid of [tank, healer, ...dps])
          sim.dungeonFinderQueueJoin(['hollow_crypt_normal'], pid);
        sim.tick();
        expect(sim.dungeonFinderInfoFor(leader)?.proposal).not.toBeNull();
      }
      if (guard === 'application') {
        const other = add();
        sim.dungeonFinderListingCreate('hollow_crypt_normal', [], other);
        sim.dungeonFinderApply(sim.dungeonFinderBoardView()[0].id, leader);
      }
      if (guard === 'expedition' || guard === 'current_expedition') {
        sim.enterDungeon('hollow_crypt', leader);
        if (guard === 'expedition') sim.dungeonFinderExpeditionOpen(leader);
      }
      const before = sim.dungeonFinderInfoFor(leader);
      const board = sim.dungeonFinderBoardView();
      sim.dungeonFinderExpeditionConfigure(recruit, leader);
      expect(sim.dungeonFinderInfoFor(leader)).toEqual(before);
      expect(sim.dungeonFinderBoardView()).toEqual(board);
    },
  );

  it('allows pre-entry recruitment after leaving a previous unlisted run', () => {
    const { sim, leader } = setup();
    sim.enterDungeon('hollow_crypt', leader);
    sim.leaveDungeon(leader);
    sim.dungeonFinderExpeditionConfigure(recruit, leader);
    expect(sim.dungeonFinderInfoFor(leader)?.myListing?.details?.purpose).toBe('first_time');
  });

  it.each(['queue', 'proposal', 'current_expedition'])(
    "checks another party member's %s before publishing and preserves both players' state",
    (state) => {
      const { sim, add, leader } = setup();
      const mate = add();
      if (state === 'queue' || state === 'proposal') {
        const queued = [mate];
        if (state === 'proposal') {
          const tank = add();
          const healer = add('priest');
          sim.dungeonFinderSetRoles(['tank'], tank);
          sim.dungeonFinderSetRoles(['healer'], healer);
          queued.push(tank, healer, add('mage'), add('rogue'));
        }
        for (const pid of queued) sim.dungeonFinderQueueJoin(['hollow_crypt_normal'], pid);
        if (state === 'proposal') sim.tick();
      }
      join(sim, leader, mate);
      if (state === 'current_expedition') sim.enterDungeon('hollow_crypt', mate);
      const beforeLeader = sim.dungeonFinderInfoFor(leader);
      const beforeMate = sim.dungeonFinderInfoFor(mate);
      expect(beforeLeader?.queue).toBeNull();
      expect(beforeLeader?.proposal).toBeNull();
      expect(beforeLeader?.expedition).toBeNull();
      if (state === 'queue') expect(beforeMate?.queue).not.toBeNull();
      if (state === 'proposal') expect(beforeMate?.proposal).not.toBeNull();
      if (state === 'current_expedition') expect(beforeMate?.expedition).not.toBeNull();
      sim.dungeonFinderExpeditionConfigure(recruit, leader);
      expect(sim.dungeonFinderInfoFor(leader)).toEqual(beforeLeader);
      expect(sim.dungeonFinderInfoFor(mate)).toEqual(beforeMate);
      expect(sim.dungeonFinderInfoFor(leader)?.roles).toEqual(['dps']);
      expect(sim.dungeonFinderInfoFor(leader)?.myListing).toBeNull();
      expect(sim.dungeonFinderBoardView()).toEqual([]);
    },
  );

  it('joining a party clears member applications and preserves the unrelated listing', () => {
    const { sim, add, leader } = setup();
    const mate = add();
    const otherLeader = add();
    sim.dungeonFinderListingCreate('hollow_crypt_normal', [], otherLeader);
    const unrelated = sim.dungeonFinderBoardView()[0];
    sim.dungeonFinderApply(unrelated.id, mate);
    expect(sim.dungeonFinderInfoFor(mate)?.myApplication?.listingId).toBe(unrelated.id);
    join(sim, leader, mate);
    expect(sim.dungeonFinderInfoFor(mate)?.myApplication).toBeNull();
    sim.dungeonFinderApply(unrelated.id, mate);
    expect(sim.dungeonFinderInfoFor(mate)?.myApplication).toBeNull();
    sim.dungeonFinderExpeditionConfigure(recruit, leader);
    expect(sim.dungeonFinderInfoFor(leader)?.myListing).not.toBeNull();
    expect(sim.dungeonFinderBoardView()).toHaveLength(2);
    expect(sim.dungeonFinderBoardView().find((row) => row.id === unrelated.id)).toEqual(unrelated);
  });
});

describe('ordinary listing applications with one chosen role', () => {
  it.each(['nythraxis_boss_arena_normal', 'nythraxis_crypt_normal'])(
    'keeps %s ordinary listings on the legacy application path',
    (activityId) => {
      const { sim, add, leader } = setup();
      sim.setPlayerLevel(20, leader);
      const applicant = add('priest', 20);
      sim.dungeonFinderSetRoles(['healer'], applicant);
      sim.dungeonFinderListingCreate(activityId, [], leader);
      const listingId = sim.dungeonFinderBoardView()[0].id;
      sim.dungeonFinderExpeditionApply(listingId, 'healer', applicant);
      expect(sim.dungeonFinderInfoFor(applicant)?.myApplication).toBeNull();
      sim.dungeonFinderApply(listingId, applicant);
      expect(sim.dungeonFinderInfoFor(applicant)?.myApplication?.listingId).toBe(listingId);
    },
  );
  it.each(['healer', 'dps'] as const)(
    'carries the chosen %s role through application and acceptance despite another sticky role',
    (role) => {
      const { sim, add, leader } = setup();
      sim.dungeonFinderExpeditionConfigure(recruit, leader);
      const applicant = add('priest');
      const sticky = role === 'healer' ? 'dps' : 'healer';
      sim.dungeonFinderSetRoles([sticky], applicant);
      const listingId = sim.dungeonFinderBoardView()[0].id;
      sim.dungeonFinderExpeditionApply(listingId, role, applicant);
      expect(sim.dungeonFinderInfoFor(leader)?.myListing?.applicants).toMatchObject([
        { pid: applicant, roles: [role] },
      ]);
      expect(sim.dungeonFinderInfoFor(applicant)?.roles).toEqual([sticky]);
      sim.dungeonFinderApplicationRespond(applicant, true, leader);
      expect(sim.partyOf(applicant)?.leader).toBe(leader);
      expect(sim.dungeonFinderInfoFor(applicant)?.roles).toEqual([role]);
      expect(
        sim.dungeonFinderBoardView()[0].members.find((member) => member.cls === 'priest')?.role,
      ).toBe(role);
    },
  );

  it('refuses an incompatible chosen role without changing sticky roles or pending applications', () => {
    const { sim, add, leader } = setup();
    sim.dungeonFinderExpeditionConfigure(recruit, leader);
    const applicant = add('warrior');
    sim.dungeonFinderExpeditionApply(sim.dungeonFinderBoardView()[0].id, 'healer', applicant);
    expect(sim.dungeonFinderInfoFor(applicant)?.roles).toEqual(['dps']);
    expect(sim.dungeonFinderInfoFor(applicant)?.myApplication).toBeNull();
    expect(sim.dungeonFinderInfoFor(leader)?.myListing?.applicants).toEqual([]);
  });

  it('preserves legacy applications using the latest compatible sticky roles on acceptance', () => {
    const { sim, add, leader } = setup();
    sim.dungeonFinderExpeditionConfigure(recruit, leader);
    const applicant = add('priest');
    sim.dungeonFinderSetRoles(['healer'], applicant);
    sim.dungeonFinderApply(sim.dungeonFinderBoardView()[0].id, applicant);
    expect(sim.dungeonFinderInfoFor(leader)?.myListing?.applicants[0].roles).toEqual(['healer']);
    sim.dungeonFinderSetRoles(['dps'], applicant);
    sim.dungeonFinderApplicationRespond(applicant, true, leader);
    expect(sim.partyOf(applicant)?.leader).toBe(leader);
    expect(sim.dungeonFinderInfoFor(applicant)?.roles).toEqual(['dps']);
  });

  it.each(['role_compatibility', 'queue'])(
    'rechecks %s on acceptance before changing the role or joining the group',
    (changed) => {
      const { sim, add, leader } = setup();
      sim.dungeonFinderExpeditionConfigure(recruit, leader);
      const applicant = add('priest');
      sim.dungeonFinderExpeditionApply(sim.dungeonFinderBoardView()[0].id, 'healer', applicant);
      expect(sim.dungeonFinderInfoFor(leader)?.myListing?.applicants).toHaveLength(1);
      if (changed === 'role_compatibility') {
        const meta = sim.players.get(applicant);
        if (!meta) throw new Error('missing applicant');
        meta.cls = 'warrior';
      } else sim.dungeonFinderQueueJoin(['hollow_crypt_normal'], applicant);
      sim.dungeonFinderApplicationRespond(applicant, true, leader);
      expect(sim.partyOf(applicant)).toBeNull();
      expect(sim.dungeonFinderInfoFor(applicant)?.roles).toEqual(['dps']);
      if (changed === 'queue') expect(sim.dungeonFinderInfoFor(applicant)?.queue).not.toBeNull();
    },
  );

  it.each(['queue', 'proposal'])(
    'refuses chosen-role applications while in a %s without clearing it',
    (state) => {
      const { sim, add, leader } = setup();
      sim.dungeonFinderExpeditionConfigure(recruit, leader);
      const applicant = add('priest');
      sim.dungeonFinderSetRoles(['healer'], applicant);
      const queued = [applicant];
      if (state === 'proposal') {
        const tank = add();
        sim.dungeonFinderSetRoles(['tank'], tank);
        queued.push(tank, add('mage'), add('rogue'), add('hunter'));
      }
      for (const pid of queued) sim.dungeonFinderQueueJoin(['hollow_crypt_normal'], pid);
      if (state === 'proposal') sim.tick();
      const before = sim.dungeonFinderInfoFor(applicant);
      sim.dungeonFinderExpeditionApply(sim.dungeonFinderBoardView()[0].id, 'healer', applicant);
      expect(sim.dungeonFinderInfoFor(applicant)).toEqual(before);
      expect(sim.dungeonFinderInfoFor(leader)?.myListing?.applicants).toEqual([]);
    },
  );
});
