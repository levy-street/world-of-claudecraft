// Pure, host-agnostic core for the Apply Enchant picker (Professions 2.0).
// Two steps, both DOM-free: (1) the enchants that consume a chosen
// reagent, each with its EFFECT facts, its per-reagent affordability read from
// the viewer's inventory, and its target slot, grouped into the three reagent-
// derived tier sections (enchantSectionsForReagent) and sorted by paperdoll
// slot inside each, and (2) the items eligible as the enchant target (def slot
// matches the enchant, and the copy is NOT already enchanted), in two families:
// the BAGGED copies (enchantTargets) and the WORN ones (wornEnchantTargets),
// since worn gear is enchanted in place and needs no unequip / re-equip round
// trip. The enchant content is static (content/enchants.ts, identical in both
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
import {
  ALL_EQUIP_SLOTS,
  type EquipSlot,
  type InvSlot,
  type ItemInstancePayload,
} from '../sim/types';
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

/** One stat axis an enchant grants, as the picker renders it inline. */
export interface EnchantEffectRow {
  /** The EnchantDef.statBonus key (str/agi/sta/int/spi/armor). */
  stat: string;
  value: number;
}

export interface EnchantPickRow {
  enchantId: string;
  /** The equip slot this enchant targets (ItemDef['slot']). */
  itemSlot: string;
  /** What the enchant actually DOES, straight off ENCHANTS[id].statBonus in
   *  declaration order. Rendered inline on the row (never hover-only: the
   *  picker also lives on touch, where there is no hover). */
  effects: EnchantEffectRow[];
  reagents: EnchantReagentRow[];
  /** True only when every reagent is held in sufficient count. */
  affordable: boolean;
}

/** The enchants that consume `reagentItemId`, in ENCHANTS declaration order,
 *  each with its effect facts, per-reagent affordability from the viewer's
 *  inventory, and its target slot. */
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
    const effects: EnchantEffectRow[] = [];
    for (const [stat, value] of Object.entries(enchant.statBonus)) {
      if (value === undefined || value === 0) continue;
      effects.push({ stat, value });
    }
    rows.push({
      enchantId: enchant.id,
      itemSlot: enchant.itemSlot,
      effects,
      reagents,
      affordable: reagents.every((reagent) => reagent.have >= reagent.required),
    });
  }
  return rows;
}

/** The three enchant tiers the picker groups by, in ladder order. Derived from
 *  the reagents alone (EnchantDef carries no tier field and this change adds
 *  none): arcane_shard is the Greater tier's exclusive reagent, a typed
 *  `resonant_*` secondary is the Runed tier's, and everything else is Base.
 *  Shard WINS over resonant so a hypothetical enchant consuming both still
 *  reads as the top tier (content/enchants.ts describes shard as the premium
 *  that has to stay a visible step). */
export type EnchantTier = 'base' | 'runed' | 'greater';

export const ENCHANT_TIER_ORDER: readonly EnchantTier[] = ['base', 'runed', 'greater'];

/** The item id whose presence in an enchant's reagents marks the Greater tier. */
const GREATER_TIER_REAGENT = 'arcane_shard';

/** The id prefix of the typed disenchant secondaries
 *  (src/sim/professions/disenchant_reagents.ts), the Runed tier's reagents. */
const RUNED_TIER_REAGENT_PREFIX = 'resonant_';

/** Which tier one enchant sits in, from its reagents. Unknown ids read as Base
 *  (the picker never drops a row it cannot classify). */
export function enchantTier(enchantId: string): EnchantTier {
  const enchant = ENCHANTS[enchantId];
  if (!enchant) return 'base';
  let runed = false;
  for (const reagent of enchant.reagents) {
    if (reagent.itemId === GREATER_TIER_REAGENT) return 'greater';
    if (reagent.itemId.startsWith(RUNED_TIER_REAGENT_PREFIX)) runed = true;
  }
  return runed ? 'runed' : 'base';
}

/** Paperdoll order for the picker's within-section sort: the weapon first, then
 *  the armor slots top to bottom, jewelry last. Mirrors how a player reads
 *  their own character sheet, so a slot's enchants sit where the eye expects
 *  them. An unlisted slot sorts after every listed one. */
const SLOT_SORT_ORDER: readonly string[] = [
  'mainhand',
  'helmet',
  'neck',
  'shoulder',
  'chest',
  'waist',
  'legs',
  'gloves',
  'feet',
  'ring',
];

function slotSortIndex(itemSlot: string): number {
  const index = SLOT_SORT_ORDER.indexOf(itemSlot);
  return index < 0 ? SLOT_SORT_ORDER.length : index;
}

/** The localized section-header key for one tier. */
export function enchantTierTitleKey(tier: EnchantTier): TranslationKey {
  return `hudChrome.enchanting.tier.${tier}` as TranslationKey;
}

export interface EnchantPickSection {
  tier: EnchantTier;
  titleKey: TranslationKey;
  rows: EnchantPickRow[];
}

/** enchantsForReagent, grouped into the three tier sections in ladder order and
 *  sorted inside each section by paperdoll slot then name key. Empty sections
 *  are omitted, so a dust-only reagent still paints exactly one header. Pure:
 *  the input rows are re-bucketed, never mutated. */
export function enchantSectionsForReagent(
  inventory: readonly InvSlot[],
  reagentItemId: string,
): EnchantPickSection[] {
  const byTier = new Map<EnchantTier, EnchantPickRow[]>();
  for (const row of enchantsForReagent(inventory, reagentItemId)) {
    const tier = enchantTier(row.enchantId);
    const bucket = byTier.get(tier);
    if (bucket) bucket.push(row);
    else byTier.set(tier, [row]);
  }
  const sections: EnchantPickSection[] = [];
  for (const tier of ENCHANT_TIER_ORDER) {
    const rows = byTier.get(tier);
    if (!rows || rows.length === 0) continue;
    rows.sort((a, b) => {
      const slotDelta = slotSortIndex(a.itemSlot) - slotSortIndex(b.itemSlot);
      if (slotDelta !== 0) return slotDelta;
      const aKey = enchantNameKey(a.enchantId);
      const bKey = enchantNameKey(b.enchantId);
      return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
    });
    sections.push({ tier, titleKey: enchantTierTitleKey(tier), rows });
  }
  return sections;
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

export interface WornEnchantTargetRow {
  itemId: string;
  /** The exact equipment key this copy is worn in, and the discriminator the
   *  apply command carries: ring1/ring2 and mainhand/offhand can be wearing
   *  identical copies of one item id, so the id alone cannot name the target. */
  slot: EquipSlot;
}

/** The WORN copies eligible as the enchant target, one row per equipment slot,
 *  in ALL_EQUIP_SLOTS order. Mirrors the sim's worn arm
 *  (src/sim/professions/enchanting.ts resolveApplyEnchantWorn) gate for gate: the
 *  worn item's def slot must match the enchant's itemSlot, and the worn copy must
 *  not already be enchanted. An ABSENT payload is a plain worn copy and stays
 *  eligible; a signed or masterwork payload is not "enchanted" and stays eligible
 *  too, exactly as in the bags. Both rings and both hands list separately when
 *  each holds an eligible copy, since each is its own target.
 *
 *  `equipment` and `equippedInstances` are read straight off the two worlds'
 *  shared surfaces (IWorld.equipment and the self entity mirror
 *  Entity.equippedInstances), so this decides identically offline and online. */
export function wornEnchantTargets(
  equipment: Partial<Record<EquipSlot, string>>,
  equippedInstances: Partial<Record<EquipSlot, ItemInstancePayload>>,
  enchantId: string,
): WornEnchantTargetRow[] {
  const enchant = ENCHANTS[enchantId];
  if (!enchant) return [];
  const rows: WornEnchantTargetRow[] = [];
  for (const slot of ALL_EQUIP_SLOTS) {
    const itemId = equipment[slot];
    if (!itemId) continue;
    const def = ITEMS[itemId];
    if (!def || def.slot !== enchant.itemSlot) continue;
    const instance = equippedInstances[slot];
    if (instance && isEnchantedInstance(instance)) continue;
    rows.push({ itemId, slot });
  }
  return rows;
}
