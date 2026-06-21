import { describe, expect, it } from 'vitest';
import { CLASSES } from '../src/sim/content/classes';
import {
  buildDefaultFormBar, classHasFormBars, clearHotbarSlot, hotbarActionsEqual, parseHotbarActions,
  placeAbilityOnSlot, placeItemOnSlot, shouldSeedFormBar, syncHotbarActions,
} from '../src/ui/hotbar';

const abilityIds = new Set(['fireball', 'frost_armor', 'arcane_intellect', 'polymorph', 'shared_id']);
const itemIds = new Set(['baked_bread', 'spring_water', 'shared_id']);
const abilityExists = (id: string) => abilityIds.has(id);
const itemExists = (id: string) => itemIds.has(id);

describe('hotbar action parsing', () => {
  it('migrates legacy ability strings and drops duplicate abilities', () => {
    const actions = parseHotbarActions(
      ['fireball', 'frost_armor', 'fireball', 'baked_bread'],
      5,
      abilityExists,
      itemExists,
    );

    expect(actions).toEqual([
      { type: 'ability', id: 'fireball' },
      { type: 'ability', id: 'frost_armor' },
      null,
      null,
      null,
    ]);
  });

  it('keeps item and ability actions distinct even when ids overlap', () => {
    const actions = parseHotbarActions(
      [{ type: 'ability', id: 'shared_id' }, { type: 'item', id: 'shared_id' }],
      2,
      abilityExists,
      itemExists,
    );

    expect(actions).toEqual([
      { type: 'ability', id: 'shared_id' },
      { type: 'item', id: 'shared_id' },
    ]);
  });
});

describe('hotbar action placement', () => {
  it('places a spellbook ability onto the target action slot', () => {
    const slots = [
      { type: 'ability' as const, id: 'fireball' },
      { type: 'ability' as const, id: 'frost_armor' },
      { type: 'ability' as const, id: 'arcane_intellect' },
      null,
    ];

    const next = placeAbilityOnSlot(slots, 'polymorph', 1);

    expect(next).toEqual([
      { type: 'ability', id: 'fireball' },
      { type: 'ability', id: 'polymorph' },
      { type: 'ability', id: 'arcane_intellect' },
      null,
    ]);
    expect(slots).toEqual([
      { type: 'ability', id: 'fireball' },
      { type: 'ability', id: 'frost_armor' },
      { type: 'ability', id: 'arcane_intellect' },
      null,
    ]);
  });

  it('swaps instead of duplicating when the spellbook ability is already on the bar', () => {
    const slots = [
      { type: 'ability' as const, id: 'fireball' },
      { type: 'ability' as const, id: 'frost_armor' },
      { type: 'ability' as const, id: 'arcane_intellect' },
      null,
    ];

    const next = placeAbilityOnSlot(slots, 'arcane_intellect', 0);

    expect(next).toEqual([
      { type: 'ability', id: 'arcane_intellect' },
      { type: 'ability', id: 'frost_armor' },
      { type: 'ability', id: 'fireball' },
      null,
    ]);
  });

  it('places a food item on an occupied action slot without removing other item shortcuts', () => {
    const slots = [
      { type: 'item' as const, id: 'baked_bread' },
      { type: 'ability' as const, id: 'fireball' },
      null,
    ];

    const next = placeItemOnSlot(slots, 'baked_bread', 1);

    expect(next).toEqual([
      { type: 'item', id: 'baked_bread' },
      { type: 'item', id: 'baked_bread' },
      null,
    ]);
  });

  it('keeps item shortcuts when learned abilities resync', () => {
    const slots = [
      { type: 'item' as const, id: 'spring_water' },
      { type: 'ability' as const, id: 'fireball' },
      null,
    ];

    const synced = syncHotbarActions(slots, ['fireball', 'polymorph'], new Set(['polymorph']));

    expect(synced.actions).toEqual([
      { type: 'item', id: 'spring_water' },
      { type: 'ability', id: 'fireball' },
      { type: 'ability', id: 'polymorph' },
    ]);
    expect(synced.changed).toBe(true);
  });

  it('places the mage overflow spell onto a full non-Attack action bar', () => {
    const barSlots = 11;
    const mageAbilities = CLASSES.mage.abilities;
    const slots = mageAbilities.slice(0, barSlots).map((id) => ({ type: 'ability' as const, id }));
    const targetIndex = 4;
    const displacedAbility = slots[targetIndex];

    expect(slots).toHaveLength(barSlots);
    // ice_barrier is an overflow spell learned beyond the initial bar slots.
    expect(mageAbilities.indexOf('ice_barrier')).toBeGreaterThanOrEqual(barSlots);
    expect(slots.some((action) => action.id === 'ice_barrier')).toBe(false);

    const next = placeAbilityOnSlot(slots, 'ice_barrier', targetIndex);
    const occupied = next.filter((action) => action !== null);

    expect(next[targetIndex]).toEqual({ type: 'ability', id: 'ice_barrier' });
    expect(next).not.toContain(displacedAbility);
    expect(occupied).toHaveLength(barSlots);
    expect(new Set(occupied.map((action) => action!.id)).size).toBe(occupied.length);
    expect(slots).toEqual(mageAbilities.slice(0, barSlots).map((id) => ({ type: 'ability', id })));
  });
});

describe('hotbar slot clearing', () => {
  it('clears an occupied slot', () => {
    const slotMap = [{ type: 'ability' as const, id: 'fireball' }, { type: 'ability' as const, id: 'frostbolt' }, null];

    expect(clearHotbarSlot(slotMap, 1)).toEqual([{ type: 'ability', id: 'fireball' }, null, null]);
  });

  it('leaves an empty slot stable', () => {
    const slotMap = [{ type: 'ability' as const, id: 'fireball' }, null, { type: 'ability' as const, id: 'blink' }];

    expect(clearHotbarSlot(slotMap, 1)).toEqual([
      { type: 'ability', id: 'fireball' },
      null,
      { type: 'ability', id: 'blink' },
    ]);
  });

  it('does not mutate the input array', () => {
    const slotMap = [{ type: 'ability' as const, id: 'fireball' }, { type: 'ability' as const, id: 'frostbolt' }, null];

    clearHotbarSlot(slotMap, 1);

    expect(slotMap).toEqual([{ type: 'ability', id: 'fireball' }, { type: 'ability', id: 'frostbolt' }, null]);
  });

  it('ignores out-of-range slots', () => {
    const slotMap = [{ type: 'ability' as const, id: 'fireball' }, { type: 'ability' as const, id: 'frostbolt' }, null];

    expect(clearHotbarSlot(slotMap, -1)).toEqual(slotMap);
    expect(clearHotbarSlot(slotMap, 3)).toEqual(slotMap);
  });
});

describe('default form bar', () => {
  it('places the form kit in order starting at the first slot and pads with null', () => {
    const bar = buildDefaultFormBar(['bear_form', 'maul', 'growl'], 5);

    expect(bar).toEqual([
      { type: 'ability', id: 'bear_form' },
      { type: 'ability', id: 'maul' },
      { type: 'ability', id: 'growl' },
      null,
      null,
    ]);
  });

  it('drops duplicate ability ids', () => {
    const bar = buildDefaultFormBar(['maul', 'maul', 'growl'], 4);

    expect(bar).toEqual([
      { type: 'ability', id: 'maul' },
      { type: 'ability', id: 'growl' },
      null,
      null,
    ]);
  });

  it('drops overflow past the slot count', () => {
    const bar = buildDefaultFormBar(['a', 'b', 'c', 'd'], 2);

    expect(bar).toEqual([
      { type: 'ability', id: 'a' },
      { type: 'ability', id: 'b' },
    ]);
  });

  it('does not mutate the input list', () => {
    const ids = ['maul', 'growl'];
    buildDefaultFormBar(ids, 4);
    expect(ids).toEqual(['maul', 'growl']);
  });
});

describe('hotbar actions equality', () => {
  it('treats slot-by-slot identical layouts as equal', () => {
    const a = [{ type: 'ability' as const, id: 'maul' }, null, { type: 'item' as const, id: 'baked_bread' }];
    const b = [{ type: 'ability' as const, id: 'maul' }, null, { type: 'item' as const, id: 'baked_bread' }];

    expect(hotbarActionsEqual(a, b)).toBe(true);
  });

  it('distinguishes differing ids, types, null gaps, and lengths', () => {
    const base = [{ type: 'ability' as const, id: 'maul' }, null];

    expect(hotbarActionsEqual(base, [{ type: 'ability' as const, id: 'growl' }, null])).toBe(false);
    expect(hotbarActionsEqual(base, [{ type: 'item' as const, id: 'maul' }, null])).toBe(false);
    expect(hotbarActionsEqual(base, [{ type: 'ability' as const, id: 'maul' }, { type: 'ability' as const, id: 'growl' }])).toBe(false);
    expect(hotbarActionsEqual(base, [{ type: 'ability' as const, id: 'maul' }])).toBe(false);
    expect(hotbarActionsEqual([null, null], [null, null])).toBe(true);
  });
});

describe('classes with per-form action bars', () => {
  it('only the druid has form bars — every other class is single-bar', () => {
    const classIds = Object.keys(CLASSES);
    // sanity: the full roster is present so this stays exhaustive as classes are added
    expect(classIds.length).toBeGreaterThanOrEqual(9);
    expect(classIds).toContain('druid');

    expect(classHasFormBars('druid')).toBe(true);
    for (const id of classIds) {
      expect(classHasFormBars(id)).toBe(id === 'druid');
    }
    // the form-bar-only "Reset bar" button must never leak onto these
    for (const id of ['warrior', 'mage', 'rogue', 'priest', 'hunter', 'paladin', 'shaman', 'warlock']) {
      expect(classHasFormBars(id)).toBe(false);
    }
  });
});

describe('form bar seeding decision', () => {
  const maul = { type: 'ability' as const, id: 'maul' };
  const wrath = { type: 'ability' as const, id: 'wrath' };
  const caster = [wrath, { type: 'ability' as const, id: 'moonfire' }, null];

  it('seeds an empty form bar', () => {
    expect(shouldSeedFormBar([null, null, null], caster, false)).toBe(true);
  });

  it('seeds (migrates) a form bar that is a byte-identical clone of the caster bar', () => {
    expect(shouldSeedFormBar([...caster], caster, false)).toBe(true);
  });

  it('keeps a deliberately customized form bar', () => {
    expect(shouldSeedFormBar([maul, null, null], caster, false)).toBe(false);
  });

  it('never re-seeds once the form bar has been marked', () => {
    expect(shouldSeedFormBar([null, null, null], caster, true)).toBe(false);
    expect(shouldSeedFormBar([...caster], caster, true)).toBe(false);
  });
});

describe('hotbar slot sync', () => {
  it('preserves a missing already-known ability as a cleared slot', () => {
    const slots = [{ type: 'ability' as const, id: 'fireball' }, null, { type: 'ability' as const, id: 'blink' }];

    expect(syncHotbarActions(slots, ['fireball', 'frostbolt', 'blink'], new Set()).actions).toEqual(slots);
  });

  it('places a newly learned ability into the first empty slot', () => {
    const slots = [{ type: 'ability' as const, id: 'fireball' }, null, { type: 'ability' as const, id: 'blink' }];

    expect(syncHotbarActions(slots, ['fireball', 'frostbolt', 'blink'], new Set(['frostbolt'])).actions).toEqual([
      { type: 'ability', id: 'fireball' },
      { type: 'ability', id: 'frostbolt' },
      { type: 'ability', id: 'blink' },
    ]);
  });

  it('drops abilities that are no longer known', () => {
    const slots = [
      { type: 'ability' as const, id: 'fireball' },
      { type: 'ability' as const, id: 'frostbolt' },
      { type: 'ability' as const, id: 'blink' },
    ];

    expect(syncHotbarActions(slots, ['fireball', 'blink'], new Set()).actions).toEqual([
      { type: 'ability', id: 'fireball' },
      null,
      { type: 'ability', id: 'blink' },
    ]);
  });
});
