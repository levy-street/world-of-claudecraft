// The Hollow Crypt's health after the owner's reading of the manager's playtest
// (2026-10-12), read from live spawns in a real claimed crypt:
//   - the three wing bosses keep their DESIGNED normal pools;
//   - on heroic every boss sits in the 24,000 to 30,000 band (Sexton Marrow and
//     Cantor Ilvane about 25,000 beside the Lady's 24,999, Morthen about 28,800);
//   - on heroic every miniboss sits in 15,000 to 20,000, clearly under the
//     bosses. A miniboss is a solo elite that is no gate's boss: the Ossuary
//     Drake, the one spawn-list elite that holds a pull alone (doubled, and by
//     the same factor on normal, where it stays under the weakest wing boss),
//     and the summoned Knellwyrm (tests/hollow_crypt_knellwyrm_pool.test.ts);
//   - health only: melee, mechanic factors and armor are the shipped numbers,
//     and the Lady's Frozen Embrace breaks on the damage it always took.

import { describe, expect, it, vi } from 'vitest';
import { HOLLOW_CRYPT_GATES, HOLLOW_CRYPT_SPAWNS } from '../src/sim/content/hollow_crypt';
import { MOBS } from '../src/sim/data';
import { embraceBreakShare, LADY_ID } from '../src/sim/encounters/hollow_crypt';
import { boss, cryptFight } from './helpers/crypt_boss_fight';
import {
  HEROIC_BOSS_BAND,
  HEROIC_MINIBOSS_BAND,
  NORMAL_MINIBOSS_SHARE,
} from './helpers/dungeon_pools';

vi.setConfig({ testTimeout: 300_000 });

const DRAKE = 'crypt_ossuary_drake';

interface Row {
  hp: number;
  weapon: [number, number];
  mech: number | undefined;
  armor: number;
}

/** Live pools and the untouched damage numbers beside them. */
const POOLS: Record<'normal' | 'heroic', Record<string, Row>> = {
  normal: {
    // The wing bosses: fight length x planning party DPS (hollow_crypt.md 5).
    sexton_marrow: { hp: 3152, weapon: [32, 50], mech: undefined, armor: 154 },
    rimeweb: { hp: 3998, weapon: [35, 54], mech: undefined, armor: 160 },
    cantor_ilvane: { hp: 3195, weapon: [33, 51], mech: undefined, armor: 144 },
    hollow_chorister: { hp: 391, weapon: [27, 42], mech: undefined, armor: 84 },
    morthen: { hp: 6791, weapon: [41, 65], mech: undefined, armor: 234 },
    // The miniboss: twice the pool it shipped with (1,039.6 before rounding,
    // 1,040 live).
    [DRAKE]: { hp: 2079, weapon: [43, 68], mech: undefined, armor: 216 },
  },
  heroic: {
    // About 25,000 each (Marrow was 16,099, Ilvane 14,687).
    sexton_marrow: { hp: 24996, weapon: [1476, 2306], mech: 6, armor: 601 },
    rimeweb: { hp: 24999, weapon: [1476, 2306], mech: 5, armor: 546 },
    cantor_ilvane: { hp: 24996, weapon: [1402, 2190], mech: 8, armor: 491 },
    hollow_chorister: { hp: 1844, weapon: [575, 898], mech: 9, armor: 328 },
    morthen: { hp: 28837, weapon: [1574, 2460], mech: 9, armor: 710 },
    // The miniboss: twice the 7,936 it shipped with.
    [DRAKE]: { hp: 15872, weapon: [754, 1178], mech: 20, armor: 655 },
  },
};

/** What the Drake shipped with, and the factor both difficulties took. */
const DRAKE_SHIPPED = { normal: 1040, heroic: 7936 };
const DRAKE_FACTOR = 2;
const BOSSES = ['sexton_marrow', 'rimeweb', 'cantor_ilvane', 'morthen'];

describe('Hollow Crypt minibosses, in the content own terms', () => {
  it('finds exactly one solo spawn-list elite that is no gate boss: the Ossuary Drake', () => {
    const gateBosses = new Set<string>();
    for (const g of HOLLOW_CRYPT_GATES) {
      for (const b of g.bosses ?? []) gateBosses.add(b);
      if (g.sealWhileEngaged) gateBosses.add(g.sealWhileEngaged);
    }
    const packSize = new Map<string, number>();
    for (const s of HOLLOW_CRYPT_SPAWNS)
      if (s.packId) packSize.set(s.packId, (packSize.get(s.packId) ?? 0) + 1);
    const solo = HOLLOW_CRYPT_SPAWNS.filter((s) => {
      const t = MOBS[s.mobId];
      if (!t.elite || t.boss || gateBosses.has(s.mobId)) return false;
      // A pack of one, or a placement outside every pack.
      return s.packId === undefined || packSize.get(s.packId) === 1;
    }).map((s) => s.mobId);
    expect(solo).toEqual([DRAKE]);
    // The gargoyles and every other elite fight in packs of three to five.
    expect(packSize.get('drake')).toBe(1);
    for (const pack of ['c1', 'c3', 'c4']) expect(packSize.get(pack)).toBeGreaterThanOrEqual(4);
  });
});

for (const difficulty of ['normal', 'heroic'] as const) {
  describe(`Hollow Crypt pools read from live spawns (${difficulty})`, () => {
    const f = cryptFight(difficulty, 4, new Set(Object.keys(POOLS[difficulty])));

    for (const [id, row] of Object.entries(POOLS[difficulty])) {
      it(`${id}: its pool, and its shipped melee, mechanic factor and armor`, () => {
        const b = boss(f, id);
        expect(b.maxHp).toBe(row.hp);
        expect(b.hp).toBe(b.maxHp);
        expect([b.weapon?.min, b.weapon?.max]).toEqual(row.weapon);
        expect(b.mechanicDamageMult).toBe(row.mech);
        expect(b.stats.armor).toBe(row.armor);
      });
    }

    it('raises the Ossuary Drake by one factor on both difficulties', () => {
      const hp = boss(f, DRAKE).maxHp;
      expect(Math.abs(hp - DRAKE_SHIPPED[difficulty] * DRAKE_FACTOR)).toBeLessThanOrEqual(1);
    });

    if (difficulty === 'heroic') {
      it('holds every boss inside the 24,000 to 30,000 heroic band', () => {
        for (const id of BOSSES) {
          const hp = boss(f, id).maxHp;
          expect(hp, id).toBeGreaterThanOrEqual(HEROIC_BOSS_BAND.min);
          expect(hp, id).toBeLessThanOrEqual(HEROIC_BOSS_BAND.max);
        }
      });

      it('holds the miniboss inside 15,000 to 20,000, clearly under every boss', () => {
        const drake = boss(f, DRAKE).maxHp;
        expect(drake).toBeGreaterThanOrEqual(HEROIC_MINIBOSS_BAND.min);
        expect(drake).toBeLessThanOrEqual(HEROIC_MINIBOSS_BAND.max);
        for (const id of BOSSES) expect(drake, id).toBeLessThan(boss(f, id).maxHp - 4000);
      });
    } else {
      it('keeps the miniboss at three quarters of the weakest wing boss or less on normal', () => {
        const weakest = Math.min(
          ...['sexton_marrow', 'rimeweb', 'cantor_ilvane'].map((id) => boss(f, id).maxHp),
        );
        expect(weakest).toBe(3152);
        expect(boss(f, DRAKE).maxHp).toBeLessThanOrEqual(weakest * NORMAL_MINIBOSS_SHARE);
      });
    }

    it("asks the Lady's Frozen Embrace for the damage it always took", () => {
      // The break rule of lady_embrace.ts (dealt >= share x pool), on the live
      // pool: 240 on normal (6 percent of 3,998) and 1,103 on heroic (her own
      // heroic share of 24,999, what 6 percent of the 18,382 she shipped with
      // was). The real break path, one point under and at the threshold, is
      // driven in tests/hollow_crypt_lady.test.ts.
      const lady = boss(f, LADY_ID);
      const needed = Math.ceil(embraceBreakShare(difficulty === 'heroic') * lady.maxHp - 1e-6);
      expect(needed).toBe(difficulty === 'heroic' ? 1103 : 240);
    });
  });
}
