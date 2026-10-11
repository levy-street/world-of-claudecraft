// The King of the Hill half of the Discord PvP channel
// (server/discord_hill_feed.ts): the sim event mapped onto the server clock
// (relative seconds to wall-clock ms, zone id to its English name), the fall
// dropped, the bounded FIFO and its requeue, and the activity-detect arm that
// feeds it. The outbox stream is pinned in tests/server/internal.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/daily_rewards', () => ({ dailyRewardService: {} }));
vi.mock('../../server/deeds_db', () => ({ getDeedBroadcasts: async () => true }));
vi.mock('../../server/realm', () => ({ REALM: 'Claudemoon' }));

import { detectActivityEvent } from '../../server/activity_detect';
import {
  drainHillAnnouncements,
  enqueueHillAnnouncement,
  HILL_ANNOUNCEMENT_MAX_QUEUE,
  hillAnnouncementItem,
  hillAnnouncementQueueDepth,
  type QueuedHillAnnouncement,
  requeueHillAnnouncements,
} from '../../server/discord_hill_feed';
import { drainPvpKills } from '../../server/discord_pvp_feed';
import { ZONES } from '../../src/sim/data';
import type { SimEvent } from '../../src/sim/types';

type HillAnnounced = Extract<SimEvent, { type: 'hillAnnounced' }>;

const NOW = 1_790_000_000_000;
const WARNING: HillAnnounced = {
  type: 'hillAnnounced',
  phase: 'warning',
  zoneId: 'drakelands',
  secondsUntilRise: 900,
  secondsUntilFall: 3600,
};

function item(zoneName: string): QueuedHillAnnouncement {
  return { phase: 'warning', zoneName, risesAtMs: NOW, fallsAtMs: NOW, realm: 'R' };
}

beforeEach(() => {
  drainHillAnnouncements();
  drainPvpKills();
});

describe('hillAnnouncementItem', () => {
  it('maps the relative seconds onto the server clock and the zone id onto its English name', () => {
    const name = ZONES.find((z) => z.id === 'drakelands')?.name;
    expect(name).toBeDefined();
    expect(hillAnnouncementItem(WARNING, 'Claudemoon', NOW)).toEqual({
      phase: 'warning',
      zoneName: name,
      risesAtMs: NOW + 900_000,
      fallsAtMs: NOW + 3_600_000,
      realm: 'Claudemoon',
    });
  });

  it('keeps the rise, drops the fall', () => {
    expect(hillAnnouncementItem({ ...WARNING, phase: 'risen' }, 'R', NOW)?.phase).toBe('risen');
    expect(hillAnnouncementItem({ ...WARNING, phase: 'fallen' }, 'R', NOW)).toBeNull();
  });
});

describe('the hill call queue', () => {
  it('drops the OLDEST past the cap and requeues at the front in order', () => {
    for (let i = 0; i <= HILL_ANNOUNCEMENT_MAX_QUEUE; i++) enqueueHillAnnouncement(item(`Z${i}`));
    expect(hillAnnouncementQueueDepth()).toBe(HILL_ANNOUNCEMENT_MAX_QUEUE);
    const drained = drainHillAnnouncements();
    expect(drained[0].zoneName).toBe('Z1');

    enqueueHillAnnouncement(item('A'));
    const taken = drainHillAnnouncements();
    enqueueHillAnnouncement(item('B'));
    requeueHillAnnouncements(taken);
    expect(drainHillAnnouncements().map((c) => c.zoneName)).toEqual(['A', 'B']);
  });
});

describe('the activity-detect arm', () => {
  const deps = {
    clients: { get: () => undefined },
    profileUrlFor: () => null,
    sessionByName: () => null,
    sendDailyRewardPointsGained: () => {},
  };

  it('enqueues the warning and the rise on the server realm and clock, never the fall, never a kill', () => {
    detectActivityEvent(WARNING, NOW, deps);
    detectActivityEvent({ ...WARNING, phase: 'risen', secondsUntilRise: 0 }, NOW, deps);
    detectActivityEvent({ ...WARNING, phase: 'fallen' }, NOW, deps);
    expect(drainHillAnnouncements()).toEqual([
      hillAnnouncementItem(WARNING, 'Claudemoon', NOW),
      hillAnnouncementItem({ ...WARNING, phase: 'risen', secondsUntilRise: 0 }, 'Claudemoon', NOW),
    ]);
    expect(drainPvpKills()).toEqual([]);
  });
});
