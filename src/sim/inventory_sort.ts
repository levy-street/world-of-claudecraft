// One-shot bag clean-up (the classic "sort bags" button): consolidate partial
// stacks, then restamp every stack's persisted cell hint (InvSlot.slot, see
// inventory_order.ts) so the grid reads weapons, armor, bags, consumables,
// tools, mounts, materials, quest items, and gray trash last, with every
// stack of an item adjacent and a fine material grade sitting beside its base
// grade (professions/material_grades.ts is what links fine_elderwood_log to
// elderwood_log; the two share quality 'common', so no quality view can group
// them on its own).
//
// The sort REWRITES CELL HINTS, NEVER THE ARRAY. The inventory array's order
// is load-bearing far beyond the grid (the removal walks in bags.ts and the
// Sim hub run from the array's end, and 'recent' recency IS array order), so
// rearranging it would quietly change which copy a vendor sale or a craft
// consumes. Restamping hints moves every square the player sees while leaving
// all of that untouched; consolidation is the one array mutation (an emptied
// donor stack is spliced out), and it only ever removes entries.
//
// Consolidation obeys the ONE stacking rule every other site obeys: same
// itemId, same plain-stack craftedRecipeId marker, payloads mergeable under
// canStackInstancePayloads (item_instance_merge.ts), capped at stackSizeOf
// (bags.ts). A charge-bearing payload never merges, a plain stack never
// absorbs an instanced copy, and no unit is ever created or destroyed.
//
// Pure leaf on the inventory_order.ts model: no SimContext, no content-table
// import (the item table rides in as an injected lookup), no rng, no clock,
// so a Vitest imports it directly and the sim's command body (items.ts
// sortInventory) passes ITEMS. Deterministic by construction: the comparator
// is a fixed key chain over the item defs, ties keep array order (spec-stable
// sort plus an explicit index tiebreak), so the same inventory always lands
// in the same cells on every host.

import { canStackInstancePayloads, isMergeableInstancePayload } from './item_instance_merge';
import type { Quality } from './loot_master';
import { baseMaterialFor } from './professions/material_grades';
import { ALL_EQUIP_SLOTS, type InvSlot, type ItemDef, type ItemKind } from './types';

/** Item-table access, injected so tests drive synthetic defs and the leaf
 *  never imports data.ts (the command body passes the merged ITEMS table). */
export type ItemDefLookup = (itemId: string) => ItemDef | undefined;

/** The stack facts the comparator reads: satisfied by InvSlot and by the bank
 *  window's BankSlotModel, so the bags/bank quality and name list views can
 *  share this ordering as their tiebreak. */
export interface SortableStack {
  itemId: string;
  count: number;
}

// The clean-up ladder. Gear leads (weapons, then armor by paperdoll slot,
// then held offhands and unequipped bags), consumables next (potions before
// elixirs before food and drink), then tools and mount reins, then the junk
// kind (every material lives there; gray vendor trash is hoisted out below),
// then quest items where they are easy to find, and poor-quality trash dead
// last so the sell-all-junk sweep reads straight off the bag's tail.
// Record<ItemKind, number> deliberately: a new kind fails to compile until it
// is given a rank here, instead of silently sorting after gray trash.
const KIND_RANK: Record<ItemKind, number> = {
  weapon: 0,
  armor: 1,
  held_offhand: 2,
  bag: 3,
  potion: 4,
  elixir: 5,
  food: 6,
  drink: 7,
  tool: 8,
  mount: 9,
  junk: 10,
  quest: 11,
};
const TRASH_RANK = 12; // any poor-quality item, regardless of kind
// The two defensive tails are DISTINCT ranks on purpose (comparator
// transitivity): a missing-def stack compares by raw id while a known def
// compares by the name/quality chain, and if the two populations could tie on
// category the mixed bucket would order inconsistently (an intransitive
// comparator makes Array.prototype.sort implementation-defined, a cross-host
// hazard). Distinct ranks mean the buckets never meet in a tie.
const UNRANKED_KIND_RANK = 13; // a known def whose kind escaped KIND_RANK (unreachable while the Record is total)
const MISSING_DEF_RANK = 14; // a def the lookup cannot resolve (defensive; the sim's table is complete)

// Lower rank sorts first, so the grid reads legendary down to poor. Mirrors
// the UI's bag_filter.ts ranks. Record<Quality, number> for the same reason
// KIND_RANK is total above: a new quality tier fails to compile until it is
// ranked here, instead of silently landing mid-ladder. (This is the DISPLAY
// ladder, descending; loot_master.ts owns the ascending threshold ladder.)
const QUALITY_RANK: Record<Quality, number> = {
  legendary: 0,
  epic: 1,
  rare: 2,
  uncommon: 3,
  common: 4,
  poor: 5,
};

function qualityRankOf(def: ItemDef): number {
  return QUALITY_RANK[def.quality ?? 'common'];
}

function categoryRankOf(def: ItemDef | undefined): number {
  if (!def) return MISSING_DEF_RANK;
  if ((def.quality ?? 'common') === 'poor') return TRASH_RANK;
  return KIND_RANK[def.kind] ?? UNRANKED_KIND_RANK;
}

// Paperdoll position for gear kinds, so armor groups helmet-to-feet the way
// the character sheet reads. An item declares 'ring' (never ring1/ring2); it
// sorts at the first ring position. Non-gear defs all rank 0 (the kind ladder
// already separated them).
function slotRankOf(def: ItemDef): number {
  if (!def.slot) return 0;
  const slot = def.slot === 'ring' ? 'ring1' : def.slot;
  const rank = ALL_EQUIP_SLOTS.indexOf(slot);
  return rank >= 0 ? rank : ALL_EQUIP_SLOTS.length;
}

// The adjacency group: a fine material grade shares its BASE material's name
// key, so fine_elderwood_log and elderwood_log sit together no matter what
// their own names alphabetize to. Everything else groups by its own name.
// Returns [groupName, gradeRank]: the fine grade leads its base (premium
// first, the way higher quality leads everywhere else in the ladder).
function familyKeyOf(itemId: string, def: ItemDef, lookup: ItemDefLookup): [string, number] {
  const baseId = baseMaterialFor(itemId);
  if (baseId !== undefined) return [lookup(baseId)?.name ?? baseId, 0];
  return [def.name, 1];
}

// Deterministic code-unit string order. Deliberately NOT localeCompare: the
// comparator runs inside the sim on both hosts, and localeCompare's answer
// depends on the host's collation tables. Item names are English ASCII, and
// the grid order keys on the ENGLISH content name for every locale on
// purpose: a per-locale order would break cross-host determinism (the server
// has no locale), so do not "fix" this into localeCompare or a localized
// name lookup.
function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** The canonical clean-up ordering over two stacks. Total and deterministic:
 *  category ladder, paperdoll slot, quality (best first), family name (fine
 *  grades grouped under their base material), fine grade before base, item
 *  id, fuller stacks first. Ties (same id, same count, e.g. two distinct
 *  instanced copies) return 0 and keep their relative array order. */
export function compareBagStacks(
  a: SortableStack,
  b: SortableStack,
  lookup: ItemDefLookup,
): number {
  const defA = lookup(a.itemId);
  const defB = lookup(b.itemId);
  const category = categoryRankOf(defA) - categoryRankOf(defB);
  if (category !== 0) return category;
  if (!defA || !defB) return compareStrings(a.itemId, b.itemId);
  const slot = slotRankOf(defA) - slotRankOf(defB);
  if (slot !== 0) return slot;
  const quality = qualityRankOf(defA) - qualityRankOf(defB);
  if (quality !== 0) return quality;
  const [familyA, gradeA] = familyKeyOf(a.itemId, defA, lookup);
  const [familyB, gradeB] = familyKeyOf(b.itemId, defB, lookup);
  const family = compareStrings(familyA, familyB);
  if (family !== 0) return family;
  const grade = gradeA - gradeB;
  if (grade !== 0) return grade;
  const id = compareStrings(a.itemId, b.itemId);
  if (id !== 0) return id;
  return b.count - a.count;
}

/** Merge partial stacks in place: each stack tops up from every later stack
 *  it may legally share a slot with (same itemId, same craftedRecipeId
 *  marker, canStackInstancePayloads), up to `stackCap(def)`; an emptied donor
 *  is spliced out. Walks in array order, so which copy survives is
 *  deterministic. Legacy overstacked entries are never split (they only ever
 *  shrink by donating). */
export function consolidateBagStacks(
  inventory: InvSlot[],
  lookup: ItemDefLookup,
  stackCap: (def: ItemDef | undefined) => number,
): void {
  for (let i = 0; i < inventory.length; i++) {
    const target = inventory[i];
    // A corrupt persisted count (non-positive, fractional, or non-finite) is
    // INERT on both sides of a merge: as a target it would absorb honest
    // units into its deficit (10 poured into a -3 leaves 7, three real items
    // gone) or poison the survivor (NaN propagates through +=), and as a
    // donor (guarded below) a bad take would shrink or poison the survivor.
    if (!Number.isInteger(target.count) || target.count <= 0) continue;
    if (!isMergeableInstancePayload(target.instance)) continue;
    const cap = stackCap(lookup(target.itemId));
    for (let j = i + 1; j < inventory.length && target.count < cap; j++) {
      const donor = inventory[j];
      if (
        donor.itemId !== target.itemId ||
        donor.craftedRecipeId !== target.craftedRecipeId ||
        // A corrupt count (non-positive, fractional, or non-finite) must never
        // DONATE (a negative take would shrink the survivor while vanishing
        // the donor at zero; NaN would poison it).
        !Number.isInteger(donor.count) ||
        donor.count <= 0 ||
        !canStackInstancePayloads(target.instance, donor.instance)
      )
        continue;
      const take = Math.min(cap - target.count, donor.count);
      target.count += take;
      donor.count -= take;
      if (donor.count <= 0) {
        inventory.splice(j, 1);
        j--;
      }
    }
  }
}

/** The whole clean-up: consolidate, then restamp every stack's cell hint to
 *  its canonical position (0..n-1, holes closed). The array order itself is
 *  never rearranged (see the header for why); layoutBagCells turns the new
 *  hints into the grid, and new loot (which carries no hint) flows into the
 *  first cell past the sorted block. Idempotent: a second call merges
 *  nothing and stamps identical hints. A legacy over-capacity save keeps its
 *  tolerated overflow: the first `capacity` sorted ranks fill the grid and
 *  layoutBagCells appends the rest past it in ARRAY order (total and
 *  lossless; the tail is not a grid position and is not itself sorted). */
export function sortInventoryStacks(
  inventory: InvSlot[],
  lookup: ItemDefLookup,
  stackCap: (def: ItemDef | undefined) => number,
): void {
  consolidateBagStacks(inventory, lookup, stackCap);
  const ranked = inventory.map((stack, index) => ({ stack, index }));
  ranked.sort((a, b) => compareBagStacks(a.stack, b.stack, lookup) || a.index - b.index);
  for (let cell = 0; cell < ranked.length; cell++) ranked[cell].stack.slot = cell;
}
