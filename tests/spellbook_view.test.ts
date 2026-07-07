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
import { buildSpellbookView, type SpellbookInput } from '../src/ui/spellbook_view';

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
