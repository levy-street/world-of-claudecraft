// Pure, host-agnostic core for the enchanting-action result toasts (Professions
// 2.0). The three commands (disenchant / apply-enchant / salvage) each
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
// The two YIELD-BEARING successes (#2430). The grant hub's "You receive:" line
// used to be the only thing naming what a disenchant or a salvage handed back;
// the profession's own line named only the piece that was destroyed. Now that
// the hub line stands down for those grants (the loot event's `callerLogs`
// flag), the success key selected here has to name the reclaimed material and
// its count too, or the player is told nothing about the yield. A rare+
// disenchant's typed bind-on-trade secondary is a DIFFERENT item, so it takes
// its own extra line (disenchantSecondaryLineKey), which is also what collapses
// its per-unit grant calls into one line.
//
// DOM/Three-free (registered in tests/architecture.test.ts UI_PURE_CORES).

import { isMultiUnitGrant } from './grant_line_view';
import type { TranslationKey } from './i18n.catalog';

export interface EnchantingToast {
  key: TranslationKey;
  /** 'log' = a success chat line; 'error' = a failure error toast. */
  sink: 'log' | 'error';
}

export interface DisenchantResultEvent {
  ok: boolean;
  /** The reclaimed primary material and its rolled count (present on ok). */
  materialItemId?: string;
  count?: number;
  /** The typed bind-on-trade secondary a rare+ yield adds (absent otherwise). */
  secondaryItemId?: string;
  secondaryCount?: number;
  reason?:
    | 'unknown_item'
    | 'not_disenchantable'
    | 'not_held'
    | 'throttled'
    | 'no_bag_space'
    | 'busy';
}
export interface SalvageResultEvent {
  ok: boolean;
  /** The reclaimed material and its rolled count (present on ok). */
  materialItemId?: string;
  count?: number;
  reason?: 'unknown_item' | 'not_salvageable' | 'not_held' | 'throttled' | 'no_bag_space' | 'busy';
}
export interface ApplyEnchantResultEvent {
  ok: boolean;
  reason?:
    | 'unknown_item'
    | 'unknown_enchant'
    | 'wrong_slot'
    | 'not_held'
    | 'insufficient_materials'
    | 'throttled'
    | 'no_bag_space'
    // #2415: the honest already-enchanted deny (no confirm flag), and the
    // identical-enchant-id re-apply denied on every arm.
    | 'already_enchanted'
    | 'same_enchant'
    | 'busy';
}

/** The toast for one disenchantResult event. Success is a chat line naming the
 *  consumed piece AND the reclaimed material ({ item, material, qty }), with the
 *  quantity variant only past one unit; every reason is an error toast.
 *  unknown_item and not_held share the "you do not have that" copy (an unknown
 *  id reads the same to a player). A success with no resolvable material
 *  (unreachable from a well-formed resolveDisenchant, which always sets
 *  materialItemId on ok) falls back to the yield-free wording rather than
 *  rendering an empty placeholder. */
export function disenchantResultToast(ev: DisenchantResultEvent): EnchantingToast {
  if (ev.ok)
    return {
      key: !ev.materialItemId
        ? 'hudChrome.enchanting.disenchantedLine'
        : isMultiUnitGrant(ev.count)
          ? 'hudChrome.enchanting.disenchantedYieldQty'
          : 'hudChrome.enchanting.disenchantedYield',
      sink: 'log',
    };
  switch (ev.reason) {
    case 'throttled':
    case 'busy':
      return { key: 'hudChrome.enchanting.disenchantBusy', sink: 'error' };
    case 'not_disenchantable':
      return { key: 'hudChrome.enchanting.notDisenchantable', sink: 'error' };
    case 'no_bag_space':
      return { key: 'hudChrome.enchanting.disenchantNoSpace', sink: 'error' };
    default:
      return { key: 'hudChrome.enchanting.notHeld', sink: 'error' };
  }
}

/** The toast for one salvageResult event: the disenchant shape above, same
 *  yield-naming success keys and same yield-free fallback. */
export function salvageResultToast(ev: SalvageResultEvent): EnchantingToast {
  if (ev.ok)
    return {
      key: !ev.materialItemId
        ? 'hudChrome.enchanting.salvagedLine'
        : isMultiUnitGrant(ev.count)
          ? 'hudChrome.enchanting.salvagedYieldQty'
          : 'hudChrome.enchanting.salvagedYield',
      sink: 'log',
    };
  switch (ev.reason) {
    case 'throttled':
    case 'busy':
      return { key: 'hudChrome.enchanting.salvageBusy', sink: 'error' };
    case 'not_salvageable':
      return { key: 'hudChrome.enchanting.notSalvageable', sink: 'error' };
    case 'no_bag_space':
      return { key: 'hudChrome.enchanting.salvageNoSpace', sink: 'error' };
    default:
      return { key: 'hudChrome.enchanting.notHeld', sink: 'error' };
  }
}

/** The EXTRA line a rare-or-better disenchant prints for its typed
 *  bind-on-trade secondary, or null when the yield had none (every sub-rare
 *  disenchant, and a rare+ piece with no typed material). One line per DISTINCT
 *  granted item: the secondary is a different item from the primary, so it
 *  earns its own line, and rendering it from the event's secondaryCount is what
 *  collapses the sim's per-unit grant calls into that single line. */
export function disenchantSecondaryLineKey(ev: DisenchantResultEvent): TranslationKey | null {
  if (!ev.ok || !ev.secondaryItemId || !ev.secondaryCount) return null;
  return isMultiUnitGrant(ev.secondaryCount)
    ? 'hudChrome.enchanting.disenchantedAlsoQty'
    : 'hudChrome.enchanting.disenchantedAlso';
}

/** The toast for one enchantResult event. Success is a chat line ({ item,
 *  enchant }); every reason is an error toast. The apply-enchant grant re-mints
 *  the player's OWN copy, so unlike disenchant/salvage this line has no yield
 *  to name: eliding the hub's "You receive:" line for it strictly removes a
 *  falsehood (#2430, it named an item that never left the bags). */
export function applyEnchantResultToast(ev: ApplyEnchantResultEvent): EnchantingToast {
  if (ev.ok) return { key: 'hudChrome.enchanting.enchantAppliedLine', sink: 'log' };
  switch (ev.reason) {
    case 'throttled':
    case 'busy':
      return { key: 'hudChrome.enchanting.enchantBusy', sink: 'error' };
    case 'wrong_slot':
      return { key: 'hudChrome.enchanting.enchantWrongSlot', sink: 'error' };
    case 'unknown_enchant':
      return { key: 'hudChrome.enchanting.enchantUnknown', sink: 'error' };
    case 'insufficient_materials':
      return { key: 'hudChrome.enchanting.enchantInsufficient', sink: 'error' };
    case 'no_bag_space':
      return { key: 'hudChrome.enchanting.enchantNoSpace', sink: 'error' };
    // #2415: the two dedicated already-enchanted denies, each naming the real
    // cause instead of the old misleading "You do not have that item.".
    case 'already_enchanted':
      return { key: 'hudChrome.enchanting.alreadyEnchanted', sink: 'error' };
    case 'same_enchant':
      return { key: 'hudChrome.enchanting.sameEnchant', sink: 'error' };
    default:
      return { key: 'hudChrome.enchanting.notHeld', sink: 'error' };
  }
}
