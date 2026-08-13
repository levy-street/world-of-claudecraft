// Pure view-core for The Reliquary window (#reliquary-window). DOM/Three/i18n-free:
// maps IWorldReliquary reads plus the static catalog (injected so tests drive
// synthetic tables) to flat render models the cold painter draws. Registered in
// UI_PURE_CORES; unit-tested in tests/reliquary_view.test.ts.
//
// Phase 5: page grids (owned art vs silhouette), unlock/Illumination plan, and
// grid-relevant refresh signature dimensions. Phase 6: Curator rank names,
// seal chrome, and rank-up celebration plan.
//
// Phase 13: the nearly-complete predicate (either arm, both inclusive), the
// source-line ARM choice (reliquarySourceLinePlan, ids only, one line per
// authored door), and the search / ownership filter. The i18n-free contract in the first line still holds and is
// load-bearing: this core decides WHICH source arm and WHICH cells survive a
// filter, while every localized string stays one layer out. Filtering therefore
// matches on display text the painter injects (pageSearchText / relicSearchText,
// the deeds_view searchText idiom), never on the raw catalog English the models
// carry, so a player searches the names their own client shows them.

import { DEEDS } from '../sim/content/deeds';
import {
  type ReliquaryClearSource,
  type ReliquaryPageDef,
  type ReliquaryRelicDef,
  type ReliquaryShelfId,
  type ReliquarySourceHint,
  reliquaryRelicSource,
} from '../sim/content/reliquary';
import {
  CURATOR_RANK_DEFS,
  type CuratorRankDef,
  catalogRankOwned,
  catalogRelicCompletion,
  curatorRankFromOwned,
  curatorSealIdForRank,
  isRelicFilled,
  pageCompletion,
} from '../sim/reliquary';
import { DEED_STAT_KEYS, type DeedDef, type DeedStatKey, type DeedStats } from '../sim/types';
import type { ReliquaryRarity } from '../world_api';
import type { TranslationKey } from './i18n';

/** Top-level nav: virtual Overview plus the three catalog shelves. */
export const RELIQUARY_NAV = ['overview', 'conquerors', 'professions', 'horizons'] as const;
export type ReliquaryNavId = (typeof RELIQUARY_NAV)[number];

/**
 * The three catalog shelves in nav order. One definition, because two surfaces
 * depend on it agreeing: the shelf totals bucket and the Overview summary cards,
 * whose array order is a contract the painter and its tests both read.
 */
export const RELIQUARY_SHELF_ORDER: readonly ReliquaryShelfId[] = [
  'conquerors',
  'professions',
  'horizons',
];

/** Named Curator rank chrome keys (Phase 6). Falls back to numeric rank label. */
export const CURATOR_RANK_NAME_KEYS: readonly TranslationKey[] = [
  'hudChrome.reliquary.curatorRankName1',
  'hudChrome.reliquary.curatorRankName2',
  'hudChrome.reliquary.curatorRankName3',
  'hudChrome.reliquary.curatorRankName4',
  'hudChrome.reliquary.curatorRankName5',
];

/** Shared key picker for Overview seal chrome, sheet lines, and rank-up toast.
 *  Integer-guarded: a fractional rank (only reachable from a hostile or buggy
 *  upstream) falls to the generic key like an out-of-range one, because the
 *  indexed lookup below would otherwise answer undefined behind the non-null
 *  assertion and throw inside t() at the caller. */
export function curatorRankNameKey(rank: number): TranslationKey {
  if (Number.isInteger(rank) && rank >= 1 && rank <= CURATOR_RANK_NAME_KEYS.length) {
    return CURATOR_RANK_NAME_KEYS[rank - 1]!;
  }
  return 'hudChrome.reliquary.curatorRank';
}

/**
 * The Curator rank bridge whose deed reward is a wearable nameplate border:
 * the rank the copy announces plus the deed that names the border. Derived by
 * crossing the rank ladder with the deed catalog instead of writing the rank
 * as a literal, so a re-tiered ladder moves the note with it rather than
 * stranding it on a rank that grants nothing. Null when no bridge carries one.
 */
export interface CuratorBorderReward {
  rank: number;
  deedId: string;
}

export function curatorBorderReward(
  defs: readonly CuratorRankDef[],
  deeds: Readonly<Record<string, DeedDef>>,
): CuratorBorderReward | null {
  for (const def of defs) {
    const deedId = def.deedId;
    if (deedId === undefined) continue;
    // The deeds table is a plain object, so a bare index resolves prototype
    // keys; same guard as the sim validators (src/sim/deeds.ts).
    if (!Object.hasOwn(deeds, deedId)) continue;
    if (deeds[deedId]?.reward?.kind === 'border') return { rank: def.rank, deedId };
  }
  return null;
}

/** The live ladder's border bridge, resolved once (both tables are static). */
export const CURATOR_BORDER_REWARD = curatorBorderReward(CURATOR_RANK_DEFS, DEEDS);

/**
 * i18n key for a catalogued profession mark find label.
 * Mark ids use colon namespaces (`gather_event:pristine_vein`); the leaf key
 * replaces `:` with `_` under `hudChrome.reliquary.markFind.*`.
 */
export function reliquaryMarkFindKey(markId: string): string {
  return `hudChrome.reliquary.markFind.${markId.replace(/:/g, '_')}`;
}

/** How incomplete a page must be (and how full) to appear in nearly-complete. */
export const RELIQUARY_NEARLY_MIN_OWNED = 1;
export const RELIQUARY_NEARLY_MAX = 5;
/**
 * "Nearly complete" qualifies on EITHER arm, both boundaries INCLUSIVE: a page
 * within RELIQUARY_NEARLY_MAX_REMAINING relics of Illumination, or one already
 * at least RELIQUARY_NEARLY_MIN_FRACTION full. One relic into a thirty-slot
 * raid shelf is a chase, not a nearly-done page, and the owned >= 1 floor alone
 * used to promote it over a genuinely close page whenever the close one was
 * larger.
 */
export const RELIQUARY_NEARLY_MAX_REMAINING = 3;
export const RELIQUARY_NEARLY_MIN_FRACTION = 0.6;

/**
 * Catalog relic kinds plus the recent-ring 'unknown', the kind an id-only wire
 * find carries before the catalog places it. Declared HERE rather than in
 * reliquary_labels.ts so the search-text callback below can name it without the
 * core importing the localizer (labels imports this module, never the reverse).
 */
export type ReliquaryRelicNameKind = ReliquaryRelicDef['kind'] | 'unknown';

/** Grid ownership filter (the DeedsFilter shape scoped to relic cells). */
export const RELIQUARY_OWNED_FILTERS = ['all', 'owned', 'missing'] as const;
export type ReliquaryOwnedFilter = (typeof RELIQUARY_OWNED_FILTERS)[number];

/** True when a string is a known grid ownership filter (click-handler guard). */
export function isReliquaryOwnedFilter(value: string): value is ReliquaryOwnedFilter {
  return (RELIQUARY_OWNED_FILTERS as readonly string[]).includes(value);
}

/**
 * Where a relic comes from, resolved to ids only: the pure half of one source
 * line. The localized half (mob/dungeon/zone/npc/deed/craft/delve/quest names
 * plus the sentence key) lives in reliquary_labels.ts, so this core stays
 * i18n-free and a Vitest can assert WHICH arm a hint selects without a language
 * loaded.
 */
export type ReliquarySourceLinePlan =
  | { kind: 'bossDungeon'; bossId: string; dungeonId: string }
  | { kind: 'bossZone'; bossId: string; zoneId: string }
  | { kind: 'boss'; bossId: string }
  | { kind: 'zone'; zoneId: string }
  | { kind: 'profession'; professionId: string }
  | { kind: 'deed'; deedId: string }
  | { kind: 'vendor'; npcId: string }
  | { kind: 'delve'; delveId: string }
  | { kind: 'rift'; rank: string }
  | { kind: 'quest'; questId: string }
  | { kind: 'store'; storeId: string }
  | { kind: 'activity'; activityId: string };

/** Shared frozen empty answer, so "no source" never allocates (the
 *  NO_SOURCE_HINTS idiom on the catalog side of this pair). */
const NO_SOURCE_LINES: readonly ReliquarySourceLinePlan[] = Object.freeze([]);

/** The arm one hint takes on its own, before any composition. A boss hint on a
 *  page whose clear meter reads a dungeon names both ("in {dungeon}"); a boss on
 *  a raid, world-boss, or delve page names the boss alone rather than inventing
 *  a place. */
function sourceLineForHint(
  hint: ReliquarySourceHint,
  clearSource: ReliquaryClearSource | undefined,
): ReliquarySourceLinePlan {
  switch (hint.sourceKind) {
    case 'boss':
      return clearSource?.kind === 'dungeon'
        ? { kind: 'bossDungeon', bossId: hint.sourceId, dungeonId: clearSource.dungeonId }
        : { kind: 'boss', bossId: hint.sourceId };
    case 'zone':
      return { kind: 'zone', zoneId: hint.sourceId };
    case 'profession':
      return { kind: 'profession', professionId: hint.sourceId };
    case 'deed':
      return { kind: 'deed', deedId: hint.sourceId };
    case 'vendor':
      return { kind: 'vendor', npcId: hint.sourceId };
    case 'delve':
      return { kind: 'delve', delveId: hint.sourceId };
    case 'rift':
      return { kind: 'rift', rank: hint.sourceId };
    case 'quest':
      return { kind: 'quest', questId: hint.sourceId };
    case 'store':
      return { kind: 'store', storeId: hint.sourceId };
    case 'activity':
      return { kind: 'activity', activityId: hint.sourceId };
  }
}

/**
 * Plan every source line one relic shows, from the hints the catalog authors
 * for it. THE one pattern, stated once so a reader never has to guess which
 * shape produces which line count:
 *
 *   ONE LINE PER HINT, in authored order, with no cap. Composition happens in
 *   exactly two places, both of which fold a PLACE into a line that would
 *   otherwise name only a source:
 *     - a boss hint on a dungeon-clear page becomes "in {dungeon}" (unchanged
 *       from the single-hint world), and
 *     - a list holding EXACTLY ONE boss hint and EXACTLY ONE zone hint (on a
 *       page with no dungeon of its own) composes them into one bossZone line
 *       at the BOSS hint's authored position, because "which rare" and "where
 *       it camps" are two halves of one open-world answer.
 *   Every other hint in the list still renders its own line either way, and the
 *   dungeon composition wins where both could apply: dropping the page's own
 *   dungeon to name a zone instead would lose the more specific place.
 *
 * An empty list is a real answer ("content names no source") and produces no
 * line at all, never a guess.
 *
 * Same-dungeon boss pairs are deliberately NOT merged into an "either boss"
 * line. One line per door is the pattern everywhere else in this function, and
 * a reader who has learned to count doors by counting lines should not have to
 * unlearn it for the one shape where the doors happen to share a roof.
 */
export function reliquarySourceLinePlan(
  hints: readonly ReliquarySourceHint[],
  clearSource: ReliquaryClearSource | undefined,
): readonly ReliquarySourceLinePlan[] {
  if (hints.length === 0) return NO_SOURCE_LINES;
  let soleBoss: ReliquarySourceHint | null = null;
  let soleZone: ReliquarySourceHint | null = null;
  let bosses = 0;
  let zones = 0;
  for (const hint of hints) {
    if (hint.sourceKind === 'boss') {
      bosses += 1;
      soleBoss = hint;
    } else if (hint.sourceKind === 'zone') {
      zones += 1;
      soleZone = hint;
    }
  }
  // Both sole-hint guards are symmetric even though the counts already imply
  // them. The insurance is one-directional and cheap: if bosses === 1 ever
  // loosened DOWNWARD to admit zero bosses, the null guard keeps the compose
  // off so the lone zone hint still renders its own line instead of being
  // skipped by the loop below (an upward loosening folds into the last-seen
  // hint instead; the count checks are what rule that out).
  const composeBossZone =
    clearSource?.kind !== 'dungeon' &&
    bosses === 1 &&
    zones === 1 &&
    soleBoss !== null &&
    soleZone !== null;
  const lines: ReliquarySourceLinePlan[] = [];
  for (const hint of hints) {
    if (composeBossZone && soleZone !== null) {
      // The pair renders once, at the boss's position; the zone half is folded
      // in rather than repeated as a line of its own.
      if (hint === soleZone) continue;
      if (hint === soleBoss) {
        lines.push({ kind: 'bossZone', bossId: hint.sourceId, zoneId: soleZone.sourceId });
        continue;
      }
    }
    lines.push(sourceLineForHint(hint, clearSource));
  }
  return lines;
}

/** Sparse first-find meta (mirrors IWorld.reliquaryFirstFind). */
export type ReliquaryFirstFindLookup = Readonly<Record<string, { clears?: number } | undefined>>;

/**
 * Sparse per-relic obtain tally (mirrors IWorld.reliquaryObtainCounts). An
 * ABSENT id means no counted obtain, which is not the same as no obtain: a
 * relic that arrived by trade, mail, or market never has one, and neither does
 * a veteran who has not re-obtained since counting began.
 */
export type ReliquaryObtainCountLookup = Readonly<Record<string, number | undefined>>;

export interface ReliquaryViewInput {
  /** Catalog pages (live RELIQUARY_PAGES or a synthetic table in tests). */
  pages: readonly ReliquaryPageDef[];
  /** Item ownership = itemsDiscovered (or a test Set). */
  itemsDiscovered: { has(id: string): boolean };
  /** Authored non-item marks (profession trophies, etc.). */
  marks: { has(id: string): boolean };
  /** Capped recent find ids (item or mark), oldest-first from the facet. */
  recent: readonly string[];
  /** Active shelf / overview nav id. */
  nav: ReliquaryNavId;
  /** Selected page id within a shelf, or null for the shelf stub list. */
  pageId: string | null;
  /**
   * Optional clear-count lookup (IWorld.reliquaryPageClearCount). Fairness:
   * owned/missing and clear counts are never gated by graphics tier; the
   * painter always receives the real numbers when the source exists.
   */
  clearCount?: (pageId: string) => number | undefined;
  /**
   * Optional SECOND clear-count lookup for pages whose def carries a
   * secondaryClearSource (display-only meter; the window reads the deed
   * counter it names). Same fairness rule as clearCount: never gated by
   * graphics tier. Undefined for a page without a secondary source.
   */
  secondaryClearCount?: (pageId: string) => number | undefined;
  /**
   * Sparse first-find meta for catalogued item relics (live first obtain).
   * Used only for owned-cell tooltips (clear#); never invents ownership.
   */
  firstFind?: ReliquaryFirstFindLookup;
  /**
   * Sparse obtain tally for catalogued item relics. Owned-cell tooltips only;
   * it never decides ownership, completion, rank, or order. Information about
   * a relic you already have, never a score.
   */
  obtainCounts?: ReliquaryObtainCountLookup;
  /** Mount ownership (live ownedMounts / reins seam). */
  ownedMounts?: { has(id: string): boolean };
  /** Account weapon-skin unlocks (empty when account cosmetics absent). */
  weaponSkins?: { has(id: string): boolean };
  /** Title ownership via deeds earned (deeds with title rewards only). */
  deedsEarned?: { has(id: string): boolean };
  /**
   * Lowercased search needle; '' (or absent) means no search. Matching runs
   * against the LOCALIZED display text the painter injects below, never the
   * raw catalog English on the models: a player searching in their own
   * language must hit the names they can actually read.
   */
  search?: string;
  /** Grid ownership filter. Absent behaves as 'all'. */
  ownedFilter?: ReliquaryOwnedFilter;
  /**
   * Localized, pre-lowercased searchable text for a page (the deeds_view
   * `searchText(id)` idiom). Page lists filter when either resolver is
   * injected (rows also survive on a contained relic's name); with neither
   * injected they stay whole.
   */
  pageSearchText?: (pageId: string) => string;
  /** Localized, pre-casefolded searchable text for one relic slot. Takes the
   *  wire-shaped 'unknown' too, so the recent strip filters on exactly the kind
   *  it renders with rather than coercing first. */
  relicSearchText?: (kind: ReliquaryRelicNameKind, id: string) => string;
}

export interface ReliquaryProgressModel {
  owned: number;
  total: number;
  /** 0..1 completion over unique item relics. */
  fraction: number;
  /** Cosmetic Curator rank index (0 = none). */
  curatorRank: number;
  /**
   * Window seal chrome id for the current rank (null when unranked).
   * Derived pure; never invents power or Renown.
   */
  curatorSealId: string | null;
}

export interface ReliquaryRecentFindModel {
  /** Item or mark id from the recent ring. */
  id: string;
  kind: 'item' | 'mark' | 'unknown';
  /**
   * Page the chip jumps to: the recorded first-find page when the catalog still
   * holds it, otherwise the first page in authored order whose relic list
   * contains the slot. Null when nothing places the relic (a wire-only id, or
   * content drift), and the painter then draws an inert chip rather than a
   * button that would navigate nowhere.
   */
  pageId: string | null;
}

/**
 * One Overview shelf summary card. The array these come in is ordered by
 * RELIQUARY_SHELF_ORDER and that order is a contract: the painter draws the
 * cards in the same order the rail lists the shelves.
 */
export interface ReliquaryShelfCardModel {
  shelf: ReliquaryShelfId;
  /** Aggregate owned/total across every page on the shelf. */
  owned: number;
  total: number;
  /**
   * Newest ring find whose derived page sits on this shelf, or null when the
   * ring holds none. Captured from the WHOLE ring, before any search narrows
   * the recent strip: a card summarizes its shelf, not the current needle.
   */
  recentId: string | null;
  /** Kind of recentId, so the painter can name and ghost it. Null with it. */
  recentKind: ReliquaryRecentFindModel['kind'] | null;
}

export interface ReliquaryNearlyPageModel {
  pageId: string;
  /** Raw catalog English. Never render it directly: resolve the display name
   *  from pageId through reliquaryPageName (src/ui/reliquary_i18n.ts). */
  name: string;
  owned: number;
  total: number;
  remaining: number;
}

export interface ReliquaryShelfPageModel {
  pageId: string;
  /** Raw catalog English. Never render it directly: resolve the display name
   *  from pageId through reliquaryPageName (src/ui/reliquary_i18n.ts). */
  name: string;
  shelf: ReliquaryShelfId;
  owned: number;
  total: number;
  complete: boolean;
  /** Lifetime clears when the page has a clear source; undefined otherwise.
   *
   *  The SECOND meter is deliberately not here: only the open page renders it,
   *  so it lives on ReliquaryPageDetailModel and a shelf row never carries a
   *  number nothing paints. */
  clears: number | undefined;
}

/** One relic slot on an open page grid. */
export interface ReliquaryGridCellModel {
  /** Stable slot identity (itemId / markId / mountId / skinId / deedId). */
  id: string;
  kind: ReliquaryRelicDef['kind'];
  owned: boolean;
  /** Catalog order index (0-based) for stable paint order. */
  index: number;
  /**
   * Clear# at first obtain when this is an owned item relic with live
   * firstFind meta. Undefined for retro ownership, non-item relics, or missing.
   */
  firstFindClears?: number;
  /**
   * How many times this owned item relic has been obtained from the world.
   * Undefined for a missing cell, a non-item relic, and for an owned relic the
   * world reports no counted obtain for (traded, mailed, bought on the market,
   * or held since before counting): those are the same "cannot say" the
   * tooltip answers by rendering no line at all.
   */
  obtainedCount?: number;
  /**
   * Every door this relic comes through, ids only and in authored order
   * (reliquarySourceLinePlan). Undefined when the catalog authors no hint for
   * the slot and none for the page; never an empty list, so a truthiness test
   * and a length test agree.
   */
  sourcePlans?: readonly ReliquarySourceLinePlan[];
}

/** Full page view: header progress plus ordered grid cells. */
export interface ReliquaryPageDetailModel extends ReliquaryShelfPageModel {
  /** Lifetime count for the page's display-only secondaryClearSource meter;
   *  undefined for every page without one (the common case). Detail-scoped:
   *  the open page header is the ONE surface that paints it. */
  secondaryClears: number | undefined;
  /** Grid cells AFTER search / ownership filtering. owned and total above stay
   *  the page's true completion, so the header meter never lies under a filter. */
  cells: ReliquaryGridCellModel[];
  /** True when a search or ownership filter narrowed the grid this paint. */
  filtered: boolean;
  /** Alias of complete for Illumination chrome (first-time celebration is event-driven). */
  illuminated: boolean;
  /**
   * True when the page is account-scoped (weapon skins). UI labels the scope;
   * empty when account cosmetics are absent.
   */
  accountScoped: boolean;
}

export interface ReliquaryNavModel {
  id: ReliquaryNavId;
  /** Owned/total for catalog shelves (Overview has no pair). */
  owned: number;
  total: number;
}

export interface ReliquaryViewModel {
  nav: ReliquaryNavId;
  pageId: string | null;
  progress: ReliquaryProgressModel;
  recent: ReliquaryRecentFindModel[];
  nearly: ReliquaryNearlyPageModel[];
  shelves: ReliquaryNavModel[];
  /** Overview shelf summary cards, one per shelf in RELIQUARY_SHELF_ORDER. */
  shelfCards: ReliquaryShelfCardModel[];
  /** Pages on the active catalog shelf (empty on Overview). */
  shelfPages: ReliquaryShelfPageModel[];
  /** Active page header stub, or null when on Overview / no page selected. */
  activePage: ReliquaryShelfPageModel | null;
  /** Full page grid when a page is selected; null otherwise. */
  pageDetail: ReliquaryPageDetailModel | null;
  /**
   * Did the needle actually narrow the painted NON-GRID surface this build
   * (Overview strips or the shelf list)? False when no needle is live and
   * false when a needle matches everything, so announce gating can key on a
   * real narrowing instead of on mere needle presence. The grid answers for
   * itself through pageDetail.filtered.
   */
  filtered: boolean;
  /**
   * The needle emptied this strip: entries existed to show and the filter
   * removed every one. Distinguishes "nothing here matches" from a
   * STRUCTURALLY empty strip, whose own hint stays true while a needle is
   * live; keying the painter's no-match line on mere needle presence would
   * assert a false cause on the structurally empty strip.
   */
  recentEmptiedBySearch: boolean;
  nearlyEmptiedBySearch: boolean;
}

function ownershipOpts(input: ReliquaryViewInput) {
  return {
    itemsDiscovered: input.itemsDiscovered,
    marks: input.marks,
    ownedMounts: input.ownedMounts,
    weaponSkins: input.weaponSkins,
    deedsEarned: input.deedsEarned,
  };
}

function pageIsShelf(page: ReliquaryPageDef, shelf: ReliquaryShelfId): boolean {
  return page.shelf === shelf;
}

function shelfPageModel(
  page: ReliquaryPageDef,
  opts: ReturnType<typeof ownershipOpts>,
  clearCount?: (pageId: string) => number | undefined,
): ReliquaryShelfPageModel {
  const c = pageCompletion(page, opts);
  return {
    pageId: page.id,
    name: page.name,
    shelf: page.shelf,
    owned: c.owned,
    total: c.total,
    complete: c.complete,
    clears: clearCount?.(page.id),
  };
}

const DEED_STAT_KEY_SET: ReadonlySet<string> = new Set(DEED_STAT_KEYS);

/**
 * The display-only SECOND clear meter's value for one page: undefined for
 * every page without a secondaryClearSource (the common case), else the named
 * counter floored to a finite non-negative integer.
 *
 * Fail-closed on purpose, and the reason it is a unit rather than a lambda
 * inside the window: a stat name outside DEED_STAT_KEYS, an absent counters
 * block (a stub world in a test, or a host that has not mirrored the facet
 * yet), and a negative / NaN / Infinity counter all answer 0 rather than
 * throwing mid-paint or inventing a parallel counter channel. Zero and
 * undefined are DIFFERENT answers here: undefined means the page has no second
 * meter and the painter renders no line at all.
 *
 * Takes the page DEF rather than an id, the reliquaryRelicSource convention: a
 * synthetic test page reusing a live id must resolve its own source, never the
 * catalog row that shares the id.
 */
export function reliquarySecondaryClears(
  page: ReliquaryPageDef | undefined,
  counters: DeedStats['counters'] | undefined,
): number | undefined {
  const src = page?.secondaryClearSource;
  if (src === undefined) return undefined;
  if (!DEED_STAT_KEY_SET.has(src.stat)) return 0;
  const n = counters?.[src.stat as DeedStatKey];
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function relicSlotId(relic: ReliquaryRelicDef): string {
  switch (relic.kind) {
    case 'item':
      return relic.itemId;
    case 'mark':
      return relic.markId;
    case 'mount':
      return relic.mountId;
    case 'weapon_skin':
      return relic.skinId;
    case 'title':
      return relic.deedId;
  }
}

/** Build ordered grid cells for one page (owned vs missing). */
export function buildReliquaryPageCells(
  page: ReliquaryPageDef,
  opts: {
    itemsDiscovered: { has(id: string): boolean };
    marks?: { has(id: string): boolean };
    ownedMounts?: { has(id: string): boolean };
    weaponSkins?: { has(id: string): boolean };
    deedsEarned?: { has(id: string): boolean };
    firstFind?: ReliquaryFirstFindLookup;
    obtainCounts?: ReliquaryObtainCountLookup;
  },
): ReliquaryGridCellModel[] {
  const cells: ReliquaryGridCellModel[] = [];
  for (let i = 0; i < page.relics.length; i++) {
    const relic = page.relics[i];
    const owned = isRelicFilled(relic, opts);
    const id = relicSlotId(relic);
    const cell: ReliquaryGridCellModel = {
      id,
      kind: relic.kind,
      owned,
      index: i,
    };
    // Slot hints first, then the page default, through the ONE implementation of
    // that precedence (reliquaryRelicSource). It takes the INJECTED page def,
    // never a catalog lookup by id, so a synthetic test page resolves its own
    // sourceDefault instead of a live RELIQUARY_PAGES row that shares its id.
    const plans = reliquarySourceLinePlan(reliquaryRelicSource(page, relic), page.clearSource);
    if (plans.length > 0) cell.sourcePlans = plans;
    if (owned && relic.kind === 'item') {
      const clears = opts.firstFind?.[id]?.clears;
      if (clears !== undefined) cell.firstFindClears = clears;
      // Item relics only, on the same rule as the clear stamp above: the world
      // tallies catalogued item ids and nothing else, so a mark, mount, skin,
      // or title cell must never surface a number even from a spoofed record.
      // The floor is a real gate, not a formality: the record arrives off the
      // wire, and a zero, a negative, or a non-number must render no line
      // rather than "Obtained 0 times".
      const count = opts.obtainCounts?.[id];
      if (typeof count === 'number' && Number.isFinite(count) && count >= 1) {
        cell.obtainedCount = count;
      }
    }
    cells.push(cell);
  }
  return cells;
}

/** Build the whole cold-window model. Per-call allocation is fine (event-driven). */
export function buildReliquaryView(input: ReliquaryViewInput): ReliquaryViewModel {
  const opts = ownershipOpts(input);
  // Overview totals include all shelves (including account skins). Curator rank
  // scores only character-durable fills (excludes weapon skins) so seal chrome
  // matches syncCuratorRankDeeds / grant path.
  const catalog = catalogRelicCompletion(opts, input.pages);
  const curatorRank = curatorRankFromOwned(catalogRankOwned(opts, input.pages));
  const progress: ReliquaryProgressModel = {
    owned: catalog.owned,
    total: catalog.total,
    fraction: catalog.total > 0 ? catalog.owned / catalog.total : 0,
    curatorRank,
    curatorSealId: curatorSealIdForRank(curatorRank),
  };

  const search = input.search ?? '';
  const ownedFilter = input.ownedFilter ?? 'all';

  const pagesById = new Map<string, ReliquaryPageDef>();
  for (const page of input.pages) pagesById.set(page.id, page);
  // One pass over the catalog instead of a re-scan per chip. Built only when
  // the ring holds something, so a fresh account pays nothing for it.
  const relicPageIndex = input.recent.length > 0 ? reliquaryRelicPageIndex(input.pages) : null;

  const recent: ReliquaryRecentFindModel[] = [];
  const shelfLatest = new Map<
    ReliquaryShelfId,
    { id: string; kind: ReliquaryRecentFindModel['kind'] }
  >();
  let recentTotal = 0;
  // Newest-first for the strip (facet is oldest-first).
  for (let i = input.recent.length - 1; i >= 0; i--) {
    const id = input.recent[i];
    if (!id) continue;
    recentTotal += 1;
    let kind: ReliquaryRecentFindModel['kind'] = 'unknown';
    if (input.marks.has(id)) kind = 'mark';
    else if (input.itemsDiscovered.has(id) || (relicPageIndex?.itemIds.has(id) ?? false)) {
      kind = 'item';
    }
    // Where the chip jumps to, through the shared resolver the unlock chat
    // line also calls (reliquaryRelicPageId): the first authored page holding
    // the slot, else null.
    const pageId = relicPageIndex === null ? null : reliquaryRelicPageId(relicPageIndex, id);
    // Shelf cards summarize a shelf, not the needle, so their latest-find line
    // is captured from the WHOLE ring before the search filter below: typing
    // must not blank a card's last find.
    if (pageId !== null) {
      const shelf = pagesById.get(pageId)?.shelf;
      if (shelf !== undefined && !shelfLatest.has(shelf)) shelfLatest.set(shelf, { id, kind });
    }
    // The Overview strips narrow with the search too: a search field that is
    // visible on a shelf but inert on Overview is the same broken promise as a
    // pointer cursor on something that does not click.
    if (search !== '' && input.relicSearchText !== undefined) {
      // The real kind, the same one the chip renders with: coercing 'unknown'
      // to 'item' here would silently disagree with the label if those two
      // resolver arms ever stop being identical.
      if (!input.relicSearchText(kind, id).includes(search)) continue;
    }
    recent.push({ id, kind, pageId });
  }

  // Page rows (nearly strip and shelf list alike) survive on their own text OR
  // on any relic inside them, so the field's "Search relics" promise holds on
  // every surface that lists pages. With NEITHER resolver injected there is no
  // localized text to match against, so the lists stay whole rather than
  // filtering everything away.
  const canMatchPages = input.pageSearchText !== undefined || input.relicSearchText !== undefined;
  const pageMatches = (pageId: string): boolean =>
    (input.pageSearchText?.(pageId) ?? '').includes(search) ||
    pageHasRelicMatch(input, pagesById.get(pageId), search);

  // The needle narrows the QUALIFYING set before the strip cap, never the
  // capped strip: a match that ranks sixth by remaining-count must still be
  // reachable from Overview search, exactly as it is from the shelf list.
  const nearlyMatches = search === '' || !canMatchPages ? undefined : pageMatches;
  const nearly = buildNearlyComplete(input.pages, opts, nearlyMatches);
  // The strip a needle-less build would have painted, for the narrowing flag
  // below. Only rebuilt while a needle is live (cold path, one keystroke).
  const unfilteredNearly =
    nearlyMatches === undefined ? nearly : buildNearlyComplete(input.pages, opts);

  const shelfTotals = new Map<ReliquaryShelfId, { owned: number; total: number }>();
  for (const shelf of RELIQUARY_SHELF_ORDER) {
    shelfTotals.set(shelf, { owned: 0, total: 0 });
  }
  for (const page of input.pages) {
    // Same scoring rule the headline pair uses (completionScoringPages in
    // src/sim/reliquary.ts): an excludeFromCompletion page contributes to
    // NEITHER side of a shelf sum. Counting flagged slots here while the
    // headline excluded them was one source of rail-vs-headline drift; the
    // shelf sums still run above the headline because they count a shared id
    // once per page while the headline de-dupes across pages (pre-existing,
    // deliberate). The flagged page's OWN row keeps its local owned/total,
    // which is the pair a player can actually move.
    if (page.excludeFromCompletion !== undefined) continue;
    const c = pageCompletion(page, opts);
    const bucket = shelfTotals.get(page.shelf);
    if (!bucket) continue;
    bucket.owned += c.owned;
    bucket.total += c.total;
  }

  const shelves: ReliquaryNavModel[] = RELIQUARY_NAV.map((id) => {
    if (id === 'overview') return { id, owned: 0, total: 0 };
    const t = shelfTotals.get(id) ?? { owned: 0, total: 0 };
    return { id, owned: t.owned, total: t.total };
  });

  // The same totals the rail counts, plus the shelf's newest find: one card per
  // shelf, always all three, in nav order.
  const shelfCards: ReliquaryShelfCardModel[] = RELIQUARY_SHELF_ORDER.map((shelf) => {
    const totals = shelfTotals.get(shelf) ?? { owned: 0, total: 0 };
    const latest = shelfLatest.get(shelf);
    return {
      shelf,
      owned: totals.owned,
      total: totals.total,
      recentId: latest?.id ?? null,
      recentKind: latest?.kind ?? null,
    };
  });

  // Every page on the shelf, before the search narrows the visible list: the
  // open page must still resolve its header and grid while a search that
  // excludes its name is active.
  const allShelfPages: ReliquaryShelfPageModel[] = [];
  if (input.nav !== 'overview') {
    for (const page of input.pages) {
      if (!pageIsShelf(page, input.nav)) continue;
      allShelfPages.push(shelfPageModel(page, opts, input.clearCount));
    }
  }
  // Typing a relic name from the shelf shows you which page holds it instead
  // of an empty list (see pageMatches above). Cold path (one keystroke, not
  // per frame).
  const shelfPages =
    search === '' || !canMatchPages
      ? allShelfPages
      : allShelfPages.filter((p) => pageMatches(p.pageId));

  let activePage: ReliquaryShelfPageModel | null = null;
  let pageDetail: ReliquaryPageDetailModel | null = null;
  if (input.pageId !== null) {
    activePage = allShelfPages.find((p) => p.pageId === input.pageId) ?? null;
    if (activePage === null) {
      // Page selected but not on this shelf (or unknown): resolve from full catalog.
      const page = pagesById.get(input.pageId);
      if (page) {
        activePage = shelfPageModel(page, opts, input.clearCount);
      }
    }
    if (activePage !== null) {
      const header = activePage;
      const page = pagesById.get(header.pageId);
      if (page) {
        const cells = buildReliquaryPageCells(page, {
          ...opts,
          firstFind: input.firstFind,
          obtainCounts: input.obtainCounts,
        });
        const visible = cells.filter(
          (cell) =>
            (ownedFilter === 'all' || (ownedFilter === 'owned' ? cell.owned : !cell.owned)) &&
            (search === '' ||
              input.relicSearchText === undefined ||
              input.relicSearchText(cell.kind, cell.id).includes(search)),
        );
        pageDetail = {
          ...header,
          // Resolved HERE and not on the shelf row: the second meter paints on
          // the open page header alone, so only the detail model carries it.
          secondaryClears: input.secondaryClearCount?.(header.pageId),
          cells: visible,
          filtered: visible.length !== cells.length,
          illuminated: header.complete,
          // Weapon skins are account cosmetics; label the scope in the cold UI.
          accountScoped: page.relics.some((r) => r.kind === 'weapon_skin'),
        };
      }
    }
  }

  // A real narrowing of the painted non-grid surface, not mere needle
  // presence: a needle that matches everything narrows nothing.
  const nearlyNarrowed =
    nearly.length !== unfilteredNearly.length ||
    nearly.some((n, i) => n.pageId !== unfilteredNearly[i]?.pageId);
  const filtered =
    search === '' || !canMatchPages
      ? false
      : input.nav === 'overview'
        ? recent.length !== recentTotal || nearlyNarrowed
        : shelfPages.length !== allShelfPages.length;

  return {
    nav: input.nav,
    pageId: input.pageId,
    progress,
    recent,
    nearly,
    shelves,
    shelfCards,
    shelfPages,
    activePage,
    pageDetail,
    filtered,
    // With no needle each visible strip equals its unfiltered self, so both
    // flags are necessarily false; no needle-presence check is needed.
    recentEmptiedBySearch: recent.length === 0 && recentTotal > 0,
    nearlyEmptiedBySearch: nearly.length === 0 && unfilteredNearly.length > 0,
  };
}

/** True when any relic slot on the page matches the needle by its localized
 *  display name. Short-circuits on the first hit. Takes the resolved page def
 *  (callers hold a Map) so a per-keystroke sweep never re-scans the catalog. */
function pageHasRelicMatch(
  input: ReliquaryViewInput,
  page: ReliquaryPageDef | undefined,
  search: string,
): boolean {
  const resolve = input.relicSearchText;
  if (resolve === undefined) return false;
  if (page === undefined) return false;
  for (const relic of page.relics) {
    if (resolve(relic.kind, relicSlotId(relic)).includes(search)) return true;
  }
  return false;
}

/** The three catalog lookups a relic id needs (see reliquaryRelicPageIndex). */
export type ReliquaryRelicPageIndex = {
  /** Slot id to the first page in authored order that holds it. */
  pageOf: ReadonlyMap<string, string>;
  /** Every item-slot id the catalog places, for classifying a ring entry. */
  itemIds: ReadonlySet<string>;
  /** Every authored page id, for checking a recorded first-find hint. */
  pageIds: ReadonlySet<string>;
};

/**
 * Slot id to the FIRST page in authored order that holds it, across every relic
 * kind the catalog places (items, marks, mounts, weapon skins, title deeds).
 * A relic listed on several pages resolves to the first, so a jump target is
 * stable rather than dependent on iteration luck. The same pass collects the
 * item-slot ids, so classifying a ring entry needs no re-scan of the catalog
 * per chip, and the page ids, so a first-find hint can be checked against what
 * the catalog still holds.
 *
 * Built once per surface (one view build, one unlock drain) and handed to
 * reliquaryRelicPageId.
 */
export function reliquaryRelicPageIndex(
  pages: readonly ReliquaryPageDef[],
): ReliquaryRelicPageIndex {
  const pageOf = new Map<string, string>();
  const itemIds = new Set<string>();
  const pageIds = new Set<string>();
  for (const page of pages) {
    pageIds.add(page.id);
    for (const relic of page.relics) {
      const id = relicSlotId(relic);
      if (!pageOf.has(id)) pageOf.set(id, page.id);
      if (relic.kind === 'item') itemIds.add(relic.itemId);
    }
  }
  return { pageOf, itemIds, pageIds };
}

/**
 * Where a relic's jump lands: the first authored page that lists the slot.
 * Null means the catalog no longer places the relic at all, and the caller
 * renders an inert surface (the recent strip's unclickable chip, a plain chat
 * line) instead of promising a page that is not there.
 *
 * The ONE answer to "where does this relic live": the Overview recent chip and
 * the unlock chat line share it, so a chip and its own announcement can never
 * point at different pages. It used to prefer a `pageId` the first-find stamp
 * recorded, but that stamp only ever held the same first authored page this
 * index resolves, so the hint could differ from the catalog in exactly one
 * case: a page retired since the find, where the fallback was already the
 * answer. Phase 17 retired the stored field with it.
 */
export function reliquaryRelicPageId(
  index: ReliquaryRelicPageIndex,
  relicId: string,
): string | null {
  return index.pageOf.get(relicId) ?? null;
}

/** The ranking inputs a nearly-complete candidate row must carry. Kept to the
 *  three fields the order actually reads, so the HUD tracker can rank its own
 *  rows through the SAME comparator without carrying the Overview's display
 *  fields. */
export interface ReliquaryNearlyRankRow {
  pageId: string;
  owned: number;
  total: number;
}

/**
 * Is this page "nearly complete"? The ONE predicate behind both surfaces that
 * claim the phrase: the Overview strip and the HUD tracker's default selection
 * (what it shows before the player pins anything). A page qualifies when it is
 * started but unfinished and either within RELIQUARY_NEARLY_MAX_REMAINING
 * relics of Illumination or already RELIQUARY_NEARLY_MIN_FRACTION full.
 */
export function isReliquaryNearlyComplete(owned: number, total: number): boolean {
  if (total <= 0 || owned >= total) return false;
  if (owned < RELIQUARY_NEARLY_MIN_OWNED) return false;
  const remaining = total - owned;
  const fraction = owned / total;
  return remaining <= RELIQUARY_NEARLY_MAX_REMAINING || fraction >= RELIQUARY_NEARLY_MIN_FRACTION;
}

/**
 * Rank nearly-complete candidates: fewest remaining first, then highest owned
 * fraction, then stable page id (so two equally close pages never trade places
 * between builds). The one comparator both nearly-complete surfaces order by.
 *
 * COPY-RETURNING: the caller's array is never sorted in place. A rendered
 * model array's order is a contract its own consumers read, and this is now
 * called on a container the HUD tracker reuses across builds.
 */
export function rankNearlyComplete<T extends ReliquaryNearlyRankRow>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const ra = a.total - a.owned;
    const rb = b.total - b.owned;
    if (ra !== rb) return ra - rb;
    const fa = a.total > 0 ? a.owned / a.total : 0;
    const fb = b.total > 0 ? b.owned / b.total : 0;
    if (fa !== fb) return fb - fa;
    return a.pageId < b.pageId ? -1 : a.pageId > b.pageId ? 1 : 0;
  });
}

function buildNearlyComplete(
  pages: readonly ReliquaryPageDef[],
  opts: {
    itemsDiscovered: { has(id: string): boolean };
    marks: { has(id: string): boolean };
    ownedMounts?: { has(id: string): boolean };
    weaponSkins?: { has(id: string): boolean };
    deedsEarned?: { has(id: string): boolean };
  },
  matches?: (pageId: string) => boolean,
): ReliquaryNearlyPageModel[] {
  const candidates: ReliquaryNearlyPageModel[] = [];
  for (const page of pages) {
    // An excludeFromCompletion page never qualifies: "nearly complete" is a
    // nudge toward the missing relics, and neither a retired page's missing
    // relics (no longer winnable) nor a class-personal page's (never winnable
    // by one character) can be filled. The tracker's default scan applies the
    // same skip (refreshDefaultRows in reliquary_tracker_view.ts).
    if (page.excludeFromCompletion !== undefined) continue;
    const c = pageCompletion(page, opts);
    if (!isReliquaryNearlyComplete(c.owned, c.total)) continue;
    // The needle narrows here, BEFORE the ranking cap, so a qualifying match
    // that ranks below the cap is still reachable from Overview search.
    if (matches !== undefined && !matches(page.id)) continue;
    candidates.push({
      pageId: page.id,
      name: page.name,
      owned: c.owned,
      total: c.total,
      remaining: c.total - c.owned,
    });
  }
  return rankNearlyComplete(candidates).slice(0, RELIQUARY_NEARLY_MAX);
}

// ---------------------------------------------------------------------------
// Unlock / Illumination plan: pure HUD reaction to a drain of reliquaryUnlock.
// Presentation only; never invents membership (mirrors stay authoritative).
// ---------------------------------------------------------------------------

/** One presentation-only reliquaryUnlock event (id-only; no English). */
export interface ReliquaryUnlockEventModel {
  itemId?: string;
  markId?: string;
  pageIds?: readonly string[];
  illuminatedPageId?: string;
  /** New Curator rank when this fill crossed a threshold (cosmetic only). */
  curatorRank?: number;
  /** On-join back-credit: silent, counted into one summary line. */
  retro?: boolean;
}

export type ReliquaryUnlockLog = { kind: 'item'; id: string } | { kind: 'mark'; id: string };

export type ReliquaryUnlockBanner =
  | { kind: 'unlock'; relic: ReliquaryUnlockLog }
  | { kind: 'illuminate'; pageId: string }
  | { kind: 'rankUp'; rank: number };

export interface ReliquaryUnlockPlan {
  /** One durable log line per catalogued unlock in drain order. */
  logs: ReliquaryUnlockLog[];
  /**
   * Single banner slot priority (highest wins; last of same tier wins):
   * rankUp > Illumination > plain unlock. The log still carries every line.
   */
  banner: ReliquaryUnlockBanner | null;
  /** One celebration sound per drain with at least one unlock. */
  playSound: boolean;
  /**
   * Motion-only flourish gate, consumed by the banner fade alone since
   * Phase 14: the window's fill flash and Illumination celebration are armed
   * unconditionally and suppressed in CSS by the prefers-reduced-motion
   * block. False under reduced motion. Never gates log lines, banner text,
   * or sound (information survives).
   */
  motion: boolean;
  /** True when the open Reliquary window should force a rebuild this drain. */
  refreshWindow: boolean;
  /** Last illuminated page id in the drain, if any. */
  illuminatedPageId: string | null;
  /** Highest Curator rank-up in the drain, if any (cosmetic only). */
  curatorRank: number | null;
  /**
   * On-join back-credits (the seed pass): NO log line, NO banner, NO audio,
   * NO motion, NO window refresh, and they never claim the Illumination or
   * rank slots. Just this count, which the HUD spends on ONE summary line
   * (the deeds retro idiom).
   */
  retroCount: number;
}

/**
 * Plan the HUD reaction to a drain of reliquaryUnlock events.
 * Skips events with neither itemId nor markId (content drift / empty payload).
 * Does not consult discovery mirrors: membership is never invented here.
 */
export function buildReliquaryUnlockPlan(
  events: readonly ReliquaryUnlockEventModel[],
  reducedMotion: boolean,
): ReliquaryUnlockPlan {
  const logs: ReliquaryUnlockLog[] = [];
  let banner: ReliquaryUnlockBanner | null = null;
  let illuminatedPageId: string | null = null;
  let curatorRank: number | null = null;
  let retroCount = 0;

  for (const event of events) {
    let log: ReliquaryUnlockLog | null = null;
    if (event.itemId) log = { kind: 'item', id: event.itemId };
    else if (event.markId) log = { kind: 'mark', id: event.markId };
    if (!log) continue;
    // A veteran's first login can seed dozens of fills at once. Those are
    // counted and nothing else: they must not steal the banner slot, the
    // Illumination line, or the rank-up moment from a live find in the same
    // drain, so the capture below is skipped entirely.
    if (event.retro) {
      retroCount++;
      continue;
    }
    logs.push(log);

    const rankUp =
      typeof event.curatorRank === 'number' &&
      Number.isFinite(event.curatorRank) &&
      event.curatorRank > 0
        ? Math.floor(event.curatorRank)
        : null;
    // Always capture Illumination for the secondary log, even when the same
    // production event also carries curatorRank (emitReliquaryUnlock ships both).
    // Banner priority is gated separately; do not drop the log field on rank-up.
    if (event.illuminatedPageId) {
      illuminatedPageId = event.illuminatedPageId;
    }
    if (rankUp !== null) {
      curatorRank = rankUp;
      // Rank-up outranks Illumination and plain unlock (rarer prestige moment).
      banner = { kind: 'rankUp', rank: rankUp };
    } else if (event.illuminatedPageId) {
      // Illumination outranks plain unlock; never overwrites a rank-up banner.
      if (banner === null || banner.kind === 'unlock' || banner.kind === 'illuminate') {
        banner = { kind: 'illuminate', pageId: event.illuminatedPageId };
      }
    } else if (banner === null || banner.kind === 'unlock') {
      // Plain unlock only fills the slot when no higher tier has claimed it yet
      // in this drain; a later plain unlock still updates the unlock banner.
      banner = { kind: 'unlock', relic: log };
    }
  }

  return {
    logs,
    banner,
    playSound: logs.length > 0,
    motion: logs.length > 0 && !reducedMotion,
    refreshWindow: logs.length > 0,
    illuminatedPageId,
    curatorRank,
    retroCount,
  };
}

// ---------------------------------------------------------------------------
// Window refresh signature: compact key the cold painter's slow-band diffs.
// ---------------------------------------------------------------------------

export interface ReliquaryRefreshSigParts {
  owned: number;
  total: number;
  curatorRank: number;
  recentSig: string;
  marksSize: number;
  nav: ReliquaryNavId;
  pageId: string | null;
  /** Optional clear digest so open-window clear meters stay live. */
  clearsDigest?: number;
  /**
   * Grid / ownership digest so an open page grid stays live on silhouette
   * fill (discovered size + firstFind key count + active page owned).
   */
  ownershipDigest?: number;
  /**
   * Obtain-tally digest so a REPEAT obtain repaints an open window. It is the
   * only dimension that moves on one: a duplicate fills no silhouette, mints no
   * first-find key, and changes no total.
   */
  countsDigest?: number;
  /** Live search needle, so a keystroke repaints the narrowed list. */
  search?: string;
  /** Live grid ownership filter, so a chip click repaints the grid. */
  ownedFilter?: ReliquaryOwnedFilter;
}

/** Compact repaint signature. Equal parts elide the rebuild. */
export function reliquaryRefreshSig(parts: ReliquaryRefreshSigParts): string {
  return JSON.stringify([
    parts.owned,
    parts.total,
    parts.curatorRank,
    parts.recentSig,
    parts.marksSize,
    parts.nav,
    parts.pageId,
    parts.clearsDigest ?? 0,
    parts.ownershipDigest ?? 0,
    parts.countsDigest ?? 0,
    parts.search ?? '',
    parts.ownedFilter ?? 'all',
  ]);
}

/**
 * Compact digest of every page's clear meters, folding the PRIMARY and the
 * SECONDARY count per page, so a pure clear bump (no ownership change) still
 * refreshes an open window. Both meters are folded because both paint: a
 * digest that read only the primary would leave an open header showing a
 * stale secondary count whenever the two counters moved apart (a mirrored
 * world replaying counters, or a future secondary stat that bumps alone).
 * The +1 keeps 0 distinct from undefined (meter absent); the two distinct
 * multipliers keep "primary 5" from colliding with "secondary 5".
 */
export function reliquaryClearsDigest(
  pages: readonly { id: string }[],
  clearCount?: (pageId: string) => number | undefined,
  secondaryClearCount?: (pageId: string) => number | undefined,
): number {
  let digest = 0;
  for (const page of pages) {
    const n = clearCount?.(page.id);
    if (n !== undefined) digest = (digest * 31 + (n + 1)) | 0;
    const s = secondaryClearCount?.(page.id);
    if (s !== undefined) digest = (digest * 33 + (s + 1)) | 0;
  }
  return digest;
}

/**
 * Compact digest of grid-relevant ownership so a pure silhouette fill (or a
 * firstFind stamp) moves the open-window signature even when catalog totals
 * already matched by coincidence.
 */
export function reliquaryOwnershipDigest(parts: {
  discoveredSize: number;
  marksSize: number;
  firstFindCount: number;
  /** Owned count on the active page, or 0 when no page is open. */
  pageOwned: number;
}): number {
  // Small primes keep collisions rare for realistic sizes without allocation.
  return (
    (((parts.discoveredSize * 1009 + parts.marksSize) * 1009 + parts.firstFindCount) * 1009 +
      parts.pageOwned) |
    0
  );
}

/**
 * Compact digest of the sparse obtain tally, the dimension that carries a
 * REPEAT obtain into an open window's signature.
 *
 * Size AND sum, because either alone has a live blind spot: a first obtain
 * mints a key (size moves, sum moves), a duplicate only bumps a value (sum
 * moves alone), and size catches a whole-record swap only when the key
 * COUNT changes with it (an equal-cardinality swap with an equal sum would
 * elide; unreachable live, because per-key counts only increment and a
 * record swap moves owned/recentSig/marksSize in the same signature). Both
 * folds are order-independent on purpose: an online mirror rebuilds the
 * record wholesale, and a re-ordered rebuild of the SAME tally must still
 * elide rather than repaint.
 *
 * Counted in place (for..in plus hasOwn, the firstFindCount precedent) so a
 * slow-band poll that elides allocates nothing; the hasOwn guard keeps the
 * fold own-keys-only, and the numeric guard keeps a prototype-shaped key from
 * poisoning the sum with NaN, which would then compare unequal forever and
 * repaint the window on every poll.
 */
export function reliquaryObtainCountsDigest(counts: ReliquaryObtainCountLookup): number {
  let size = 0;
  let sum = 0;
  for (const id in counts) {
    if (!Object.hasOwn(counts, id)) continue;
    size += 1;
    const n = counts[id];
    if (typeof n === 'number' && Number.isFinite(n)) sum = (sum + n) | 0;
  }
  return (size * 1009 + sum) | 0;
}

/** Stable digest of the recent ring (order matters; the ring arrives from the
 *  facet oldest-first, and the join preserves that order verbatim). */
export function reliquaryRecentSig(recent: readonly string[]): string {
  return recent.join('\u0001');
}

/** True when a string is a known Reliquary nav id. */
export function isReliquaryNavId(value: string): value is ReliquaryNavId {
  return (RELIQUARY_NAV as readonly string[]).includes(value);
}

/** Whole-percent fill for an owned/total pair, the one number every Reliquary
 *  meter draws; the empty-pair case pins at zero rather than dividing by it. */
export function reliquaryFillPct(owned: number, total: number): number {
  return total > 0 ? Math.round((owned / total) * 100) : 0;
}

/** The one flash/cell key shape, kind-namespaced because slot ids are not:
 *  the Hud arms the fill flash with it and the painter matches cells on it,
 *  so a bare-id arming can never light a same-named cell of another kind. */
export function reliquaryFlashKey(kind: string, id: string): string {
  return `${kind}:${id}`;
}

/**
 * Where focus should land when the control that held it does not survive its
 * own jump. A shelf card or a page-jump row triggers a rebuild that replaces
 * the surface it lived on, so the exact data-focus-key restore finds nothing
 * and would fall through to the Close button, one Enter press from closing
 * the window a keyboard player just asked to open further. The fallback is
 * the nearest control that names where they landed: the shelf's own rail
 * button for a card, the Back button for any jump into a page detail.
 */
export function reliquaryFocusFallbackKey(focusKey: string | null): string | null {
  if (focusKey === null) return null;
  if (focusKey.startsWith('card:')) return `nav:${focusKey.slice('card:'.length)}`;
  if (
    focusKey.startsWith('recent:') ||
    focusKey.startsWith('nearly:') ||
    focusKey.startsWith('page:')
  ) {
    return 'back';
  }
  return null;
}

/** The population-rarity fraction for one relic id, or null when there is
 *  nothing to render: no aggregate (offline, or the fetch failed), an empty
 *  eligible population, or a relic nobody has found (absent from the map by
 *  the endpoint contract; weapon-skin, title, and mount relics are always
 *  absent). The painter renders a rarity line only for a non-null value, so
 *  absent data means no node at all (the deedRarityFraction contract). The
 *  hasOwn gate keeps a wire-parsed map honest: a prototype-colliding id must
 *  read as absent, never as a function. */
export function reliquaryRarityFraction(
  rarity: ReliquaryRarity | null,
  relicId: string,
): number | null {
  if (rarity === null || rarity.totalEligible <= 0) return null;
  if (!Object.hasOwn(rarity.found, relicId)) return null;
  const found = rarity.found[relicId];
  if (found === undefined) return null;
  // The aggregate's scans are not one snapshot, so a count can outrun the
  // denominator by a hair; a rarity line must never read over 100 percent.
  return Math.min(1, found / rarity.totalEligible);
}

/** The illumination-rarity fraction for one page id, on exactly the
 *  reliquaryRarityFraction contract (null means the header omits the line;
 *  a page nobody has illuminated is absent from the map, which also covers
 *  the personal Riftbound page: it can never illuminate, pinned in
 *  tests/reliquary_state.test.ts and the reliquary content sweep). */
export function reliquaryPageRarityFraction(
  rarity: ReliquaryRarity | null,
  pageId: string,
): number | null {
  if (rarity === null || rarity.totalEligible <= 0) return null;
  if (!Object.hasOwn(rarity.illuminated, pageId)) return null;
  const illuminated = rarity.illuminated[pageId];
  if (illuminated === undefined) return null;
  return Math.min(1, illuminated / rarity.totalEligible);
}
