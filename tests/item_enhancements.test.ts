import { afterEach, describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import {
  characterDerivedStats,
  createPlayer,
  recalcPlayerStats,
  type PlayerEquipment,
} from '../src/sim/entity';
import { aggregateItemEnhancements } from '../src/sim/item_enhancements';
import type { ItemDef } from '../src/sim/types';

const ENHANCED_CHEST = 'test_enhanced_chest';
const OVER_LEVEL_CHEST = 'test_over_level_enhanced_chest';

afterEach(() => {
  delete ITEMS[ENHANCED_CHEST];
  delete ITEMS[OVER_LEVEL_CHEST];
});

function register(id: string, item: ItemDef): void {
  ITEMS[id] = item;
}

function chest(id: string, extra: Partial<ItemDef> = {}): ItemDef {
  return {
    id,
    name: id,
    kind: 'armor',
    armorType: 'mail',
    slot: 'chest',
    sellValue: 1,
    ...extra,
  } as ItemDef;
}

function warrior(level: number, equipment: PlayerEquipment) {
  const e = createPlayer(0, 'warrior', { x: 0, y: 0, z: 0 }, 'Tester');
  e.level = level;
  recalcPlayerStats(e, 'warrior', equipment);
  return e;
}

describe('aggregateItemEnhancements', () => {
  it('sums enchant and gem effects into one deterministic stat block', () => {
    const item = chest('stacked', {
      enhancements: [
        {
          id: 'minor_might',
          name: 'Minor Might',
          kind: 'enchant',
          effect: { stats: { str: 3, armor: 7 }, attackPower: 10 },
        },
        {
          id: 'glowing_ruby',
          name: 'Glowing Ruby',
          kind: 'gem',
          effect: { stats: { sta: 4 }, spellPower: 5, crit: 0.02 },
        },
      ],
    });

    expect(aggregateItemEnhancements(item)).toEqual({
      stats: { str: 3, agi: 0, sta: 4, int: 0, spi: 0, armor: 7 },
      attackPower: 10,
      spellPower: 5,
      crit: 0.02,
    });
  });

  it('returns a zero block for plain items', () => {
    expect(aggregateItemEnhancements(chest('plain'))).toEqual({
      stats: { str: 0, agi: 0, sta: 0, int: 0, spi: 0, armor: 0 },
      attackPower: 0,
      spellPower: 0,
      crit: 0,
    });
  });
});

describe('recalcPlayerStats applies item enhancements', () => {
  it('folds enhanced gear into primary stats, AP, crit, spell power, and vitals', () => {
    register(
      ENHANCED_CHEST,
      chest(ENHANCED_CHEST, {
        stats: { armor: 10, str: 2 },
        enhancements: [
          {
            id: 'greater_might',
            name: 'Greater Might',
            kind: 'enchant',
            effect: {
              stats: { armor: 7, str: 3, sta: 4 },
              attackPower: 10,
              spellPower: 5,
              crit: 0.02,
            },
          },
        ],
      }),
    );

    const bare = warrior(20, {});
    const enhanced = warrior(20, { chest: ENHANCED_CHEST });

    expect(enhanced.stats.str).toBe(bare.stats.str + 5);
    expect(enhanced.stats.sta).toBe(bare.stats.sta + 4);
    expect(enhanced.stats.armor).toBe(bare.stats.armor + 17);
    expect(enhanced.attackPower).toBe(bare.attackPower + 20);
    expect(enhanced.critChance).toBeCloseTo(bare.critChance + 0.02);
    expect(enhanced.spellPower).toBe(bare.spellPower + 5);
    expect(enhanced.maxHp).toBeGreaterThan(bare.maxHp);
  });

  it('keeps enhancements inert while the underlying gear is over-level', () => {
    register(
      OVER_LEVEL_CHEST,
      chest(OVER_LEVEL_CHEST, {
        requiredLevel: 20,
        stats: { armor: 10, sta: 2 },
        enhancements: [
          {
            id: 'too_soon',
            name: 'Too Soon',
            kind: 'enchant',
            effect: {
              stats: { str: 99, sta: 99, armor: 99 },
              attackPower: 99,
              spellPower: 99,
              crit: 0.5,
            },
          },
        ],
      }),
    );

    const bare = characterDerivedStats('warrior', 19, {});
    const inert = characterDerivedStats('warrior', 19, { chest: OVER_LEVEL_CHEST });
    expect(inert).toEqual(bare);
  });
});
