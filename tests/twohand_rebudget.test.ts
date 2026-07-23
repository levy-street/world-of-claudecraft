// v0.27.1 two-hand re-budget: a two-handed weapon differentiates on weapon DPS,
// never on stats. Every dual-wield or weapon-and-shield setup must out-stat a
// two-hander of the same item level; the 2H's compensation is the TWOHAND_DPS_MULT
// weapon-dps premium. Born from the v0.27.0 fury incident: the old 2x stat budget
// assumed the offhand slot was sacrificed, and Titan's Grip filled BOTH slots with
// double-budget two-handers (86 weapon stat points vs 38 for a dual-1H pair).
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import {
  SLOT_STAT_MULT,
  TWOHAND_DPS_MULT,
  TWOHAND_STAT_MULT,
  weaponDpsBudget,
} from '../src/sim/item_budget';
import { expectedStatBudget, itemLevel, primaryStatSum } from '../src/sim/item_level';
import type { WeaponItemDef } from '../src/sim/types';

const twoHanders = (): WeaponItemDef[] =>
  Object.values(ITEMS).filter(
    (i): i is WeaponItemDef => i.kind === 'weapon' && i.hand === 'twohand',
  );

describe('v0.27.1 two-hand re-budget', () => {
  it('pins the re-budget constants', () => {
    expect(TWOHAND_STAT_MULT).toBe(1.3);
    expect(TWOHAND_DPS_MULT).toBe(1.15);
  });

  it('keeps a two-hander strictly below every mainhand + offhand pair budget', () => {
    // The structural invariant behind the re-budget: the stat premium must never
    // reach the combined slot weights of the pair it displaces, whatever the tier.
    expect(TWOHAND_STAT_MULT).toBeLessThan(SLOT_STAT_MULT.mainhand + SLOT_STAT_MULT.offhand);
  });

  it('every leveled two-hander carries exactly its re-budgeted stat total', () => {
    let checked = 0;
    for (const item of twoHanders()) {
      if (itemLevel(item) === undefined) continue;
      expect(primaryStatSum(item), item.id).toBe(expectedStatBudget(item));
      checked++;
    }
    // The four authored epics at minimum; generated heroic variants join the
    // sweep automatically as they exist.
    expect(checked).toBeGreaterThanOrEqual(4);
  });

  it('every leveled two-hander sits on the premium dps curve', () => {
    for (const item of twoHanders()) {
      const level = itemLevel(item);
      if (level === undefined) continue;
      const dps = (item.weapon.min + item.weapon.max) / 2 / item.weapon.speed;
      const target = weaponDpsBudget(level) * TWOHAND_DPS_MULT;
      expect(
        Math.abs(dps - target),
        `${item.id} dps ${dps.toFixed(2)} vs target ${target.toFixed(2)}`,
      ).toBeLessThan(0.35);
    }
  });
});
