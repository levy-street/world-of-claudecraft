// The Collections window's pure view model: the three tabs (Buddies, Mounts,
// Item Sets) resolved into rows, with every row's sources derived by
// collection_sources.ts rather than authored a second time here.
//
// DOM-free and i18n-free on purpose (the painter localizes; this half is what
// tests/collections_view.test.ts drives directly). It reads only static content
// tables plus the caller's owned-key sets, so it is safe to rebuild whenever the
// window opens and cheap enough to rebuild on a tab switch.

import { BUDDIES, BUDDY_KEYS, type BuddyKey, type BuddyKind } from '../../sim/content/buddies';
import { BUDDY_MOBS, buddyTemplateId } from '../../sim/content/buddy_mobs';
import { MOUNTS, type MountKey } from '../../sim/content/mounts';
import { ITEM_SETS, ITEMS } from '../../sim/data';
import { itemLevel } from '../../sim/item_level';
import type { ArmorType, ItemDef } from '../../sim/types';
import { type CollectionItemFacts, collectionItemFacts } from './collection_sources';

export type CollectionsTabId = 'buddies' | 'mounts' | 'sets';

export const COLLECTIONS_TABS: readonly CollectionsTabId[] = ['buddies', 'mounts', 'sets'];

/** What a companion IS, the buddy tab's outer grouping: the catalog's own
 *  authored kind when it carries one, else derived from the follower's mob
 *  family (content/buddy_mobs.ts). Everything that is not a walking corpse or
 *  a person derives as a beast, spiders and raptors included. */
export type CollectionPetKind = BuddyKind;

/** Pet kinds in the order the tab lists them: the creature groups first, by
 *  how ordinary they are, and the guest characters last. */
export const COLLECTION_PET_KINDS: readonly CollectionPetKind[] = [
  'beast',
  'elemental',
  'humanoid',
  'undead',
  'celebrity',
];

/** Rarity order INSIDE a kind: purple first, then blue, green, white. The
 *  catalog has no grey (poor) whistle and must not grow one: greys were folded
 *  into white by the same 2026-09-04 call that set this order, so anything
 *  unranked sorts as common rather than inventing a fifth rung. */
export const COLLECTION_RARITY_ORDER: readonly string[] = ['epic', 'rare', 'uncommon', 'common'];

/** The grouping a mob FAMILY implies, the fallback when the catalog authors
 *  none. It can never return an editorial group: no family means celebrity,
 *  and elemental buddies are authored rather than inferred, because the two
 *  elemental rigs are a beast and a critter body to the sim. */
export function petKindOf(family: string): CollectionPetKind {
  if (family === 'undead') return 'undead';
  if (family === 'humanoid') return 'humanoid';
  return 'beast';
}

/** The group a companion sits in: authored first, family second. */
export function buddyKindOf(key: BuddyKey): CollectionPetKind {
  const authored = BUDDIES[key]?.kind;
  if (authored) return authored;
  return petKindOf(BUDDY_MOBS[buddyTemplateId(key)]?.family ?? 'beast');
}

/** Sort rank of a quality on the tab: lower sorts first. A quality the ladder
 *  does not name (a grey, were one ever authored) ranks with white. */
export function rarityRank(quality: string): number {
  const i = COLLECTION_RARITY_ORDER.indexOf(quality);
  return i < 0 ? COLLECTION_RARITY_ORDER.indexOf('common') : i;
}

/** One buddy or mount row. */
export interface CollectionEntryView {
  /** BuddyKey or MountKey: the row's stable identity and its i18n stem. */
  key: string;
  /** Canonical English name, for the painter's i18n fallback. */
  name: string;
  /** The item that grants it (a whistle or reins), or null when the catalog
   *  carries the creature but no item names it yet. */
  itemId: string | null;
  quality: string;
  /** The renderer visual key for the idle preview, or null when the entry has
   *  no dedicated rig. */
  visualKey: string | null;
  /** Null exactly when itemId is null: an entry with no item has no source,
   *  no price and no bind state to report. */
  facts: CollectionItemFacts | null;
  /** Which of the three buddy groups this row sits in. Mount rows carry
   *  'beast' and never use it: only the buddy tab groups. */
  petKind: CollectionPetKind;
  /** The follower's entity dye (content/buddy_mobs.ts). Inert on a rig with
   *  baked textures, and the whole colour on a shared animal or skeleton rig,
   *  which is exactly how the world draws it. */
  tint: number;
  /** True when the viewer owns the granting item. */
  owned: boolean;
  /** False when nothing in the game grants this entry today; the window says
   *  so rather than hiding the row. */
  obtainable: boolean;
}

/** The primary stat an epic set is itemized around. 'mixed' is a real answer
 *  (a hybrid family), never a fallback for missing data. */
export type CollectionSetStat = 'intellect' | 'agility' | 'strength' | 'mixed';

export interface CollectionSetPieceView {
  itemId: string;
  name: string;
  /** Item level, the tab's sort key. Undefined for a piece the level index
   *  does not rank (jewelry and cosmetics carry none). */
  itemLevel: number | undefined;
  facts: CollectionItemFacts | null;
  owned: boolean;
}

export interface CollectionSetView {
  setId: string;
  name: string;
  armorType: ArmorType;
  stat: CollectionSetStat;
  quality: string;
  /** The family's item level: the highest its pieces reach, which is what a
   *  player compares two sets by. Undefined only when no piece ranks. */
  itemLevel: number | undefined;
  pieces: CollectionSetPieceView[];
  /** Pieces the viewer owns, of pieces.length. */
  ownedCount: number;
  /** The authored set bonuses, ascending, each with the piece count it wants
   *  and whether the viewer already OWNS that many. Ownership, not equipped:
   *  this window is a collection ledger, and the tooltip is where a worn-set
   *  answer belongs. */
  bonuses: CollectionSetBonusView[];
}

export interface CollectionSetBonusView {
  pieces: number;
  owned: boolean;
}

/** Sets grouped the way the window shows them: armor type, then primary stat. */
export interface CollectionSetGroupView {
  armorType: ArmorType;
  stat: CollectionSetStat;
  sets: CollectionSetView[];
}

/** One heading of the buddy tab: a pet kind and the rows under it, already
 *  in rarity order. */
export interface CollectionPetGroupView {
  kind: CollectionPetKind;
  entries: CollectionEntryView[];
}

export interface CollectionsView {
  /** Every buddy in one list, kind then rarity: the flat read the preview
   *  and the selection default still want. */
  buddies: CollectionEntryView[];
  /** The same rows split into their headings, which is what the tab paints. */
  buddyGroups: CollectionPetGroupView[];
  mounts: CollectionEntryView[];
  setGroups: CollectionSetGroupView[];
}

/** Armor types in the window's authored order (the tab's outer grouping). */
export const COLLECTION_ARMOR_TYPES: readonly ArmorType[] = ['cloth', 'mail', 'leather'];
/** Stats in the window's authored order (the inner grouping under each type). */
export const COLLECTION_SET_STATS: readonly CollectionSetStat[] = [
  'intellect',
  'agility',
  'strength',
  'mixed',
];

/** Item ids of every set the quality gate admits: epic or better. */
const SET_QUALITY_FLOOR = new Set(['epic', 'legendary']);

function itemsBySet(setId: string): ItemDef[] {
  return Object.values(ITEMS).filter((item) => item.set === setId);
}

/** The whistle that summons a buddy, resolved from the item table rather than
 *  from a naming convention, so a renamed item id cannot silently orphan a row. */
function buddyItemId(key: BuddyKey): string | null {
  const item = Object.values(ITEMS).find((def) => def.kind === 'buddy' && def.buddy === key);
  return item?.id ?? null;
}

function mountItemId(key: MountKey): string | null {
  const item = Object.values(ITEMS).find((def) => def.kind === 'mount' && def.mount === key);
  return item?.id ?? null;
}

/** The stat identity of a set: whichever primary stat its pieces carry most of.
 *  A family whose top two stats tie is 'mixed', which is a hybrid, not a gap. */
export function setPrimaryStat(pieces: readonly ItemDef[]): CollectionSetStat {
  const totals = { intellect: 0, agility: 0, strength: 0 };
  for (const piece of pieces) {
    totals.intellect += piece.stats?.int ?? 0;
    totals.agility += piece.stats?.agi ?? 0;
    totals.strength += piece.stats?.str ?? 0;
  }
  const ranked = (Object.entries(totals) as [Exclude<CollectionSetStat, 'mixed'>, number][]).sort(
    (a, b) => b[1] - a[1],
  );
  if (ranked[0][1] === 0) return 'mixed';
  if (ranked[0][1] === ranked[1][1]) return 'mixed';
  return ranked[0][0];
}

/** The armor class a set is worn by: the class its pieces agree on. A family
 *  whose pieces disagree (or that carries no armor at all) is not an armor set
 *  and is left out of the tab entirely by buildCollectionsView. */
export function setArmorType(pieces: readonly ItemDef[]): ArmorType | null {
  const types = new Set(
    pieces.map((piece) => piece.armorType).filter((type): type is ArmorType => !!type),
  );
  return types.size === 1 ? [...types][0] : null;
}

function entryFor(
  key: string,
  name: string,
  itemId: string | null,
  visualKey: string | null,
  ownedKeys: ReadonlySet<string>,
  petKind: CollectionPetKind = 'beast',
  tint = 0xffffff,
): CollectionEntryView {
  const facts = itemId ? collectionItemFacts(itemId) : null;
  return {
    key,
    name,
    itemId,
    quality: facts?.quality ?? 'common',
    visualKey,
    facts,
    petKind,
    tint,
    owned: ownedKeys.has(key),
    obtainable: facts?.obtainable ?? false,
  };
}

export interface CollectionsViewInput {
  /** Buddy keys the viewer owns (IWorld.ownedBuddies): ownership IS the whistle
   *  sitting in bags or bank, which the sim already resolves for both worlds. */
  ownedBuddyKeys: ReadonlySet<string>;
  /** Mount keys the viewer owns (IWorld.ownedMounts), same model as above. */
  ownedMountKeys: ReadonlySet<string>;
  /** Item ids the viewer carries or wears, for the set tab's per-piece marks.
   *  Set pieces are ordinary gear, so there is no key-level ownership read. */
  ownedItemIds: ReadonlySet<string>;
  /** key -> renderer visual key for the mount rows. Injected rather than
   *  imported so this module stays free of any src/render import. */
  buddyVisualKeys: Readonly<Partial<Record<string, string>>>;
  mountVisualKeys: Readonly<Partial<Record<string, string>>>;
}

export function buildCollectionsView(input: CollectionsViewInput): CollectionsView {
  const buddies = BUDDY_KEYS.map((key) =>
    entryFor(
      key,
      BUDDIES[key].name,
      buddyItemId(key),
      // Resolved by the host through the same lookup the world draws a buddy
      // with, so the preview can never drift from the follower (two buddies
      // share an animal rig rather than shipping one of their own).
      input.buddyVisualKeys[key] ?? null,
      input.ownedBuddyKeys,
      buddyKindOf(key),
      BUDDY_MOBS[buddyTemplateId(key)]?.color ?? 0xffffff,
    ),
  );
  // The tab reads kind first, then rarity, then catalog order: a collector
  // scans for the purple in their group, and the stable third key keeps two
  // whistles of one rarity from swapping places between renders.
  buddies.sort(
    (a, b) =>
      COLLECTION_PET_KINDS.indexOf(a.petKind) - COLLECTION_PET_KINDS.indexOf(b.petKind) ||
      rarityRank(a.quality) - rarityRank(b.quality) ||
      BUDDY_KEYS.indexOf(a.key as BuddyKey) - BUDDY_KEYS.indexOf(b.key as BuddyKey),
  );
  const mounts = (Object.keys(MOUNTS) as MountKey[]).map((key) =>
    entryFor(
      key,
      MOUNTS[key].name,
      mountItemId(key),
      input.mountVisualKeys[key] ?? null,
      input.ownedMountKeys,
    ),
  );

  const sets: CollectionSetView[] = [];
  for (const set of Object.values(ITEM_SETS)) {
    const pieces = itemsBySet(set.id);
    if (pieces.length === 0) continue;
    // Quality floor: the tab is the epic-and-better armor families. A set whose
    // pieces disagree on quality takes its best piece, which is how a family
    // with one lower-tier filler piece still reads as the epic set it is.
    const quality = pieces.some((piece) => piece.quality === 'legendary')
      ? 'legendary'
      : (pieces[0].quality ?? 'common');
    if (!SET_QUALITY_FLOOR.has(quality)) continue;
    const armorType = setArmorType(pieces);
    if (!armorType) continue;
    // Pieces read high item level first, the order a player judges gear in;
    // ties fall back to the id so the list never reshuffles between renders.
    const ordered = [...pieces].sort(
      (a, b) => (itemLevel(b) ?? 0) - (itemLevel(a) ?? 0) || a.id.localeCompare(b.id),
    );
    const levels = pieces
      .map((piece) => itemLevel(piece))
      .filter((n): n is number => n !== undefined);
    const setItemLevel = levels.length > 0 ? Math.max(...levels) : undefined;
    const ownedPieces = ordered.filter((piece) => input.ownedItemIds.has(piece.id)).length;
    sets.push({
      setId: set.id,
      name: set.name,
      armorType,
      stat: setPrimaryStat(pieces),
      quality,
      itemLevel: setItemLevel,
      pieces: ordered.map((piece) => ({
        itemId: piece.id,
        name: piece.name,
        itemLevel: itemLevel(piece),
        facts: collectionItemFacts(piece.id),
        owned: input.ownedItemIds.has(piece.id),
      })),
      ownedCount: ownedPieces,
      bonuses: [...(set.bonuses ?? [])]
        .sort((a, b) => a.pieces - b.pieces)
        .map((tier) => ({ pieces: tier.pieces, owned: ownedPieces >= tier.pieces })),
    });
  }

  const setGroups: CollectionSetGroupView[] = [];
  for (const armorType of COLLECTION_ARMOR_TYPES) {
    for (const stat of COLLECTION_SET_STATS) {
      // Highest item level first inside a heading: the newest raid tier is what
      // a player opens this tab for, and name order buried it among the older
      // families. Name is the tiebreak so equal tiers stay stable.
      const matching = sets
        .filter((set) => set.armorType === armorType && set.stat === stat)
        .sort((a, b) => (b.itemLevel ?? 0) - (a.itemLevel ?? 0) || a.name.localeCompare(b.name));
      if (matching.length > 0) setGroups.push({ armorType, stat, sets: matching });
    }
  }

  const buddyGroups: CollectionPetGroupView[] = COLLECTION_PET_KINDS.map((kind) => ({
    kind,
    entries: buddies.filter((row) => row.petKind === kind),
  })).filter((group) => group.entries.length > 0);

  return { buddies, buddyGroups, mounts, setGroups };
}
