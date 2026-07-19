import { describe, expect, it } from 'vitest';
import { itemOffhandModelUrl } from '../src/render/characters/manifest';
import { DUNGEONS, ITEMS, MOBS } from '../src/sim/data';
import { isShieldItem } from '../src/sim/equipment_rules';
import {
  expectedStatBudget,
  itemLevel,
  itemSourceLevel,
  primaryStatSum,
} from '../src/sim/item_level';
import type { ArmorItemDef, ItemDef } from '../src/sim/types';

const DUNGEON_SHIELDS = [
  {
    itemId: 'boundstone_bulwark',
    mobId: 'sanctum_boneguard',
    dungeonId: 'gravewyrm_sanctum',
    quality: 'rare',
    itemLevel: 22,
    chance: 0.08,
    rollGroup: 'boneguard_bonus',
    model: 'models/weapons/shield_round.glb',
  },
  {
    itemId: 'drownedmoon_aegis',
    mobId: 'ysolei',
    dungeonId: 'drowned_temple',
    quality: 'epic',
    itemLevel: 24,
    chance: 0.15,
    rollGroup: undefined,
    model: 'models/weapons/shield_round.glb',
  },
  {
    itemId: 'gravewyrm_bulwark',
    mobId: 'korzul_the_gravewyrm',
    dungeonId: 'gravewyrm_sanctum',
    quality: 'epic',
    itemLevel: 26,
    chance: 0.1,
    rollGroup: 'korzul_bonus',
    model: 'models/weapons/shield_square.glb',
  },
] as const;

function assertShield(item: ItemDef | undefined, itemId: string): asserts item is ArmorItemDef {
  expect(item, `${itemId} exists`).toBeTruthy();
  expect(isShieldItem(item), `${itemId} is a shield`).toBe(true);
  if (!isShieldItem(item)) throw new Error(`${itemId} is not a shield`);
}

describe('dungeon shield progression', () => {
  it('adds tank shields across the item-level 22 to 26 gap', () => {
    for (const expected of DUNGEON_SHIELDS) {
      const item = ITEMS[expected.itemId];
      assertShield(item, expected.itemId);

      expect(item.kind, expected.itemId).toBe('armor');
      expect(item.armorType, expected.itemId).toBe('mail');
      expect(item.slot, expected.itemId).toBe('offhand');
      expect(item.shield, expected.itemId).toBe(true);
      expect(item.blockValue, expected.itemId).toBeGreaterThan(0);
      expect(item.quality, expected.itemId).toBe(expected.quality);
      expect(item.requiredClass, expected.itemId).toEqual(['warrior', 'paladin', 'shaman']);
      expect(itemOffhandModelUrl(item.id), `${expected.itemId} held model`).toBe(expected.model);
      expect(itemLevel(item), expected.itemId).toBe(expected.itemLevel);
      expect(primaryStatSum(item), `${expected.itemId} uses its full stat budget`).toBe(
        expectedStatBudget(item),
      );
    }
  });

  it('sources every shield from a mob inside its dungeon at the configured rate', () => {
    for (const expected of DUNGEON_SHIELDS) {
      const dungeon = DUNGEONS[expected.dungeonId];
      const mob = MOBS[expected.mobId];
      expect(dungeon, expected.dungeonId).toBeTruthy();
      expect(mob, expected.mobId).toBeTruthy();
      expect(
        dungeon.spawns.some((spawn) => spawn.mobId === expected.mobId),
        `${expected.mobId} spawns in ${expected.dungeonId}`,
      ).toBe(true);

      const drop = mob.loot.find((entry) => entry.itemId === expected.itemId);
      expect(drop, `${expected.mobId} drops ${expected.itemId}`).toBeTruthy();
      expect(drop?.chance, expected.itemId).toBe(expected.chance);
      expect(drop?.rollGroup, expected.itemId).toBe(expected.rollGroup);
      expect(itemSourceLevel(expected.itemId), expected.itemId).toBe(mob.maxLevel);
    }
  });

  it('raises armor, block, and primary stats through the ladder', () => {
    const shields = DUNGEON_SHIELDS.map(({ itemId }) => {
      const item = ITEMS[itemId];
      assertShield(item, itemId);
      return item;
    });

    expect(shields.map((item) => itemLevel(item))).toEqual([22, 24, 26]);
    for (let i = 1; i < shields.length; i++) {
      expect(shields[i].stats?.armor, shields[i].id).toBeGreaterThan(
        shields[i - 1].stats?.armor ?? 0,
      );
      expect(shields[i].blockValue, shields[i].id).toBeGreaterThan(shields[i - 1].blockValue ?? 0);
      expect(primaryStatSum(shields[i]), shields[i].id).toBeGreaterThan(
        primaryStatSum(shields[i - 1]),
      );
    }
  });
});
