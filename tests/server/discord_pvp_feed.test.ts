// The Discord PvP kill feed's server half (server/discord_pvp_feed.ts): the
// sim-event-to-wire shaping (zone id resolved to its English name), the bounded
// FIFO with drop-oldest overflow, the requeue-at-front contract the outbox's
// retry relies on, and the activity-detect arm that feeds it from the tick's
// `worldPvpKill` event. The outbox stream itself is pinned in
// tests/server/internal.test.ts describe('discord/outbox'), its size in
// tests/server/discord_outbox.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/daily_rewards', () => ({ dailyRewardService: {} }));
vi.mock('../../server/deeds_db', () => ({ getDeedBroadcasts: async () => true }));
vi.mock('../../server/realm', () => ({ REALM: 'Claudemoon' }));

import { detectActivityEvent } from '../../server/activity_detect';
import { drainActivity } from '../../server/discord_activity';
import {
  drainPvpKills,
  enqueuePvpKill,
  PVP_KILL_FEED_MAX_QUEUE,
  pvpKillFeedItem,
  pvpKillQueueDepth,
  type QueuedPvpKill,
  requeuePvpKills,
} from '../../server/discord_pvp_feed';
import { ZONES } from '../../src/sim/data';
import type { SimEvent } from '../../src/sim/types';

type WorldPvpKill = Extract<SimEvent, { type: 'worldPvpKill' }>;

const EVENT: WorldPvpKill = {
  type: 'worldPvpKill',
  killerName: 'Kargath',
  victimName: 'Annthar',
  killerLevel: 60,
  victimLevel: 58,
  zoneId: 'drakelands',
  assists: 2,
  copper: 1_200,
};

function item(killerName: string): QueuedPvpKill {
  return { ...pvpKillFeedItem(EVENT, 'R'), killerName };
}

beforeEach(() => {
  drainPvpKills();
  drainActivity();
});

describe('pvpKillFeedItem', () => {
  it('carries every field and resolves the zone id to its English table name', () => {
    const drakelands = ZONES.find((z) => z.id === 'drakelands');
    expect(drakelands).toBeDefined();
    expect(pvpKillFeedItem(EVENT, 'Claudemoon')).toEqual({
      killerName: 'Kargath',
      victimName: 'Annthar',
      killerLevel: 60,
      victimLevel: 58,
      zoneName: drakelands?.name,
      assists: 2,
      copper: 1_200,
      realm: 'Claudemoon',
    });
  });

  it('answers a null zone for a null or unknown zone id', () => {
    expect(pvpKillFeedItem({ ...EVENT, zoneId: null }, 'R').zoneName).toBeNull();
    expect(pvpKillFeedItem({ ...EVENT, zoneId: 'no_such_zone' }, 'R').zoneName).toBeNull();
  });
});

describe('the kill feed queue', () => {
  it('drains FIFO and destructively', () => {
    enqueuePvpKill(item('A'));
    enqueuePvpKill(item('B'));
    expect(drainPvpKills().map((k) => k.killerName)).toEqual(['A', 'B']);
    expect(drainPvpKills()).toEqual([]);
  });

  it('drops the OLDEST kill once past the cap', () => {
    for (let i = 0; i <= PVP_KILL_FEED_MAX_QUEUE; i++) enqueuePvpKill(item(`K${i}`));
    expect(pvpKillQueueDepth()).toBe(PVP_KILL_FEED_MAX_QUEUE);
    const drained = drainPvpKills();
    expect(drained[0].killerName).toBe('K1');
    expect(drained[drained.length - 1].killerName).toBe(`K${PVP_KILL_FEED_MAX_QUEUE}`);
  });

  it('requeues at the FRONT in original order, ahead of kills that arrived meanwhile', () => {
    enqueuePvpKill(item('A'));
    enqueuePvpKill(item('B'));
    const taken = drainPvpKills();
    enqueuePvpKill(item('C'));
    requeuePvpKills(taken);
    expect(drainPvpKills().map((k) => k.killerName)).toEqual(['A', 'B', 'C']);
  });
});

describe('the activity-detect arm', () => {
  const deps = {
    clients: { get: () => undefined },
    profileUrlFor: () => null,
    sessionByName: () => null,
    sendDailyRewardPointsGained: () => {},
  };

  it('enqueues one kill-feed item per worldPvpKill event, on the server realm, and no activity card', () => {
    detectActivityEvent(EVENT, 1_700_000_000_000, deps);
    expect(drainPvpKills()).toEqual([pvpKillFeedItem(EVENT, 'Claudemoon')]);
    // A kill is its own stream, never an activity card (no pings, no link gate).
    expect(drainActivity()).toEqual([]);
  });

  it('does not dedupe: two kills of the same pair are two lines (the sim fires once per death)', () => {
    detectActivityEvent(EVENT, 1_700_000_000_000, deps);
    detectActivityEvent(EVENT, 1_700_000_000_001, deps);
    expect(drainPvpKills()).toHaveLength(2);
  });
});
