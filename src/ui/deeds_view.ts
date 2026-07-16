// Pure view-core for the Book of Deeds window (#deeds-window) and the
// watchlist HUD tracker. DOM/Three/i18n-free: it maps the IWorldDeeds facet
// reads (earned map, lifetime stat block, renown, active title) plus the
// static catalog (injected, so tests drive synthetic tables) to flat render
// models the thin painters draw. Registered in UI_PURE_CORES; unit-tested
// against both Sim- and ClientWorld-shaped inputs in tests/deeds_view.test.ts.
//
// Masking rules (the design contract):
// - A hidden deed contributes NOTHING (no entry, no counts, no search hits)
//   until earned; once earned it renders with an earned-only badge.
// - Hidden deeds carry category 'hidden' and no home-category data, so they
//   surface in the Feats display bucket (their authoring home); unlike feats
//   they bear Renown and count toward completion once earned.
// - Feats always render, marked, and never count toward completion or appear
//   in the nearest list.

import type { DeedDef, DeedStats, DeedTrigger } from '../sim/types';
import type { DeedsRarity } from '../world_api';
import { DEED_IMAGE_IDS } from './deed_image_ids';

/** Watchlist cap: at most this many deeds pinned to the HUD tracker. */
export const DEED_WATCH_CAP = 5;

// Fixed sidebar order (the overview id-prefix table). 'hidden' folds into
// 'feat' for display; an unknown future category value also lands on the
// Feats shelf rather than vanishing (forward compat).
export const DEED_DISPLAY_CATEGORIES = [
  'progression',
  'combat',
  'dungeon',
  'delve',
  'chronicle',
  'collection',
  'pvp',
  'social',
  'exploration',
  'feat',
] as const;
export type DeedDisplayCategory = (typeof DEED_DISPLAY_CATEGORIES)[number];

export function deedDisplayCategory(category: string): DeedDisplayCategory {
  if (category === 'hidden') return 'feat';
  return (DEED_DISPLAY_CATEGORIES as readonly string[]).includes(category)
    ? (category as DeedDisplayCategory)
    : 'feat';
}

// Bespoke crest set: the marquee highlight subset (title/border capstones and
// visually iconic milestones from the reviewed launch catalog); every other
// deed renders its display category's base crest. Exported so the window
// painter and any future consumer resolve identically.
export const DEED_BESPOKE_CRESTS: ReadonlySet<string> = new Set([
  'prog_veteran',
  'prog_eternal',
  'prog_prestige',
  'prog_level_cap',
  'cmb_first_blood',
  'cmb_thunzharr_unbroken',
  'dgn_nythraxis',
  'dgn_korzul_flawless',
  'dgn_nythraxis_deathless',
  'dgn_deepward',
  'dlv_nhalia_bells',
  'dlv_tumbler_premium',
  'chr_vale_chapter_iii',
  'chr_marsh_chapter_iii',
  'chr_peaks_chapter_iii',
  'col_discovery_250',
  'col_seven_regalia',
  'pvp_arena_1v1_1900',
  'pvp_vcup_wins_25',
  'soc_wyrms_hoard',
  'exp_world_traveler',
]);

/** Crest icon id for a deed: `deed_<id>` when the deed has committed painted art
 *  (DEED_IMAGE_IDS) OR a bespoke procedural recipe (DEED_BESPOKE_CRESTS), else the
 *  display category base `deed_cat_<category>`. The image branch in icons.ts outranks the
 *  bespoke recipe for the same id; the recipes stay as the forward-compat fallback tier
 *  (an artless bespoke deed still lands on deed_<id>, never the base crest). */
export function deedCrestId(id: string, category: string): string {
  return DEED_IMAGE_IDS.has(id) || DEED_BESPOKE_CRESTS.has(id)
    ? `deed_${id}`
    : `deed_cat_${deedDisplayCategory(category)}`;
}

export interface DeedProgress {
  current: number;
  target: number;
}

/** Progress for the counter-shaped trigger kinds the deedStats facet can
 *  evaluate client-side (clamped, never over target). Predicate, meta, and
 *  UNKNOWN trigger kinds (forward compat) return null: binary
 *  earned/unearned. */
export function deedProgress(
  trigger: DeedTrigger,
  stats: Readonly<DeedStats>,
): DeedProgress | null {
  switch (trigger.kind) {
    case 'stat': {
      return clampProgress(stats.counters[trigger.stat] ?? 0, trigger.count);
    }
    case 'dungeonClears': {
      const normal = stats.dungeonClears[trigger.dungeonId] ?? 0;
      const heroic = stats.dungeonClears[`${trigger.dungeonId}:heroic`] ?? 0;
      const current =
        trigger.difficulty === 'normal'
          ? normal
          : trigger.difficulty === 'heroic'
            ? heroic
            : normal + heroic;
      return clampProgress(current, trigger.count);
    }
    case 'collectItems': {
      let current = 0;
      for (const itemId of trigger.itemIds) if (stats.itemsDiscovered.has(itemId)) current++;
      return clampProgress(current, trigger.count ?? trigger.itemIds.length);
    }
    case 'visits': {
      let current = 0;
      for (const markId of trigger.markIds) if (stats.visited.has(markId)) current++;
      return clampProgress(current, trigger.count ?? trigger.markIds.length);
    }
    default:
      return null;
  }
}

function clampProgress(current: number, target: number): DeedProgress | null {
  if (!(target > 0)) return null;
  return { current: Math.min(current, target), target };
}

function progressFraction(progress: DeedProgress | null): number {
  return progress ? progress.current / progress.target : 0;
}

export const DEED_FILTERS = ['all', 'earned', 'unearned', 'nearly'] as const;
export type DeedsFilter = (typeof DEED_FILTERS)[number];

/** How complete a 'nearly done' deed must be to pass that filter arm. */
export const DEED_NEARLY_FRACTION = 0.5;

export interface DeedsViewInput {
  // The IWorldDeeds facet reads (identical shapes offline and online).
  deedsEarned: ReadonlyMap<string, string>;
  deedStats: Readonly<DeedStats>;
  renown: number;
  activeTitle: string | null;
  // The static catalog, injected (the bank-view lookup precedent): the
  // painter binds the live DEEDS/DEED_ORDER, tests drive synthetic tables.
  deeds: Readonly<Record<string, DeedDef>>;
  order: readonly string[];
  // Window view-state owned by the painter.
  category: DeedDisplayCategory | 'titles';
  filter: DeedsFilter;
  // Pre-lowercased by the painter with locale rules (bank_filter precedent);
  // empty means no search.
  search: string;
  watched: ReadonlySet<string>;
  // Localized searchable text (name + desc), pre-lowercased by the painter so
  // the core stays i18n-free; both sides of the match share one casing rule.
  searchText(id: string): string;
}

export interface DeedRecentModel {
  id: string;
  crestId: string;
  earnedDay: string;
}

export interface DeedNearestModel {
  id: string;
  progress: DeedProgress;
}

export interface DeedsSummaryModel {
  renown: number;
  // Earned / visible-total completion. Hidden unearned deeds and ALL feats
  // are excluded from the denominator; an earned hidden deed counts in both.
  earned: number;
  visibleTotal: number;
  completion: number;
  // Last 5 unlocks by earned day, newest first (catalog order breaks ties,
  // later entries first: appended content reads as more recent).
  recent: DeedRecentModel[];
  // Top 3 unearned counter-trigger deeds by progress fraction (feats and
  // zero-progress deeds excluded), catalog order breaking ties.
  nearest: DeedNearestModel[];
}

export interface DeedsCategoryModel {
  category: DeedDisplayCategory;
  earned: number;
  visible: number;
}

export interface DeedEntryModel {
  id: string;
  earned: boolean;
  // The utcDay earned ('YYYY-MM-DD'); null when unearned or when the host set
  // no calendar ('' on the wire), which hides the date line entirely.
  earnedDay: string | null;
  renown: number;
  progress: DeedProgress | null;
  watchable: boolean;
  watched: boolean;
  feat: boolean;
  // Earned-only badge for a hidden deed now revealed on the Feats shelf.
  hiddenBadge: boolean;
  titleReward: boolean;
  crestId: string;
}

export interface DeedTitleOption {
  // null is the "No Title" option.
  id: string | null;
  active: boolean;
}

export interface DeedsViewModel {
  summary: DeedsSummaryModel;
  categories: DeedsCategoryModel[];
  entries: DeedEntryModel[];
  titles: DeedTitleOption[];
}

/** Build the whole cold-window model. Per-call allocation is fine here (the
 *  window is event-driven); the TRACKER view below is the slow-band path and
 *  stays allocation-light. */
export function buildDeedsView(input: DeedsViewInput): DeedsViewModel {
  const counts = new Map<DeedDisplayCategory, { earned: number; visible: number }>();
  for (const category of DEED_DISPLAY_CATEGORIES) counts.set(category, { earned: 0, visible: 0 });

  const entries: DeedEntryModel[] = [];
  const titles: DeedTitleOption[] = [{ id: null, active: input.activeTitle === null }];
  let earnedCount = 0;
  let visibleTotal = 0;

  for (const id of input.order) {
    const def = input.deeds[id];
    if (!def) continue;
    const earned = input.deedsEarned.has(id);
    // Hidden masking: no entry, no counts, no search hits until earned.
    if (def.hidden && !earned) continue;
    const feat = def.feat === true;
    const bucket = deedDisplayCategory(def.category);
    const bucketCounts = counts.get(bucket);
    if (bucketCounts) {
      bucketCounts.visible++;
      if (earned) bucketCounts.earned++;
    }
    if (!feat) {
      visibleTotal++;
      if (earned) earnedCount++;
    }
    if (earned && def.reward?.kind === 'title') {
      titles.push({ id, active: input.activeTitle === id });
    }
    if (input.category !== bucket) continue;
    const progress = earned ? null : deedProgress(def.trigger, input.deedStats);
    if (!matchesFilter(input.filter, earned, progress)) continue;
    if (input.search !== '' && !input.searchText(id).includes(input.search)) continue;
    const day = input.deedsEarned.get(id) ?? '';
    entries.push({
      id,
      earned,
      earnedDay: earned && day !== '' ? day : null,
      renown: def.renown,
      progress,
      watchable: !earned,
      watched: input.watched.has(id),
      feat,
      hiddenBadge: def.hidden === true,
      titleReward: def.reward?.kind === 'title',
      crestId: deedCrestId(id, def.category),
    });
  }

  return {
    summary: buildSummary(input, earnedCount, visibleTotal),
    categories: DEED_DISPLAY_CATEGORIES.map((category) => {
      const c = counts.get(category) ?? { earned: 0, visible: 0 };
      return { category, earned: c.earned, visible: c.visible };
    }),
    entries,
    titles,
  };
}

function matchesFilter(
  filter: DeedsFilter,
  earned: boolean,
  progress: DeedProgress | null,
): boolean {
  switch (filter) {
    case 'earned':
      return earned;
    case 'unearned':
      return !earned;
    case 'nearly':
      return !earned && progressFraction(progress) >= DEED_NEARLY_FRACTION;
    default:
      return true;
  }
}

function buildSummary(
  input: DeedsViewInput,
  earned: number,
  visibleTotal: number,
): DeedsSummaryModel {
  // Recent unlocks: earned entries whose id still exists in the catalog
  // (content drift tolerated by skipping), newest day first; catalog order
  // (later first) breaks same-day ties deterministically.
  const orderIndex = new Map<string, number>();
  for (let i = 0; i < input.order.length; i++) orderIndex.set(input.order[i], i);
  const recent: { id: string; day: string; index: number }[] = [];
  for (const [id, day] of input.deedsEarned) {
    const def = input.deeds[id];
    if (!def) continue;
    recent.push({ id, day, index: orderIndex.get(id) ?? 0 });
  }
  recent.sort((a, b) => (a.day === b.day ? b.index - a.index : a.day < b.day ? 1 : -1));

  const nearest: { id: string; progress: DeedProgress; fraction: number; index: number }[] = [];
  for (const id of input.order) {
    const def = input.deeds[id];
    if (!def || def.feat || input.deedsEarned.has(id)) continue;
    if (def.hidden) continue;
    const progress = deedProgress(def.trigger, input.deedStats);
    if (!progress) continue;
    const fraction = progressFraction(progress);
    if (fraction <= 0) continue;
    nearest.push({ id, progress, fraction, index: orderIndex.get(id) ?? 0 });
  }
  nearest.sort((a, b) => (a.fraction === b.fraction ? a.index - b.index : b.fraction - a.fraction));

  return {
    renown: input.renown,
    earned,
    visibleTotal,
    completion: visibleTotal > 0 ? earned / visibleTotal : 0,
    recent: recent.slice(0, 5).map((entry) => ({
      id: entry.id,
      crestId: deedCrestId(entry.id, input.deeds[entry.id].category),
      earnedDay: entry.day,
    })),
    nearest: nearest.slice(0, 3).map((entry) => ({ id: entry.id, progress: entry.progress })),
  };
}

// ---------------------------------------------------------------------------
// Watchlist
// ---------------------------------------------------------------------------

export interface WatchToggleResult {
  watched: ReadonlySet<string>;
  // True when the add was refused at the cap (the button renders disabled
  // with a full note; never a silent no-op).
  full: boolean;
  changed: boolean;
}

export interface WatchPruneResult {
  watched: ReadonlySet<string>;
  changed: boolean;
}

/** Drop earned and catalog-unknown ids from the watch set (the exact skip
 *  predicate of buildDeedTrackerViewInto, so the stored set and the tracker
 *  display can never diverge). An earned watched deed loses its unwatch
 *  button, so without this prune it would hold its cap slot forever. Returns
 *  the SAME set instance on the common nothing-dropped path. */
export function pruneWatched(
  watched: ReadonlySet<string>,
  deedsEarned: ReadonlyMap<string, string>,
  deeds: Readonly<Record<string, DeedDef>>,
): WatchPruneResult {
  let dropped = false;
  for (const id of watched) {
    if (!deeds[id] || deedsEarned.has(id)) {
      dropped = true;
      break;
    }
  }
  if (!dropped) return { watched, changed: false };
  const next = new Set<string>();
  for (const id of watched) {
    if (deeds[id] && !deedsEarned.has(id)) next.add(id);
  }
  return { watched: next, changed: true };
}

/** Toggle a deed on the watch set, enforcing the cap of DEED_WATCH_CAP.
 *  Returns the UNCHANGED set plus the full flag when an add hits the cap. */
export function toggleWatch(watched: ReadonlySet<string>, id: string): WatchToggleResult {
  if (watched.has(id)) {
    const next = new Set(watched);
    next.delete(id);
    return { watched: next, full: false, changed: true };
  }
  if (watched.size >= DEED_WATCH_CAP) return { watched, full: true, changed: false };
  const next = new Set(watched);
  next.add(id);
  return { watched: next, full: false, changed: true };
}

// ---------------------------------------------------------------------------
// Watchlist HUD tracker (slow-band: reused container, no per-call garbage)
// ---------------------------------------------------------------------------

export interface DeedTrackerLine {
  id: string;
  hasProgress: boolean;
  current: number;
  target: number;
}

export interface DeedTrackerView {
  visible: boolean;
  collapsed: boolean;
  // Compact touch tier: the header is a count chip that opens the Book of Deeds
  // dialog rather than a disclosure toggle (the rows are folded away there). Set
  // by the host from document.body, not by buildDeedTrackerViewInto (which stays
  // DOM-free); the painter drops the disclosure a11y when it is true.
  chip: boolean;
  // Live line count; `lines` slots past it hold stale data by design.
  count: number;
  lines: DeedTrackerLine[];
}

/** Preallocate the reused tracker container (one per painter instance). */
export function makeDeedTrackerView(): DeedTrackerView {
  const lines: DeedTrackerLine[] = [];
  for (let i = 0; i < DEED_WATCH_CAP; i++) {
    lines.push({ id: '', hasProgress: false, current: 0, target: 0 });
  }
  return { visible: false, collapsed: false, chip: false, count: 0, lines };
}

/** Fill `out` with the watched, unearned deeds (earned and catalog-unknown
 *  ids drop off automatically). Mutates and returns the SAME container: the
 *  slow-band path allocates nothing per call. */
export function buildDeedTrackerViewInto(
  out: DeedTrackerView,
  watched: ReadonlySet<string>,
  deedsEarned: ReadonlyMap<string, string>,
  stats: Readonly<DeedStats>,
  deeds: Readonly<Record<string, DeedDef>>,
  collapsed: boolean,
): DeedTrackerView {
  let count = 0;
  for (const id of watched) {
    if (count >= out.lines.length) break;
    const def = deeds[id];
    if (!def || deedsEarned.has(id)) continue;
    const line = out.lines[count];
    line.id = id;
    const progress = deedProgress(def.trigger, stats);
    line.hasProgress = progress !== null;
    line.current = progress ? progress.current : 0;
    line.target = progress ? progress.target : 0;
    count++;
  }
  out.count = count;
  out.visible = count > 0;
  out.collapsed = collapsed;
  return out;
}

// ---------------------------------------------------------------------------
// The earned moment: one drain's worth of deedUnlocked events, planned purely
// so the HUD arm stays a thin consumer and the batching rules are unit-pinned.
// ---------------------------------------------------------------------------

export interface DeedUnlockPlan {
  // Every catalog-known, non-retro unlock in drain order: one gold log line
  // each (the durable copy).
  logIds: string[];
  // Banners coalesce to the LAST unlock (the banner element is single-slot;
  // the log carries every line), null when the drain held none.
  bannerId: string | null;
  // Non-retro unlocks whose reward is a title: a second log line hints the
  // Titles section.
  titleHintIds: string[];
  // One celebration sound per drain, not one per unlock.
  playSound: boolean;
  // Retro back-credits (on-join catch-up): NO banner, NO audio, ONE summary
  // log line with this count.
  retroCount: number;
}

/** Plan the HUD reaction to a drain of deedUnlocked events. Catalog-unknown
 *  ids (content drift) are skipped entirely, never surfaced. */
export function buildDeedUnlockPlan(
  events: readonly { deedId: string; retro?: boolean }[],
  deeds: Readonly<Record<string, DeedDef>>,
): DeedUnlockPlan {
  const logIds: string[] = [];
  const titleHintIds: string[] = [];
  let retroCount = 0;
  for (const event of events) {
    const def = deeds[event.deedId];
    if (!def) continue;
    if (event.retro) {
      retroCount++;
      continue;
    }
    logIds.push(event.deedId);
    if (def.reward?.kind === 'title') titleHintIds.push(event.deedId);
  }
  return {
    logIds,
    bannerId: logIds.length > 0 ? logIds[logIds.length - 1] : null,
    titleHintIds,
    playSound: logIds.length > 0,
    retroCount,
  };
}

// ---------------------------------------------------------------------------
// Window refresh signature: the compact key the cold painter's slow-band
// refresh diffs, extracted pure so every repaint dimension is unit-pinned
// (dropping one would silently freeze an open window).
// ---------------------------------------------------------------------------

/** The eight dimensions a slow-band repaint keys on. */
export interface DeedsRefreshSigParts {
  renown: number;
  earnedCount: number;
  activeTitle: string | null;
  filter: DeedsFilter;
  search: string;
  category: DeedDisplayCategory | 'titles';
  watchRev: number;
  statsDigest: number;
}

/** Compact repaint signature (JSON keeps '' vs null and cross-type values
 *  unambiguous). Equal parts elide the rebuild; any moved part triggers it. */
export function deedsRefreshSig(parts: DeedsRefreshSigParts): string {
  return JSON.stringify([
    parts.renown,
    parts.earnedCount,
    parts.activeTitle,
    parts.filter,
    parts.search,
    parts.category,
    parts.watchRev,
    parts.statsDigest,
  ]);
}

/** The rarity fraction for one deed card, or null when there is nothing to
 *  render: no aggregate (offline, or the fetch failed), an empty eligible
 *  population, or a deed nobody has earned (absent from the map by the
 *  endpoint contract). The painter renders a rarity line only for a non-null
 *  value, so absent data means no node at all. */
export function deedRarityFraction(rarity: DeedsRarity | null, deedId: string): number | null {
  if (rarity === null || rarity.totalEligible <= 0) return null;
  const earned = rarity.earned[deedId];
  if (earned === undefined) return null;
  // The aggregate's two scans are not one snapshot, so a count can outrun the
  // denominator by a hair; a rarity line must never read over 100 percent.
  return Math.min(1, earned / rarity.totalEligible);
}

/** Digest over the lifetime stat block: any counter climb, dungeon clear,
 *  discovery, or first visit moves it (all monotonic, so climbs never cancel),
 *  keeping an open window's progress bars live between unlocks. */
export function deedStatsDigest(stats: Readonly<DeedStats>): number {
  let digest = stats.itemsDiscovered.size + stats.visited.size;
  for (const key in stats.counters) digest += stats.counters[key as never] as number;
  for (const key in stats.dungeonClears) digest += stats.dungeonClears[key];
  return digest;
}
