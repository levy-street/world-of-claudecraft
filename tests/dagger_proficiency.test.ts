// The dagger weapon proficiency (src/sim/equipment_rules.ts DAGGER_WEAPON_CLASSES).
//
// Druids hold it alongside rogues and hunters: they fight with one-handed blades
// out of form, and their feral forms swing whatever is equipped.
//
// The trap this file exists for: `weaponArchetypeForItem` recovers a weapon's
// archetype by matching its `requiredClass` against the group EXACTLY
// (`sameClassSet`). Widening the group without widening every dagger's list, or
// the reverse, does not error: the item silently loses its archetype and falls
// through to a literal class check, so a druid quietly cannot equip it. Both
// halves are therefore pinned here, over the live content tables.
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import {
  canDualWield,
  canEquipItem,
  canEquipItemInSlot,
  DAGGER_WEAPON_CLASSES,
  weaponArchetypeForItem,
} from '../src/sim/equipment_rules';
import { ALL_CLASSES, type ItemDef, type PlayerClass } from '../src/sim/types';

/** Every dagger in the game, by the flag the sim itself gates on. */
function daggers(): [string, ItemDef][] {
  return Object.entries(ITEMS).filter(
    ([, item]) => item.kind === 'weapon' && item.weapon?.dagger === true,
  );
}

describe('the dagger proficiency group', () => {
  it('is rogue, hunter and druid', () => {
    expect([...DAGGER_WEAPON_CLASSES].sort()).toEqual(['druid', 'hunter', 'rogue']);
  });

  it('covers a real, non-trivial set of daggers', () => {
    // Vacuity floor: every assertion below iterates this list, so an empty or
    // collapsed table would make the whole suite silently pass.
    expect(daggers().length).toBeGreaterThan(25);
  });
});

describe('a druid can equip every dagger', () => {
  for (const [id, item] of daggers()) {
    it(`${id}`, () => {
      expect(canEquipItem('druid', item), `${id} must admit a druid`).toBe(true);
    });
  }
});

describe('the group and the content tables cannot drift apart', () => {
  it('every restricted dagger resolves to the dagger archetype', () => {
    // The silent-failure mode: a dagger whose requiredClass no longer matches the
    // group exactly keeps working for rogues (its list still names them) while
    // quietly excluding druids. A null archetype on a restricted dagger is that
    // bug, so it fails here rather than in someone's inventory.
    const orphaned = daggers()
      .filter(([, item]) => item.requiredClass !== undefined)
      .filter(([, item]) => weaponArchetypeForItem(item) === null)
      .map(([id]) => id);
    expect(orphaned).toEqual([]);
  });

  it('every restricted dagger names exactly the group', () => {
    for (const [id, item] of daggers()) {
      if (!item.requiredClass) continue;
      expect([...item.requiredClass].sort(), `${id} must name the whole group`).toEqual(
        [...DAGGER_WEAPON_CLASSES].sort(),
      );
    }
  });

  it('admits exactly the group and no one else', () => {
    // The negative half: widening the group must not have widened it further
    // than intended. Warriors, paladins, shamans and the pure casters have no
    // dagger proficiency and must still be refused.
    const outsiders = ALL_CLASSES.filter(
      (cls) => !DAGGER_WEAPON_CLASSES.includes(cls as PlayerClass),
    );
    expect(outsiders.length).toBeGreaterThan(0);
    for (const [id, item] of daggers()) {
      if (!item.requiredClass) continue; // an unrestricted dagger is open to all
      for (const cls of outsiders) {
        expect(canEquipItem(cls, item), `${id} must refuse ${cls}`).toBe(false);
      }
    }
  });
});

describe('the widening is scoped to daggers', () => {
  it('leaves the warrior and caster weapon groups alone', () => {
    // A druid gains DAGGERS, not one-handed maces, swords, axes or bows. Pinned
    // over the live table so a future weapon cannot quietly ride along.
    const gained = Object.entries(ITEMS).filter(
      ([, item]) =>
        item.kind === 'weapon' &&
        item.weapon?.dagger !== true &&
        item.requiredClass !== undefined &&
        weaponArchetypeForItem(item) === 'rogue',
    );
    expect(gained.map(([id]) => id)).toEqual([]);
  });

  it('does not let a druid dual wield the daggers it can now hold', () => {
    // Dagger proficiency is not a second weapon hand: canDualWield still admits
    // only rogues and fury warriors, so a druid wields one and keeps its offhand
    // for a held offhand. Asserted through the slot resolver, which is the rule
    // the equip path actually applies.
    const entry = daggers().find(([, i]) => i.requiredClass !== undefined);
    expect(entry).toBeDefined();
    if (!entry) return;
    const [id, dagger] = entry;
    expect(canDualWield('druid')).toBe(false);
    expect(canEquipItemInSlot('druid', dagger, 'mainhand'), `${id} in the mainhand`).toBe(true);
    expect(canEquipItemInSlot('druid', dagger, 'offhand'), `${id} in the offhand`).toBe(false);
    // The rogue, which does hold the second hand, still gets both.
    expect(canEquipItemInSlot('rogue', dagger, 'offhand')).toBe(true);
  });
});
