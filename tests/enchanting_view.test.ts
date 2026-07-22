// Pure-core tests for the enchanting result toasts (Professions 2.0 Phase 13):
// every event x reason maps to the exact i18n key and sink (a success chat line
// vs an error toast). The throttled arm is pinned to its OWN action key (never
// the crafting-busy line), the 12c cross-action-throttle nuance.

import { describe, expect, it } from 'vitest';
import {
  applyEnchantResultToast,
  disenchantResultToast,
  salvageResultToast,
} from '../src/ui/enchanting_view';

describe('enchanting_view: disenchant toast mapping', () => {
  it('maps success to the disenchanted chat line', () => {
    expect(disenchantResultToast({ ok: true })).toEqual({
      key: 'hudChrome.enchanting.disenchantedLine',
      sink: 'log',
    });
  });
  it('maps every reason to its own error toast', () => {
    expect(disenchantResultToast({ ok: false, reason: 'throttled' })).toEqual({
      key: 'hudChrome.enchanting.disenchantThrottled',
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
  });
});

describe('enchanting_view: salvage toast mapping', () => {
  it('maps success to the salvaged chat line', () => {
    expect(salvageResultToast({ ok: true })).toEqual({
      key: 'hudChrome.enchanting.salvagedLine',
      sink: 'log',
    });
  });
  it('maps every reason to its own error toast', () => {
    expect(salvageResultToast({ ok: false, reason: 'throttled' }).key).toBe(
      'hudChrome.enchanting.salvageThrottled',
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
      'hudChrome.enchanting.enchantThrottled',
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
  });
  it('always routes a failure through the error sink', () => {
    for (const reason of [
      'throttled',
      'wrong_slot',
      'unknown_enchant',
      'insufficient_materials',
      'not_held',
      'unknown_item',
    ] as const) {
      expect(applyEnchantResultToast({ ok: false, reason }).sink).toBe('error');
    }
  });
});
