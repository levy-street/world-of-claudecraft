import { describe, expect, it, vi } from 'vitest';

// Retained rules stay covered for a future reactivation. Shipping-off behavior
// and save preservation are exercised without mocks in queue_rewards_disabled.
vi.mock('../src/sim/content/queue_rewards', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/sim/content/queue_rewards')>()),
  QUEUE_REWARDS_ENABLED: true,
}));

import { FINDER_ACTIVITIES } from '../src/sim/content/dungeon_finder';
import {
  changeQueueReward,
  grantQueueEncounter,
  loadQueueRewards,
  savedQueueRewards,
} from '../src/sim/social/queue_rewards';

const activity = FINDER_ACTIVITIES.find((a) => a.id === 'hollow_crypt_normal')!;
const final = activity.encounters.find((e) => e.final)!;
describe('bounded character Queue Points and cosmetic purchases', () => {
  it('omits untouched state and rejects malformed counters and unknown ownership', () => {
    expect(savedQueueRewards()).toEqual({});
    expect(savedQueueRewards(loadQueueRewards())).toEqual({});
    expect(
      loadQueueRewards({
        balance: Infinity,
        unlocked: ['gold', 'admin', 'gold'],
        equipped: 'silver',
        day: 'wrong',
        earnedToday: -2,
        credited: { admin: ['completion'] },
      }),
    ).toEqual({
      balance: 0,
      unlocked: ['gold'],
      equipped: null,
      day: '',
      earnedToday: 0,
      credited: {},
    });
  });
  it('pays each boss and completion once per activity difficulty per day', () => {
    const s = loadQueueRewards();
    expect(grantQueueEncounter(s, '2026-10-05', activity.id, final.mobId)).toBe(15);
    expect(grantQueueEncounter(s, '2026-10-05', activity.id, final.mobId)).toBe(0);
    const restored = loadQueueRewards(savedQueueRewards(s).queueRewards);
    expect(grantQueueEncounter(restored, '2026-10-05', activity.id, final.mobId)).toBe(0);
    expect(grantQueueEncounter(restored, '2026-10-04', activity.id, final.mobId)).toBe(0);
    expect(grantQueueEncounter(restored, '2026-10-06', activity.id, final.mobId)).toBe(15);
    expect(restored.balance).toBe(30);
  });
  it('caps daily earnings and persisted state by authored activities, never run receipts', () => {
    const s = loadQueueRewards();
    for (const a of FINDER_ACTIVITIES)
      for (const e of a.encounters) grantQueueEncounter(s, '2026-10-05', a.id, e.mobId);
    expect(s.balance).toBe(60);
    expect(s.earnedToday).toBe(60);
    expect(Object.keys(s.credited).length).toBeLessThanOrEqual(FINDER_ACTIVITIES.length);
    expect(JSON.stringify(savedQueueRewards(s)).length).toBeLessThan(24000);
    const saved = savedQueueRewards(s).queueRewards!;
    saved.unlocked.push('gold');
    saved.credited[activity.id].push('tampered');
    expect(s.unlocked).toEqual([]);
    expect(s.credited[activity.id]).not.toContain('tampered');
  });
  it('keeps unlock and debit together, refuses insufficient or duplicate purchases and validates equip', () => {
    const s = loadQueueRewards();
    const before = savedQueueRewards(s);
    expect(changeQueueReward(s, 'gold', true)).toBe(false);
    expect(savedQueueRewards(s)).toEqual(before);
    s.balance = 100;
    expect(changeQueueReward(s, 'silver', true)).toBe(true);
    expect(s.balance).toBe(40);
    expect(s.unlocked).toEqual(['silver']);
    expect(s.equipped).toBe('silver');
    expect(changeQueueReward(s, 'silver', true)).toBe(false);
    expect(s.balance).toBe(40);
    expect(changeQueueReward(s, 'gold', false)).toBe(false);
    expect(changeQueueReward(s, null, false)).toBe(true);
    const restored = loadQueueRewards(savedQueueRewards(s).queueRewards);
    expect(changeQueueReward(restored, 'silver', false)).toBe(true);
    expect(restored.balance).toBe(40);
  });
  it('retains the no-calendar anti-farm gate across offline reloads', () => {
    const s = loadQueueRewards();
    grantQueueEncounter(s, '', activity.id, final.mobId);
    expect(grantQueueEncounter(loadQueueRewards(s), '', activity.id, final.mobId)).toBe(0);
  });
});
