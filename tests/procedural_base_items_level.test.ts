import { describe, expect, it } from 'vitest';
import { PROCEDURAL_BASE_ITEMS, PROCEDURAL_ITEM_BASES } from '../src/sim/content/procedural_loot';
import type { ProceduralItemInstance } from '../src/sim/procedural_item';
import {
  meetsItemInstanceLevelRequirement,
  proceduralRequiredLevel,
  requiredLevelForItemInstance,
} from '../src/sim/procedural_item_level';
import type { ItemInstancePayload } from '../src/sim/types';

function instance(
  baseId: string,
  itemLevel: number,
  rarity: ProceduralItemInstance['rarity'],
): ItemInstancePayload {
  return {
    procedural: {
      version: 1,
      uid: 'pi1:test:1',
      baseId,
      itemLevel,
      rarity,
      affixes: [],
      generatedName: { baseId },
      seed: 1,
    },
  };
}

describe('procedural base item definitions and level gates', () => {
  it('creates one static physical definition for every procedural base', () => {
    expect(Object.keys(PROCEDURAL_BASE_ITEMS).sort()).toEqual(
      Object.keys(PROCEDURAL_ITEM_BASES).sort(),
    );
    for (const [baseId, definition] of Object.entries(PROCEDURAL_BASE_ITEMS)) {
      const base = PROCEDURAL_ITEM_BASES[baseId];
      expect(definition.id).toBe(base.id);
      expect(definition.name).toBe(base.name);
      expect(definition.slot).toBe(base.slot);
      expect(definition.quality).toBe('common');
      expect(definition.sellValue).toBeGreaterThan(0);
      if (base.kind === 'weapon') {
        expect(definition.kind).toBe('weapon');
        expect(definition.weapon?.min).toBeGreaterThan(0);
        expect(definition.weapon?.max).toBeGreaterThanOrEqual(definition.weapon?.min ?? 0);
        expect(definition.weapon?.speed).toBe(base.baseWeapon?.speed);
      }
    }
  });

  it('materializes dagger, shield, and caster-offhand gameplay metadata', () => {
    const dagger = PROCEDURAL_BASE_ITEMS.mirefen_dirk;
    expect(dagger.kind).toBe('weapon');
    if (dagger.kind !== 'weapon') throw new Error('mirefen dirk must be a weapon');
    expect(dagger.weapon.dagger).toBe(true);

    const shield = PROCEDURAL_BASE_ITEMS.thornpeak_bulwark;
    expect(shield.kind).toBe('armor');
    if (shield.kind !== 'armor' || shield.slot !== 'offhand')
      throw new Error('thornpeak bulwark must be offhand armor');
    expect(shield.slot).toBe('offhand');
    expect(shield.shield).toBe(true);
    expect(shield.blockValue).toBe(10);
    expect(shield.stats?.armor).toBe(144);

    const focus = PROCEDURAL_BASE_ITEMS.gravecaller_focus;
    expect(focus.kind).toBe('held_offhand');
    expect(focus.slot).toBe('offhand');
  });
  it.each([
    ['common', 18, 18],
    ['magic', 18, 17],
    ['rare', 21, 18],
    ['epic', 23, 18],
    ['legendary', 24, 18],
    ['mythic', 24, 18],
  ] as const)('maps %s item level %i to required level %i', (rarity, itemLevel, requiredLevel) => {
    expect(proceduralRequiredLevel(itemLevel, rarity)).toBe(requiredLevel);
  });

  it('clamps procedural requirements to the playable level range', () => {
    expect(proceduralRequiredLevel(1, 'legendary')).toBe(1);
    expect(proceduralRequiredLevel(40, 'common')).toBe(20);
  });

  it('uses the exact instance requirement instead of the common base definition', () => {
    const definition = PROCEDURAL_BASE_ITEMS.gravecaller_ring;
    const payload = instance('gravecaller_ring', 21, 'rare');
    expect(requiredLevelForItemInstance(definition)).toBe(1);
    expect(requiredLevelForItemInstance(definition, payload)).toBe(18);
    expect(meetsItemInstanceLevelRequirement(17, definition, payload)).toBe(false);
    expect(meetsItemInstanceLevelRequirement(18, definition, payload)).toBe(true);
  });

  it('fails closed on a base mismatch', () => {
    expect(() =>
      requiredLevelForItemInstance(
        PROCEDURAL_BASE_ITEMS.gravecaller_ring,
        instance('iron_broadsword', 20, 'rare'),
      ),
    ).toThrow(/does not match item definition/);
  });
});
