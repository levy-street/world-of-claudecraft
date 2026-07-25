import { describe, expect, it } from 'vitest';
import { PROCEDURAL_BASE_ITEMS, PROCEDURAL_ITEM_BASES } from '../src/sim/content/procedural_loot';
import { resolvedItemStats, resolvedWeaponDps } from '../src/sim/equipment/resolved_item';
import { TWOHAND_DPS_MULT, weaponDpsBudget } from '../src/sim/item_budget';
import { generateProceduralItem } from '../src/sim/loot/procedural/generate';
import type { ProceduralItemInstance } from '../src/sim/procedural_item';
import type { ItemInstancePayload } from '../src/sim/types';

const SAMPLE_SIZE = 100_000;

type DropCategory = 'armor' | 'weapon' | 'jewelry' | 'offhand';

function category(baseId: string): DropCategory {
  const base = PROCEDURAL_ITEM_BASES[baseId];
  if (base.kind === 'weapon') return 'weapon';
  if (base.kind === 'held_offhand' || base.shield) return 'offhand';
  if (base.slot === 'ring' || base.slot === 'neck') return 'jewelry';
  return 'armor';
}

function instance(baseId: string, itemLevel: number): ItemInstancePayload {
  const procedural: ProceduralItemInstance = {
    version: 1,
    uid: `pi1:balance:${baseId}:${itemLevel}`,
    baseId,
    itemLevel,
    rarity: 'rare',
    affixes: [],
    generatedName: { baseId },
    seed: 1,
  };
  return { procedural };
}

describe('procedural loot balance matrix', () => {
  it('keeps category budgets at 40/40/10/10 despite the 21 armor bases', () => {
    const weightByCategory: Record<DropCategory, number> = {
      armor: 0,
      weapon: 0,
      jewelry: 0,
      offhand: 0,
    };
    for (const base of Object.values(PROCEDURAL_ITEM_BASES)) {
      weightByCategory[category(base.id)] += base.dropWeight;
    }
    expect(weightByCategory).toEqual({ armor: 378, weapon: 378, jewelry: 94, offhand: 94 });

    const observed: Record<DropCategory, number> = {
      armor: 0,
      weapon: 0,
      jewelry: 0,
      offhand: 0,
    };
    const jewelry = { ring: 0, neck: 0 };
    for (let sample = 1; sample <= SAMPLE_SIZE; sample++) {
      const seed = Math.imul(sample, 0x9e3779b1) >>> 0;
      const drop = generateProceduralItem({
        seed,
        uid: `pi1:balance:${seed}`,
        context: {
          source: 'dev',
          sourceEntityId: 1,
          sourceSpawnSequence: seed,
          lootSlotIndex: 0,
        },
        basePoolId: 'initial_all',
        rarityTableId: 'initial_world',
        sourceItemLevel: 40,
        forcedRarity: 'common',
      });
      observed[category(drop.itemId)]++;
      const slot = PROCEDURAL_ITEM_BASES[drop.itemId].slot;
      if (slot === 'ring' || slot === 'neck') jewelry[slot]++;
    }

    const totalWeight = Object.values(weightByCategory).reduce((sum, weight) => sum + weight, 0);
    for (const key of Object.keys(observed) as DropCategory[]) {
      expect(observed[key] / SAMPLE_SIZE, key).toBeCloseTo(weightByCategory[key] / totalWeight, 2);
    }
    expect(jewelry.ring / jewelry.neck).toBeCloseTo(63 / 31, 1);
  });

  it('keeps same-slot armor ordered cloth below leather below mail at every tested level', () => {
    const slots = ['helmet', 'shoulder', 'chest', 'waist', 'legs', 'gloves', 'feet'] as const;
    for (const itemLevel of [1, 5, 10, 20, 30, 40]) {
      for (const slot of slots) {
        const armor = (armorType: 'cloth' | 'leather' | 'mail'): number => {
          const base = Object.values(PROCEDURAL_ITEM_BASES).find(
            (candidate) =>
              candidate.armorType === armorType && candidate.slot === slot && !candidate.shield,
          );
          if (!base) throw new Error(`missing ${armorType}:${slot}`);
          return resolvedItemStats(PROCEDURAL_BASE_ITEMS[base.id], instance(base.id, itemLevel))
            .stats.armor;
        };
        const cloth = armor('cloth');
        const leather = armor('leather');
        const mail = armor('mail');
        expect(cloth, `${itemLevel}:${slot}:cloth`).toBeLessThanOrEqual(leather);
        expect(leather, `${itemLevel}:${slot}:leather`).toBeLessThan(mail);
        if (itemLevel > 1) expect(cloth, `${itemLevel}:${slot}:cloth-strict`).toBeLessThan(leather);
      }
    }
  });

  it('keeps every weapon on the shared one-hand or two-hand DPS curve', () => {
    for (const itemLevel of [1, 5, 10, 20, 30, 40]) {
      for (const base of Object.values(PROCEDURAL_ITEM_BASES)) {
        if (base.kind !== 'weapon') continue;
        const resolved = resolvedItemStats(
          PROCEDURAL_BASE_ITEMS[base.id],
          instance(base.id, itemLevel),
        );
        const expected =
          weaponDpsBudget(itemLevel) * (base.hand === 'twohand' ? TWOHAND_DPS_MULT : 1);
        expect(resolvedWeaponDps(resolved), `${itemLevel}:${base.id}`).toBeCloseTo(expected, 0);
      }
    }
  });
});
