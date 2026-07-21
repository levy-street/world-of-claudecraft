import { describe, expect, it } from 'vitest';
import { CLASSES } from '../src/sim/content/classes';
import { emptyAllocation } from '../src/sim/content/talents';
import {
  actionForAttackSlot,
  applyLoadoutBar,
  assignAttackSlotAction,
  attackSlotStorageKey,
  buildDefaultFormBar,
  classHasFormBars,
  clearHotbarSlot,
  encodeStoredHotbarAction,
  handleMobileAttackTap,
  hotbarActionsEqual,
  loadAttackSlotAction,
  loadoutKnownAbilityIds,
  parseHotbarActions,
  parseStoredHotbarAction,
  placeAbilityOnSlot,
  placeItemOnSlot,
  resolveMobileHotbarDrop,
  saveAttackSlotAction,
  shouldSeedFormBar,
  syncHotbarActions,
} from '../src/ui/hud/action_bar/hotbar';

const abilityIds = new Set([
  'fireball',
  'frost_armor',
  'arcane_intellect',
  'polymorph',
  'shared_id',
]);
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
      [
        { type: 'ability', id: 'shared_id' },
        { type: 'item', id: 'shared_id' },
      ],
      2,
      abilityExists,
      itemExists,
    );

    expect(actions).toEqual([
      { type: 'ability', id: 'shared_id' },
      { type: 'item', id: 'shared_id' },
    ]);
  });

  it('parses only valid persisted abilities and items that still exist', () => {
    expect(
      parseStoredHotbarAction(
        JSON.stringify({ type: 'ability', id: 'fireball' }),
        abilityExists,
        itemExists,
      ),
    ).toEqual({ type: 'ability', id: 'fireball' });
    expect(
      parseStoredHotbarAction(
        JSON.stringify({ type: 'item', id: 'baked_bread' }),
        abilityExists,
        itemExists,
      ),
    ).toEqual({ type: 'item', id: 'baked_bread' });
    expect(
      parseStoredHotbarAction(
        JSON.stringify({ type: 'ability', id: 'unknown' }),
        abilityExists,
        itemExists,
      ),
    ).toBeNull();
    expect(
      parseStoredHotbarAction(JSON.stringify({ type: 'item', id: 42 }), abilityExists, itemExists),
    ).toBeNull();
    expect(parseStoredHotbarAction('{broken', abilityExists, itemExists)).toBeNull();
    expect(parseStoredHotbarAction(null, abilityExists, itemExists)).toBeNull();
  });

  it('encodes persisted actions and represents an empty slot without JSON null', () => {
    expect(encodeStoredHotbarAction({ type: 'ability', id: 'fireball' })).toBe(
      JSON.stringify({ type: 'ability', id: 'fireball' }),
    );
    expect(encodeStoredHotbarAction(null)).toBeNull();
  });
});

describe('mobile attack tap', () => {
  it.each([
    { autoAttack: true, hasLiveHostileTarget: false },
    { autoAttack: false, hasLiveHostileTarget: true },
  ])('toggles auto-attack for an active combat state', (state) => {
    const calls: string[] = [];

    handleMobileAttackTap(state, {
      activateAttack: () => calls.push('toggle'),
      attackNearest: () => calls.push('nearest'),
    });

    expect(calls).toEqual(['toggle']);
  });

  it('acquires the nearest target when idle and a resolver is available', () => {
    const calls: string[] = [];

    handleMobileAttackTap(
      { autoAttack: false, hasLiveHostileTarget: false },
      {
        activateAttack: () => calls.push('toggle'),
        attackNearest: () => calls.push('nearest'),
      },
    );

    expect(calls).toEqual(['nearest']);
  });

  it('falls back to the auto-attack toggle when no nearest resolver is wired', () => {
    const calls: string[] = [];

    handleMobileAttackTap(
      { autoAttack: false, hasLiveHostileTarget: false },
      { activateAttack: () => calls.push('toggle'), attackNearest: null },
    );

    expect(calls).toEqual(['toggle']);
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
    const slotMap = [
      { type: 'ability' as const, id: 'fireball' },
      { type: 'ability' as const, id: 'frostbolt' },
      null,
    ];

    expect(clearHotbarSlot(slotMap, 1)).toEqual([{ type: 'ability', id: 'fireball' }, null, null]);
  });

  it('leaves an empty slot stable', () => {
    const slotMap = [
      { type: 'ability' as const, id: 'fireball' },
      null,
      { type: 'ability' as const, id: 'blink' },
    ];

    expect(clearHotbarSlot(slotMap, 1)).toEqual([
      { type: 'ability', id: 'fireball' },
      null,
      { type: 'ability', id: 'blink' },
    ]);
  });

  it('does not mutate the input array', () => {
    const slotMap = [
      { type: 'ability' as const, id: 'fireball' },
      { type: 'ability' as const, id: 'frostbolt' },
      null,
    ];

    clearHotbarSlot(slotMap, 1);

    expect(slotMap).toEqual([
      { type: 'ability', id: 'fireball' },
      { type: 'ability', id: 'frostbolt' },
      null,
    ]);
  });

  it('ignores out-of-range slots', () => {
    const slotMap = [
      { type: 'ability' as const, id: 'fireball' },
      { type: 'ability' as const, id: 'frostbolt' },
      null,
    ];

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
    const a = [
      { type: 'ability' as const, id: 'maul' },
      null,
      { type: 'item' as const, id: 'baked_bread' },
    ];
    const b = [
      { type: 'ability' as const, id: 'maul' },
      null,
      { type: 'item' as const, id: 'baked_bread' },
    ];

    expect(hotbarActionsEqual(a, b)).toBe(true);
  });

  it('distinguishes differing ids, types, null gaps, and lengths', () => {
    const base = [{ type: 'ability' as const, id: 'maul' }, null];

    expect(hotbarActionsEqual(base, [{ type: 'ability' as const, id: 'growl' }, null])).toBe(false);
    expect(hotbarActionsEqual(base, [{ type: 'item' as const, id: 'maul' }, null])).toBe(false);
    expect(
      hotbarActionsEqual(base, [
        { type: 'ability' as const, id: 'maul' },
        { type: 'ability' as const, id: 'growl' },
      ]),
    ).toBe(false);
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
    for (const id of [
      'warrior',
      'mage',
      'rogue',
      'priest',
      'hunter',
      'paladin',
      'shaman',
      'warlock',
    ]) {
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
    const slots = [
      { type: 'ability' as const, id: 'fireball' },
      null,
      { type: 'ability' as const, id: 'blink' },
    ];

    expect(syncHotbarActions(slots, ['fireball', 'frostbolt', 'blink'], new Set()).actions).toEqual(
      slots,
    );
  });

  it('places a newly learned ability into the first empty slot', () => {
    const slots = [
      { type: 'ability' as const, id: 'fireball' },
      null,
      { type: 'ability' as const, id: 'blink' },
    ];

    expect(
      syncHotbarActions(slots, ['fireball', 'frostbolt', 'blink'], new Set(['frostbolt'])).actions,
    ).toEqual([
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

  it('sweeps a passive left on the bar by an older build, and never re-places it', () => {
    const slots = [
      { type: 'ability' as const, id: 'fireball' },
      { type: 'ability' as const, id: 'measured_fury' }, // passive saved by an older build
      { type: 'ability' as const, id: 'blink' },
    ];
    const known = ['fireball', 'measured_fury', 'blink'];
    const isPassive = (id: string) => id === 'measured_fury';

    // measured_fury is known but passive: its slot is cleared, and it is NOT
    // re-added even if the auto-place set (defensively) contains it.
    const synced = syncHotbarActions(slots, known, new Set(['measured_fury']), isPassive);
    expect(synced.actions).toEqual([
      { type: 'ability', id: 'fireball' },
      null,
      { type: 'ability', id: 'blink' },
    ]);
    expect(synced.changed).toBe(true);
  });
});

describe('applying a saved talent loadout bar', () => {
  // A SavedLoadout.bar is ability ids only (saveTalentLoadout's currentBar mapping
  // in hud.ts drops item shortcuts before persisting), so switching to a saved
  // loadout must not silently clear a potion/food/drink slot the loadout never
  // captured in the first place. Regression for #1889.
  it('keeps an existing item shortcut in a slot the loadout leaves blank', () => {
    const current = [
      { type: 'item' as const, id: 'baked_bread' },
      { type: 'ability' as const, id: 'frost_armor' },
      { type: 'item' as const, id: 'spring_water' },
      null,
    ];

    expect(applyLoadoutBar(current, ['fireball', null, null, null], 4, abilityExists)).toEqual([
      { type: 'ability', id: 'fireball' },
      null,
      { type: 'item', id: 'spring_water' },
      null,
    ]);
  });

  it('lets a loadout ability slot replace whatever was there before', () => {
    const current = [
      { type: 'item' as const, id: 'baked_bread' },
      { type: 'ability' as const, id: 'frost_armor' },
    ];

    expect(applyLoadoutBar(current, ['polymorph', 'fireball'], 2, abilityExists)).toEqual([
      { type: 'ability', id: 'polymorph' },
      { type: 'ability', id: 'fireball' },
    ]);
  });

  it('drops an unknown/stale ability id from the loadout without reviving an item there', () => {
    const current = [{ type: 'ability' as const, id: 'fireball' }];

    expect(applyLoadoutBar(current, ['no_such_ability'], 1, abilityExists)).toEqual([null]);
  });

  it('restores an ability in the last slot of the third row', () => {
    const current = Array(33).fill(null);
    const saved = Array<string | null>(33).fill(null);
    saved[32] = 'polymorph';

    expect(applyLoadoutBar(current, saved, 33, abilityExists)[32]).toEqual({
      type: 'ability',
      id: 'polymorph',
    });
  });

  it('preserves third-row actions missing from a legacy two-row loadout', () => {
    const current = Array<ReturnType<typeof applyLoadoutBar>[number]>(33).fill(null);
    current[32] = { type: 'ability', id: 'polymorph' };
    const legacyBar = Array<string | null>(22).fill(null);

    expect(applyLoadoutBar(current, legacyBar, 33, abilityExists)[32]).toEqual({
      type: 'ability',
      id: 'polymorph',
    });
  });
});

describe('loadoutKnownAbilityIds', () => {
  // Regression: switching talent loadouts scrambled the action bar (shaman bug
  // report). applyLoadoutBar's "does this ability id exist" check must resolve
  // against what the TARGET build actually grants, not the global ability
  // table: two shaman specs grant disjoint signature abilities (stormstrike for
  // Enhancement, chain_heal for Restoration), and stormstrike/chain_heal both
  // exist in ABILITIES regardless of which spec is active.
  it('only includes abilities the loadout own allocation actually grants', () => {
    const enhancement = { ...emptyAllocation(), spec: 'enhancement' };
    const restoration = { ...emptyAllocation(), spec: 'restoration' };

    const enhancementKnown = loadoutKnownAbilityIds('shaman', enhancement, 20);
    const restorationKnown = loadoutKnownAbilityIds('shaman', restoration, 20);

    expect(enhancementKnown.has('stormstrike')).toBe(true);
    expect(enhancementKnown.has('chain_heal')).toBe(false);
    expect(restorationKnown.has('chain_heal')).toBe(true);
    expect(restorationKnown.has('stormstrike')).toBe(false);
  });

  it('still includes base class-kit abilities regardless of spec', () => {
    const known = loadoutKnownAbilityIds('shaman', { ...emptyAllocation(), spec: 'elemental' }, 20);
    expect(known.has('lightning_bolt')).toBe(true);
  });

  it('excludes passive traits from saved loadout action-bar eligibility', () => {
    const armsKnown = loadoutKnownAbilityIds('warrior', { ...emptyAllocation(), spec: 'arms' }, 20);

    expect(armsKnown.has('measured_fury')).toBe(false);
    expect(armsKnown.has('seasoned_soldier')).toBe(false);
    expect(armsKnown.has('sudden_death')).toBe(false);
    expect(armsKnown.has('deep_wounds')).toBe(false);
    expect(armsKnown.has('battle_shout')).toBe(true);
  });

  // Pins the actual applyLoadoutBar call site wiring, not just the predicate in
  // isolation: reverting the predicate to `(id) => !!ABILITIES[id]` would let
  // stormstrike survive a switch to a Restoration loadout without failing this.
  it("rejects a foreign-spec ability when used as applyLoadoutBar's predicate", () => {
    const restoration = { ...emptyAllocation(), spec: 'restoration' };
    const restorationKnown = loadoutKnownAbilityIds('shaman', restoration, 20);

    const current = [{ type: 'ability' as const, id: 'stormstrike' }];

    expect(applyLoadoutBar(current, ['stormstrike'], 1, (id) => restorationKnown.has(id))).toEqual([
      null,
    ]);
  });
});

describe('mobile touch drag drop resolution', () => {
  it('resolves the target slot when it differs from the source', () => {
    expect(resolveMobileHotbarDrop(2, 5)).toBe(5);
  });

  it('cancels when the pointer released outside any slot', () => {
    expect(resolveMobileHotbarDrop(2, null)).toBeNull();
  });

  it('cancels when the pointer released back on the source slot', () => {
    expect(resolveMobileHotbarDrop(2, 2)).toBeNull();
  });
});

describe('desktop attack slot behavior', () => {
  const storage = () => {
    const values = new Map<string, string>();
    return {
      values,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };
  };

  it('uses a separate, stable storage key and round-trips valid actions', () => {
    const store = storage();
    const key = attackSlotStorageKey('woc_hotbar_warrior_Thorgar');
    expect(key).toBe('woc_hotbar_warrior_Thorgar:s0');

    saveAttackSlotAction(store, key, { type: 'ability', id: 'fireball' });
    expect(loadAttackSlotAction(store, key, abilityExists, itemExists)).toEqual({
      type: 'ability',
      id: 'fireball',
    });
    saveAttackSlotAction(store, key, null);
    expect(store.getItem(key)).toBeNull();
  });

  it('rejects malformed and stale persisted actions', () => {
    const store = storage();
    const key = attackSlotStorageKey('bar');
    store.setItem(key, '{"type":"ability","id":"gone"}');
    expect(loadAttackSlotAction(store, key, abilityExists, itemExists)).toBeNull();
    store.setItem(key, '{bad');
    expect(loadAttackSlotAction(store, key, abilityExists, itemExists)).toBeNull();
  });

  it('keeps slot 0 empty while Attack is shown and casts its assignment when removed', () => {
    const action = { type: 'ability' as const, id: 'fireball' };
    expect(actionForAttackSlot(true, action)).toBeNull();
    expect(actionForAttackSlot(false, action)).toEqual(action);
  });

  it('assigns a dropped action and clears the source bar slot when applicable', () => {
    const action = { type: 'ability' as const, id: 'fireball' };
    expect(assignAttackSlotAction(action, 3)).toEqual({ action, clearSourceIndex: 3 });
    expect(assignAttackSlotAction(action, null)).toEqual({ action, clearSourceIndex: null });
  });
});
