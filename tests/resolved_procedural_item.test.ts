import { describe, expect, it } from 'vitest';
import { resolvedItemStats, resolvedWeaponDps } from '../src/sim/equipment/resolved_item';
import { TWOHAND_DPS_MULT, weaponDpsBudget } from '../src/sim/item_budget';
import type { ProceduralItemInstance } from '../src/sim/procedural_item';
import type { ItemDef, ItemInstancePayload } from '../src/sim/types';

function definition(id: string, values: Partial<ItemDef> = {}): ItemDef {
  return {
    id,
    name: id,
    kind: 'armor',
    slot: 'ring',
    quality: 'common',
    sellValue: 1,
    ...values,
  } as ItemDef;
}

function procedural(
  baseId: string,
  itemLevel: number,
  affixValues: Record<string, number>,
): ProceduralItemInstance {
  return {
    version: 1,
    uid: 'pi1:test:1',
    baseId,
    itemLevel,
    rarity: 'rare',
    affixes: [
      {
        affixId: 'fixture',
        family: 'fixture',
        position: 'prefix',
        tier: 1,
        revision: 1,
        budget: 1,
        values: affixValues,
        ranges: Object.fromEntries(
          Object.entries(affixValues).map(([key, value]) => [key, { min: value, max: value }]),
        ),
      },
    ],
    generatedName: {
      baseId,
      rareWordIds: ['procedural.rare.grave', 'procedural.rare.promise'],
    },
    seed: 1,
  };
}

describe('resolved procedural item stats', () => {
  it('preserves definition-only equipment values', () => {
    const item = definition('static_ring', {
      stats: { str: 2, sta: 3 },
      spellPower: 4,
      critRating: 5,
      hasteRating: 6,
      hitRating: 7,
      pvpOffenseRating: 8,
      pvpDefenseRating: 9,
    });
    expect(resolvedItemStats(item)).toEqual({
      stats: { str: 2, agi: 0, sta: 3, int: 0, spi: 0, armor: 0 },
      spellPower: 4,
      critRating: 5,
      hasteRating: 6,
      hitRating: 7,
      pvpOffenseRating: 8,
      pvpDefenseRating: 9,
      healthOnKill: 0,
      manaOnKill: 0,
      blockValue: 0,
    });
  });

  it('combines definition, legacy rolled, and procedural final values once', () => {
    const item = definition('gravecaller_ring', {
      stats: { sta: 1 },
      spellPower: 2,
      critRating: 3,
    });
    const instance: ItemInstancePayload = {
      rolled: { stats: { int: 2, sta: 1 } },
      procedural: procedural('gravecaller_ring', 20, {
        int: 7,
        sta: 4,
        spellPower: 8,
        critRating: 10,
        hasteRating: 11,
        hitRating: 12,
        healthOnKill: 5,
        manaOnKill: 6,
      }),
    };
    const resolved = resolvedItemStats(item, instance);
    expect(resolved.stats).toEqual({
      str: 0,
      agi: 0,
      sta: 6,
      int: 9,
      spi: 0,
      armor: 0,
    });
    expect(resolved.spellPower).toBe(10);
    expect(resolved.critRating).toBe(13);
    expect(resolved.hasteRating).toBe(11);
    expect(resolved.hitRating).toBe(12);
    expect(resolved.healthOnKill).toBe(5);
    expect(resolved.manaOnKill).toBe(6);
  });

  it('scales a procedural armor base to the persisted item level', () => {
    const item = definition('thornpeak_mail_chest', {
      slot: 'chest',
      armorType: 'mail',
      stats: { armor: 72 },
    });
    const instance: ItemInstancePayload = {
      rolled: { stats: { armor: 3 } },
      procedural: procedural('thornpeak_mail_chest', 21, { armor: 28 }),
    };
    // The physical base resolves first: 72 at source level 14 becomes 108 at
    // item level 21. The rolled procedural armor affix then adds 28. Legacy
    // armor is intentionally replaced with the base physical value.
    expect(resolvedItemStats(item, instance).stats.armor).toBe(136);
  });

  it('resolves one-hand and two-hand weapons on the shared DPS curve', () => {
    const sword = definition('iron_broadsword', {
      kind: 'weapon',
      slot: 'mainhand',
      weapon: { min: 2, max: 4, speed: 2.4 },
    });
    const staff = definition('ashwood_staff', {
      kind: 'weapon',
      slot: 'mainhand',
      hand: 'twohand',
      weapon: { min: 3, max: 6, speed: 3 },
    });
    const swordStats = resolvedItemStats(sword, {
      procedural: procedural('iron_broadsword', 20, {}),
    });
    const staffStats = resolvedItemStats(staff, {
      procedural: procedural('ashwood_staff', 20, {}),
    });
    expect(resolvedWeaponDps(swordStats)).toBeCloseTo(weaponDpsBudget(20), 0);
    expect(resolvedWeaponDps(staffStats)).toBeCloseTo(weaponDpsBudget(20) * TWOHAND_DPS_MULT, 0);
    expect(resolvedWeaponDps(staffStats)).toBeGreaterThan(resolvedWeaponDps(swordStats));
  });

  it('does not mutate definitions, instances, or nested legendary rolls', () => {
    const item = definition('gravecaller_ring', { stats: { int: 1 } });
    const proc = procedural('gravecaller_ring', 20, { int: 7 });
    proc.legendaryPowerId = 'fixture_power';
    proc.legendaryRolls = { chance: 0.3 };
    const instance: ItemInstancePayload = { procedural: proc };
    const beforeItem = structuredClone(item);
    const beforeInstance = structuredClone(instance);
    const resolved = resolvedItemStats(item, instance);
    expect(item).toEqual(beforeItem);
    expect(instance).toEqual(beforeInstance);
    expect(resolved.legendaryPowerId).toBe('fixture_power');
    expect(resolved.legendaryRolls).toEqual({ chance: 0.3 });
    expect(resolved.legendaryRolls).not.toBe(proc.legendaryRolls);
  });

  it('fails closed when a payload base disagrees with its definition', () => {
    expect(() =>
      resolvedItemStats(definition('gravecaller_ring'), {
        procedural: procedural('iron_broadsword', 20, { str: 5 }),
      }),
    ).toThrow(/does not match item definition/);
  });
});
