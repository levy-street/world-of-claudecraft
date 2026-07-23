// Pure, host-agnostic core for the bag-item context menu (Professions 2.0).
// It owns the DOM-free decisions behind the right-click / touch
// action menu on a bag stack: which new actions (Disenchant, Salvage,
// Apply Enchant) are eligible for an item, the full ordered menu (the classic
// left-click action first so that binding survives, then the eligible new
// rows), and the "would this destroy a special copy?" predicate the confirm
// dialog escalates on. bag_item_action_menu.ts is the thin DOM consumer that
// paints the rows and dispatches; this mirrors the player_context_menu.ts
// family shape (state in, action list out) beside the bags_view.ts pure core.
//
// Eligibility is DEF-based (isDisenchantable / isSalvageable / an enchant
// reagent id), matching the sim's own itemId-keyed command resolution: the
// commands consume a PREFERRED copy (never the exact clicked slot), so the
// menu reasons about the item, not one stack.
//
// DOM/Three-free (registered in tests/architecture.test.ts UI_PURE_CORES).

import { ENCHANTS } from '../sim/content/enchants';
import { isDisenchantable, isEnchantedInstance } from '../sim/professions/enchanting';
import { isSalvageable } from '../sim/professions/salvage';
import type { ItemDef, ItemInstancePayload } from '../sim/types';
import type { TranslationKey } from './i18n.catalog';

// Every item id that appears in ANY enchant's reagent list: the Apply Enchant
// action is offered on these (an enchant reagent the flow can spend). Derived
// once from the static ENCHANTS table (data-as-code), never per call.
const ENCHANT_REAGENT_IDS: ReadonlySet<string> = new Set(
  Object.values(ENCHANTS).flatMap((enchant) => enchant.reagents.map((reagent) => reagent.itemId)),
);

/** Whether `itemId` is consumed by at least one enchant, so the Apply Enchant
 *  action applies to it. */
export function isEnchantReagentItem(itemId: string): boolean {
  return ENCHANT_REAGENT_IDS.has(itemId);
}

export type BagItemNewActionId = 'disenchant' | 'salvage' | 'applyEnchant';
export type BagItemContextActionId = 'default' | BagItemNewActionId;

export interface BagItemContextAction {
  id: BagItemContextActionId;
  labelKey: TranslationKey;
}

const NEW_ACTION_LABEL_KEY: Record<BagItemNewActionId, TranslationKey> = {
  disenchant: 'hudChrome.itemMenu.disenchant',
  salvage: 'hudChrome.itemMenu.salvage',
  applyEnchant: 'hudChrome.itemMenu.applyEnchant',
};

/** The classic left-click verb for the default (first) menu row, so the menu's
 *  top row always does exactly what a plain click does (the classic binding).
 *  Gear equips; everything else uses. */
function defaultActionLabelKey(def: ItemDef): TranslationKey {
  return def.kind === 'weapon' ||
    def.kind === 'armor' ||
    def.kind === 'held_offhand' ||
    def.kind === 'bag'
    ? 'hudChrome.itemMenu.equip'
    : 'hudChrome.itemMenu.use';
}

/** The eligible new actions for this item, in fixed order (disenchant,
 *  salvage, apply-enchant). Empty when none apply, which is what keeps a plain
 *  item's right-click byte-identical to today. */
export function bagItemNewActions(def: ItemDef, itemId: string): BagItemNewActionId[] {
  const out: BagItemNewActionId[] = [];
  if (isDisenchantable(def)) out.push('disenchant');
  if (isSalvageable(def)) out.push('salvage');
  if (isEnchantReagentItem(itemId)) out.push('applyEnchant');
  return out;
}

/** Whether this item has at least one new action, so a right-click / tap
 *  opens the menu instead of running the classic action directly. */
export function bagItemHasContextActions(def: ItemDef, itemId: string): boolean {
  return bagItemNewActions(def, itemId).length > 0;
}

/** The full ordered menu: the classic default row first (so left-click's binding
 *  survives as row one), then each eligible new action. */
export function bagItemContextActions(def: ItemDef, itemId: string): BagItemContextAction[] {
  const rows: BagItemContextAction[] = [{ id: 'default', labelKey: defaultActionLabelKey(def) }];
  for (const id of bagItemNewActions(def, itemId)) {
    rows.push({ id, labelKey: NEW_ACTION_LABEL_KEY[id] });
  }
  return rows;
}

/** One held copy of an item, as the confirm predicate needs it: the count and
 *  the optional per-copy instance payload (absent for a plain fungible stack). */
export interface BagCopy {
  count: number;
  instance?: ItemInstancePayload;
}

/** Whether destroying this specific copy loses something irreplaceable: it was
 *  signed/crafted, is a masterwork proc, or is enchanted (isEnchantedInstance:
 *  the explicit marker or a legacy bare rolled.stats without masterwork). A
 *  plain fungible copy is never special. */
export function isSpecialCopy(instance: ItemInstancePayload | undefined): boolean {
  if (!instance) return false;
  return !!instance.signer || !!instance.rolled?.masterwork || isEnchantedInstance(instance);
}

/** Whether the copy the destructive action WOULD consume is special, so the
 *  confirm escalates to the stronger warning. Both actions prefer a PLAIN
 *  fungible copy first, so a player holding any plain copy is never warned
 *  (that plain copy is what dies): do not scare someone holding a plain copy
 *  plus a masterwork copy. Only when no fungible copy exists does the action
 *  reach for an instanced copy, and we warn iff THAT copy is special. Mirrors
 *  the sim's removal order (highest inventory index first among matching
 *  copies):
 *   - salvage (items.ts removePreferFungible): once fungible is exhausted the
 *     highest-index instanced copy of ANY kind is taken (enchanted included).
 *   - disenchant (sim.ts removeEnchantableItem): the highest-index NON-enchanted
 *     instanced copy is taken (already-enchanted copies are never eligible, so
 *     they are skipped when choosing the victim). */
export function destroyConsumesSpecialCopy(
  action: 'disenchant' | 'salvage',
  copies: readonly BagCopy[],
): boolean {
  if (copies.some((copy) => !copy.instance)) return false;
  for (let i = copies.length - 1; i >= 0; i--) {
    const instance = copies[i].instance;
    if (!instance) continue;
    if (action === 'disenchant' && isEnchantedInstance(instance)) continue;
    return isSpecialCopy(instance);
  }
  return false;
}
