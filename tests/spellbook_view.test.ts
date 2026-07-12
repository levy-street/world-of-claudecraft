// Tests for the spellbook window pure core (spellbook_view.ts):
//  - the class kit maps to rows in display order,
//  - learned vs locked (trainable) rows from the `known` set,
//  - rank passthrough,
//  - on-bar derivation from the action-bar ability ids,
//  - the add-control disabled state (known, off the bar, no free slot),
//  - the empty state (no class kit),
//  - parity: a Sim-shaped and a ClientWorld-mirror-shaped `known`
//    set carrying the same logical data render identical rows, plus determinism.
//
// DOM-free / i18n-free, so this Node suite drives the core directly; the localized
// markup + drag/tooltip wiring is covered by the spellbook_window.ts source guard.

import { describe, expect, it } from 'vitest';
import { CLASSES } from '../src/sim/data';
import type { ResolvedAbility } from '../src/sim/sim';
import type { PlayerClass } from '../src/sim/types';
import type { HotbarAction } from '../src/ui/hotbar';
import {
  buildMobileSpellbookPicker,
  buildSpellbookView,
  isSpellbookBarTokenCurrent,
  mobileSpellbookAssignment,
  nextMobileSpellbookPickerPage,
  type SpellbookInput,
} from '../src/ui/spellbook_view';

// A class whose kit has at least two abilities, so we can exercise known/locked.
const CLASS_ID = Object.values(CLASSES).find((c) => c.abilities.length >= 2)!.id as PlayerClass;
const KIT = CLASSES[CLASS_ID].abilities;

// Minimal ResolvedAbility stub: the core reads only `def.id` and `rank`. shape:
// 'sim' carries extra fields the core must ignore.
function known(shape: 'sim' | 'client', abilityId: string, rank = 1): ResolvedAbility {
  const junk = shape === 'sim' ? { _resolvedSeq: 3, cost: 12, cooldown: 6 } : {};
  return { def: { id: abilityId }, rank, ...junk } as unknown as ResolvedAbility;
}

function input(over: Partial<SpellbookInput> = {}): SpellbookInput {
  return {
    classId: CLASS_ID,
    abilities: KIT,
    known: [],
    barAbilityIds: [],
    hasFreeSlot: true,
    hasFormBars: false,
    ...over,
  };
}

describe('buildSpellbookView: class kit + learned state', () => {
  it('maps the class kit to rows in display order', () => {
    const v = buildSpellbookView(input());
    expect(v.rows.map((r) => r.abilityId)).toEqual([...KIT]);
    expect(v.classId).toBe(CLASS_ID);
    expect(v.empty).toBe(false);
  });

  it('marks a learned ability known with its rank and a locked one null', () => {
    const v = buildSpellbookView(input({ known: [known('sim', KIT[0], 3)] }));
    const learned = v.rows.find((r) => r.abilityId === KIT[0])!;
    const locked = v.rows.find((r) => r.abilityId === KIT[1])!;
    expect(learned.known).not.toBeNull();
    expect(learned.rank).toBe(3);
    expect(locked.known).toBeNull();
    expect(locked.rank).toBe(0);
  });

  it('reports the empty state when the class kit is empty', () => {
    const v = buildSpellbookView(input({ abilities: [] }));
    expect(v.rows).toEqual([]);
    expect(v.empty).toBe(true);
  });

  it('passes the form-bars flag through (drives the reset button)', () => {
    expect(buildSpellbookView(input({ hasFormBars: true })).hasFormBars).toBe(true);
    expect(buildSpellbookView(input({ hasFormBars: false })).hasFormBars).toBe(false);
  });
});

describe('buildSpellbookView: on-bar + toggle-disabled derivation', () => {
  it('flags a learned ability that sits on the action bar as onBar', () => {
    const v = buildSpellbookView(input({ known: [known('sim', KIT[0])], barAbilityIds: [KIT[0]] }));
    expect(v.rows.find((r) => r.abilityId === KIT[0])!.onBar).toBe(true);
  });

  it('does not flag a locked ability as onBar even if its id is on the bar', () => {
    // A defensive case: an id on the bar but not in `known` is not a learned row.
    const v = buildSpellbookView(input({ known: [], barAbilityIds: [KIT[0]] }));
    expect(v.rows.find((r) => r.abilityId === KIT[0])!.onBar).toBe(false);
  });

  it('disables the add control for a learned, off-bar ability when no slot is free', () => {
    const v = buildSpellbookView(
      input({ known: [known('sim', KIT[0])], barAbilityIds: [], hasFreeSlot: false }),
    );
    expect(v.rows.find((r) => r.abilityId === KIT[0])!.toggleDisabled).toBe(true);
  });

  it('enables the add control when a slot is free', () => {
    const v = buildSpellbookView(
      input({ known: [known('sim', KIT[0])], barAbilityIds: [], hasFreeSlot: true }),
    );
    expect(v.rows.find((r) => r.abilityId === KIT[0])!.toggleDisabled).toBe(false);
  });

  it('never disables a removal (on-bar ability stays enabled even with no free slot)', () => {
    const v = buildSpellbookView(
      input({ known: [known('sim', KIT[0])], barAbilityIds: [KIT[0]], hasFreeSlot: false }),
    );
    expect(v.rows.find((r) => r.abilityId === KIT[0])!.toggleDisabled).toBe(false);
  });
});

describe('buildSpellbookView: mobilePage derivation (Phase 4)', () => {
  // abilityIdByBarSlot index 0 = barSlot 1 (hotbarActions' own index = barSlot-1
  // convention). Build a slot array with KIT[0] parked on a given 1-indexed slot.
  const slotsWith = (abilityId: string, barSlot: number): (string | null)[] => {
    const slots: (string | null)[] = new Array(22).fill(null);
    slots[barSlot - 1] = abilityId;
    return slots;
  };

  it('assigns page 0 for a bar-assigned row on slots 1-5', () => {
    for (const slot of [1, 2, 3, 4, 5]) {
      const v = buildSpellbookView(
        input({
          known: [known('sim', KIT[0])],
          barAbilityIds: [KIT[0]],
          abilityIdByBarSlot: slotsWith(KIT[0], slot),
        }),
      );
      expect(v.rows.find((r) => r.abilityId === KIT[0])!.mobilePage, `slot ${slot}`).toBe(0);
    }
  });

  it('assigns page 1 for a bar-assigned row on slots 6-10', () => {
    for (const slot of [6, 7, 8, 9, 10]) {
      const v = buildSpellbookView(
        input({
          known: [known('sim', KIT[0])],
          barAbilityIds: [KIT[0]],
          abilityIdByBarSlot: slotsWith(KIT[0], slot),
        }),
      );
      expect(v.rows.find((r) => r.abilityId === KIT[0])!.mobilePage, `slot ${slot}`).toBe(1);
    }
  });

  it('assigns page 2 for a bar-assigned row on slots 11-15', () => {
    for (const slot of [11, 12, 13, 14, 15]) {
      const v = buildSpellbookView(
        input({
          known: [known('sim', KIT[0])],
          barAbilityIds: [KIT[0]],
          abilityIdByBarSlot: slotsWith(KIT[0], slot),
        }),
      );
      expect(v.rows.find((r) => r.abilityId === KIT[0])!.mobilePage, `slot ${slot}`).toBe(2);
    }
  });

  it('assigns page 3 for slots 16-20', () => {
    const v = buildSpellbookView(
      input({
        known: [known('sim', KIT[0])],
        barAbilityIds: [KIT[0]],
        abilityIdByBarSlot: slotsWith(KIT[0], 16),
      }),
    );
    expect(v.rows.find((r) => r.abilityId === KIT[0])!.mobilePage).toBe(3);
  });

  it('assigns null for a row that is off-bar even if abilityIdByBarSlot is provided', () => {
    const v = buildSpellbookView(
      input({
        known: [known('sim', KIT[0])],
        barAbilityIds: [],
        abilityIdByBarSlot: new Array(22).fill(null),
      }),
    );
    expect(v.rows.find((r) => r.abilityId === KIT[0])!.mobilePage).toBeNull();
  });

  it('assigns null when abilityIdByBarSlot is omitted (desktop / not-yet-wired callers)', () => {
    const v = buildSpellbookView(input({ known: [known('sim', KIT[0])], barAbilityIds: [KIT[0]] }));
    expect(v.rows.find((r) => r.abilityId === KIT[0])!.mobilePage).toBeNull();
  });
});

describe('buildSpellbookView: exact assignment state', () => {
  const slotsWith = (abilityId: string, sourceSlot: number): (string | null)[] => {
    const slots: (string | null)[] = new Array(22).fill(null);
    slots[sourceSlot - 1] = abilityId;
    return slots;
  };

  it.each([
    [1, 0, 1],
    [5, 0, 5],
    [6, 1, 1],
    [20, 3, 5],
  ])('reports source slot %i as mobile P%i A%i', (sourceSlot, page, position) => {
    const view = buildSpellbookView(
      input({
        known: [known('sim', KIT[0])],
        barAbilityIds: [KIT[0]],
        abilityIdByBarSlot: slotsWith(KIT[0], sourceSlot),
        touchPresentation: true,
      }),
    );
    expect(view.rows.find((row) => row.abilityId === KIT[0])?.assignment).toEqual({
      kind: 'mobile',
      sourceSlot,
      page,
      position,
    });
  });

  it.each([21, 22])('reports source slot %i as desktop overflow', (sourceSlot) => {
    const view = buildSpellbookView(
      input({
        known: [known('sim', KIT[0])],
        barAbilityIds: [KIT[0]],
        abilityIdByBarSlot: slotsWith(KIT[0], sourceSlot),
        touchPresentation: true,
      }),
    );
    expect(view.rows.find((row) => row.abilityId === KIT[0])?.assignment).toEqual({
      kind: 'desktop',
      sourceSlot,
    });
  });

  it('uses the lowest source slot for corrupt duplicate assignments', () => {
    const slots = slotsWith(KIT[0], 12);
    slots[2] = KIT[0];
    const view = buildSpellbookView(
      input({
        known: [known('sim', KIT[0])],
        barAbilityIds: [KIT[0]],
        abilityIdByBarSlot: slots,
        touchPresentation: true,
      }),
    );
    expect(view.rows.find((row) => row.abilityId === KIT[0])?.assignment).toMatchObject({
      kind: 'mobile',
      sourceSlot: 3,
    });
  });

  it('keeps touch Add enabled on a full bar while desktop Add stays disabled', () => {
    const base = {
      known: [known('sim', KIT[0])],
      barAbilityIds: [],
      hasFreeSlot: false,
    };
    const touch = buildSpellbookView(input({ ...base, touchPresentation: true }));
    const desktop = buildSpellbookView(input({ ...base, touchPresentation: false }));
    expect(touch.rows.find((row) => row.abilityId === KIT[0])?.toggleDisabled).toBe(false);
    expect(desktop.rows.find((row) => row.abilityId === KIT[0])?.toggleDisabled).toBe(true);
  });
});

describe('buildSpellbookView: ClientWorld-vs-Sim parity', () => {
  // The core passes the resolved ability OBJECT through to the painter (it needs it
  // for the tooltip/summary), so the parity guarantee is over the DERIVED decision
  // state: a Sim-shaped known carrying extra fields the core ignores must yield the
  // same known-ness / rank / on-bar / disabled state as a ClientWorld-mirror shape.
  const derived = (shape: 'sim' | 'client') =>
    buildSpellbookView(
      input({ known: [known(shape, KIT[0], 2)], barAbilityIds: [KIT[0]], hasFreeSlot: false }),
    ).rows.map((r) => ({
      abilityId: r.abilityId,
      learned: r.known !== null,
      rank: r.rank,
      onBar: r.onBar,
      toggleDisabled: r.toggleDisabled,
    }));

  it('derives identical decision state regardless of the known object shape', () => {
    expect(derived('sim')).toEqual(derived('client'));
  });

  it('is deterministic: identical inputs produce a deep-equal view', () => {
    const i = input({ known: [known('sim', KIT[0])] });
    expect(buildSpellbookView(i)).toEqual(buildSpellbookView(i));
  });
});

describe('mobile Spellbook picker model', () => {
  const actions = (): HotbarAction[] => Array<HotbarAction>(22).fill(null);

  it('projects four tabs and five stable destinations for the selected page', () => {
    const bar = actions();
    bar[5] = { type: 'ability', id: 'frost_armor' };
    bar[6] = { type: 'item', id: 'baked_bread' };

    const picker = buildMobileSpellbookPicker({
      actions: bar,
      abilityId: 'fireball',
      selectedPage: 1,
      barToken: 'mage:normal',
    });

    expect(picker.tabs.map((tab) => [tab.page, tab.selected, tab.tabIndex])).toEqual([
      [0, false, -1],
      [1, true, 0],
      [2, false, -1],
      [3, false, -1],
    ]);
    expect(picker.destinations.map((destination) => destination.sourceSlot)).toEqual([
      6, 7, 8, 9, 10,
    ]);
    expect(picker.destinations[0].occupant).toEqual({ type: 'ability', id: 'frost_armor' });
    expect(picker.destinations[1].occupant).toEqual({ type: 'item', id: 'baked_bread' });
    expect(picker.destinations[2].occupant).toBeNull();
  });

  it('reports mobile, desktop, and unassigned locations using stable source slots', () => {
    const bar = actions();
    bar[19] = { type: 'ability', id: 'fireball' };
    expect(mobileSpellbookAssignment(bar, 'fireball')).toEqual({
      kind: 'mobile',
      sourceSlot: 20,
      page: 3,
      position: 5,
    });
    bar[19] = null;
    bar[20] = { type: 'ability', id: 'fireball' };
    expect(mobileSpellbookAssignment(bar, 'fireball')).toEqual({
      kind: 'desktop',
      sourceSlot: 21,
    });
    bar[20] = null;
    expect(mobileSpellbookAssignment(bar, 'fireball')).toEqual({ kind: 'unassigned' });
  });

  it('focuses current destination, then first empty destination, then A1', () => {
    const current = actions();
    current[7] = { type: 'ability', id: 'fireball' };
    expect(
      buildMobileSpellbookPicker({
        actions: current,
        abilityId: 'fireball',
        selectedPage: 1,
        barToken: 'mage:normal',
      }).focusDestinationIndex,
    ).toBe(2);

    const partlyOccupied = actions();
    partlyOccupied[5] = { type: 'item', id: 'baked_bread' };
    expect(
      buildMobileSpellbookPicker({
        actions: partlyOccupied,
        abilityId: 'fireball',
        selectedPage: 1,
        barToken: 'mage:normal',
      }).focusDestinationIndex,
    ).toBe(1);

    const full = actions();
    for (let index = 5; index < 10; index++) full[index] = { type: 'item', id: `item-${index}` };
    expect(
      buildMobileSpellbookPicker({
        actions: full,
        abilityId: 'fireball',
        selectedPage: 1,
        barToken: 'mage:normal',
      }).focusDestinationIndex,
    ).toBe(0);
  });

  it('moves picker tabs with arrows and Home or End', () => {
    expect(nextMobileSpellbookPickerPage(0, 'ArrowLeft')).toBe(3);
    expect(nextMobileSpellbookPickerPage(3, 'ArrowRight')).toBe(0);
    expect(nextMobileSpellbookPickerPage(2, 'Home')).toBe(0);
    expect(nextMobileSpellbookPickerPage(1, 'End')).toBe(3);
    expect(nextMobileSpellbookPickerPage(1, 'Enter')).toBe(1);
  });

  it('compares immutable character and form bar tokens exactly', () => {
    expect(isSpellbookBarTokenCurrent('character-1:normal', 'character-1:normal')).toBe(true);
    expect(isSpellbookBarTokenCurrent('character-1:normal', 'character-1:bear')).toBe(false);
    expect(isSpellbookBarTokenCurrent('character-1:normal', 'character-2:normal')).toBe(false);
  });
});
