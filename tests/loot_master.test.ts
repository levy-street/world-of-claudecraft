import { describe, expect, it } from 'vitest';
import { effectiveMasterLooter, meetsMasterThreshold, QUALITY_RANK } from '../src/sim/loot_master';
import type { MasterLootSettings } from '../src/sim/types';

describe('meetsMasterThreshold', () => {
  it('passes items at or above the threshold rank', () => {
    expect(meetsMasterThreshold('uncommon', 'uncommon')).toBe(true);
    expect(meetsMasterThreshold('rare', 'uncommon')).toBe(true);
    expect(meetsMasterThreshold('legendary', 'epic')).toBe(true);
  });
  it('rejects items below the threshold rank', () => {
    expect(meetsMasterThreshold('common', 'uncommon')).toBe(false);
    expect(meetsMasterThreshold('poor', 'uncommon')).toBe(false);
    expect(meetsMasterThreshold('uncommon', 'epic')).toBe(false);
  });
  it('treats undefined quality as common', () => {
    expect(meetsMasterThreshold(undefined, 'uncommon')).toBe(false);
    expect(QUALITY_RANK.common).toBe(1);
  });
});

describe('effectiveMasterLooter', () => {
  const base: MasterLootSettings = { enabled: true, looter: 0, threshold: 'uncommon' };
  it('returns null when disabled', () => {
    expect(effectiveMasterLooter({ ...base, enabled: false }, 7, [7, 8])).toBeNull();
  });
  it('resolves 0 to the current leader', () => {
    expect(effectiveMasterLooter(base, 7, [7, 8, 9])).toBe(7);
  });
  it('returns an explicitly named looter who is still a member', () => {
    expect(effectiveMasterLooter({ ...base, looter: 9 }, 7, [7, 8, 9])).toBe(9);
  });
  it('falls back to the leader when the named looter has left', () => {
    expect(effectiveMasterLooter({ ...base, looter: 42 }, 7, [7, 8, 9])).toBe(7);
  });
});
