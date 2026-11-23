import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommunityRelay } from '../server/community_relay';
import { drainRelay } from '../server/discord_relay';
import { dispatchDungeonFinderCommand } from '../server/dungeon_finder_commands';
import { FINDER_GUILD_TAG } from '../src/sim/content/dungeon_finder';
import { Sim } from '../src/sim/sim';
import {
  FINDER_ADVERT_COOLDOWN_SECONDS,
  FinderAdvertCooldowns,
  finderAdvertText,
} from '../src/sim/social/finder_advert';
import type { SimEvent } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

afterEach(() => {
  drainRelay();
});

const errorsFor = (events: SimEvent[], pid: number) =>
  events
    .filter((e) => e.type === 'error' && e.pid === pid)
    .map((e) => (e as { text: string }).text);

function leaderSim() {
  const sim = new Sim({ seed: 3, playerClass: 'warrior', noPlayer: true, world: EMPTY_TEST_WORLD });
  const leader = sim.addPlayer('warrior', 'Leader');
  sim.setPlayerLevel(8, leader);
  sim.dungeonFinderSetRoles(['tank'], leader);
  return { sim, leader };
}

describe('finderAdvertText: the LFM line', () => {
  it('names content, difficulty, size and the still-needed roles in the requested order', () => {
    expect(
      finderAdvertText({
        activityId: 'nythraxis_boss_arena_heroic',
        size: 4,
        capacity: 10,
        needed: { tank: 0, healer: 2, dps: 4 },
        guildOnly: false,
      }),
    ).toBe('LFM - Nythraxis Raid Arena - Heroic - 4/10 - Healer/DPS needed');
  });

  it('says any role when roles are not enforced, and flags a Guild Party', () => {
    expect(
      finderAdvertText({
        activityId: 'hollow_crypt_normal',
        size: 1,
        capacity: 5,
        needed: null,
        guildOnly: true,
      }),
    ).toBe('LFM - The Hollow Crypt - Normal - 1/5 - Any role needed - Guild only');
    expect(
      finderAdvertText({
        activityId: 'no_such_activity',
        size: 1,
        capacity: 5,
        needed: null,
        guildOnly: false,
      }),
    ).toBeNull();
  });
});

describe('FinderAdvertCooldowns', () => {
  it('spends 5 minutes for General and 30 for Discord, per key and per target', () => {
    expect(FINDER_ADVERT_COOLDOWN_SECONDS).toEqual({ general: 300, discord: 1800 });
    const book = new FinderAdvertCooldowns();
    expect(book.use(1, 'general', 0)).toBe(true);
    expect(book.use(1, 'general', 299)).toBe(false);
    expect(book.use(1, 'discord', 299)).toBe(true);
    expect(book.use(2, 'general', 1)).toBe(true);
    expect(book.view(1, 299, true)).toEqual({ general: 1, discord: 30, discordAvailable: true });
    expect(book.use(1, 'general', 300)).toBe(true);
    expect(book.use(1, 'discord', 299 + 1799)).toBe(false);
    expect(book.use(1, 'discord', 299 + 1800)).toBe(true);
  });
});

describe('offline Sim advert (the Groups window buttons)', () => {
  it('exposes the sim-built line on my listing and posts it to General once per cooldown', () => {
    const { sim, leader } = leaderSim();
    sim.dungeonFinderListingCreate('hollow_crypt_normal', [], leader);
    const info = sim.dungeonFinderInfoFor(leader);
    expect(info?.myListing?.advertText).toBe(
      'LFM - The Hollow Crypt - Normal - 1/5 - Healer/DPS needed',
    );
    expect(info?.advert).toEqual({ general: 0, discord: 0, discordAvailable: false });

    sim.dungeonFinderExpeditionConfigure({ kind: 'advertise', target: 'general' }, leader);
    const events = sim.tick();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'chat',
        channel: 'general',
        fromPid: leader,
        text: 'LFM - The Hollow Crypt - Normal - 1/5 - Healer/DPS needed',
      }),
    );
    expect(sim.dungeonFinderInfoFor(leader)?.advert?.general).toBe(5);

    sim.dungeonFinderExpeditionConfigure({ kind: 'advertise', target: 'general' }, leader);
    const again = sim.tick();
    expect(again.some((e) => e.type === 'chat')).toBe(false);
    expect(errorsFor(again, leader)).toContain(
      'You posted your group recently. Please wait before posting again.',
    );
  });

  it('refuses Discord offline and refuses a player without a listing', () => {
    const { sim, leader } = leaderSim();
    sim.dungeonFinderExpeditionConfigure({ kind: 'advertise', target: 'general' }, leader);
    expect(errorsFor(sim.tick(), leader)).toContain('You do not lead a group listing.');
    sim.dungeonFinderListingCreate('hollow_crypt_normal', [], leader);
    sim.dungeonFinderExpeditionConfigure({ kind: 'advertise', target: 'discord' }, leader);
    expect(errorsFor(sim.tick(), leader)).toContain(
      'Posting to Discord is only available in online play.',
    );
  });

  it('flags a Guild Party in the line', () => {
    const { sim, leader } = leaderSim();
    sim.setPlayerGuild(leader, 'Nightwatch');
    sim.dungeonFinderListingCreate('hollow_crypt_normal', [FINDER_GUILD_TAG], leader);
    expect(sim.dungeonFinderInfoFor(leader)?.myListing?.advertText).toMatch(/ - Guild only$/);
  });
});

describe('online advert: server-owned, per account', () => {
  it('never forwards an advertise command to the Sim; the server hook receives it', () => {
    const { sim, leader } = leaderSim();
    sim.dungeonFinderListingCreate('hollow_crypt_normal', [], leader);
    const hook = vi.fn();
    const settings = { kind: 'advertise', target: 'discord' };
    dispatchDungeonFinderCommand(
      sim,
      leader,
      { cmd: 'df_expedition_configure', settings },
      () => true,
      hook,
    );
    expect(hook).toHaveBeenCalledWith('discord');
    // No hook (and a bad target) never reach the Sim's offline path.
    dispatchDungeonFinderCommand(sim, leader, { cmd: 'df_expedition_configure', settings });
    dispatchDungeonFinderCommand(
      sim,
      leader,
      { cmd: 'df_expedition_configure', settings: { kind: 'advertise', target: 'world' } },
      () => true,
      hook,
    );
    expect(hook).toHaveBeenCalledTimes(1);
    expect(sim.tick().some((e) => e.type === 'chat' || e.type === 'error')).toBe(false);
    expect(sim.dungeonFinderInfoFor(leader)?.advert?.general).toBe(0);
  });

  const open = {
    allowed: () => true,
    postGeneral: (_t: string, delivered: () => void) => delivered(),
  };

  it('posts to Discord once per 30 minutes per account, across characters', () => {
    let now = 1_000_000;
    const errors: string[] = [];
    const relay = new CommunityRelay({
      entity: () => undefined,
      broadcastSystem: () => {},
      error: (_s, text) => errors.push(text),
      nowMs: () => now,
    });
    const alt = { accountId: 9, pid: 2, name: 'Alt' };
    const main = { accountId: 9, pid: 1, name: 'Main' };
    const line = 'LFM - The Hollow Crypt - Normal - 1/5 - Healer/DPS needed';
    relay.advertise(main, 'discord', line, open);
    expect(drainRelay()).toMatchObject([
      { commandId: 'lfg', characterName: 'Main', message: line },
    ]);
    expect(relay.withAdvertCooldowns(null, 9)).toBeNull();
    now += 60_000;
    relay.advertise(alt, 'discord', line, open);
    expect(drainRelay()).toEqual([]);
    expect(errors).toEqual(['You posted your group recently. Please wait before posting again.']);
    const info = relay.withAdvertCooldowns({ advert: undefined } as never, 9);
    expect(info?.advert).toEqual({ general: 0, discord: 29, discordAvailable: true });
    now += 29 * 60_000;
    relay.advertise(alt, 'discord', line, open);
    expect(drainRelay()).toHaveLength(1);
  });

  it('a muted or filtered player posts nowhere and spends nothing', () => {
    const relay = new CommunityRelay({
      entity: () => undefined,
      broadcastSystem: () => {},
      error: () => {},
      nowMs: () => 0,
    });
    const session = { accountId: 4, pid: 1, name: 'Muted' };
    const postGeneral = vi.fn();
    const muted = { allowed: () => false, postGeneral };
    relay.advertise(session, 'discord', 'LFM - x', muted);
    relay.advertise(session, 'general', 'LFM - x', muted);
    expect(drainRelay()).toEqual([]);
    expect(postGeneral).not.toHaveBeenCalled();
    expect(relay.withAdvertCooldowns({} as never, 4)?.advert).toMatchObject({
      general: 0,
      discord: 0,
    });
  });

  it('spends the General cooldown only once the line is actually delivered', () => {
    const relay = new CommunityRelay({
      entity: () => undefined,
      broadcastSystem: () => {},
      error: () => {},
      nowMs: () => 0,
    });
    const session = { accountId: 4, pid: 1, name: 'Leader' };
    // A quota refusal (or a token refusal) never calls `delivered`.
    const refused = vi.fn();
    relay.advertise(session, 'general', 'LFM - x', { allowed: () => true, postGeneral: refused });
    relay.advertise(session, 'general', 'LFM - x', { allowed: () => true, postGeneral: refused });
    expect(refused).toHaveBeenCalledTimes(2);
    const accepted = vi.fn((_t: string, delivered: () => void) => delivered());
    relay.advertise(session, 'general', 'LFM - x', { allowed: () => true, postGeneral: accepted });
    relay.advertise(session, 'general', 'LFM - x', { allowed: () => true, postGeneral: accepted });
    expect(accepted).toHaveBeenCalledTimes(1);
    expect(relay.withAdvertCooldowns({} as never, 4)?.advert?.general).toBe(5);
    expect(drainRelay()).toEqual([]);
  });
});
