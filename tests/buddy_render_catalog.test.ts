import { describe, expect, it } from 'vitest';
import { VISUALS } from '../src/render/characters/manifest';
import { BUDDY_MOBS } from '../src/sim/content/buddy_mobs';

describe('active buddy render catalog', () => {
  it('includes the referral Sapling alongside the existing follower bodies', () => {
    const expected = ['buddy_crystal_lich', 'buddy_forgemaw', 'buddy_horse', 'buddy_sapling'];
    expect(
      Object.keys(VISUALS)
        .filter((key) => key.startsWith('buddy_'))
        .sort(),
    ).toEqual(expected);
    expect(Object.keys(BUDDY_MOBS).sort()).toEqual(expected);
    for (const key of expected) {
      expect(VISUALS[key].tint).toBeUndefined();
      expect(VISUALS[key].url).toBe(`models/buddies/${key.slice('buddy_'.length)}.glb`);
    }
  });
});
