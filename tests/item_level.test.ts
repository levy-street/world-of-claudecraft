import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import {
  expectedStatBudget,
  itemLevel,
  itemScore,
  itemSourceLevel,
  normalizePrimaryStats,
  PRIMARY_STATS,
  primaryStatBudget,
  primaryStatSum,
  resetItemLevelCache,
} from '../src/sim/item_level';

// The showcase tiers wired up in src/sim/content/items.ts: two trios, each one
// piece per archetype, dropping from the same place so they share an item level.
const CHEST_TRIO = ['hollowbone_hauberk', 'gravewoven_raiment', 'cryptstalker_jerkin'];
const WEAPON_TRIO = ['gravecaller_blade', 'widowfang_dirk', 'gravecaller_staff'];

describe('item level: source derivation', () => {
  it('derives the drop level from the dropping mob band', () => {
    // The chest trio drops from the level-7 chapel rare elites.
    for (const id of CHEST_TRIO) expect(itemSourceLevel(id), id).toBe(7);
  });

  it('derives a quest reward level from its hardest kill objective (the boss)', () => {
    // The weapon trio is the q_hollow reward for slaying Morthen (level 10).
    for (const id of WEAPON_TRIO) expect(itemSourceLevel(id), id).toBe(10);
  });

  it('returns undefined for items with no drop or quest source', () => {
    // Conjured water is mage-made, never dropped or quest-granted.
    expect(itemSourceLevel('conjured_water')).toBeUndefined();
    expect(itemLevel(ITEMS.conjured_water)).toBeUndefined();
  });
});

describe('item level: tier number', () => {
  it('adds the rarity bonus to the source level', () => {
    // rare = +3: chest trio 7 -> 10, weapon trio 10 -> 13.
    for (const id of CHEST_TRIO) expect(itemLevel(ITEMS[id]), id).toBe(10);
    for (const id of WEAPON_TRIO) expect(itemLevel(ITEMS[id]), id).toBe(13);
  });
});

describe('item level: stat budget formula', () => {
  it('whites carry no primary-stat budget; rarity and level raise it', () => {
    expect(primaryStatBudget(10, 'common', 'chest')).toBe(0);
    expect(primaryStatBudget(10, 'rare', 'chest')).toBe(6);
    expect(primaryStatBudget(13, 'rare', 'mainhand')).toBe(7);
    // monotonic in level and in quality for a fixed slot.
    expect(primaryStatBudget(20, 'rare', 'chest')).toBeGreaterThan(
      primaryStatBudget(10, 'rare', 'chest'),
    );
    expect(primaryStatBudget(13, 'epic', 'mainhand')).toBeGreaterThan(
      primaryStatBudget(13, 'rare', 'mainhand'),
    );
  });

  it('weights smaller slots below chest/main-hand', () => {
    expect(primaryStatBudget(13, 'rare', 'feet')).toBeLessThan(
      primaryStatBudget(13, 'rare', 'chest'),
    );
  });

  it('a sourceless / slotless item has no expected budget', () => {
    expect(expectedStatBudget(ITEMS.conjured_water)).toBeUndefined();
  });
});

describe('item level: showcase tiers are normalized to budget', () => {
  it('every showcase item carries exactly its item-level stat budget', () => {
    for (const id of [...CHEST_TRIO, ...WEAPON_TRIO]) {
      const item = ITEMS[id];
      const budget = expectedStatBudget(item);
      expect(budget, `${id} has a derivable budget`).not.toBeUndefined();
      expect(primaryStatSum(item), `${id} stat sum == budget`).toBe(budget);
    }
  });

  it('items from the same place share one item level and one budget (same tier)', () => {
    const chestLevels = new Set(CHEST_TRIO.map((id) => itemLevel(ITEMS[id])));
    const chestBudgets = new Set(CHEST_TRIO.map((id) => primaryStatSum(ITEMS[id])));
    expect(chestLevels).toEqual(new Set([10]));
    expect(chestBudgets).toEqual(new Set([6]));

    const weaponLevels = new Set(WEAPON_TRIO.map((id) => itemLevel(ITEMS[id])));
    const weaponBudgets = new Set(WEAPON_TRIO.map((id) => primaryStatSum(ITEMS[id])));
    expect(weaponLevels).toEqual(new Set([13]));
    expect(weaponBudgets).toEqual(new Set([7]));
  });

  it('normalization preserved each piece stat identity (no attribute swapped in/out)', () => {
    const ident = (id: string) =>
      PRIMARY_STATS.filter((k) => (ITEMS[id].stats?.[k] ?? 0) > 0).sort();
    expect(ident('hollowbone_hauberk')).toEqual(['sta', 'str']);
    expect(ident('gravewoven_raiment')).toEqual(['int', 'spi']);
    expect(ident('cryptstalker_jerkin')).toEqual(['agi', 'sta']);
    expect(ident('gravecaller_staff')).toEqual(['int', 'spi']);
  });
});

describe('normalizePrimaryStats', () => {
  it('scales to the exact integer budget while keeping the input ratio', () => {
    expect(normalizePrimaryStats({ str: 3, sta: 2 }, 7)).toEqual({ str: 4, sta: 3 });
    expect(normalizePrimaryStats({ int: 4, spi: 2 }, 7)).toEqual({ int: 5, spi: 2 });
    // sum is always exactly the budget.
    const out = normalizePrimaryStats({ agi: 4, sta: 2 }, 6);
    expect((out.agi ?? 0) + (out.sta ?? 0)).toBe(6);
  });

  it('only touches the attributes already present and passes armor through', () => {
    const out = normalizePrimaryStats({ armor: 38, int: 4, spi: 3 }, 6);
    expect(out.armor).toBe(38);
    expect(out.str).toBeUndefined();
    expect((out.int ?? 0) + (out.spi ?? 0)).toBe(6);
  });

  it('is deterministic (ties resolved by a stable order) and idempotent at budget', () => {
    const a = normalizePrimaryStats({ str: 1, agi: 1 }, 3);
    const b = normalizePrimaryStats({ str: 1, agi: 1 }, 3);
    expect(a).toEqual(b);
    expect((a.str ?? 0) + (a.agi ?? 0)).toBe(3);
    // re-normalizing an already-on-budget item is a no-op.
    expect(normalizePrimaryStats({ str: 4, sta: 3 }, 7)).toEqual({ str: 4, sta: 3 });
  });

  it('drops all primary stats at a zero budget but keeps armor', () => {
    expect(normalizePrimaryStats({ armor: 10, str: 3 }, 0)).toEqual({ armor: 10 });
  });
});

describe('itemScore', () => {
  it('counts primary stats, converted armor, and converted weapon dps', () => {
    // Pure stat piece: score is just the stat sum.
    expect(
      itemScore({ id: 'x', name: 'x', kind: 'armor', sellValue: 0, stats: { str: 4, sta: 3 } }),
    ).toBe(7);
    // Armor converts at ARMOR_PER_POINT (12): 24 armor -> 2 points.
    expect(
      itemScore({ id: 'x', name: 'x', kind: 'armor', sellValue: 0, stats: { armor: 24 } }),
    ).toBe(2);
    // A weapon adds dps weight, so it outscores its raw stat bonus alone.
    const blade = ITEMS.gravecaller_blade;
    expect(itemScore(blade)).toBeGreaterThan(primaryStatSum(blade));
  });
});

describe('item level: purity and determinism', () => {
  it('is a pure function of the static tables across cache rebuilds', () => {
    const before = CHEST_TRIO.map((id) => [itemSourceLevel(id), itemLevel(ITEMS[id])]);
    resetItemLevelCache();
    const after = CHEST_TRIO.map((id) => [itemSourceLevel(id), itemLevel(ITEMS[id])]);
    expect(after).toEqual(before);
  });
});
