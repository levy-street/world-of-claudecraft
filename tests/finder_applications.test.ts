import { describe, expect, it } from 'vitest';
import { TALENTS } from '../src/sim/content/talents';
import { Sim } from '../src/sim/sim';
import { FINDER_EXPEDITION_RECENT_APPLICATION_CAP } from '../src/sim/social/dungeon_finder';
import {
  FINDER_PLAYER_APPLICATION_CAP,
  FinderApplications,
} from '../src/sim/social/finder_applications';
import { EMPTY_TEST_WORLD } from './sim_shared';

describe('finder application indexes', () => {
  it('keeps player and listing indexes aligned across scoped and whole-player removals', () => {
    const book = new FinderApplications();
    const first = {
      pid: 1,
      listingId: 10,
      leaderPid: 2,
      activityId: 'crypt',
      roles: ['dps'] as const,
      at: 1,
    };
    const add = (pid: number, listingId: number) =>
      book.set({ ...first, pid, listingId, roles: ['dps'] });
    add(1, 10);
    add(1, 20);
    add(3, 10);
    expect(book.get(1)?.listingId).toBe(10);
    expect(book.forListing(10).map((app) => app.pid)).toEqual([1, 3]);
    expect(book.delete(1, 20)).toBe(true);
    expect(book.forListing(20)).toEqual([]);
    expect(book.forPlayer(1).map((app) => app.listingId)).toEqual([10]);
    expect(book.delete(1)).toBe(true);
    expect(book.has(1)).toBe(false);
    expect(book.get(1)).toBeUndefined();
    expect(book.forListing(10).map((app) => app.pid)).toEqual([3]);
    expect(book.delete(1, 10)).toBe(false);
    expect(book.values().map((app) => app.pid)).toEqual([3]);
  });
});

function setup(count = 2) {
  const sim = new Sim({
    seed: 42,
    playerClass: 'warrior',
    noPlayer: true,
    world: EMPTY_TEST_WORLD,
  });
  const add = (name: string) => {
    const pid = sim.addPlayer('warrior', name);
    sim.setPlayerLevel(8, pid);
    sim.setSpec(TALENTS.warrior.specs.find((spec) => spec.role === 'dps')!.id, pid);
    sim.dungeonFinderSetRoles(['dps'], pid);
    return pid;
  };
  const helper = add('Helper');
  const leaders = Array.from({ length: count }, (_, i) => {
    const leader = add(`Leader${i}`);
    expect(sim.enterDungeon('hollow_crypt', leader)).toBe(true);
    sim.dungeonFinderExpeditionOpen(leader);
    return leader;
  });
  const listings = leaders.map((leader) => sim.dungeonFinderInfoFor(leader)!.myListing!.id);
  const apply = (index: number) => sim.dungeonFinderExpeditionApply(listings[index], 'dps', helper);
  const pending = () =>
    sim.dungeonFinderInfoFor(helper)!.myApplications!.map((app) => app.listingId);
  const sweep = () => {
    sim.tickCount = 19;
    sim.tick();
  };
  return { sim, add, helper, leaders, listings, apply, pending, sweep };
}

describe('independent expedition applications through the authoritative Sim', () => {
  it('reports the actual live applicant specialization independently of declared role', () => {
    const { sim, helper, leaders, apply } = setup(1);
    apply(0);
    const read = () => sim.dungeonFinderInfoFor(leaders[0])!.myListing!.applicants[0];
    expect(read().spec).toBe(sim.players.get(helper)!.talents.spec);
    const tankSpec = TALENTS.warrior.specs.find((spec) => spec.role === 'tank')!.id;
    sim.setSpec(tankSpec, helper);
    expect(read()).toMatchObject({ spec: tankSpec, roles: ['dps'] });
    sim.players.get(helper)!.talents.spec = null;
    expect(read()).toMatchObject({ spec: null, roles: ['dps'] });
  });

  it('applies to multiple leaders immediately and exposes the oldest legacy application', () => {
    const { sim, helper, leaders, listings, apply, pending } = setup();
    apply(0);
    apply(1);
    expect(pending()).toEqual(listings);
    expect(sim.dungeonFinderInfoFor(helper)?.myApplication).toEqual(
      sim.dungeonFinderInfoFor(helper)?.myApplications?.[0],
    );
    expect(sim.dungeonFinderInfoFor(helper)?.myApplications).toEqual([
      {
        listingId: listings[0],
        activityId: 'hollow_crypt_normal',
        leaderName: 'Leader0',
        remaining: 120,
      },
      {
        listingId: listings[1],
        activityId: 'hollow_crypt_normal',
        leaderName: 'Leader1',
        remaining: 120,
      },
    ]);
    for (const leader of leaders)
      expect(sim.dungeonFinderInfoFor(leader)?.myListing?.applicants.map((a) => a.pid)).toEqual([
        helper,
      ]);
  });

  it('bounds personal applications at five and keeps duplicate requests idempotent at the cap', () => {
    expect(FINDER_PLAYER_APPLICATION_CAP).toBe(5);
    const { sim, helper, leaders, listings, apply, pending } = setup(6);
    for (let i = 0; i < listings.length; i++) apply(i);
    sim.time += 20;
    apply(0);
    expect(pending()).toEqual(listings.slice(0, 5));
    expect(sim.dungeonFinderInfoFor(helper)?.myApplications?.[0].remaining).toBe(100);
    expect(sim.dungeonFinderInfoFor(leaders.at(-1)!)?.myListing?.applicants).toEqual([]);
  });

  it.each(['cancel', 'decline', 'close'] as const)(
    '%s affects only its selected listing',
    (action) => {
      const { sim, helper, leaders, listings, apply, pending } = setup();
      apply(0);
      apply(1);
      if (action === 'cancel')
        sim.dungeonFinderExpeditionConfigure(
          { kind: 'cancel_application', listingId: listings[1] },
          helper,
        );
      if (action === 'decline') sim.dungeonFinderApplicationRespond(helper, false, leaders[1]);
      if (action === 'close') sim.dungeonFinderListingClose(leaders[1]);
      expect(pending()).toEqual([listings[0]]);
      expect(sim.dungeonFinderInfoFor(leaders[0])?.myListing?.applicants).toHaveLength(1);
    },
  );

  it('legacy cancellation withdraws the oldest request while retaining the others', () => {
    const { sim, helper, listings, apply, pending } = setup();
    apply(0);
    apply(1);
    sim.dungeonFinderApplyCancel(helper);
    expect(pending()).toEqual([listings[1]]);
    expect(sim.dungeonFinderInfoFor(helper)?.myApplication?.listingId).toBe(listings[1]);
  });

  it('expires each request from its own deadline', () => {
    const { sim, helper, listings, apply, pending, sweep } = setup();
    apply(0);
    sim.time += 60;
    apply(1);
    sim.time += 61;
    sweep();
    expect(pending()).toEqual([listings[1]]);
    expect(sim.dungeonFinderInfoFor(helper)?.applicationFeedback?.outcome).toBe('expired');
  });

  it('keeps the retry cooldown local to the rejected listing', () => {
    const { sim, helper, leaders, listings, apply, pending } = setup();
    apply(0);
    sim.dungeonFinderApplicationRespond(helper, false, leaders[0]);
    apply(0);
    apply(1);
    expect(pending()).toEqual([listings[1]]);
    sim.time += 11;
    apply(0);
    expect(pending()).toEqual([listings[1], listings[0]]);
  });

  it('preserves the first retry deadline after cancelling six distinct requests', () => {
    const { sim, helper, listings, apply, pending } = setup(6);
    for (let i = 0; i < listings.length; i++) {
      apply(i);
      expect(pending()).toEqual([listings[i]]);
      sim.dungeonFinderExpeditionConfigure(
        { kind: 'cancel_application', listingId: listings[i] },
        helper,
      );
    }
    apply(0);
    expect(pending()).toEqual([]);
    sim.time += 10;
    apply(0);
    expect(pending()).toEqual([listings[0]]);
  });

  it('refuses new requests when the recent-attempt window is full and recovers on expiry', () => {
    const { sim, helper, leaders, pending } = setup(1);
    const leader = leaders[0];
    let listing = sim.dungeonFinderInfoFor(leader)!.myListing!.id;
    for (let i = 0; i < FINDER_EXPEDITION_RECENT_APPLICATION_CAP; i++) {
      sim.dungeonFinderExpeditionApply(listing, 'dps', helper);
      expect(pending()).toEqual([listing]);
      sim.dungeonFinderExpeditionConfigure(
        { kind: 'cancel_application', listingId: listing },
        helper,
      );
      sim.dungeonFinderListingClose(leader);
      sim.dungeonFinderExpeditionOpen(leader);
      listing = sim.dungeonFinderInfoFor(leader)!.myListing!.id;
    }
    sim.dungeonFinderExpeditionApply(listing, 'dps', helper);
    expect(pending()).toEqual([]);
    sim.time += 10;
    // Expired entries are purged on application without waiting for the sweep.
    sim.dungeonFinderExpeditionApply(listing, 'dps', helper);
    expect(pending()).toEqual([listing]);
  });

  it('clears every competing request on acceptance and rejects a second leader in the same tick', () => {
    const { sim, helper, leaders, apply, pending } = setup();
    apply(0);
    apply(1);
    sim.dungeonFinderApplicationRespond(helper, true, leaders[1]);
    expect(pending()).toEqual([]);
    expect(sim.dungeonFinderInfoFor(leaders[0])?.myListing?.applicants).toEqual([]);
    sim.dungeonFinderApplicationRespond(helper, true, leaders[0]);
    expect(sim.partyOf(helper)?.leader).toBe(leaders[1]);
    expect(sim.partyOf(leaders[0])).toBeNull();
    expect(sim.dungeonFinderInfoFor(helper)?.applicationFeedback?.outcome).toBe('accepted');
  });

  it('clears all requests immediately when an ordinary invite forms another party', () => {
    const { sim, add, helper, leaders, apply, pending } = setup();
    const inviter = add('Inviter');
    apply(0);
    apply(1);
    sim.partyInvite(helper, inviter);
    sim.partyAccept(helper);
    expect(pending()).toEqual([]);
    for (const leader of leaders)
      expect(sim.dungeonFinderInfoFor(leader)?.myListing?.applicants).toEqual([]);
    expect(sim.partyOf(helper)?.leader).toBe(inviter);
  });

  it('preserves the declared role across spec changes and clears competing requests on joining', () => {
    const { sim, helper, leaders, apply, pending } = setup();
    apply(0);
    apply(1);
    const tankSpec = TALENTS.warrior.specs.find((spec) => spec.role === 'tank')!.id;
    sim.setSpec(tankSpec, helper);
    sim.dungeonFinderApplicationRespond(helper, true, leaders[0]);
    expect(sim.partyOf(helper)?.leader).toBe(leaders[0]);
    expect(pending()).toEqual([]);
    expect(sim.players.get(helper)!.talents.spec).toBe(tankSpec);
  });

  it('preserves single pending application behavior for ordinary listings', () => {
    const { sim, add, helper, apply, pending } = setup();
    const leader = add('Ordinary');
    sim.dungeonFinderListingCreate('hollow_crypt_normal', [], leader);
    const listing = sim.dungeonFinderInfoFor(leader)!.myListing!.id;
    sim.dungeonFinderApply(listing, helper);
    apply(0);
    expect(pending()).toEqual([listing]);
    sim.dungeonFinderApplyCancel(helper);
    apply(0);
    sim.dungeonFinderApply(listing, helper);
    expect(pending()).toHaveLength(1);
    expect(pending()).not.toContain(listing);
  });
});
