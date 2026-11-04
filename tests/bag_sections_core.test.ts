// Bag captions (the inventory UX phase 2 and 3): the pure row builder behind
// the slot sub-headings on Weapons and Armor, the gear-set sub-headings on
// Favorites, and the All view's Sections mode. Real catalog ids throughout, so
// the slot and hand facts come from the shipped content, not a fixture.
import { describe, expect, it } from 'vitest';
import type { SavedLoadout } from '../src/sim/content/talents';
import { ITEMS } from '../src/sim/data';
import { buildGearSet } from '../src/sim/loadout_gear';
import type { InvSlot } from '../src/sim/types';
import { type BagFilterState, DEFAULT_BAG_FILTER } from '../src/ui/bag_filter';
import { buildBagGearSetIndex, EMPTY_BAG_GEAR_SET_INDEX } from '../src/ui/bag_gear_sets_core';
import {
  type BagSectionRow,
  bagSectionCategory,
  bagSectionClass,
  bagSectionLabel,
  bagSectionsReplaceCells,
  bagSlotGroup,
  buildBagSectionRows,
  parseBagSectionsPref,
} from '../src/ui/bag_sections_core';

const lookup = (id: string) => ITEMS[id];
const filter = (patch: Partial<BagFilterState>): BagFilterState => ({
  ...DEFAULT_BAG_FILTER,
  ...patch,
});
const off = { sectionsOn: false, gearSets: EMPTY_BAG_GEAR_SET_INDEX };

// A compact readout of a row list: captions as [level:key], stacks as their id.
function readout(rows: BagSectionRow[]): string[] {
  return rows.map((row) => {
    if (row.kind === 'stack') return row.slot.itemId;
    const k = row.key;
    const name =
      k.kind === 'category'
        ? k.category
        : k.kind === 'slot'
          ? k.group
          : k.kind === 'gearSet'
            ? `set${k.setIndex}`
            : 'locked';
    return `[${row.level}:${name}]`;
  });
}

describe('bagSlotGroup', () => {
  it('splits weapons by hand and armor by the slot it declares', () => {
    expect(ITEMS.eastbrook_greatsword.kind).toBe('weapon');
    expect(bagSlotGroup(ITEMS.eastbrook_greatsword)).toBe('twohand');
    // No hand field means a one-hander (equipment_rules.ts weaponHand).
    expect(ITEMS.worn_sword.kind === 'weapon' && ITEMS.worn_sword.hand).toBeFalsy();
    expect(bagSlotGroup(ITEMS.worn_sword)).toBe('onehand');
    expect(bagSlotGroup(ITEMS.homespun_hood)).toBe('helmet');
    expect(bagSlotGroup(ITEMS.recruit_tunic)).toBe('chest');
    expect(bagSlotGroup(ITEMS.valefire_lantern)).toBe('offhand');
    expect(bagSlotGroup(ITEMS.hammered_copper_band)).toBe('ring');
    expect(bagSlotGroup(ITEMS.baked_bread)).toBeNull();
  });
});

describe('Weapons and Armor slot sub-headings', () => {
  it('Weapons groups by hand in display order and keeps each group in list order', () => {
    const visible: InvSlot[] = [
      { itemId: 'eastbrook_greatsword', count: 1 },
      { itemId: 'worn_sword', count: 1 },
      { itemId: 'highwatch_greatsword', count: 1 },
      { itemId: 'rusty_dagger', count: 1 },
    ];
    const rows = buildBagSectionRows(visible, lookup, filter({ category: 'weapon' }), off);
    expect(readout(rows)).toEqual([
      '[1:onehand]',
      'worn_sword',
      'rusty_dagger',
      '[1:twohand]',
      'eastbrook_greatsword',
      'highwatch_greatsword',
    ]);
  });

  it('Armor follows the paperdoll order the Sort button stamps (off hand first)', () => {
    const visible: InvSlot[] = [
      { itemId: 'recruit_tunic', count: 1 },
      { itemId: 'homespun_hood', count: 1 },
      { itemId: 'valefire_lantern', count: 1 },
    ];
    const rows = buildBagSectionRows(visible, lookup, filter({ category: 'armor' }), off);
    expect(readout(rows)).toEqual([
      '[1:offhand]',
      'valefire_lantern',
      '[1:helmet]',
      'homespun_hood',
      '[1:chest]',
      'recruit_tunic',
    ]);
  });
});

describe('All view: Sections off keeps the old rows, Sections on groups', () => {
  const mixed = (): InvSlot[] => [
    { itemId: 'baked_bread', count: 2 },
    { itemId: 'soggy_boot', count: 3 },
    { itemId: 'eastbrook_greatsword', count: 1 },
    { itemId: 'recruit_tunic', count: 1 },
    { itemId: 'worn_sword', count: 1 },
    { itemId: 'zz_unknown_future_item', count: 1 },
  ];

  it('Sections off: only the cells view, never captions on a plain list', () => {
    expect(bagSectionsReplaceCells(filter({}), false)).toBe(false);
    const rows = buildBagSectionRows(mixed(), lookup, filter({ sort: 'name' }), off);
    expect(rows.every((r) => r.kind === 'stack')).toBe(true);
  });

  it('Sections on: category captions, slot captions nested, junk last, unknown in Other', () => {
    expect(bagSectionsReplaceCells(filter({}), true)).toBe(true);
    expect(bagSectionsReplaceCells(filter({ category: 'weapon' }), true)).toBe(false);
    const rows = buildBagSectionRows(mixed(), lookup, filter({}), {
      sectionsOn: true,
      gearSets: EMPTY_BAG_GEAR_SET_INDEX,
    });
    expect(readout(rows)).toEqual([
      '[1:weapon]',
      '[2:onehand]',
      'worn_sword',
      '[2:twohand]',
      'eastbrook_greatsword',
      '[1:armor]',
      '[2:chest]',
      'recruit_tunic',
      '[1:consumable]',
      'baked_bread',
      '[1:other]',
      'zz_unknown_future_item',
      '[1:junk]',
      'soggy_boot',
    ]);
    // Every stack shows exactly once: captions never drop or duplicate one here.
    const stacks = rows.filter((r) => r.kind === 'stack').map((r) => r.slot.itemId);
    expect(stacks.sort()).toEqual(
      mixed()
        .map((s) => s.itemId)
        .sort(),
    );
  });

  it('a grey weapon is junk in Sections, but still a weapon on the Weapons tab', () => {
    // The catalog ships no grey weapon today, so a poor copy of a real sword stands in.
    const grey = { ...ITEMS.worn_sword, id: 'test_grey_sword', quality: 'poor' as const };
    const greyLookup = (id: string) => (id === grey.id ? grey : ITEMS[id]);
    const slot: InvSlot = { itemId: grey.id, count: 1 };
    expect(bagSectionCategory(grey, slot)).toBe('junk');
    const weaponRows = buildBagSectionRows([slot], greyLookup, filter({ category: 'weapon' }), off);
    expect(readout(weaponRows)).toEqual(['[1:onehand]', 'test_grey_sword']);
  });

  it('keeps the soft Quest caption on a derived list, as before', () => {
    const quest = Object.values(ITEMS).find((d) => d.kind === 'quest');
    expect(quest).toBeDefined();
    const rows = buildBagSectionRows(
      [
        { itemId: 'baked_bread', count: 1 },
        { itemId: quest!.id, count: 1 },
      ],
      lookup,
      filter({ sort: 'name' }),
      off,
    );
    expect(readout(rows)[0]).toBe('[1:quest]');
    expect(bagSectionClass({ kind: 'category', category: 'quest' })).toBe('bag-section-quest');
  });
});

describe('Favorites gear-set sub-headings', () => {
  const tank: SavedLoadout = {
    name: 'Tank set',
    alloc: {} as SavedLoadout['alloc'],
    bar: [],
    gear: buildGearSet({ mainhand: 'worn_sword', chest: 'recruit_tunic' }, undefined),
  };
  const pvp: SavedLoadout = {
    name: 'PvP set',
    alloc: {} as SavedLoadout['alloc'],
    bar: [],
    gear: buildGearSet({ mainhand: 'worn_sword' }, undefined),
  };
  const talentsOnly: SavedLoadout = { name: 'Raid', alloc: {} as SavedLoadout['alloc'], bar: [] };

  it('one caption per set that names something held, a copy in two sets under both, then Locked', () => {
    const gearSets = buildBagGearSetIndex([talentsOnly, tank, pvp]);
    expect(gearSets.sets.map((s) => s.name)).toEqual(['Tank set', 'PvP set']);
    const visible: InvSlot[] = [
      { itemId: 'worn_sword', count: 1 },
      { itemId: 'recruit_tunic', count: 1 },
      { itemId: 'baked_bread', count: 1, instance: { locked: true } },
    ];
    const rows = buildBagSectionRows(visible, lookup, filter({ category: 'favourite' }), {
      sectionsOn: false,
      gearSets,
    });
    expect(readout(rows)).toEqual([
      '[1:set0]',
      'worn_sword',
      'recruit_tunic',
      '[1:set1]',
      'worn_sword',
      '[1:locked]',
      'baked_bread',
    ]);
    expect(bagSectionLabel({ kind: 'gearSet', setIndex: 0 }, gearSets)).toEqual({
      text: 'Tank set',
    });
  });

  it('no set names anything held: the plain locked list, with no lone caption', () => {
    const gearSets = buildBagGearSetIndex([tank]);
    const visible: InvSlot[] = [{ itemId: 'baked_bread', count: 1, instance: { locked: true } }];
    const rows = buildBagSectionRows(visible, lookup, filter({ category: 'favourite' }), {
      sectionsOn: false,
      gearSets,
    });
    expect(readout(rows)).toEqual(['baked_bread']);
  });

  it('a blank loadout name falls back to a numbered caption', () => {
    const gearSets = buildBagGearSetIndex([{ ...tank, name: '   ' }]);
    expect(bagSectionLabel({ kind: 'gearSet', setIndex: 0 }, gearSets)).toEqual({
      key: 'hudChrome.bags.sectionGearSetFallback',
      values: { n: 1 },
    });
  });
});

describe('labels and the persisted toggle', () => {
  it('maps captions to catalog keys', () => {
    const none = EMPTY_BAG_GEAR_SET_INDEX;
    expect(bagSectionLabel({ kind: 'slot', group: 'onehand' }, none)).toEqual({
      key: 'hudChrome.bags.sectionOneHand',
    });
    expect(bagSectionLabel({ kind: 'slot', group: 'twohand' }, none)).toEqual({
      key: 'itemUi.slots.twoHand',
    });
    expect(bagSectionLabel({ kind: 'category', category: 'other' }, none)).toEqual({
      key: 'hudChrome.bags.sectionOther',
    });
    expect(bagSectionLabel({ kind: 'category', category: 'junk' }, none)).toEqual({
      key: 'hudChrome.bags.filterJunk',
    });
    expect(bagSectionLabel({ kind: 'locked' }, none)).toEqual({
      key: 'hudChrome.bags.sectionLocked',
    });
  });

  it('only the exact stored "on" turns Sections on', () => {
    expect(parseBagSectionsPref('on')).toBe(true);
    expect(parseBagSectionsPref('off')).toBe(false);
    expect(parseBagSectionsPref(null)).toBe(false);
    expect(parseBagSectionsPref('true')).toBe(false);
  });
});
