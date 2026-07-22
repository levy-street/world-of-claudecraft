// Pure, host-agnostic core for the enchanting-action result toasts (Professions
// 2.0 Phase 13). The three commands (disenchant / apply-enchant / salvage) each
// mirror back a text-free personal SimEvent; this maps one event to the i18n key
// it renders and the sink it renders through (a success chat line vs an error
// toast), the gathering_view.ts gatherDeniedLineKey pattern (event -> t() key).
// The HUD's drainEvents switch gains only three THIN cases that call these and
// supply the item/enchant names as params; hud.ts never grows an enchanting
// branch of its own.
//
// The shared 10-per-60s action throttle is CROSS-ACTION (crafting, gathering,
// and all three enchanting actions draw one budget), so each throttled deny key
// names ITS OWN action and never the generic crafting-busy line, which would
// mis-attribute a craft deny to disenchant spend or vice versa.
//
// DOM/Three-free (registered in tests/architecture.test.ts UI_PURE_CORES).

import type { TranslationKey } from './i18n.catalog';

export interface EnchantingToast {
  key: TranslationKey;
  /** 'log' = a success chat line; 'error' = a failure error toast. */
  sink: 'log' | 'error';
}

export interface DisenchantResultEvent {
  ok: boolean;
  reason?: 'unknown_item' | 'not_disenchantable' | 'not_held' | 'throttled';
}
export interface SalvageResultEvent {
  ok: boolean;
  reason?: 'unknown_item' | 'not_salvageable' | 'not_held' | 'throttled';
}
export interface ApplyEnchantResultEvent {
  ok: boolean;
  reason?:
    | 'unknown_item'
    | 'unknown_enchant'
    | 'wrong_slot'
    | 'not_held'
    | 'insufficient_materials'
    | 'throttled';
}

/** The toast for one disenchantResult event. Success is a chat line ({ item });
 *  every reason is an error toast. unknown_item and not_held share the
 *  "you do not have that" copy (an unknown id reads the same to a player). */
export function disenchantResultToast(ev: DisenchantResultEvent): EnchantingToast {
  if (ev.ok) return { key: 'hudChrome.enchanting.disenchantedLine', sink: 'log' };
  switch (ev.reason) {
    case 'throttled':
      return { key: 'hudChrome.enchanting.disenchantThrottled', sink: 'error' };
    case 'not_disenchantable':
      return { key: 'hudChrome.enchanting.notDisenchantable', sink: 'error' };
    default:
      return { key: 'hudChrome.enchanting.notHeld', sink: 'error' };
  }
}

/** The toast for one salvageResult event. Success is a chat line ({ item });
 *  every reason is an error toast. */
export function salvageResultToast(ev: SalvageResultEvent): EnchantingToast {
  if (ev.ok) return { key: 'hudChrome.enchanting.salvagedLine', sink: 'log' };
  switch (ev.reason) {
    case 'throttled':
      return { key: 'hudChrome.enchanting.salvageThrottled', sink: 'error' };
    case 'not_salvageable':
      return { key: 'hudChrome.enchanting.notSalvageable', sink: 'error' };
    default:
      return { key: 'hudChrome.enchanting.notHeld', sink: 'error' };
  }
}

/** The toast for one enchantResult event. Success is a chat line ({ item,
 *  enchant }); every reason is an error toast. */
export function applyEnchantResultToast(ev: ApplyEnchantResultEvent): EnchantingToast {
  if (ev.ok) return { key: 'hudChrome.enchanting.enchantAppliedLine', sink: 'log' };
  switch (ev.reason) {
    case 'throttled':
      return { key: 'hudChrome.enchanting.enchantThrottled', sink: 'error' };
    case 'wrong_slot':
      return { key: 'hudChrome.enchanting.enchantWrongSlot', sink: 'error' };
    case 'unknown_enchant':
      return { key: 'hudChrome.enchanting.enchantUnknown', sink: 'error' };
    case 'insufficient_materials':
      return { key: 'hudChrome.enchanting.enchantInsufficient', sink: 'error' };
    default:
      return { key: 'hudChrome.enchanting.notHeld', sink: 'error' };
  }
}
