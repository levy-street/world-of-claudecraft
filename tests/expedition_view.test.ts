import { describe, expect, it } from 'vitest';
import { buildExpeditionView } from '../src/ui/hud/expeditions/expedition_view';
import type { DungeonFinderInfo, DungeonFinderListingView } from '../src/world_api/dungeon_finder';

const info = (): DungeonFinderInfo => ({
  roles: ['tank'],
  eligibleRoles: ['tank', 'dps'],
  queue: null,
  cooldown: 0,
  proposal: null,
  myListing: null,
  myApplication: null,
  expedition: {
    exitId: 20,
    activityId: 'hollow_crypt_normal',
    dungeonId: 'hollow_crypt',
    leaderPid: 1,
    isLeader: true,
    isInside: true,
    canTravel: false,
    open: false,
    bossesDefeated: 0,
    bossesTotal: 4,
  },
});
const group = (id = 3): DungeonFinderListingView => ({
  id,
  activityId: 'hollow_crypt_normal',
  leaderName: 'Ana',
  tags: [],
  size: 1,
  capacity: 5,
  needed: { tank: 0, healer: 1, dps: 3 },
  members: [],
  expedition: { bossesDefeated: 1, bossesTotal: 4 },
});

describe('open expedition view', () => {
  it('projects a published pre-entry listing as forming a group with applicants and capacity', () => {
    const state = info();
    state.expedition = null;
    state.myListing = {
      id: 3,
      activityId: 'hollow_crypt_normal',
      tags: [],
      applicants: [{ pid: 2, name: 'Bru', cls: 'priest', level: 8, roles: ['healer'] }],
    };
    const view = buildExpeditionView(state, [], 1, false, false, null);
    expect(view.run).toBeNull();
    expect(view.recruitment?.dungeonId).toBe('hollow_crypt');
    expect(view.capacity).toBe(5);
    expect(view.requests[0]?.pid).toBe(2);
    expect(view.alert?.pid).toBe(2);
    expect(view.prompt).toBeNull();
  });
  it('keeps other groups requestable while projecting independent pending requests', () => {
    const state = info();
    state.myApplications = [
      { listingId: 3, remaining: 90 },
      { listingId: 4, remaining: 60 },
    ];
    const view = buildExpeditionView(state, [group(3), group(4), group(5)], 1, false, false, null);
    expect(view.groups.map((row) => row.canApply)).toEqual([false, false, true]);
    expect(view.applications.map((app) => app.listingId)).toEqual([3, 4]);
    state.myApplications = [3, 4, 6, 7, 8].map((listingId) => ({ listingId }));
    expect(buildExpeditionView(state, [group(5)], 1, false, false, null).groups[0].canApply).toBe(
      false,
    );
  });
  it('partitions the current listing from other groups without losing it when recruitment closes', () => {
    const state = info();
    state.myListing = { id: 3, activityId: 'hollow_crypt_normal', tags: [], applicants: [] };
    const view = buildExpeditionView(state, [group(3), group(4)], 1, false, false, null);
    expect(view.currentGroup?.id).toBe(3);
    expect(view.otherGroups.map((row) => row.id)).toEqual([4]);
    state.myListing = null;
    expect(buildExpeditionView(state, [], 1, false, false, null).run?.exitId).toBe(20);
  });
  it('keeps party roster identity in the view and removes an accepted member current group from browsing', () => {
    const state = info();
    state.expedition!.leaderPid = 9;
    state.expedition!.isLeader = false;
    const party = {
      leader: 9,
      members: [{ pid: 9, name: 'Ana', cls: 'warrior', level: 8, role: 'tank' }],
      raid: false,
    } as never;
    const view = buildExpeditionView(state, [group()], 1, true, false, null, 2, party);
    expect(view.currentGroup?.id).toBe(3);
    expect(view.otherGroups).toEqual([]);
    expect(view.partyMembers[0].name).toBe('Ana');
  });
  it('prompts on the current live claim, with solo dismiss scoped to that claim', () => {
    const state = info();
    expect(buildExpeditionView(state, [], 1, false, false, null).prompt?.exitId).toBe(20);
    expect(buildExpeditionView(state, [], 1, false, false, 20).prompt).toBeNull();
    state.expedition!.exitId = 21;
    expect(buildExpeditionView(state, [], 1, false, false, 20).prompt?.exitId).toBe(21);
  });
  it('suppresses automatic prompts and request cards in combat but preserves pending counts', () => {
    const state = info();
    state.expedition!.open = true;
    state.myListing = {
      id: 3,
      activityId: 'hollow_crypt_normal',
      tags: [],
      applicants: [{ pid: 2, name: 'Bru', cls: 'priest', level: 8, roles: ['healer'] }],
    };
    const view = buildExpeditionView(state, [group()], 1, false, true, null);
    expect(view.prompt).toBeNull();
    expect(view.alert).toBeNull();
    expect(view.requests).toHaveLength(1);
  });
  it('does not surface an expired request as an automatic alert', () => {
    const state = info();
    state.expedition!.open = true;
    state.myListing = {
      id: 3,
      activityId: 'hollow_crypt_normal',
      tags: [],
      applicants: [
        { pid: 2, name: 'Bru', cls: 'priest', level: 8, roles: ['healer'], remaining: 0 },
      ],
    };
    const view = buildExpeditionView(state, [], 1, false, false, null);
    expect(view.requests).toHaveLength(0);
    expect(view.alert).toBeNull();
  });
  it('keeps the current run available after dismissing the entry prompt', () => {
    expect(buildExpeditionView(info(), [], 1, false, false, 20).run?.isLeader).toBe(true);
  });
  it('does not offer recruitment when the current party fills the dungeon', () => {
    const view = buildExpeditionView(info(), [], 1, true, false, null, 5);
    expect(view.canOpen).toBe(false);
    expect(view.prompt).toBeNull();
  });
  it('shows pre-entry groups alongside running expeditions', () => {
    const manual = group(4);
    delete manual.expedition;
    expect(
      buildExpeditionView(info(), [group(), manual], 1, false, false, null).groups,
    ).toHaveLength(2);
  });
  it('suggests missing roles without blocking another compatible role', () => {
    const listing = group();
    listing.needed = null;
    listing.members = [{ cls: 'warrior', level: 8, role: 'tank' }];
    const view = buildExpeditionView(info(), [listing], 1, false, false, null);
    expect(view.groups[0].needed).toEqual({ tank: 0, healer: 1, dps: 3 });
    expect(view.groups[0].canApply).toBe(true);
    expect(view.roles).toContain('tank');
  });
  it.each(['grouped', 'pending', 'full', 'no-role'] as const)(
    'disables invalid application: %s',
    (reason) => {
      const state = info(),
        listing = group();
      if (reason === 'pending') state.myApplication = { listingId: listing.id };
      if (reason === 'full') listing.size = 5;
      if (reason === 'no-role') state.eligibleRoles = [];
      expect(
        buildExpeditionView(state, [listing], 1, reason === 'grouped', false, null).groups[0]
          .canApply,
      ).toBe(false);
    },
  );
  it('has stable signatures across identical input and changes with progress or requests', () => {
    const state = info(),
      listing = group();
    const sig = buildExpeditionView(state, [listing], 1, false, false, null).sig;
    expect(buildExpeditionView(state, [listing], 1, false, false, null).sig).toBe(sig);
    listing.expedition!.bossesDefeated++;
    expect(buildExpeditionView(state, [listing], 1, false, false, null).sig).not.toBe(sig);
  });
});
