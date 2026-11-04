// Which bag copies a saved gear set names (bag_gear_sets_core.ts). The rule is
// the swap's own (loadout_gear.ts planGearSwap: id AND itemCopyPin), so the copy
// the Favorites tab lists under "Tank set" is the copy a swap would equip.
import { describe, expect, it } from 'vitest';
import type { SavedLoadout } from '../src/sim/content/talents';
import { ITEMS } from '../src/sim/data';
import { buildGearSet, planGearSwap } from '../src/sim/loadout_gear';
import { repairTalentLoadouts } from '../src/sim/talent_loadouts';
import type { InvSlot } from '../src/sim/types';
import { applyBagFilter, DEFAULT_BAG_FILTER, matchesBagSlot } from '../src/ui/bag_filter';
import { buildBagGearSetIndex } from '../src/ui/bag_gear_sets_core';

const loadout = (name: string, gear?: SavedLoadout['gear']): SavedLoadout => ({
  name,
  alloc: {} as SavedLoadout['alloc'],
  bar: [],
  ...(gear ? { gear } : {}),
});

describe('buildBagGearSetIndex', () => {
  it('skips loadouts that captured no gear and keeps loadout order', () => {
    const index = buildBagGearSetIndex([
      loadout('Talents only'),
      loadout('Tank set', buildGearSet({ mainhand: 'worn_sword' }, undefined)),
      loadout('Empty gear', {}),
    ]);
    expect(index.sets).toEqual([{ loadoutIndex: 1, name: 'Tank set' }]);
  });

  it('matches by copy, not by id: a signed copy and a plain duplicate stay apart', () => {
    const signed = { signer: 'Aurelia' };
    const index = buildBagGearSetIndex([
      loadout('PvP set', buildGearSet({ mainhand: 'worn_sword' }, { mainhand: signed })),
    ]);
    const plain: InvSlot = { itemId: 'worn_sword', count: 1 };
    const named: InvSlot = { itemId: 'worn_sword', count: 1, instance: signed };
    expect(index.setsFor(plain)).toEqual([]);
    expect(index.setsFor(named)).toEqual([0]);
    // The same verdict the swap planner reaches over the same bags.
    const gear = buildGearSet({ mainhand: 'worn_sword' }, { mainhand: signed });
    const plan = planGearSwap(gear, [plain, named], {}, undefined);
    expect(plan.equips).toEqual([{ slot: 'mainhand', itemId: 'worn_sword', bagIndex: 1 }]);
  });

  it('a set naming one copy in two slots lists it once', () => {
    const index = buildBagGearSetIndex([
      loadout(
        'Rings',
        buildGearSet({ ring1: 'hammered_copper_band', ring2: 'hammered_copper_band' }, undefined),
      ),
    ]);
    expect(index.setsFor({ itemId: 'hammered_copper_band', count: 1 })).toEqual([0]);
  });
});

describe('online mirror shapes', () => {
  it('a loadout repaired off the wire and a JSON-mirrored bag slot still match', () => {
    const signed = { signer: 'Aurelia' };
    const saved = loadout(
      'PvP set',
      buildGearSet({ mainhand: 'worn_sword' }, { mainhand: signed }),
    );
    // ClientWorld.loadouts arrives as JSON and passes the repair (ability_presentation.ts).
    const wire = repairTalentLoadouts('warrior', 60, JSON.parse(JSON.stringify([saved])), 0);
    expect(wire.loadouts[0]?.gear).toEqual(saved.gear);
    const index = buildBagGearSetIndex(wire.loadouts);
    // The bag slot is a mirrored snapshot, so a fresh object with a parsed payload.
    const mirrored = JSON.parse(
      JSON.stringify({ itemId: 'worn_sword', count: 1, slot: 7, instance: signed }),
    ) as InvSlot;
    expect(index.setsFor(mirrored)).toEqual([0]);
  });
});

describe('Favorites includes gear-set copies', () => {
  it('an unlocked set piece is a favourite in the bags; an unrelated copy is not', () => {
    const gearSets = buildBagGearSetIndex([
      loadout('Tank set', buildGearSet({ chest: 'recruit_tunic' }, undefined)),
    ]);
    const tunic: InvSlot = { itemId: 'recruit_tunic', count: 1 };
    const sword: InvSlot = { itemId: 'worn_sword', count: 1 };
    expect(matchesBagSlot(ITEMS.recruit_tunic, 'favourite', tunic, { gearSets })).toBe(true);
    expect(matchesBagSlot(ITEMS.recruit_tunic, 'favourite', tunic)).toBe(false);
    expect(matchesBagSlot(ITEMS.worn_sword, 'favourite', sword, { gearSets })).toBe(false);
    // The arm is Favorites-only: a set piece is not suddenly junk or a weapon.
    expect(matchesBagSlot(ITEMS.recruit_tunic, 'junk', tunic, { gearSets })).toBe(false);
    const shown = applyBagFilter(
      [sword, tunic],
      (id) => ITEMS[id],
      { ...DEFAULT_BAG_FILTER, category: 'favourite' },
      { gearSets },
    );
    expect(shown).toEqual([tunic]);
  });
});
