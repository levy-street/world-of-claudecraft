import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import {
  collectionFitsRole,
  collectionRoleForSpec,
  selectLegalGear,
} from '../src/sim/dev/gear_selection';
import type { ArmorItemDef, ItemDef, WeaponItemDef } from '../src/sim/types';

function armor(id: string, slot: 'chest' | 'waist' | 'feet', masterwrought = false): ArmorItemDef {
  return {
    id,
    name: id,
    kind: 'armor',
    armorType: 'cloth',
    sellValue: 0,
    slot,
    quality: 'epic',
    stats: {},
    masterwrought,
  };
}

function weapon(id: string, hand: 'onehand' | 'twohand'): WeaponItemDef {
  return {
    id,
    name: id,
    kind: 'weapon',
    sellValue: 0,
    slot: 'mainhand',
    hand,
    weapon: { min: 10, max: 20, speed: 2 },
  };
}

const SHIELD: ArmorItemDef = {
  id: 'shield',
  name: 'Shield',
  sellValue: 0,
  kind: 'armor',
  armorType: 'mail',
  slot: 'offhand',
  shield: true,
  requiredClass: ['warrior'],
  stats: {},
};

describe('ordered reference gear selection', () => {
  it('keeps slot and tie order, skips a third crafted piece, and fills its slot', () => {
    const chest = armor('crafted_chest', 'chest', true);
    const waist = armor('crafted_waist', 'waist', true);
    const feet = armor('crafted_feet', 'feet', true);
    const fallback = armor('plain_feet', 'feet');
    const other = armor('other_plain_feet', 'feet');
    const items = Object.fromEntries([chest, waist, feet, fallback, other].map((i) => [i.id, i]));
    const rows = [
      ['chest', [chest]],
      ['waist', [waist]],
      ['feet', [feet, fallback, other]],
    ] as const;
    const before = JSON.stringify(rows);
    const select = () => selectLegalGear('warrior', 'prot', rows, (id) => items[id]);
    expect(select()).toEqual({ chest: chest.id, waist: waist.id, feet: fallback.id });
    expect(select()).toEqual(select());
    expect(JSON.stringify(rows)).toBe(before);
  });

  it('preserves non-crafted choices and does not duplicate a ring', () => {
    const chest = armor('plain_chest', 'chest');
    const first: ItemDef = {
      id: 'first_ring',
      name: 'First ring',
      sellValue: 0,
      kind: 'armor',
      slot: 'ring',
      quality: 'epic',
    };
    const second = { ...first, id: 'second_ring' };
    const items = { [chest.id]: chest, [first.id]: first, [second.id]: second };
    expect(
      selectLegalGear(
        'mage',
        'fire',
        [
          ['chest', [chest]],
          ['ring1', [first, second]],
          ['ring2', [first, second]],
        ],
        (id) => items[id],
      ),
    ).toEqual({ chest: chest.id, ring1: first.id, ring2: second.id });
  });

  it('holds the legendary crafted sub-cap and leaves only truly uncoverable slots empty', () => {
    const chest = { ...armor('legendary_chest', 'chest', true), quality: 'legendary' as const };
    const waist = { ...armor('legendary_waist', 'waist', true), quality: 'legendary' as const };
    const fallback = armor('plain_waist', 'waist');
    const items = { [chest.id]: chest, [waist.id]: waist, [fallback.id]: fallback };
    expect(
      selectLegalGear(
        'mage',
        'fire',
        [
          ['chest', [chest]],
          ['waist', [waist, fallback]],
          ['feet', []],
        ],
        (id) => items[id],
      ),
    ).toEqual({ chest: chest.id, waist: fallback.id });
  });

  it('falls back past class-illegal armor and spec-illegal offhand weapons', () => {
    const mail = { ...armor('mail', 'chest'), armorType: 'mail' as const };
    const cloth = armor('cloth', 'chest');
    const sword = weapon('sword', 'onehand');
    const items = { [mail.id]: mail, [cloth.id]: cloth, [sword.id]: sword, [SHIELD.id]: SHIELD };
    expect(selectLegalGear('mage', 'fire', [['chest', [mail, cloth]]], (id) => items[id])).toEqual({
      chest: cloth.id,
    });
    expect(
      selectLegalGear('warrior', 'arms', [['offhand', [sword, SHIELD]]], (id) => items[id]),
    ).toEqual({ offhand: SHIELD.id });
    expect(
      selectLegalGear('warrior', 'fury', [['offhand', [sword, SHIELD]]], (id) => items[id]),
    ).toEqual({ offhand: sword.id });
  });

  it('never displaces a chosen hand and refills with a compatible weapon', () => {
    const twohand = weapon('twohand', 'twohand');
    const onehand = weapon('onehand', 'onehand');
    const items = { [twohand.id]: twohand, [onehand.id]: onehand, [SHIELD.id]: SHIELD };
    expect(
      selectLegalGear(
        'warrior',
        'arms',
        [
          ['mainhand', [twohand, onehand]],
          ['offhand', [SHIELD]],
        ],
        (id) => items[id],
      ),
    ).toEqual({ mainhand: twohand.id });
    expect(
      selectLegalGear(
        'warrior',
        'arms',
        [
          ['offhand', [SHIELD]],
          ['mainhand', [twohand, onehand]],
        ],
        (id) => items[id],
      ),
    ).toEqual({ offhand: SHIELD.id, mainhand: onehand.id });
  });

  it('skips a second legendary in the same unique family, not just duplicate ids', () => {
    const first: ItemDef = {
      id: 'relic',
      name: 'Relic',
      sellValue: 0,
      kind: 'armor',
      slot: 'ring',
      quality: 'legendary',
    };
    const heroic = { ...first, id: 'heroic_relic', heroicOf: first.id };
    const fallback = { ...first, id: 'plain_ring', quality: 'epic' as const };
    const items = { [first.id]: first, [heroic.id]: heroic, [fallback.id]: fallback };
    expect(
      selectLegalGear(
        'mage',
        'fire',
        [
          ['ring1', [first]],
          ['ring2', [heroic, fallback]],
        ],
        (id) => items[id],
      ),
    ).toEqual({ ring1: first.id, ring2: fallback.id });
  });
});

describe('authored collection role admission', () => {
  it.each([
    ['warrior', 'arms', 'physical'],
    ['warrior', 'prot', 'tank'],
    ['paladin', 'holy', 'healer'],
    ['shaman', 'elemental', 'caster'],
    ['hunter', 'marksmanship', 'physical'],
    ['rogue', 'combat', 'physical'],
    ['druid', 'feral', 'tank'],
    ['druid', 'balance', 'caster'],
    ['druid', 'restoration', 'healer'],
    ['priest', 'shadow', 'caster'],
    ['mage', 'arcane', 'healer'],
    ['warlock', 'affliction', 'caster'],
    ['warrior', null, undefined],
    ['warrior', 'unknown', undefined],
  ] as const)('maps %s/%s through the existing role presets', (cls, spec, role) => {
    expect(collectionRoleForSpec(cls, spec)).toBe(role);
  });

  it.each([
    ['crucible_str_mail', 'warrior', 'physical'],
    ['crucible_tank_mail', 'warrior', 'tank'],
    ['crucible_caster_mail', 'shaman', 'caster'],
    ['crucible_healer_mail', 'paladin', 'healer'],
    ['crucible_agi_leather', 'rogue', 'physical'],
    ['crucible_str_leather', 'druid', 'physical'],
    ['crucible_tank_leather', 'druid', 'tank'],
    ['crucible_caster_leather', 'druid', 'caster'],
    ['crucible_healer_leather', 'druid', 'healer'],
    ['crucible_caster_cloth', 'priest', 'caster'],
    ['crucible_healer_cloth', 'mage', 'healer'],
  ] as const)('admits %s only for its authored role', (collection, cls, role) => {
    const item = ITEMS[`${collection}_chest`];
    expect(item).toBeDefined();
    expect(collectionFitsRole(item, cls, role)).toBe(true);
    expect(collectionFitsRole(item, cls, role === 'tank' ? 'caster' : 'tank')).toBe(false);
  });

  it('honors collection class identity without changing legacy candidate admission', () => {
    expect(collectionFitsRole(ITEMS.crucible_caster_mail_chest, 'warrior')).toBe(false);
    expect(collectionFitsRole(ITEMS.crucible_caster_mail_chest, 'shaman')).toBe(true);
    expect(collectionFitsRole(ITEMS.crucible_str_leather_chest, 'rogue', 'physical')).toBe(false);
    expect(collectionFitsRole(ITEMS.crucible_agi_leather_chest, 'druid', 'physical')).toBe(false);
    expect(collectionFitsRole(ITEMS.ashveil_chest, 'druid', 'caster')).toBe(true);
  });
});
