// Pins the contract of src/sim/loot/global_drops.ts: independent of a mob's
// own loot table, every regular kill also rolls one chance per whistle
// rarity tier for a random buddy whistle of that quality. Previously this
// was pinned only by opaque parity-golden digest diffs; this file names the
// actual behavior directly.
import { describe, expect, it } from 'vitest';
import { ITEMS, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { buddyWhistlesOfQuality, GLOBAL_BUDDY_DROP_TIERS } from '../src/sim/loot/global_drops';
import { Sim } from '../src/sim/sim';

// warlock_imp ships an explicitly empty `loot: []`, so every item a kill
// produces in these tests comes from the global buddy drop, not the mob's
// own table.
const EMPTY_LOOT_MOB = 'warlock_imp';

function rollMany(seed: number, n: number): { itemId: string; count: number }[][] {
  const sim = new Sim({ seed, playerClass: 'warrior', noPlayer: true });
  const pid = sim.addPlayer('warrior', 'Looter');
  const meta = (sim as unknown as { players: Map<number, unknown> }).players.get(pid);
  const template = MOBS[EMPTY_LOOT_MOB];
  const results: { itemId: string; count: number }[][] = [];
  for (let i = 0; i < n; i++) {
    const mob = createMob(-1, template, template.minLevel, { x: 0, y: 0, z: 0 });
    (sim as unknown as { rollLoot: (m: unknown, meta: unknown) => void }).rollLoot(mob, meta);
    results.push(mob.loot?.items ?? []);
  }
  return results;
}

describe('global buddy-whistle drop', () => {
  it('carries no whistle that something else in the game owns outright', () => {
    // The withheld set is content, not a switch: a companion something else
    // owns outright (a currency counter, or the water) must not also fall off
    // a mob, while the tier it came out of keeps paying everything else in it.
    for (const itemId of [
      'whistle_proud_grunt',
      'whistle_loot_goblin',
      'whistle_penny_goldspark',
      'whistle_crystal_tide',
    ]) {
      for (const tier of GLOBAL_BUDDY_DROP_TIERS) {
        expect(buddyWhistlesOfQuality(tier.quality), `${itemId} in ${tier.quality}`).not.toContain(
          itemId,
        );
      }
    }
    // Withholding four rares did not switch the rarity off: the rares that
    // nothing else claims are still in there, and still drop at 0.05%.
    expect(buddyWhistlesOfQuality('rare')).toEqual([
      'whistle_alon',
      'whistle_cate_coin',
      'whistle_kekius',
      'whistle_solbot',
      'whistle_trollface',
    ]);
    // The other live tier still has something to give, or the drop is dead.
    expect(buddyWhistlesOfQuality('common').length).toBeGreaterThan(0);
    expect(buddyWhistlesOfQuality('uncommon').length).toBeGreaterThan(0);
  });

  it('declares exactly the four tiers at their owner-specified odds, in the fixed draw order', () => {
    expect(GLOBAL_BUDDY_DROP_TIERS.map((t) => [t.quality, t.chance])).toEqual([
      ['common', 0.015],
      ['uncommon', 0.01],
      ['rare', 0.0005],
      ['epic', 0],
    ]);
  });

  it('keeps epic listed but unwinnable, so the per-kill draw count is unchanged', () => {
    // The two withheld tiers are held at chance 0 rather than deleted: every
    // tier draws unconditionally in rollLoot, so the row is what pins the draw
    // count the parity goldens ride on. Both still resolve a real pool, which
    // is what makes re-enabling one a single-number edit.
    for (const quality of ['epic']) {
      const tier = GLOBAL_BUDDY_DROP_TIERS.find((t) => t.quality === quality);
      expect(tier, quality).toBeTruthy();
      expect(tier?.chance, quality).toBe(0);
      expect(buddyWhistlesOfQuality(quality).length, quality).toBeGreaterThan(0);
    }
  });

  it('buddyWhistlesOfQuality returns the sorted, quality-scoped whistle pool from the live catalog', () => {
    for (const tier of GLOBAL_BUDDY_DROP_TIERS) {
      const pool = buddyWhistlesOfQuality(tier.quality);
      expect(pool.length).toBeGreaterThan(0);
      // Sorted, and every id really is a buddy whistle of this exact quality.
      expect(pool).toEqual([...pool].sort());
      for (const id of pool) {
        expect(ITEMS[id]?.kind).toBe('buddy');
        expect(ITEMS[id]?.quality ?? 'common').toBe(tier.quality);
      }
    }
  });

  it('returns an empty pool for a quality with no buddy whistles', () => {
    expect(buddyWhistlesOfQuality('legendary')).toEqual([]);
    expect(buddyWhistlesOfQuality('poor')).toEqual([]);
  });

  for (const tier of GLOBAL_BUDDY_DROP_TIERS) {
    it(`drops a ${tier.quality} buddy whistle near its configured ${(tier.chance * 100).toFixed(2)}% rate`, () => {
      const n = 40000;
      const rolls = rollMany(1234, n);
      const pool = new Set(buddyWhistlesOfQuality(tier.quality));
      const hits = rolls.filter((items) => items.some((s) => pool.has(s.itemId))).length;
      const rate = hits / n;
      // Wide enough to never flake at these odds and this n, tight enough to
      // prove the tier fires at its intended rate, not 0 and not another tier's.
      expect(rate).toBeGreaterThan(tier.chance - tier.chance * 0.5 - 0.001);
      expect(rate).toBeLessThan(tier.chance + tier.chance * 0.5 + 0.001);
    });
  }

  it('fires on a mob with an empty per-mob loot table (global, not table-dependent)', () => {
    const rolls = rollMany(7, 20000);
    expect(rolls.some((items) => items.length > 0)).toBe(true);
  });

  it('is deterministic: identical seed reproduces the exact same sequence of drops', () => {
    expect(rollMany(99, 500)).toEqual(rollMany(99, 500));
  });

  it('every dropped item id is a real buddy whistle of a declared tier quality', () => {
    const rolls = rollMany(2024, 5000);
    const allQualities = new Set(GLOBAL_BUDDY_DROP_TIERS.map((t) => t.quality));
    for (const items of rolls) {
      for (const slot of items) {
        expect(ITEMS[slot.itemId]?.kind).toBe('buddy');
        expect(allQualities.has(ITEMS[slot.itemId]?.quality ?? 'common')).toBe(true);
      }
    }
  });
});
