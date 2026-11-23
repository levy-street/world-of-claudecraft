import { describe, expect, it } from 'vitest';
import { TALENTS } from '../src/sim/content/talents';
import { Sim } from '../src/sim/sim';
import { ExpeditionSocialState, validExpeditionDetails } from '../src/sim/social/expedition_social';
import { EMPTY_TEST_WORLD } from './sim_shared';

function setup() {
  const sim = new Sim({
    seed: 42,
    playerClass: 'warrior',
    noPlayer: true,
    world: EMPTY_TEST_WORLD,
  });
  const add = (name: string) => {
    const pid = sim.addPlayer('warrior', name);
    sim.setPlayerLevel(8, pid);
    sim.setSpec(TALENTS.warrior.specs.find((s) => s.role === 'dps')!.id, pid);
    sim.dungeonFinderSetRoles(['dps'], pid);
    return pid;
  };
  const leader = add('Leader');
  const helper = add('Helper');
  sim.enterDungeon('hollow_crypt', leader);
  sim.dungeonFinderExpeditionOpen(leader);
  const listing = sim.dungeonFinderBoardView()[0];
  return { sim, leader, helper, listing };
}
describe('expedition context, availability and request feedback', () => {
  it('limits metadata to known goals and short single-line notes', () => {
    expect(validExpeditionDetails({ purpose: 'needs_help', note: 'Last boss' })).toBe(true);
    expect(validExpeditionDetails({ purpose: 'admin', note: '' })).toBe(false);
    expect(validExpeditionDetails({ purpose: 'clear', note: 'x'.repeat(121) })).toBe(false);
    expect(validExpeditionDetails({ purpose: 'clear', note: 'a\nb' })).toBe(false);
  });
  it('only lets the current expedition leader publish details', () => {
    const { sim, leader, helper } = setup();
    sim.dungeonFinderExpeditionConfigure(
      { kind: 'details', details: { purpose: 'needs_help', note: '  Last boss  ' } },
      helper,
    );
    expect(sim.dungeonFinderBoardView()[0].details).toEqual({ purpose: 'clear', note: '' });
    sim.dungeonFinderExpeditionConfigure(
      { kind: 'details', details: { purpose: 'needs_help', note: '  Last boss  ' } },
      leader,
    );
    expect(sim.dungeonFinderBoardView()[0].details).toEqual({
      purpose: 'needs_help',
      note: 'Last boss',
    });
  });
  it('exposes remaining time to both sides and keeps explicit expiry feedback', () => {
    const { sim, leader, helper, listing } = setup();
    sim.dungeonFinderExpeditionApply(listing.id, 'dps', helper);
    expect(sim.dungeonFinderInfoFor(leader)?.myListing?.applicants[0].remaining).toBe(120);
    expect(sim.dungeonFinderInfoFor(helper)?.myApplication).toMatchObject({
      remaining: 120,
      leaderName: 'Leader',
    });
    sim.time += 121;
    sim.tickCount = 19;
    sim.tick();
    expect(sim.dungeonFinderInfoFor(helper)?.myApplication).toBeNull();
    expect(sim.dungeonFinderInfoFor(helper)?.applicationFeedback?.outcome).toBe('expired');
  });
  it.each(['declined', 'cancelled', 'closed'] as const)(
    'reports %s without leaving a pending request',
    (outcome) => {
      const { sim, leader, helper, listing } = setup();
      sim.dungeonFinderExpeditionApply(listing.id, 'dps', helper);
      if (outcome === 'declined') sim.dungeonFinderApplicationRespond(helper, false, leader);
      else if (outcome === 'cancelled') sim.dungeonFinderApplyCancel(helper);
      else sim.dungeonFinderListingClose(leader);
      expect(sim.dungeonFinderInfoFor(helper)?.myApplication).toBeNull();
      expect(sim.dungeonFinderInfoFor(helper)?.applicationFeedback?.outcome).toBe(outcome);
    },
  );
  it('alerts compatible opted-in helpers once, does not join them, and pauses while grouped', () => {
    const { sim, leader, helper, listing } = setup();
    sim.dungeonFinderExpeditionConfigure(
      { kind: 'available', enabled: true, roles: ['healer'] },
      helper,
    );
    expect(sim.dungeonFinderInfoFor(helper)?.availability?.enabled).toBe(false);
    sim.dungeonFinderExpeditionConfigure(
      { kind: 'available', enabled: true, roles: ['dps'] },
      helper,
    );
    sim.tickCount = 19;
    sim.tick();
    const first = sim.dungeonFinderInfoFor(helper)?.availability?.notice;
    expect(first?.listingIds).toEqual([listing.id]);
    expect(sim.partyOf(helper)).toBeNull();
    expect(sim.dungeonFinderInfoFor(helper)?.myApplication).toBeNull();
    sim.tickCount = 39;
    sim.tick();
    expect(sim.dungeonFinderInfoFor(helper)?.availability?.notice?.seq).toBe(first?.seq);
    sim.dungeonFinderExpeditionApply(listing.id, 'dps', helper);
    sim.dungeonFinderApplicationRespond(helper, true, leader);
    expect(sim.dungeonFinderInfoFor(helper)?.applicationFeedback?.outcome).toBe('accepted');
    sim.tickCount = 59;
    sim.tick();
    expect(sim.dungeonFinderInfoFor(helper)?.availability?.notice?.listingIds).toEqual([]);
    sim.dungeonFinderExpeditionConfigure({ kind: 'available', enabled: false, roles: [] }, helper);
    expect(sim.dungeonFinderInfoFor(helper)?.availability?.enabled).toBe(false);
  });
  it('bounds pending helper notifications and does not emit the same group every update', () => {
    const state = new ExpeditionSocialState();
    state.setAvailable(1, true, ['dps']);
    const rows = Array.from({ length: 50 }, (_, id) => ({
      id: id + 1,
      expedition: { bossesDefeated: 0, bossesTotal: 2 },
    })) as never;
    state.update(rows, 0, () => true);
    const first = state.readAvailability(1).notice!;
    expect(first.listingIds).toHaveLength(5);
    state.update(rows, 60, () => true);
    expect(state.readAvailability(1).notice?.seq).toBe(first.seq);
    state.remove(1);
    expect(state.readAvailability(1)).toEqual({ enabled: false, roles: [], notice: null });
  });
});
