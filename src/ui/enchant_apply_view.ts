// Pure, host-agnostic core for the Apply Enchant picker (Professions 2.0).
// Two steps, both DOM-free: (1) the enchants that consume a chosen
// reagent, each with its EFFECT facts, its per-reagent affordability read from
// the viewer's inventory, and its target slot, grouped into the three reagent-
// derived tier sections (enchantSectionsForReagent) and sorted by paperdoll
// slot inside each, and (2) the items eligible as the enchant target (def slot
// matches the enchant), in two families: the BAGGED copies (enchantTargets)
// and the WORN ones (wornEnchantTargets), since worn gear is enchanted in
// place and needs no unequip / re-equip round trip. Not-yet-enchanted copies
// are plain targets; already-enchanted copies surface as FLAGGED replace rows
// (#2415) whose activation is confirm-gated by the thin consumer, each
// carrying what the confirm dialog must name (the doomed enchant id, or a
// legacy victim's raw stats). The enchant content is static
// (content/enchants.ts, identical in both worlds), so both steps are a plain
// read of world.inventory; no wire round trip. enchant_apply_view never
// decides an outcome: world.applyEnchant does, server-authoritative.
//
// Enchant display names have no i18n pipeline before this picker (EnchantDef.name
// has never rendered), so enchantNameKey names the FIRST render sink key for the
// thin consumer to resolve; never raw def.name.
//
// DOM/Three-free (registered in tests/architecture.test.ts UI_PURE_CORES).

import { ENCHANTS } from '../sim/content/enchants';
import { ITEMS } from '../sim/data';
import { isEnchantedInstance, replaceVictimIndex } from '../sim/professions/enchanting';
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

/** The replace facts one flagged target row carries (#2415), everything the
 *  confirm dialog needs to name what is being destroyed BEFORE the command is
 *  sent. Marker victims carry the doomed enchant's id; LEGACY pre-marker
 *  victims (bare rolled.stats, no marker) have no id to name, so they carry
 *  the raw baked stats being replaced instead. */
export interface EnchantReplaceTargetInfo {
  /** Enchant id on the pinned victim copy; undefined for a legacy victim. */
  enchantId?: string;
  /** The raw stats being destroyed on a LEGACY victim (its whole rolled.stats
   *  map, which on a pre-marker copy IS the old enchant). */
  stats?: Record<string, number>;
  /** The picked enchant is already on the victim: the row paints DISABLED (a
   *  confirm whose accept the sim denies same_enchant is never offered). */
  sameEnchant: boolean;
}

/** The replace facts for one already-enchanted victim payload, or undefined
 *  when the copy is not replaceable: a marker id that no longer resolves
 *  cannot be subtracted exactly, so the sim refuses it (the defensive
 *  already_enchanted arm) and the picker must not offer it. Mirrors the sim's
 *  replace-arm validity gates one for one. */
function replaceInfoFor(
  victim: ItemInstancePayload,
  enchantId: string,
): EnchantReplaceTargetInfo | undefined {
  if (victim.enchant !== undefined) {
    if (!ENCHANTS[victim.enchant]) return undefined;
    return { enchantId: victim.enchant, sameEnchant: victim.enchant === enchantId };
  }
  return { stats: { ...victim.rolled?.stats }, sameEnchant: false };
}

export interface EnchantTargetRow {
  itemId: string;
  /** How many eligible copies are held: enchantable copies for a plain row,
   *  already-enchanted copies for a replace row. */
  count: number;
  /** Present iff this is a flagged REPLACE row (#2415): the target copies are
   *  already enchanted, activation runs the confirm dialog, and the apply is
   *  sent with confirmReplace. Describes the PINNED victim (the sim's
   *  replaceVictimIndex choice), so what the dialog names is exactly what a
   *  confirmed apply destroys. */
  replace?: EnchantReplaceTargetInfo;
}

/** The distinct held items eligible as the enchant target: def slot matches the
 *  enchant's itemSlot and at least one ENCHANTABLE copy is held. Mirrors the
 *  sim's ctx.countEnchantableItem: a plain fungible copy or a non-already-
 *  enchanted instanced copy qualifies, so a masterwork or signed copy stays
 *  eligible while an already-enchanted copy never applies silently.
 *  Already-enchanted copies surface as FLAGGED replace rows (#2415) appended
 *  after the plain rows, each describing the pinned victim the sim would
 *  consume (replaceVictimIndex, the same function the sim's replace arm
 *  walks). Grouped by item id (the apply command is itemId-keyed), each family
 *  in first-seen inventory order. */
export function enchantTargets(
  inventory: readonly InvSlot[],
  enchantId: string,
): EnchantTargetRow[] {
  const enchant = ENCHANTS[enchantId];
  if (!enchant) return [];
  const byItem = new Map<string, number>();
  const enchantedByItem = new Map<string, number>();
  for (const slot of inventory) {
    const def = ITEMS[slot.itemId];
    if (!def || def.slot !== enchant.itemSlot) continue;
    if (slot.instance && isEnchantedInstance(slot.instance)) {
      enchantedByItem.set(slot.itemId, (enchantedByItem.get(slot.itemId) ?? 0) + slot.count);
      continue;
    }
    byItem.set(slot.itemId, (byItem.get(slot.itemId) ?? 0) + slot.count);
  }
  const rows: EnchantTargetRow[] = [...byItem].map(([itemId, count]) => ({ itemId, count }));
  for (const [itemId, count] of enchantedByItem) {
    const victimIdx = replaceVictimIndex(inventory, itemId);
    const victim = victimIdx >= 0 ? inventory[victimIdx].instance : undefined;
    if (!victim) continue;
    const replace = replaceInfoFor(victim, enchantId);
    if (!replace) continue;
    rows.push({ itemId, count, replace });
  }
  return rows;
}

export interface WornEnchantTargetRow {
  itemId: string;
  /** The exact equipment key this copy is worn in, and the discriminator the
   *  apply command carries: ring1/ring2 and mainhand/offhand can be wearing
   *  identical copies of one item id, so the id alone cannot name the target. */
  slot: EquipSlot;
  /** Present iff the worn copy is already enchanted (#2415): a flagged REPLACE
   *  row, confirm-gated exactly like the bagged family. No victim pin is
   *  needed here: the slot IS the discriminator. */
  replace?: EnchantReplaceTargetInfo;
}

/** The WORN copies eligible as the enchant target, one row per equipment slot,
 *  in ALL_EQUIP_SLOTS order. Mirrors the sim's worn arm
 *  (src/sim/professions/enchanting.ts resolveApplyEnchantWorn) gate for gate: the
 *  worn item's def slot must match the enchant's itemSlot. An ABSENT payload is
 *  a plain worn copy and stays eligible; a signed or masterwork payload is not
 *  "enchanted" and stays eligible too, exactly as in the bags. An
 *  already-enchanted worn copy surfaces as a FLAGGED replace row (#2415)
 *  rather than being hidden, in the same slot-order pass. Both rings and both
 *  hands list separately when each holds an eligible copy, since each is its
 *  own target.
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
    if (instance && isEnchantedInstance(instance)) {
      const replace = replaceInfoFor(instance, enchantId);
      if (replace) rows.push({ itemId, slot, replace });
      continue;
    }
    rows.push({ itemId, slot });
  }
  return rows;
}
