// Pure, host-agnostic core for the Apply Enchant picker (Professions 2.0
// Phase 13). Two steps, both DOM-free: (1) the enchants that consume a chosen
// reagent, each with its per-reagent affordability read from the viewer's
// inventory and its target slot, and (2) the held items eligible as the enchant
// target (def slot matches the enchant, and a NON-already-enchanted copy is
// held). The enchant content is static (content/enchants.ts, identical in both
// worlds), so both steps are a plain read of world.inventory; no wire round
// trip. enchant_apply_view never decides an outcome: world.applyEnchant does,
// server-authoritative.
//
// Enchant display names have no i18n pipeline before this picker (EnchantDef.name
// has never rendered), so enchantNameKey names the FIRST render sink key for the
// thin consumer to resolve; never raw def.name.
//
// DOM/Three-free (registered in tests/architecture.test.ts UI_PURE_CORES).

import { ENCHANTS } from '../sim/content/enchants';
import { ITEMS } from '../sim/data';
import { isEnchantedInstance } from '../sim/professions/enchanting';
import type { InvSlot } from '../sim/types';
import type { TranslationKey } from './i18n.catalog';

/** The localized-name key for one enchant id (hudChrome.enchantName.<id>): its
 *  first render sink. */
export function enchantNameKey(enchantId: string): TranslationKey {
  return `hudChrome.enchantName.${enchantId}` as TranslationKey;
}

/** Total held count of an item id across every stack (fungible + instanced).
 *  Enchant reagents are plain materials, so this mirrors the sim's ctx.countItem
 *  the apply command checks each reagent against. */
function heldCount(inventory: readonly InvSlot[], itemId: string): number {
  let n = 0;
  for (const slot of inventory) if (slot.itemId === itemId) n += slot.count;
  return n;
}

export interface EnchantReagentRow {
  itemId: string;
  required: number;
  have: number;
}

export interface EnchantPickRow {
  enchantId: string;
  /** The equip slot this enchant targets (ItemDef['slot']). */
  itemSlot: string;
  reagents: EnchantReagentRow[];
  /** True only when every reagent is held in sufficient count. */
  affordable: boolean;
}

/** The enchants that consume `reagentItemId`, in ENCHANTS declaration order,
 *  each with per-reagent affordability from the viewer's inventory and its
 *  target slot. */
export function enchantsForReagent(
  inventory: readonly InvSlot[],
  reagentItemId: string,
): EnchantPickRow[] {
  const rows: EnchantPickRow[] = [];
  for (const enchant of Object.values(ENCHANTS)) {
    if (!enchant.reagents.some((reagent) => reagent.itemId === reagentItemId)) continue;
    const reagents = enchant.reagents.map((reagent) => ({
      itemId: reagent.itemId,
      required: reagent.count,
      have: heldCount(inventory, reagent.itemId),
    }));
    rows.push({
      enchantId: enchant.id,
      itemSlot: enchant.itemSlot,
      reagents,
      affordable: reagents.every((reagent) => reagent.have >= reagent.required),
    });
  }
  return rows;
}

export interface EnchantTargetRow {
  itemId: string;
  /** How many enchantable copies are held (excludes already-enchanted copies). */
  count: number;
}

/** The distinct held items eligible as the enchant target: def slot matches the
 *  enchant's itemSlot and at least one ENCHANTABLE copy is held. Mirrors the
 *  sim's ctx.countEnchantableItem: a plain fungible copy or a non-already-
 *  enchanted instanced copy qualifies, so a masterwork or signed copy stays
 *  eligible while an already-enchanted copy is excluded (double-enchant is
 *  blocked). Grouped by item id (the apply command is itemId-keyed), in first-
 *  seen inventory order. */
export function enchantTargets(
  inventory: readonly InvSlot[],
  enchantId: string,
): EnchantTargetRow[] {
  const enchant = ENCHANTS[enchantId];
  if (!enchant) return [];
  const byItem = new Map<string, number>();
  for (const slot of inventory) {
    const def = ITEMS[slot.itemId];
    if (!def || def.slot !== enchant.itemSlot) continue;
    if (slot.instance && isEnchantedInstance(slot.instance)) continue;
    byItem.set(slot.itemId, (byItem.get(slot.itemId) ?? 0) + slot.count);
  }
  return [...byItem].map(([itemId, count]) => ({ itemId, count }));
}
