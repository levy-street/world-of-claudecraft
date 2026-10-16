// The Sunken Bastion on the owner's heroic health bands (2026-10-12): on heroic
// every non-final boss carries about 25,000 and every miniboss sits in 15,000
// to 20,000, clearly under them; Vael, the final boss, is untouched and so is
// every normal BOSS pool. The Dungeon Finder's encounter list says which is
// which: Olen and Ossick are bosses; the Shipwreck Captain (template id
// turretback_hermit, a solo elite outside the list) and the Gaol Turnkey (in
// the list, but the gaol's miniboss by its own content) are minibosses. On
// normal a miniboss keeps its designed pool, clearly under the bosses: at most
// three quarters of the weakest (the owner's rule, 2026-10-12). Health only:
// melee, mechanic factors and armor are the shipped numbers. Read from live
// spawns in a real claim.

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
  // The Shipwreck Captain, a miniboss: was 13,801.
  turretback_hermit: { hp: 16996, weapon: [1529, 2390], mech: 8, armor: 819 },
  // Knight-Commander Olen: was 18,382.
  knight_commander_olen: { hp: 24999, weapon: [1417, 2214], mech: 6, armor: 655 },
  // Gaoler Ossick: was 19,530.
  gaoler_ossick: { hp: 24999, weapon: [1417, 2214], mech: 6, armor: 655 },
  // The Gaol Turnkey, the miniboss: was 11,041.
  gaol_turnkey: { hp: 15994, weapon: [1417, 2214], mech: 6, armor: 655 },
  // Vael, the final boss: untouched.
  vael_the_mistcaller: { hp: 34449, weapon: [1439, 2248], mech: 6, armor: 710 },
};

const NORMAL: Record<string, LivePool> = {
  // The Captain: his designed 60 s (he briefly carried 5,539 here).
  turretback_hermit: { hp: 4495, weapon: [55, 85], mech: undefined, armor: 360 },
  knight_commander_olen: { hp: 5995, weapon: [48, 74], mech: undefined, armor: 264 },
  gaoler_ossick: { hp: 6796, weapon: [51, 79], mech: undefined, armor: 288 },
  // The Turnkey: its designed 50 s (it briefly carried 5,214 here).
  gaol_turnkey: { hp: 3599, weapon: [51, 79], mech: undefined, armor: 288 },
  vael_the_mistcaller: { hp: 11998, weapon: [52, 81], mech: undefined, armor: 312 },
};

describe('Sunken Bastion pools read from live spawns', () => {
  const heroic = livePools('sunken_bastion', 'heroic');
  const normal = livePools('sunken_bastion', 'normal');

  it('pins every heroic pool with its shipped melee, mechanic factor and armor', () => {
    for (const [id, row] of Object.entries(HEROIC)) expect(heroic[id], id).toEqual(row);
  });

  it('pins every normal pool with its shipped melee, mechanic factor and armor', () => {
    for (const [id, row] of Object.entries(NORMAL)) expect(normal[id], id).toEqual(row);
  });

  it('holds the two heroic bosses in the boss band and the two minibosses in theirs', () => {
    for (const id of ['knight_commander_olen', 'gaoler_ossick']) {
      expect(heroic[id].hp, id).toBeGreaterThanOrEqual(HEROIC_BOSS_BAND.min);
      expect(heroic[id].hp, id).toBeLessThanOrEqual(HEROIC_BOSS_BAND.max);
    }
    for (const id of ['turretback_hermit', 'gaol_turnkey']) {
      expect(heroic[id].hp, id).toBeGreaterThanOrEqual(HEROIC_MINIBOSS_BAND.min);
      expect(heroic[id].hp, id).toBeLessThanOrEqual(HEROIC_MINIBOSS_BAND.max);
      expect(heroic[id].hp, id).toBeLessThan(heroic.knight_commander_olen.hp - 4000);
    }
    expect(heroic.vael_the_mistcaller.hp).toBeGreaterThan(HEROIC_BOSS_BAND.max);
  });

  it('keeps each normal miniboss at three quarters of the weakest normal boss or less', () => {
    const weakest = Math.min(
      normal.knight_commander_olen.hp,
      normal.gaoler_ossick.hp,
      normal.vael_the_mistcaller.hp,
    );
    expect(weakest).toBe(5995);
    for (const id of ['turretback_hermit', 'gaol_turnkey']) {
      expect(normal[id].hp, id).toBeLessThanOrEqual(weakest * NORMAL_MINIBOSS_SHARE);
    }
  });
});
