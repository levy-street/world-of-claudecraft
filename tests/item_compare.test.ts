import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import type { CoreStats, ItemDef } from '../src/sim/types';
import { itemStatDeltas } from '../src/ui/item_compare';

function armor(
  id: string,
  stats: Partial<CoreStats>,
  ratings: Partial<{
    pvpOffenseRating: number;
    pvpDefenseRating: number;
    hitRating: number;
    critRating: number;
    hasteRating: number;
    spellPower: number;
    healPower: number;
  }> = {},
): ItemDef {
  return {
    id,
    name: id,
    kind: 'armor',
    armorType: 'mail',
    slot: 'chest',
    sellValue: 1,
    stats,
    ...ratings,
  };
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

  it('compares one Warfare rating as a whole-point item stat', () => {
    const candidate = armor('candidate', {}, { pvpOffenseRating: 40, pvpDefenseRating: 40 });
    const equipped = armor('equipped', {}, { pvpOffenseRating: 15, pvpDefenseRating: 15 });
    expect(itemStatDeltas(candidate, equipped)).toEqual([
      { stat: 'warfare', delta: 25, decimals: 0 },
    ]);
  });

  it('treats missing Warfare as zero and never overstates a mismatched internal pair', () => {
    const candidate = armor('warfare', {}, { pvpOffenseRating: 30, pvpDefenseRating: 30 });
    const equipped = armor('plain', {});
    expect(itemStatDeltas(candidate, equipped)).toEqual([
      { stat: 'warfare', delta: 30, decimals: 0 },
    ]);
    expect(
      itemStatDeltas(
        armor('mismatch', {}, { pvpOffenseRating: 30, pvpDefenseRating: 10 }),
        equipped,
      ),
    ).toEqual([{ stat: 'warfare', delta: 10, decimals: 0 }]);
  });

  it('reports hit, crit and haste rating deltas in the item tooltip affix order', () => {
    // The exact toEqual also pins hit-before-crit-before-haste, matching the
    // base item tooltip's rating line order.
    const candidate = armor('hitpiece', {}, { hitRating: 20, hasteRating: 10 });
    const equipped = armor('critpiece', {}, { critRating: 20, hasteRating: 25 });
    expect(itemStatDeltas(candidate, equipped)).toEqual([
      { stat: 'hitRating', delta: 20, decimals: 0 },
      { stat: 'critRating', delta: -20, decimals: 0 },
      { stat: 'hasteRating', delta: -15, decimals: 0 },
    ]);
  });

  it('reports Spell Power and Healing Power deltas ahead of the ratings', () => {
    // The Crucible tier authored both affixes onto items; the exact toEqual
    // pins the tooltip's Stats | Affix | Ratings order (affixes first) and
    // that each affix earns its own row rather than riding a rating row.
    const candidate = armor('vestment', { int: 10 }, { spellPower: 14, critRating: 60 });
    const equipped = armor('oldrobe', { int: 8 }, { healPower: 12, critRating: 40 });
    expect(itemStatDeltas(candidate, equipped)).toEqual([
      { stat: 'int', delta: 2, decimals: 0 },
      { stat: 'spellPower', delta: 14, decimals: 0 },
      { stat: 'healPower', delta: -12, decimals: 0 },
      { stat: 'critRating', delta: 20, decimals: 0 },
    ]);
  });

  it('treats a missing rating as zero (full value counts as a gain)', () => {
    const candidate = armor('hasted', {}, { hasteRating: 25 });
    const equipped = armor('plain', {});
    expect(itemStatDeltas(candidate, equipped)).toEqual([
      { stat: 'hasteRating', delta: 25, decimals: 0 },
    ]);
  });

  it('suppresses zero rating deltas (equal ratings yield no lines)', () => {
    const candidate = armor('a', {}, { critRating: 25 });
    const equipped = armor('b', {}, { critRating: 25 });
    expect(itemStatDeltas(candidate, equipped)).toEqual([]);
  });

  it('surfaces the rating difference between two real epic helmets', () => {
    // The community report scenario: comparing gear that differs in ratings
    // showed no rating rows at all. The 2/4/6 lineage retune's Hit program
    // flipped both original helmets to crit 20 (an identical pair surfaces
    // nothing), so the pair is now crownforged versus soulflame:
    // crownforged_dreadhelm carries crit rating, soulflame_cowl carries
    // haste rating (its retuned seed).
    const dreadhelm = ITEMS.crownforged_dreadhelm;
    const cowl = ITEMS.soulflame_cowl;
    expect(dreadhelm?.critRating).toBe(20);
    expect(cowl?.hasteRating).toBe(20);
    const byStat = Object.fromEntries(
      itemStatDeltas(dreadhelm, cowl).map((d) => [d.stat, d.delta]),
    );
    expect(byStat.critRating).toBe(20);
    expect(byStat.hasteRating).toBe(-20);
  });
});
