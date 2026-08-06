// Pure-core tests for the enchanting result toasts (Professions 2.0):
// every event x reason maps to the exact i18n key and sink (a success chat line
// vs an error toast). The throttled arm is pinned to its OWN action key (never
// the crafting-busy line), the 12c cross-action-throttle nuance.

import { describe, expect, it } from 'vitest';
import {
  applyEnchantResultToast,
  disenchantResultToast,
  disenchantSecondaryLineKey,
  salvageResultToast,
} from '../src/ui/enchanting_view';

describe('enchanting_view: disenchant toast mapping', () => {
  it('maps a success carrying a yield to the yield-naming chat line', () => {
    // #2430: the hub's "You receive:" line no longer prints for the material
    // grant, so the success line has to name the reclaimed material itself.
    expect(disenchantResultToast({ ok: true, materialItemId: 'arcane_dust', count: 1 })).toEqual({
      key: 'hudChrome.enchanting.disenchantedYield',
      sink: 'log',
    });
  });
  it('takes the quantity variant only past one unit', () => {
    expect(disenchantResultToast({ ok: true, materialItemId: 'arcane_dust', count: 2 }).key).toBe(
      'hudChrome.enchanting.disenchantedYieldQty',
    );
    // A count of exactly 1 must NOT take the qty variant (the hub line's own
    // " xN"-only-past-one rule), and neither must an absent count.
    expect(disenchantResultToast({ ok: true, materialItemId: 'arcane_dust', count: 1 }).key).toBe(
      'hudChrome.enchanting.disenchantedYield',
    );
    expect(disenchantResultToast({ ok: true, materialItemId: 'arcane_dust' }).key).toBe(
      'hudChrome.enchanting.disenchantedYield',
    );
  });
  it('falls back to the yield-free line when no material resolved', () => {
    // Unreachable from a well-formed resolveDisenchant, but the fallback is
    // what stops an empty {material} placeholder rendering to a player.
    expect(disenchantResultToast({ ok: true })).toEqual({
      key: 'hudChrome.enchanting.disenchantedLine',
      sink: 'log',
    });
  });
  it('maps every reason to its own error toast', () => {
    expect(disenchantResultToast({ ok: false, reason: 'throttled' })).toEqual({
      key: 'hudChrome.enchanting.disenchantBusy',
      sink: 'error',
    });
    expect(disenchantResultToast({ ok: false, reason: 'busy' })).toEqual({
      key: 'hudChrome.enchanting.disenchantBusy',
      sink: 'error',
    });
    expect(disenchantResultToast({ ok: false, reason: 'not_disenchantable' }).key).toBe(
      'hudChrome.enchanting.notDisenchantable',
    );
    expect(disenchantResultToast({ ok: false, reason: 'not_held' }).key).toBe(
      'hudChrome.enchanting.notHeld',
    );
    expect(disenchantResultToast({ ok: false, reason: 'unknown_item' }).key).toBe(
      'hudChrome.enchanting.notHeld',
    );
    expect(disenchantResultToast({ ok: false, reason: 'no_bag_space' })).toEqual({
      key: 'hudChrome.enchanting.disenchantNoSpace',
      sink: 'error',
    });
  });
});

describe('enchanting_view: disenchant secondary line (#2430)', () => {
  it('returns a key only when the yield actually carried a typed secondary', () => {
    // A rare+ yield's typed bind-on-trade material is a DIFFERENT item, so it
    // takes its own line; every sub-rare yield (and a rare+ piece with no
    // typed material) must return null so no empty second line prints.
    expect(disenchantSecondaryLineKey({ ok: true })).toBeNull();
    expect(disenchantSecondaryLineKey({ ok: true, secondaryItemId: 'vital_essence' })).toBeNull();
    expect(disenchantSecondaryLineKey({ ok: true, secondaryCount: 2 })).toBeNull();
    expect(
      disenchantSecondaryLineKey({ ok: true, secondaryItemId: 'vital_essence', secondaryCount: 0 }),
    ).toBeNull();
    // A DENIED disenchant granted nothing, so it never gets a second line even
    // if the event somehow carried yield fields.
    expect(
      disenchantSecondaryLineKey({
        ok: false,
        reason: 'not_held',
        secondaryItemId: 'vital_essence',
        secondaryCount: 1,
      }),
    ).toBeNull();
  });
  it('takes the quantity variant only past one unit', () => {
    expect(
      disenchantSecondaryLineKey({ ok: true, secondaryItemId: 'vital_essence', secondaryCount: 1 }),
    ).toBe('hudChrome.enchanting.disenchantedAlso');
    expect(
      disenchantSecondaryLineKey({ ok: true, secondaryItemId: 'vital_essence', secondaryCount: 2 }),
    ).toBe('hudChrome.enchanting.disenchantedAlsoQty');
  });
});

describe('enchanting_view: salvage toast mapping', () => {
  it('maps a success carrying a yield to the yield-naming chat line', () => {
    expect(salvageResultToast({ ok: true, materialItemId: 'bone_fragments', count: 1 })).toEqual({
      key: 'hudChrome.enchanting.salvagedYield',
      sink: 'log',
    });
  });
  it('takes the quantity variant only past one unit, and falls back with no material', () => {
    expect(salvageResultToast({ ok: true, materialItemId: 'bone_fragments', count: 3 }).key).toBe(
      'hudChrome.enchanting.salvagedYieldQty',
    );
    expect(salvageResultToast({ ok: true })).toEqual({
      key: 'hudChrome.enchanting.salvagedLine',
      sink: 'log',
    });
  });
  it('maps every reason to its own error toast', () => {
    expect(salvageResultToast({ ok: false, reason: 'throttled' }).key).toBe(
      'hudChrome.enchanting.salvageBusy',
    );
    expect(salvageResultToast({ ok: false, reason: 'not_salvageable' }).key).toBe(
      'hudChrome.enchanting.notSalvageable',
    );
    expect(salvageResultToast({ ok: false, reason: 'not_held' }).key).toBe(
      'hudChrome.enchanting.notHeld',
    );
    expect(salvageResultToast({ ok: false, reason: 'unknown_item' }).key).toBe(
      'hudChrome.enchanting.notHeld',
    );
    expect(salvageResultToast({ ok: false, reason: 'no_bag_space' })).toEqual({
      key: 'hudChrome.enchanting.salvageNoSpace',
      sink: 'error',
    });
  });
});

describe('enchanting_view: apply-enchant toast mapping', () => {
  it('maps success to the enchant-applied chat line', () => {
    expect(applyEnchantResultToast({ ok: true })).toEqual({
      key: 'hudChrome.enchanting.enchantAppliedLine',
      sink: 'log',
    });
  });
  it('maps every reason to its own error toast', () => {
    expect(applyEnchantResultToast({ ok: false, reason: 'throttled' }).key).toBe(
      'hudChrome.enchanting.enchantBusy',
    );
    expect(applyEnchantResultToast({ ok: false, reason: 'wrong_slot' }).key).toBe(
      'hudChrome.enchanting.enchantWrongSlot',
    );
    expect(applyEnchantResultToast({ ok: false, reason: 'unknown_enchant' }).key).toBe(
      'hudChrome.enchanting.enchantUnknown',
    );
    expect(applyEnchantResultToast({ ok: false, reason: 'insufficient_materials' }).key).toBe(
      'hudChrome.enchanting.enchantInsufficient',
    );
    expect(applyEnchantResultToast({ ok: false, reason: 'not_held' }).key).toBe(
      'hudChrome.enchanting.notHeld',
    );
    expect(applyEnchantResultToast({ ok: false, reason: 'unknown_item' }).key).toBe(
      'hudChrome.enchanting.notHeld',
    );
    expect(applyEnchantResultToast({ ok: false, reason: 'no_bag_space' })).toEqual({
      key: 'hudChrome.enchanting.enchantNoSpace',
      sink: 'error',
    });
    // #2415: the two dedicated already-enchanted denies get their OWN honest
    // copy, never the shared notHeld fallback.
    expect(applyEnchantResultToast({ ok: false, reason: 'already_enchanted' }).key).toBe(
      'hudChrome.enchanting.alreadyEnchanted',
    );
    expect(applyEnchantResultToast({ ok: false, reason: 'same_enchant' }).key).toBe(
      'hudChrome.enchanting.sameEnchant',
    );
  });
  it('always routes a failure through the error sink', () => {
    for (const reason of [
      'throttled',
      'wrong_slot',
      'unknown_enchant',
      'insufficient_materials',
      'not_held',
      'unknown_item',
      'no_bag_space',
      'already_enchanted',
      'same_enchant',
    ] as const) {
      expect(applyEnchantResultToast({ ok: false, reason }).sink).toBe('error');
    }
  });
});
