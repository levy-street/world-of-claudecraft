import type { ArticleTools } from './entity_format';
import { itemAcquisitionIndex } from './item_acquisition';
import type { ItemAcquisition } from './item_acquisition_types';

// Groups every way to get an item into a few kinds of source players browse by
// (creature drops, quest rewards, vendors and so on). It reads the same acquisition
// rows the item pages print, so a source list and an item page always agree.

/** Source groups in the order the Items by source page lists them. */
export const SOURCE_ORDER = [
  'Creature drops',
  'Quest rewards',
  'Quest supplies',
  'World quests',
  'World pickups',
  'Vendors',
  'Heroic Marks',
  'Crucible sigil exchange',
  'Lantern Hall contracts',
  'World Market',
  'Crafted',
  'Disenchanting',
  'Gathering',
  'Fishing',
  'Farming',
  'Creature harvesting',
  'Rift first clears',
  'Buried hoards',
  'Treasure hunts',
  'Emissary caches',
  'Delves',
  'Dungeon and raid pickups',
  'Raid gear sundering',
  'Endgame completion rewards',
  'World PvP',
  'Seasonal events',
  'Class abilities',
  'Starting equipment',
  'Membership',
  'Referral rewards',
  'Other sources',
] as const;
export type SourceGroup = (typeof SOURCE_ORDER)[number];

// Each rule reads the start of an acquisition row's title. Titles that say an item
// cannot be had (unavailable, developer-only) belong to no group.
const RULES: [RegExp, SourceGroup | null][] = [
  [/^Defeat /, 'Creature drops'],
  [/^Quest reward /, 'Quest rewards'],
  [/^Supplied for /, 'Quest supplies'],
  [
    /^(Complete the world quest|Complete the rotating world-quest|Rotating world-quest)/,
    'World quests',
  ],
  [/^(World interaction|World pickup|Ferry bell)/, 'World pickups'],
  [/^Buy from /, 'Vendors'],
  [/^Spend Heroic Marks/, 'Heroic Marks'],
  [/^Exchange a Crucible sigil/, 'Crucible sigil exchange'],
  [/^(Weekly Lantern Hall contracts|Lantern Hall quartermaster)/, 'Lantern Hall contracts'],
  [/^Buy standing stock on the World Market/, 'World Market'],
  [/^Craft with /, 'Crafted'],
  [/^Disenchant /, 'Disenchanting'],
  [/^(Fishing in |Guaranteed quest catch)/, 'Fishing'],
  [
    /^(Grow from |Seed returned |Golden harvest |Clear a failed crop|Trade Withered Husks)/,
    'Farming',
  ],
  [/^Harvest a defeated creature/, 'Creature harvesting'],
  [/^Natural rift first-clear/, 'Rift first clears'],
  [/buried hoard$/, 'Buried hoards'],
  [/^(Finish a clue hunt|Open a Treasure Casket)/, 'Treasure hunts'],
  [/^(Finish a weekly emissary charge|Open an Emissary's Cache)/, 'Emissary caches'],
  [/( shop| reward chest)$/, 'Delves'],
  [/^Collect inside /, 'Dungeon and raid pickups'],
  [/^Sunder raid equipment/, 'Raid gear sundering'],
  [/^Eligible endgame completion/, 'Endgame completion rewards'],
  [/^World PvP trophy/, 'World PvP'],
  [/^(Gourdlight |Seasonal trick-or-treat|Open a Gourdlight)/, 'Seasonal events'],
  [/^(Take stones from a Soulwell|Conjure with a Mage ability)/, 'Class abilities'],
  [/^Starting equipment /, 'Starting equipment'],
  [/^(Membership purchase|Annual membership|Claim membership)/, 'Membership'],
  [/^(Referral |Invite one friend)/, 'Referral rewards'],
  [/^Borrow the muster drill weapon/, 'Other sources'],
  [
    /^(Unavailable through current gameplay|Developer-only item|Current availability|Availability)$/,
    null,
  ],
];
// Gathering rows are titled "<Profession> in <Zone>", so they come last.
const GATHERING = /^[A-Z][a-z]+ in [A-Z]/;

/**
 * The source group for one acquisition row title. Returns null for a row that says the
 * item cannot be had, and undefined for a title no rule knows (a new kind of source).
 */
export function sourceGroupFor(title: string): SourceGroup | null | undefined {
  for (const [pattern, group] of RULES) if (pattern.test(title)) return group;
  if (GATHERING.test(title)) return 'Gathering';
  return undefined;
}

/** What the acquisition rows need: page titles and link markup. */
export type SourceWriter = Pick<ArticleTools, 'titleBy' | 'link' | 'section' | 'bullets'> &
  Partial<ArticleTools>;
const cache = new WeakMap<object, Map<string, ItemAcquisition[]>>();
/** The item pages' acquisition rows, built once per set of page titles. */
export function acquisitionRows(w: SourceWriter): Map<string, ItemAcquisition[]> {
  let rows = cache.get(w.titleBy);
  if (!rows) {
    // Only row titles, items and map pins are read here, so prices and tables can be
    // left blank when the caller has no formatter for them.
    rows = itemAcquisitionIndex({ money: () => '', table: () => '', add() {}, ...w });
    cache.set(w.titleBy, rows);
  }
  return rows;
}

/** Every item's source groups, keyed by item id. Items with no known source are absent. */
export function itemSourceGroups(w: SourceWriter): Map<string, Set<SourceGroup>> {
  const out = new Map<string, Set<SourceGroup>>();
  for (const [id, rows] of acquisitionRows(w))
    for (const row of rows) {
      const group = sourceGroupFor(row.title);
      if (group === null) continue;
      const groups = out.get(id) ?? new Set<SourceGroup>();
      groups.add(group ?? 'Other sources');
      out.set(id, groups);
    }
  return out;
}
