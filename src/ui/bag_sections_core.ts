// Sub-headings for the bag grid: the pure decision of which captions a derived
// bag list shows and which stacks sit under each one.
//
// Three views get structure (the inventory UX research, "Show structure"):
// - Weapons and Armor group by equipment slot (One-Hand, Two-Hand, Off Hand;
//   Helmet, Shoulder, Chest), in the paperdoll order the Sort button already
//   stamps into the real cells (ALL_EQUIP_SLOTS, src/sim/inventory_sort.ts), so
//   the captions read in the same order a tidied bag does.
// - Favorites groups by saved loadout gear set ("Tank set"), then the locked
//   copies no set names (bag_gear_sets_core.ts).
// - All, only while the player turns Sections on, groups by category with the
//   slot captions nested under Weapons and Armor.
//
// Every other view keeps the soft Quest caption it always had
// (bags_view.ts buildBagListRows), mapped onto the same row shape here, so the
// painter has one row loop.
//
// A caption is never a bag cell. Sections are a view over a DERIVED list, so the
// pristine All grid (the real cells a player arranges by hand) is untouched while
// Sections is off, and turning it on makes All a list like any filtered view.
//
// DOM/Three-free (registered in tests/architecture.test.ts UI_PURE_CORES).

import { weaponHand } from '../sim/equipment_rules';
import { isItemLocked } from '../sim/item_lock_flag';
import type { InvSlot, ItemDef } from '../sim/types';
import { BAG_CATEGORY_LABEL_KEYS } from './bag_category_labels';
import {
  type BagCategory,
  type BagFilterState,
  type ItemLookup,
  matchesCategory,
} from './bag_filter';
import type { BagGearSetIndex } from './bag_gear_sets_core';
import { buildBagListRows } from './bags_view';
import type { TranslationKey } from './i18n.catalog';
import { ITEM_SLOT_LABEL_KEYS } from './item_slot_labels';

/** Equipment-slot caption groups, in display order. Weapons split by hand; every
 *  other group is the slot the item declares (rings as one Finger group). */
export const BAG_SLOT_GROUPS = [
  'onehand',
  'mainhand',
  'twohand',
  'offhand',
  'helmet',
  'neck',
  'shoulder',
  'chest',
  'waist',
  'legs',
  'gloves',
  'feet',
  'ring',
  'trinket',
  'other',
] as const;
export type BagSlotGroup = (typeof BAG_SLOT_GROUPS)[number];

/** Category caption order for the All view's Sections mode. Junk sits last: it is
 *  the pile a player walks to a vendor with, not something they look for. */
export const BAG_SECTION_CATEGORIES = [
  'weapon',
  'armor',
  'consumable',
  'material',
  'quest',
  'tool',
  'mount',
  'other',
  'junk',
] as const;
export type BagSectionCategory = (typeof BAG_SECTION_CATEGORIES)[number];

export type BagSectionKey =
  | { kind: 'category'; category: BagSectionCategory }
  | { kind: 'slot'; group: BagSlotGroup }
  | { kind: 'gearSet'; setIndex: number }
  | { kind: 'locked' };

/** One painted row: a caption (level 1, or 2 when nested under a category) or a stack. */
export type BagSectionRow =
  | { kind: 'section'; level: 1 | 2; key: BagSectionKey }
  | { kind: 'stack'; slot: InvSlot };

/** The caption group an equippable item falls under, or null for non-gear. */
export function bagSlotGroup(item: ItemDef): BagSlotGroup | null {
  if (item.kind === 'weapon') return weaponHand(item) ?? 'onehand';
  if (item.kind !== 'armor' && item.kind !== 'held_offhand') return null;
  const slot = item.slot;
  if (!slot) return 'other';
  return (BAG_SLOT_GROUPS as readonly string[]).includes(slot) ? (slot as BagSlotGroup) : 'other';
}

/** Which caption category a stack joins in the All view's Sections mode. Junk
 *  is asked first so a grey sword sits with the rest of the vendor pile. An
 *  unknown id (a bundle behind the server, R34) joins Other: it holds a real,
 *  counted slot, so it must stay visible. */
export function bagSectionCategory(item: ItemDef | undefined, slot: InvSlot): BagSectionCategory {
  if (!item) return 'other';
  if (matchesCategory(item, 'junk', slot)) return 'junk';
  for (const category of BAG_SECTION_CATEGORIES) {
    if (category === 'other' || category === 'junk') continue;
    if (matchesCategory(item, category, slot)) return category;
  }
  return 'other';
}

/** Whether Sections turns the All view into a derived list (the real cells are
 *  painted only while it is off). Every other view is a list already. */
export function bagSectionsReplaceCells(filter: BagFilterState, sectionsOn: boolean): boolean {
  return sectionsOn && filter.category === 'all';
}

/** Tolerant read of the persisted Sections toggle: only the exact 'on' turns it
 *  on, so a missing or corrupt value keeps today's hand-arranged All grid. */
export function parseBagSectionsPref(raw: string | null | undefined): boolean {
  return raw === 'on';
}

export interface BagSectionOptions {
  /** The player's Sections toggle (All view only). */
  sectionsOn: boolean;
  gearSets: BagGearSetIndex;
}

/** Push `slots` grouped by slot caption, in BAG_SLOT_GROUPS order, keeping each
 *  group's relative order. Stacks without a slot group are appended uncaptioned. */
function pushSlotGroups(
  rows: BagSectionRow[],
  slots: readonly InvSlot[],
  lookup: ItemLookup,
  level: 1 | 2,
): void {
  const groups = new Map<BagSlotGroup, InvSlot[]>();
  const loose: InvSlot[] = [];
  for (const slot of slots) {
    const item = lookup(slot.itemId);
    const group = item ? bagSlotGroup(item) : null;
    if (group === null) {
      loose.push(slot);
      continue;
    }
    const list = groups.get(group);
    if (list) list.push(slot);
    else groups.set(group, [slot]);
  }
  for (const group of BAG_SLOT_GROUPS) {
    const list = groups.get(group);
    if (!list) continue;
    rows.push({ kind: 'section', level, key: { kind: 'slot', group } });
    for (const slot of list) rows.push({ kind: 'stack', slot });
  }
  for (const slot of loose) rows.push({ kind: 'stack', slot });
}

function favouriteRows(
  visible: readonly InvSlot[],
  gearSets: BagGearSetIndex,
): BagSectionRow[] | null {
  const perSet: InvSlot[][] = gearSets.sets.map(() => []);
  const lockedOnly: InvSlot[] = [];
  for (const slot of visible) {
    const sets = gearSets.setsFor(slot);
    // A copy two sets name shows under both: each caption lists its whole set.
    for (const setIndex of sets) perSet[setIndex]?.push(slot);
    if (sets.length === 0 && isItemLocked(slot.instance)) lockedOnly.push(slot);
  }
  // No set names anything held: the plain locked list, with no lone caption.
  if (perSet.every((list) => list.length === 0)) return null;
  const rows: BagSectionRow[] = [];
  perSet.forEach((list, setIndex) => {
    if (list.length === 0) return;
    rows.push({ kind: 'section', level: 1, key: { kind: 'gearSet', setIndex } });
    for (const slot of list) rows.push({ kind: 'stack', slot });
  });
  if (lockedOnly.length > 0) {
    rows.push({ kind: 'section', level: 1, key: { kind: 'locked' } });
    for (const slot of lockedOnly) rows.push({ kind: 'stack', slot });
  }
  return rows;
}

function categoryRows(visible: readonly InvSlot[], lookup: ItemLookup): BagSectionRow[] {
  const groups = new Map<BagSectionCategory, InvSlot[]>();
  for (const slot of visible) {
    const category = bagSectionCategory(lookup(slot.itemId), slot);
    const list = groups.get(category);
    if (list) list.push(slot);
    else groups.set(category, [slot]);
  }
  const rows: BagSectionRow[] = [];
  for (const category of BAG_SECTION_CATEGORIES) {
    const list = groups.get(category);
    if (!list) continue;
    rows.push({ kind: 'section', level: 1, key: { kind: 'category', category } });
    if (category === 'weapon' || category === 'armor') pushSlotGroups(rows, list, lookup, 2);
    else for (const slot of list) rows.push({ kind: 'stack', slot });
  }
  return rows;
}

/** The rows a derived bag list paints, captions included. `visible` is the
 *  already filtered and sorted list (applyBagFilter), so a sort still orders the
 *  stacks inside each caption. Never drops or invents a stack, except that a copy
 *  two gear sets name is listed under both. */
export function buildBagSectionRows(
  visible: readonly InvSlot[],
  lookup: ItemLookup,
  filter: BagFilterState,
  opts: BagSectionOptions,
): BagSectionRow[] {
  const category: BagCategory = filter.category;
  if (category === 'weapon' || category === 'armor') {
    const rows: BagSectionRow[] = [];
    pushSlotGroups(rows, visible, lookup, 1);
    return rows;
  }
  if (category === 'favourite') {
    const rows = favouriteRows(visible, opts.gearSets);
    if (rows) return rows;
  }
  if (bagSectionsReplaceCells(filter, opts.sectionsOn)) return categoryRows(visible, lookup);
  return buildBagListRows(visible, lookup, filter).map((row) =>
    row.kind === 'section'
      ? { kind: 'section', level: 1, key: { kind: 'category', category: row.section } }
      : row,
  );
}

const SLOT_GROUP_LABEL_KEYS: Record<BagSlotGroup, TranslationKey> = {
  onehand: 'hudChrome.bags.sectionOneHand',
  mainhand: 'itemUi.slots.mainhand',
  twohand: 'itemUi.slots.twoHand',
  offhand: ITEM_SLOT_LABEL_KEYS.offhand,
  helmet: ITEM_SLOT_LABEL_KEYS.helmet,
  neck: ITEM_SLOT_LABEL_KEYS.neck,
  shoulder: ITEM_SLOT_LABEL_KEYS.shoulder,
  chest: ITEM_SLOT_LABEL_KEYS.chest,
  waist: ITEM_SLOT_LABEL_KEYS.waist,
  legs: ITEM_SLOT_LABEL_KEYS.legs,
  gloves: ITEM_SLOT_LABEL_KEYS.gloves,
  feet: ITEM_SLOT_LABEL_KEYS.feet,
  ring: ITEM_SLOT_LABEL_KEYS.ring,
  trinket: ITEM_SLOT_LABEL_KEYS.trinket,
  other: 'hudChrome.bags.sectionOther',
};

/** What a caption says: a catalog key, or the player's own loadout name (raw
 *  player text, escaped by the painter, never routed through t()). A set with a
 *  blank name falls back to a numbered key. */
export type BagSectionLabel =
  | { key: TranslationKey; values?: Record<string, string | number> }
  | { text: string };

export function bagSectionLabel(key: BagSectionKey, gearSets: BagGearSetIndex): BagSectionLabel {
  switch (key.kind) {
    case 'category':
      return {
        key:
          key.category === 'other'
            ? 'hudChrome.bags.sectionOther'
            : BAG_CATEGORY_LABEL_KEYS[key.category],
      };
    case 'slot':
      return { key: SLOT_GROUP_LABEL_KEYS[key.group] };
    case 'locked':
      return { key: 'hudChrome.bags.sectionLocked' };
    case 'gearSet': {
      const set = gearSets.sets[key.setIndex];
      const name = set?.name.trim() ?? '';
      if (name !== '') return { text: name };
      return {
        key: 'hudChrome.bags.sectionGearSetFallback',
        values: { n: (set?.loadoutIndex ?? key.setIndex) + 1 },
      };
    }
  }
}

/** The stable class suffix for a caption, so the stylesheet can tint the Quest
 *  and Junk captions and a test can find one caption by name. */
export function bagSectionClass(key: BagSectionKey): string {
  switch (key.kind) {
    case 'category':
      return `bag-section-${key.category}`;
    case 'slot':
      return `bag-section-slot-${key.group}`;
    case 'gearSet':
      return 'bag-section-gearset';
    case 'locked':
      return 'bag-section-locked';
  }
}
