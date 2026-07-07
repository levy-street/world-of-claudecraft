import { describe, expect, it } from 'vitest';
import { updateRegen } from '../src/sim/combat/auras';
import { ITEMS } from '../src/sim/data';
import { recalcPlayerStats } from '../src/sim/entity';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import { type Aura, CONSUME_TICKS, type Entity, type PlayerClass } from '../src/sim/types';

const FOOD_TIERS = {
  low: 90,
  mid: 270,
  high: 540,
} as const;

const DRINK_TIERS = {
  low: 180,
  mid: 540,
  high: 1080,
} as const;

const FOOD_IDS_BY_TIER = {
  low: [
    'baked_bread',
    'brightwood_venison',
    'conjured_bread',
    'raw_mirror_trout',
    'raw_river_perch',
    'tough_jerky',
  ],
  mid: [
    'conjured_bread2',
    'fenbridge_rye',
    'raw_bog_eel',
    'raw_marsh_pike',
    'roasted_boar',
    'smoked_eel',
  ],
  high: [
    'conjured_bread3',
    'glimmerfin_koi',
    'raw_frostgill_trout',
    'raw_stonescale_carp',
    'roast_mountain_goat',
    'trail_hardtack',
  ],
} as const;

const DRINK_IDS_BY_TIER = {
  low: ['conjured_water', 'spring_water'],
  mid: ['conjured_water2', 'marsh_mint_tea', 'silvermist_cordial'],
  high: ['conjured_water3', 'glacier_melt', 'meltwater_flask'],
} as const;

type FoodTierName = keyof typeof FOOD_TIERS;

function makeSim(cls: PlayerClass, level: number): Sim {
  const sim = new Sim({ seed: 1608, playerClass: cls, autoEquip: false });
  sim.setPlayerLevel(level);
  return sim;
}

function metaOf(sim: Sim): PlayerMeta {
  return sim.players.get(sim.player.id) as PlayerMeta;
}

function primeHpRegen(p: Entity): void {
  p.inCombat = false;
  p.hp = 1;
  p.eating = null;
  p.drinking = null;
}

function runHpRegenTick(sim: Sim): number {
  const p = sim.player;
  primeHpRegen(p);
  const before = p.hp;
  sim.tickCount = 40;
  updateRegen(sim.ctx, p, metaOf(sim));
  return p.hp - before;
}

function runEatingRegenTick(totalFoodHp: number): { idleGain: number; eatingGain: number } {
  const idleSim = makeSim('warrior', 20);
  const idleGain = runHpRegenTick(idleSim);
  const eatingSim = makeSim('warrior', 20);
  const p = eatingSim.player;
  primeHpRegen(p);
  p.eating = {
    itemId: 'test_food',
    kind: 'food',
    hpPer2s: totalFoodHp / CONSUME_TICKS,
    manaPer2s: 0,
    remaining: 18,
  };
  const before = p.hp;
  eatingSim.tickCount = 40;
  updateRegen(eatingSim.ctx, p, metaOf(eatingSim));
  return { idleGain, eatingGain: p.hp - before };
}

function runManaRegenTick(drinkMana: number): { idleGain: number; drinkingGain: number } {
  const idleSim = makeSim('mage', 20);
  const idle = idleSim.player;
  idle.inCombat = false;
  idle.resource = 1;
  idle.fiveSecondRule = 5;
  idleSim.tickCount = 40;
  const idleBefore = idle.resource;
  updateRegen(idleSim.ctx, idle, metaOf(idleSim));
  const idleGain = idle.resource - idleBefore;

  const drinkingSim = makeSim('mage', 20);
  const p = drinkingSim.player;
  p.inCombat = false;
  p.resource = 1;
  p.fiveSecondRule = 5;
  p.drinking = {
    itemId: 'test_drink',
    kind: 'drink',
    hpPer2s: 0,
    manaPer2s: drinkMana / CONSUME_TICKS,
    remaining: 18,
  };
  const before = p.resource;
  drinkingSim.tickCount = 40;
  updateRegen(drinkingSim.ctx, p, metaOf(drinkingSim));
  return { idleGain, drinkingGain: p.resource - before };
}

function idsWithValue(field: 'foodHp' | 'drinkMana' | 'potionHp' | 'potionMana'): string[] {
  return Object.values(ITEMS)
    .filter((item) => item[field] !== undefined)
    .map((item) => item.id)
    .sort();
}

function sortedTierIds(tiers: Record<string, readonly string[]>): string[] {
  return Object.values(tiers).flat().sort();
}

function expectItemsToUseValue(
  ids: readonly string[],
  field: 'foodHp' | 'drinkMana',
  value: number,
) {
  for (const id of ids) {
    expect(ITEMS[id]?.[field], id).toBe(value);
  }
}

function ratio(value: number, pool: number): number {
  return value / pool;
}

describe('consumable regen balance', () => {
  it.each(
    Object.entries(FOOD_TIERS) as [FoodTierName, number][],
  )('%s food adds its tick on top of natural HP regen', (_tier, totalFoodHp) => {
    const { idleGain, eatingGain } = runEatingRegenTick(totalFoodHp);
    const foodTick = totalFoodHp / CONSUME_TICKS;

    expect(eatingGain).toBeGreaterThan(idleGain);
    expect(eatingGain).toBe(idleGain + foodTick);
  });

  it('food and drink both use natural regen plus consumable tick', () => {
    const hp = runEatingRegenTick(FOOD_TIERS.mid);
    const mana = runManaRegenTick(DRINK_TIERS.mid);

    expect(hp.eatingGain).toBe(hp.idleGain + FOOD_TIERS.mid / CONSUME_TICKS);
    expect(mana.drinkingGain).toBe(mana.idleGain + DRINK_TIERS.mid / CONSUME_TICKS);
  });
});

describe('consumable item tiers', () => {
  it('food tiers are strictly increasing and every food item is aligned', () => {
    expect(FOOD_TIERS.low).toBeLessThan(FOOD_TIERS.mid);
    expect(FOOD_TIERS.mid).toBeLessThan(FOOD_TIERS.high);
    expect(idsWithValue('foodHp')).toEqual(sortedTierIds(FOOD_IDS_BY_TIER));
    expectItemsToUseValue(FOOD_IDS_BY_TIER.low, 'foodHp', FOOD_TIERS.low);
    expectItemsToUseValue(FOOD_IDS_BY_TIER.mid, 'foodHp', FOOD_TIERS.mid);
    expectItemsToUseValue(FOOD_IDS_BY_TIER.high, 'foodHp', FOOD_TIERS.high);
  });

  it('drink tiers are strictly increasing and every drink item is aligned', () => {
    expect(DRINK_TIERS.low).toBeLessThan(DRINK_TIERS.mid);
    expect(DRINK_TIERS.mid).toBeLessThan(DRINK_TIERS.high);
    expect(idsWithValue('drinkMana')).toEqual(sortedTierIds(DRINK_IDS_BY_TIER));
    expectItemsToUseValue(DRINK_IDS_BY_TIER.low, 'drinkMana', DRINK_TIERS.low);
    expectItemsToUseValue(DRINK_IDS_BY_TIER.mid, 'drinkMana', DRINK_TIERS.mid);
    expectItemsToUseValue(DRINK_IDS_BY_TIER.high, 'drinkMana', DRINK_TIERS.high);
  });

  it('potion ladders use the documented emergency recovery tiers', () => {
    expect(idsWithValue('potionHp')).toEqual([
      'healing_potion',
      'lesser_healing_potion',
      'minor_healing_potion',
    ]);
    expect(ITEMS.minor_healing_potion.potionHp).toBe(90);
    expect(ITEMS.lesser_healing_potion.potionHp).toBe(180);
    expect(ITEMS.healing_potion.potionHp).toBe(360);

    expect(idsWithValue('potionMana')).toEqual([
      'lesser_mana_potion',
      'mana_potion',
      'minor_mana_potion',
    ]);
    expect(ITEMS.minor_mana_potion.potionMana).toBe(180);
    expect(ITEMS.lesser_mana_potion.potionMana).toBe(360);
    expect(ITEMS.mana_potion.potionMana).toBe(585);
  });
});

describe('potion bracket fractions', () => {
  it('healing potions restore 30 to 45 percent of a durable unbuffed bracket pool', () => {
    const brackets = [
      { level: 6, itemId: 'minor_healing_potion' },
      { level: 13, itemId: 'lesser_healing_potion' },
      { level: 20, itemId: 'healing_potion' },
    ] as const;

    for (const bracket of brackets) {
      const sim = makeSim('warrior', bracket.level);
      const restored = ITEMS[bracket.itemId].potionHp as number;
      expect(ratio(restored, sim.player.maxHp), bracket.itemId).toBeGreaterThanOrEqual(0.3);
      expect(ratio(restored, sim.player.maxHp), bracket.itemId).toBeLessThanOrEqual(0.45);
    }
  });

  it('mana potions restore 30 to 45 percent of a high-mana unbuffed bracket pool', () => {
    const brackets = [
      { level: 6, itemId: 'minor_mana_potion' },
      { level: 13, itemId: 'lesser_mana_potion' },
      { level: 20, itemId: 'mana_potion' },
    ] as const;

    for (const bracket of brackets) {
      const sim = makeSim('mage', bracket.level);
      const restored = ITEMS[bracket.itemId].potionMana as number;
      expect(ratio(restored, sim.player.maxResource), bracket.itemId).toBeGreaterThanOrEqual(0.3);
      expect(ratio(restored, sim.player.maxResource), bracket.itemId).toBeLessThanOrEqual(0.45);
    }
  });

  it('top healing potion does not severely regress on a buffed stamina tank', () => {
    const unbuffed = makeSim('warrior', 20);
    const buffed = makeSim('warrior', 20);
    const p = buffed.player;
    const meta = metaOf(buffed);
    const staminaBuffs: Aura[] = [
      {
        id: 'elixir_elixir_of_the_bear',
        name: 'Might of the Bear',
        kind: 'buff_sta',
        remaining: 900,
        duration: 900,
        value: 12,
        sourceId: p.id,
        school: 'nature',
      },
      {
        id: 'power_word_fortitude',
        name: 'Power Word: Fortitude',
        kind: 'buff_sta',
        remaining: 1800,
        duration: 1800,
        value: 12,
        sourceId: p.id,
        school: 'holy',
      },
      {
        id: 'commanding_shout',
        name: 'Commanding Shout',
        kind: 'buff_sta',
        remaining: 120,
        duration: 120,
        value: 11,
        sourceId: p.id,
        school: 'physical',
      },
    ];
    p.auras.push(...staminaBuffs);
    recalcPlayerStats(p, meta.cls, meta.equipment, buffed.playerMods(meta));

    const restored = ITEMS.healing_potion.potionHp as number;
    const unbuffedFraction = ratio(restored, unbuffed.player.maxHp);
    const buffedFraction = ratio(restored, p.maxHp);
    expect(buffedFraction).toBeLessThan(unbuffedFraction);
    expect(buffedFraction).toBeGreaterThanOrEqual(0.25);
  });
});
