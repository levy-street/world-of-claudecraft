import { describe, expect, it } from 'vitest';
import { FINDER_GUILD_TAG, isFinderListingTag } from '../src/sim/content/dungeon_finder';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

function setup() {
  const sim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true, world: EMPTY_TEST_WORLD });
  const add = (guild: string) => {
    const pid = sim.addPlayer('warrior', `Player${sim.players.size}`);
    sim.setPlayerLevel(8, pid);
    sim.dungeonFinderSetRoles(['dps'], pid);
    if (guild) sim.setPlayerGuild(pid, guild);
    return pid;
  };
  return { sim, add };
}
const errorsFor = (events: SimEvent[], pid: number) =>
  events
    .filter((e) => e.type === 'error' && e.pid === pid)
    .map((e) => (e as { text: string }).text);

describe('Guild Parties (guild_only listings)', () => {
  it('accepts the guild tag on the wire but keeps it out of the purpose chips', () => {
    expect(isFinderListingTag(FINDER_GUILD_TAG)).toBe(true);
    expect(isFinderListingTag('guild')).toBe(false);
  });

  it('refuses a guildless leader and publishes for a guilded one with the guild on the row', () => {
    const { sim, add } = setup();
    const loner = add('');
    sim.dungeonFinderListingCreate('hollow_crypt_normal', [FINDER_GUILD_TAG], loner);
    expect(errorsFor(sim.tick(), loner)).toContain(
      'You must be in a guild to create a Guild Party.',
    );
    expect(sim.dungeonFinderBoardView()).toEqual([]);

    const leader = add('Nightwatch');
    sim.dungeonFinderListingCreate('hollow_crypt_normal', [FINDER_GUILD_TAG], leader);
    expect(sim.dungeonFinderBoardView()).toMatchObject([
      { tags: [FINDER_GUILD_TAG], guild: 'Nightwatch' },
    ]);
    // An open listing carries no guild field at all.
    sim.dungeonFinderListingCreate('hollow_crypt_normal', [], loner);
    expect(sim.dungeonFinderBoardView()[1].guild).toBeUndefined();
  });

  it('refuses a Guild Party when a current party member is outside the guild', () => {
    const { sim, add } = setup();
    const leader = add('Nightwatch');
    const outsider = add('Other');
    sim.partyInvite(outsider, leader);
    sim.partyAccept(outsider);
    sim.dungeonFinderListingCreate('hollow_crypt_normal', [FINDER_GUILD_TAG], leader);
    expect(errorsFor(sim.tick(), leader)).toContain(
      'Every member of a Guild Party must be in your guild.',
    );
    expect(sim.dungeonFinderBoardView()).toEqual([]);
  });

  it('only guildmates can apply, and acceptance rechecks the guild', () => {
    const { sim, add } = setup();
    const leader = add('Nightwatch');
    const outsider = add('Other');
    const guildless = add('');
    const mate = add('Nightwatch');
    sim.dungeonFinderListingCreate('hollow_crypt_normal', [FINDER_GUILD_TAG], leader);
    const listingId = sim.dungeonFinderBoardView()[0].id;
    sim.dungeonFinderApply(listingId, outsider);
    sim.dungeonFinderApply(listingId, guildless);
    const events = sim.tick();
    const only = 'That group is a Guild Party for members of its guild only.';
    expect(errorsFor(events, outsider)).toContain(only);
    expect(errorsFor(events, guildless)).toContain(only);

    sim.dungeonFinderApply(listingId, mate);
    expect(sim.dungeonFinderInfoFor(leader)?.myListing?.applicants.map((a) => a.pid)).toEqual([
      mate,
    ]);
    // The applicant leaves the guild before the leader answers: no seat.
    sim.setPlayerGuild(mate, '');
    sim.dungeonFinderApplicationRespond(mate, true, leader);
    expect(errorsFor(sim.tick(), leader)).toContain('That player is no longer available.');
    expect(sim.dungeonFinderBoardView()[0].size).toBe(1);
  });

  it('seats a guildmate applicant on acceptance', () => {
    const { sim, add } = setup();
    const leader = add('Nightwatch');
    const mate = add('Nightwatch');
    sim.dungeonFinderListingCreate('hollow_crypt_normal', [FINDER_GUILD_TAG], leader);
    sim.dungeonFinderApply(sim.dungeonFinderBoardView()[0].id, mate);
    sim.dungeonFinderApplicationRespond(mate, true, leader);
    expect(sim.dungeonFinderBoardView()[0].size).toBe(2);
  });

  it('closes a Guild Party when its roster leaves the leader guild', () => {
    const { sim, add } = setup();
    const leader = add('Nightwatch');
    const outsider = add('Other');
    sim.dungeonFinderListingCreate('hollow_crypt_normal', [FINDER_GUILD_TAG], leader);
    // An outsider joins by a plain party invite: the next sweep closes the listing.
    sim.partyInvite(outsider, leader);
    sim.partyAccept(outsider);
    for (let i = 0; i < 25; i++) sim.tick();
    expect(sim.dungeonFinderBoardView()).toEqual([]);
    expect(sim.dungeonFinderInfoFor(leader)?.myListing).toBeNull();

    const solo = add('Nightwatch');
    sim.dungeonFinderListingCreate('hollow_crypt_normal', [FINDER_GUILD_TAG], solo);
    expect(sim.dungeonFinderBoardView()).toHaveLength(1);
    sim.setPlayerGuild(solo, '');
    for (let i = 0; i < 25; i++) sim.tick();
    expect(sim.dungeonFinderBoardView()).toEqual([]);
  });

  it('shares applicant gear with the listing leader only', () => {
    const { sim, add } = setup();
    const leader = add('Nightwatch');
    const mate = add('Nightwatch');
    const bystander = add('Nightwatch');
    sim.dungeonFinderListingCreate('hollow_crypt_normal', [FINDER_GUILD_TAG], leader);
    sim.dungeonFinderApply(sim.dungeonFinderBoardView()[0].id, mate);
    const worn = sim.entities.get(mate)?.equippedItems ?? {};
    expect(sim.dungeonFinderInfoFor(leader)?.myListing?.applicants[0].gear).toEqual(worn);
    expect(JSON.stringify(sim.dungeonFinderInfoFor(mate))).not.toContain('"gear"');
    expect(JSON.stringify(sim.dungeonFinderInfoFor(bystander))).not.toContain('"gear"');
    expect(JSON.stringify(sim.dungeonFinderBoardView())).not.toContain('"gear"');
  });
});
