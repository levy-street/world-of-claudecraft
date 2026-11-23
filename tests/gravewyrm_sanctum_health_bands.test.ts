// The Gravewyrm Sanctum on the owner's heroic health bands (2026-10-12): on
// heroic every non-final boss carries about 25,000 and the miniboss sits in
// 15,000 to 20,000, clearly under them. Korgath the Bound's body goes to about
// 25,000 (his four Seal Shackles keep their pools) and the Sledge Tusker, the
// miniboss, to about 16,000; Velkhar (22,991) already sits beside the band and
// Korzul, the final boss, is untouched. On normal the Tusker keeps its designed
// pool, clearly under the bosses: at most three quarters of the weakest (the
// owner's rule, 2026-10-12); every normal boss pool is unchanged. Health only.
// Read from live spawns in a real claim.

import { describe, expect, it, vi } from 'vitest';
import {
  HEROIC_BOSS_BAND,
  HEROIC_MINIBOSS_BAND,
  type LivePool,
  livePools,
  NORMAL_MINIBOSS_SHARE,
} from './helpers/dungeon_pools';

vi.setConfig({ testTimeout: 300_000 });

const HEROIC: Record<string, LivePool> = {
  // The Sledge Tusker, the miniboss: was 13,796.
  sledge_tusker: { hp: 16002, weapon: [1393, 2177], mech: 2.5, armor: 756 },
  // Korgath the Bound's body: was 18,391.
  korgath_the_bound: { hp: 25004, weapon: [1708, 2668], mech: 2.5, armor: 756 },
  // Untouched: Velkhar beside the band, Korzul the final boss.
  grand_necromancer_velkhar: { hp: 22991, weapon: [1637, 2558], mech: 2.5, armor: 504 },
  korzul_the_gravewyrm: { hp: 36785, weapon: [1778, 2779], mech: 2.5, armor: 857 },
};

const NORMAL: Record<string, LivePool> = {
  // The miniboss: its designed 60 s (it briefly carried 10,433 here).
  sledge_tusker: { hp: 8992, weapon: [398, 622], mech: 1, armor: 570 },
  korgath_the_bound: { hp: 12007, weapon: [788, 1231], mech: 1, armor: 570 },
  grand_necromancer_velkhar: { hp: 15000, weapon: [524, 819], mech: 1, armor: 380 },
  korzul_the_gravewyrm: { hp: 23988, weapon: [734, 1148], mech: 1, armor: 646 },
};

describe('Gravewyrm Sanctum pools read from live spawns', () => {
  const heroic = livePools('gravewyrm_sanctum', 'heroic');
  const normal = livePools('gravewyrm_sanctum', 'normal');

  it('pins every heroic pool with its shipped melee, mechanic factor and armor', () => {
    for (const [id, row] of Object.entries(HEROIC)) expect(heroic[id], id).toEqual(row);
  });

  it('pins every normal pool with its shipped melee, mechanic factor and armor', () => {
    for (const [id, row] of Object.entries(NORMAL)) expect(normal[id], id).toEqual(row);
  });

  it('holds Korgath in the heroic boss band and the Tusker in the miniboss band', () => {
    expect(heroic.korgath_the_bound.hp).toBeGreaterThanOrEqual(HEROIC_BOSS_BAND.min);
    expect(heroic.korgath_the_bound.hp).toBeLessThanOrEqual(HEROIC_BOSS_BAND.max);
    expect(heroic.sledge_tusker.hp).toBeGreaterThanOrEqual(HEROIC_MINIBOSS_BAND.min);
    expect(heroic.sledge_tusker.hp).toBeLessThanOrEqual(HEROIC_MINIBOSS_BAND.max);
    expect(heroic.sledge_tusker.hp).toBeLessThan(heroic.grand_necromancer_velkhar.hp - 4000);
    expect(heroic.korzul_the_gravewyrm.hp).toBeGreaterThan(HEROIC_BOSS_BAND.max);
  });

  it('keeps the normal Tusker at three quarters of the weakest normal boss or less', () => {
    const weakest = Math.min(
      normal.korgath_the_bound.hp,
      normal.grand_necromancer_velkhar.hp,
      normal.korzul_the_gravewyrm.hp,
    );
    expect(weakest).toBe(12007);
    expect(normal.sledge_tusker.hp).toBeLessThanOrEqual(weakest * NORMAL_MINIBOSS_SHARE);
  });
});
