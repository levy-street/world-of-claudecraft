import { describe, expect, it } from 'vitest';
import { dispatchDungeonFinderCommand } from '../server/dungeon_finder_commands';
import { decodeDungeonFinderInfo } from '../src/net/dungeon_finder_wire';
import { Sim } from '../src/sim/sim';
import { finderDifficultySiblings } from '../src/sim/social/finder_listing_edit';
import type { PlayerClass, SimEvent } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

function setup() {
  const sim = new Sim({
    seed: 11,
    playerClass: 'warrior',
    noPlayer: true,
    world: EMPTY_TEST_WORLD,
  });
  const add = (cls: PlayerClass, level: number, name: string) => {
    const pid = sim.addPlayer(cls, name);
    sim.setPlayerLevel(level, pid);
    return pid;
  };
  const party = (leader: number, ...members: number[]) => {
    for (const pid of members) {
      sim.partyInvite(pid, leader);
      sim.partyAccept(pid);
    }
  };
  return { sim, add, party };
}
// Notices reach the player as `log` events.
const textsFor = (events: SimEvent[], pid: number, type: 'error' | 'log') =>
  events.filter((e) => e.type === type && e.pid === pid).map((e) => (e as { text: string }).text);

describe('bring your party: leader-assigned member roles', () => {
  it('seats the party on the listing and fills the needed roles from the assignment', () => {
    const { sim, add, party } = setup();
    const leader = add('warrior', 8, 'Lead');
    const priest = add('priest', 8, 'Mender');
    const mage = add('mage', 8, 'Spark');
    sim.dungeonFinderSetRoles(['tank'], leader);
    party(leader, priest, mage);
    sim.dungeonFinderListingCreate('hollow_crypt_normal', [], leader);
    // Before an assignment the members have no finder role, so every slot reads open.
    expect(sim.dungeonFinderBoardView()[0]).toMatchObject({
      size: 3,
      needed: { tank: 0, healer: 1, dps: 3 },
    });

    sim.dungeonFinderExpeditionConfigure(
      {
        kind: 'party_roles',
        roles: [
          { pid: priest, role: 'healer' },
          { pid: mage, role: 'dps' },
        ],
      },
      leader,
    );
    const row = sim.dungeonFinderBoardView()[0];
    expect(row.needed).toEqual({ tank: 0, healer: 0, dps: 2 });
    expect(row.members.map((m) => m.role)).toEqual(['tank', 'healer', 'dps']);
    const mine = sim.dungeonFinderInfoFor(leader)?.myListing;
    expect(mine?.partyRoles).toEqual([
      { pid: priest, role: 'healer' },
      { pid: mage, role: 'dps' },
    ]);
    expect(mine?.advertText).toBe('LFM - The Hollow Crypt - Normal - 3/5 - DPS needed');
    // The assignment is listing-scoped: the members' own selections are untouched.
    expect(sim.dungeonFinderInfoFor(priest)?.roles).toEqual([]);
  });

  it('ignores a role the class cannot fill, a non-member, and the leader, and a resend replaces', () => {
    const { sim, add, party } = setup();
    const leader = add('warrior', 8, 'Lead');
    const mage = add('mage', 8, 'Spark');
    const stranger = add('priest', 8, 'Stranger');
    sim.dungeonFinderSetRoles(['tank'], leader);
    party(leader, mage);
    sim.dungeonFinderListingCreate('hollow_crypt_normal', [], leader);
    sim.dungeonFinderExpeditionConfigure(
      {
        kind: 'party_roles',
        roles: [
          { pid: mage, role: 'healer' },
          { pid: stranger, role: 'healer' },
          { pid: leader, role: 'dps' },
        ],
      },
      leader,
    );
    expect(sim.dungeonFinderInfoFor(leader)?.myListing?.partyRoles).toEqual([]);
    sim.dungeonFinderExpeditionConfigure(
      { kind: 'party_roles', roles: [{ pid: mage, role: 'dps' }] },
      leader,
    );
    expect(sim.dungeonFinderBoardView()[0].needed?.dps).toBe(2);
    // The whole list each time: leaving the mage out returns them to their own selection.
    sim.dungeonFinderExpeditionConfigure({ kind: 'party_roles', roles: [] }, leader);
    expect(sim.dungeonFinderInfoFor(leader)?.myListing?.partyRoles).toEqual([]);
    expect(sim.dungeonFinderBoardView()[0].needed?.dps).toBe(3);
    // A party member who is not the leader edits nothing.
    sim.dungeonFinderExpeditionConfigure(
      { kind: 'party_roles', roles: [{ pid: mage, role: 'dps' }] },
      mage,
    );
    expect(sim.dungeonFinderInfoFor(leader)?.myListing?.partyRoles).toEqual([]);
  });

  it('counts assigned roles when an applicant asks for a seat', () => {
    const { sim, add, party } = setup();
    const leader = add('warrior', 8, 'Lead');
    const priest = add('priest', 8, 'Mender');
    const healer = add('priest', 8, 'Applicant');
    sim.dungeonFinderSetRoles(['tank'], leader);
    sim.dungeonFinderSetRoles(['healer'], healer);
    party(leader, priest);
    sim.dungeonFinderListingCreate('hollow_crypt_normal', [], leader);
    sim.dungeonFinderExpeditionConfigure(
      { kind: 'party_roles', roles: [{ pid: priest, role: 'healer' }] },
      leader,
    );
    sim.dungeonFinderApply(sim.dungeonFinderBoardView()[0].id, healer);
    expect(textsFor(sim.tick(), healer, 'error')).toContain(
      'That listing has no room for your roles.',
    );
  });
});

describe('a returning member seats by the role they applied with', () => {
  it('drops a stale assignment when the player is accepted back', () => {
    const { sim, add, party } = setup();
    const leader = add('warrior', 8, 'Lead');
    const druid = add('druid', 8, 'Bramble');
    sim.dungeonFinderSetRoles(['tank'], leader);
    party(leader, druid);
    sim.dungeonFinderListingCreate('hollow_crypt_normal', [], leader);
    sim.dungeonFinderExpeditionConfigure(
      { kind: 'party_roles', roles: [{ pid: druid, role: 'dps' }] },
      leader,
    );
    sim.partyLeave(druid);
    sim.tick();
    sim.dungeonFinderSetRoles(['healer'], druid);
    sim.dungeonFinderApply(sim.dungeonFinderBoardView()[0].id, druid);
    sim.dungeonFinderApplicationRespond(druid, true, leader);
    sim.tick();
    const row = sim.dungeonFinderBoardView()[0];
    expect(row.size).toBe(2);
    expect(row.members.map((m) => m.role)).toEqual(['tank', 'healer']);
    expect(sim.dungeonFinderInfoFor(leader)?.myListing?.partyRoles).toEqual([]);
  });
});

describe('changing a listing difficulty', () => {
  it('offers only the same content at its other difficulties', () => {
    expect(finderDifficultySiblings('gravewyrm_sanctum_normal').map((a) => a.id)).toEqual([
      'gravewyrm_sanctum_heroic',
    ]);
    expect(finderDifficultySiblings('nythraxis_crypt_normal')).toEqual([]);
    expect(finderDifficultySiblings('no_such_activity')).toEqual([]);
  });

  it('switches Normal to Heroic and back, keeping the listing, and releases out-of-band applicants', () => {
    const { sim, add } = setup();
    const leader = add('warrior', 20, 'Lead');
    const capped = add('mage', 20, 'Capped');
    const young = add('rogue', 19, 'Young');
    sim.dungeonFinderSetRoles(['tank'], leader);
    sim.dungeonFinderSetRoles(['dps'], capped);
    sim.dungeonFinderSetRoles(['dps'], young);
    sim.dungeonFinderListingCreate('gravewyrm_sanctum_normal', [], leader);
    const id = sim.dungeonFinderBoardView()[0].id;
    sim.dungeonFinderApply(id, capped);
    sim.dungeonFinderApply(id, young);
    sim.tick();

    sim.dungeonFinderExpeditionConfigure(
      { kind: 'difficulty', activityId: 'gravewyrm_sanctum_heroic' },
      leader,
    );
    const events = sim.tick();
    expect(textsFor(events, leader, 'log')).toContain('Your group listing difficulty is updated.');
    expect(textsFor(events, young, 'log')).toContain(
      'The group you applied to changed its difficulty, so your application was withdrawn.',
    );
    expect(sim.dungeonFinderBoardView()).toMatchObject([
      { id, activityId: 'gravewyrm_sanctum_heroic' },
    ]);
    const mine = sim.dungeonFinderInfoFor(leader)?.myListing;
    expect(mine?.activityId).toBe('gravewyrm_sanctum_heroic');
    expect(mine?.applicants.map((a) => a.pid)).toEqual([capped]);
    // The kept applicant's own application row follows the new difficulty.
    expect(sim.dungeonFinderInfoFor(capped)?.myApplications?.[0]?.activityId).toBe(
      'gravewyrm_sanctum_heroic',
    );
    expect(mine?.advertText).toMatch(/^LFM - .* - Heroic - 1\/5 - /);

    sim.dungeonFinderExpeditionConfigure(
      { kind: 'difficulty', activityId: 'gravewyrm_sanctum_normal' },
      leader,
    );
    expect(sim.dungeonFinderBoardView()[0].activityId).toBe('gravewyrm_sanctum_normal');
  });

  it('refuses other content, a member outside the new band, and a player with no listing', () => {
    const { sim, add, party } = setup();
    const leader = add('warrior', 20, 'Lead');
    const young = add('mage', 19, 'Young');
    sim.dungeonFinderSetRoles(['tank'], leader);
    party(leader, young);
    sim.dungeonFinderListingCreate('gravewyrm_sanctum_normal', [], leader);

    sim.dungeonFinderExpeditionConfigure(
      { kind: 'difficulty', activityId: 'hollow_crypt_heroic' },
      leader,
    );
    expect(textsFor(sim.tick(), leader, 'error')).toContain('That listing is no longer available.');
    sim.dungeonFinderExpeditionConfigure(
      { kind: 'difficulty', activityId: 'gravewyrm_sanctum_heroic' },
      leader,
    );
    expect(textsFor(sim.tick(), leader, 'error')).toContain(
      'Young does not meet the level range for that activity.',
    );
    expect(sim.dungeonFinderBoardView()[0].activityId).toBe('gravewyrm_sanctum_normal');

    sim.dungeonFinderExpeditionConfigure(
      { kind: 'difficulty', activityId: 'gravewyrm_sanctum_heroic' },
      young,
    );
    expect(textsFor(sim.tick(), young, 'error')).toContain('You do not lead a group listing.');
  });
});

describe('online: the new configure kinds on the wire', () => {
  it('forwards well-formed party_roles and difficulty commands and drops malformed ones', () => {
    const { sim, add, party } = setup();
    const leader = add('warrior', 20, 'Lead');
    const mage = add('mage', 20, 'Spark');
    sim.dungeonFinderSetRoles(['tank'], leader);
    party(leader, mage);
    sim.dungeonFinderListingCreate('gravewyrm_sanctum_normal', [], leader);
    const send = (settings: unknown) =>
      dispatchDungeonFinderCommand(sim, leader, { cmd: 'df_expedition_configure', settings });

    send({ kind: 'party_roles', roles: [{ pid: mage, role: 'wizard' }] });
    send({ kind: 'party_roles', roles: [{ pid: -1, role: 'dps' }] });
    send({ kind: 'party_roles', roles: 'dps' });
    expect(sim.dungeonFinderInfoFor(leader)?.myListing?.partyRoles).toEqual([]);
    send({ kind: 'party_roles', roles: [{ pid: mage, role: 'dps', extra: 1 }] });
    expect(sim.dungeonFinderInfoFor(leader)?.myListing?.partyRoles).toEqual([
      { pid: mage, role: 'dps' },
    ]);

    send({ kind: 'difficulty', activityId: 7 });
    send({ kind: 'difficulty', activityId: 'x'.repeat(65) });
    expect(sim.dungeonFinderBoardView()[0].activityId).toBe('gravewyrm_sanctum_normal');
    send({ kind: 'difficulty', activityId: 'gravewyrm_sanctum_heroic' });
    expect(sim.dungeonFinderBoardView()[0].activityId).toBe('gravewyrm_sanctum_heroic');
  });

  it('keeps a valid partyRoles list on the client mirror and drops only a malformed one', () => {
    const base = {
      roles: [],
      eligibleRoles: [],
      queue: null,
      cooldown: 0,
      proposal: null,
      myApplication: null,
      myListing: { id: 1, activityId: 'hollow_crypt_normal', tags: [], applicants: [] },
    };
    const good = decodeDungeonFinderInfo({
      ...base,
      myListing: { ...base.myListing, partyRoles: [{ pid: 4, role: 'healer' }] },
    });
    expect(good?.myListing?.partyRoles).toEqual([{ pid: 4, role: 'healer' }]);
    const bad = decodeDungeonFinderInfo({
      ...base,
      myListing: { ...base.myListing, partyRoles: [{ pid: 4, role: 'bard' }] },
    });
    expect(bad?.myListing).toMatchObject({ id: 1, activityId: 'hollow_crypt_normal' });
    expect(bad?.myListing?.partyRoles).toBeUndefined();
  });
});
