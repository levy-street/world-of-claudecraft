import { describe, expect, it } from 'vitest';
import type { ItemDef, Stats } from '../src/sim/types';
import { itemStatDeltas } from '../src/ui/item_compare';

function armor(id: string, stats: Partial<Stats>, extra: Partial<ItemDef> = {}): ItemDef {
  return {
    id,
    name: id,
    kind: 'armor',
    armorType: 'mail',
    slot: 'chest',
    sellValue: 1,
    stats,
    ...extra,
  } as ItemDef;
}
function weapon(id: string, min: number, max: number, speed: number): ItemDef {
  return {
    id,
    name: id,
    kind: 'weapon',
    slot: 'mainhand',
    sellValue: 1,
    weapon: { min, max, speed },
  };
}

describe('itemStatDeltas', () => {
  it('reports positive deltas for an upgrade and negative for a downgrade', () => {
    const candidate = armor('better', { armor: 50, str: 5, sta: 3 });
    const equipped = armor('worse', { armor: 40, str: 2, sta: 8 });
    const deltas = itemStatDeltas(candidate, equipped);
    const byStat = Object.fromEntries(deltas.map((d) => [d.stat, d.delta]));
    expect(byStat.armor).toBe(10);
    expect(byStat.str).toBe(3);
    expect(byStat.sta).toBe(-5);
    expect(byStat.agi).toBeUndefined(); // unchanged stats are omitted
  });

  it('omits trivial differences (an identical swap yields no lines)', () => {
    const same = armor('a', { armor: 40, str: 2 });
    const dup = armor('b', { armor: 40, str: 2 });
    expect(itemStatDeltas(same, dup)).toEqual([]);
  });

  it('computes a fractional weapon DPS delta at one decimal of precision', () => {
    // 10-20 @ 2.0s = 7.5 dps vs 8-12 @ 2.0s = 5.0 dps -> +2.5
    const candidate = weapon('big', 10, 20, 2.0);
    const equipped = weapon('small', 8, 12, 2.0);
    const dps = itemStatDeltas(candidate, equipped).find((d) => d.stat === 'dps');
    expect(dps).toBeDefined();
    expect(dps?.delta).toBeCloseTo(2.5, 5);
    expect(dps?.decimals).toBe(1);
  });

  it('treats a missing equipped stat as zero (full value counts as a gain)', () => {
    const candidate = armor('statful', { armor: 30, int: 12 });
    const equipped = armor('plain', { armor: 30 });
    const byStat = Object.fromEntries(
      itemStatDeltas(candidate, equipped).map((d) => [d.stat, d.delta]),
    );
    expect(byStat.int).toBe(12);
    expect(byStat.armor).toBeUndefined();
  });

  it('includes item enhancement primary stats in deltas', () => {
    const candidate = armor(
      'enchanted',
      { armor: 30 },
      {
        enhancements: [
          {
            id: 'minor_agility',
            name: 'Minor Agility',
            kind: 'enchant',
            effect: { stats: { agi: 5 } },
          },
        ],
      },
    );
    const equipped = armor(
      'socketed',
      { armor: 30 },
      {
        enhancements: [
          {
            id: 'small_ruby',
            name: 'Small Ruby',
            kind: 'gem',
            effect: { stats: { sta: 2 } },
          },
        ],
      },
    );

    const byStat = Object.fromEntries(
      itemStatDeltas(candidate, equipped).map((d) => [d.stat, d.delta]),
    );
    expect(byStat.agi).toBe(5);
    expect(byStat.sta).toBe(-2);
    expect(byStat.armor).toBeUndefined();
  });
});
