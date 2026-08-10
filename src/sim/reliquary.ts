// The Reliquary runtime: sparse first-find meta, capped recent finds, pure
// completion helpers. System module behind the SimContext seam (functions only;
// state lives on PlayerMeta.reliquary). Ownership of item relics reuses
// deedStats.itemsDiscovered via markItemDiscovered; this module never dual-
// writes a second full discovery set.
//
// Determinism: pure state transitions over live meta references. No Rng, no
// wall clock, no Math.random / Date.now. Clear counts are READ from existing
// sources (dungeonClears / delveClears / deedStats.counters via a deed_stat
// clearSource) at first obtain only (never invented on retro).
//
// Performance: firstFind and marks are allowlist-only (catalogued ids).
// recent is a fixed-cap ring. Serialize omits empty. No per-drop saveCharacter.
// The wire blob is memoized per state revision (reliquaryWireJson), and each
// fill chain builds its ownership snapshot ONCE and threads it, rather than
// rescanning inventory + bank for owned mounts at every step.

import {
  isCataloguedRelicItem,
  isCataloguedRelicMark,
  RELIQUARY_HORIZON_TITLES,
  RELIQUARY_ITEM_TO_PAGES,
  RELIQUARY_MARK_IDS,
  RELIQUARY_MARK_TO_PAGES,
  RELIQUARY_PAGE_ORDER,
  RELIQUARY_PAGES,
  RELIQUARY_PAGES_BY_ID,
  type ReliquaryClearSource,
  type ReliquaryPageDef,
  type ReliquaryRelicDef,
} from './content/reliquary';
import { ITEMS } from './data';
import { ownedMounts as ownedMountKeys } from './mounts';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import type { DeedStatKey, DeedStats, ItemDef } from './types';
import { DEED_STAT_KEYS } from './types';

/** Horizon title deed ids that score catalogRankOwned (title rewards only). */
const HORIZON_TITLE_DEED_IDS: ReadonlySet<string> = new Set(RELIQUARY_HORIZON_TITLES);

/** Cap for the recent-find ring buffer (plan: 12). Drop oldest on push. */
export const RELIQUARY_RECENT_CAP = 12;

/** Cap on a single relic's obtain tally. Far above any real play, so it never
 *  binds in practice; it exists so a hand-edited blob cannot park a number
 *  that formats into an absurd tooltip or overflows a later sum. */
export const RELIQUARY_OBTAIN_COUNT_CAP = 1e9;

/** Sparse first-obtain metadata for one catalogued relic item id. */
export interface ReliquaryFirstFind {
  /**
   * Clear count of the page's source meter at first obtain, present only when
   * that meter had actually turned over at least once. Zero is omitted rather
   * than stamped, because "first found on clear 0" states a fact about a run
   * that did not happen: the meter reads zero exactly when the player has no
   * clear of that source behind them, whether the relic dropped mid first run
   * before its clear was credited or arrived with no run behind it at all.
   * Absent means unknown, the same shape a retro fill writes.
   *
   * A first find that arrived through a MOVEMENT grant is sparse too, at any
   * meter value: the stamp answers "which clear did you find this on", and a
   * relic bought, traded, or mailed to you was not found on one of your runs
   * at all. See noteRelicItemFind for where the two gates live.
   */
  clears?: number;
}

/**
 * Sparse Reliquary state on PlayerMeta. Item ownership is NOT here: it lives
 * in deedStats.itemsDiscovered. Only catalogued first-find meta, authored
 * non-item marks, a capped recent ring, and the sparse obtain tally.
 */
export interface ReliquaryState {
  firstFind: Record<string, ReliquaryFirstFind>;
  marks: Set<string>;
  recent: string[];
  /**
   * Per-relic obtain tally, keyed by catalogued relic ITEM id, sparse (an
   * absent id has never been counted). Counts WORLD-SOURCED acquisitions
   * only; see noteRelicObtain. Information, never a score: nothing reads it
   * for power, drop rate, pity, or Curator rank, and it is never membership
   * (ownership stays on deedStats.itemsDiscovered).
   */
  counts: Record<string, number>;
  /**
   * Page ids this character has EVER illuminated (completed), sticky: catalog
   * growth can make a page's live completion read incomplete again, but the
   * record of the first illumination stays, so every once-ever celebration
   * (the client banner, the server marquee) keys off membership here rather
   * than re-firing on a re-completion. The field name is deliberately not a
   * prefix of the event field `illuminatedPageId`, so the architecture
   * guard's surface regex cannot false-positive on the emit path.
   */
  illuminatedPages: Set<string>;
}

/** One serialized firstFind entry: sparse provenance plus the folded tally. */
export interface SavedReliquaryFirstFind {
  /** See ReliquaryFirstFind.clears (omitted at zero). */
  clears?: number;
  /** state.counts[itemId], folded onto its entry. Only ever >= 1. */
  count?: number;
}

/** Serialized shape (CharacterState.reliquary). Omit-empty on write. The
 *  tally rides the firstFind entries rather than a fifth top-level key, so a
 *  relic costs one object either way and the blob keeps four keys at most
 *  (firstFind, illuminatedPages, marks, recent, each omitted when empty).
 *  illuminatedPages is save-only from the client's perspective: it rides the
 *  reliq wire blob because wire shape IS save shape (the byte-pinned memo
 *  contract), but ClientWorld deliberately does not mirror it (no facet
 *  consumer; the banner keys off the event). Accepted cost: at most the
 *  page-id list, bounded by the catalog, on the rarely-dirty reliq key
 *  (worst case every page id at once, roughly a kilobyte). */
export interface SavedReliquaryState {
  firstFind?: Record<string, SavedReliquaryFirstFind>;
  illuminatedPages?: string[];
  marks?: string[];
  recent?: string[];
}

export function freshReliquaryState(): ReliquaryState {
  return { firstFind: {}, marks: new Set(), recent: [], counts: {}, illuminatedPages: new Set() };
}

/** True when the state has nothing worth persisting. `counts` is deliberately
 *  NOT read here: every counted relic carries a firstFind entry (noteRelicObtain
 *  writes the carrier the saved tally rides on), so a counts-only state cannot
 *  exist, and testing it would let a state with a tally and nothing else
 *  serialize to a firstFind-less object the count could not survive.
 *  `illuminatedPages` MUST count, in contrast: the set has no carrier (a page
 *  membership rides no firstFind entry), so an illuminated-only state really
 *  can exist and would lose its record if this read skipped it. */
export function isReliquaryStateEmpty(state: ReliquaryState): boolean {
  return (
    Object.keys(state.firstFind).length === 0 &&
    state.marks.size === 0 &&
    state.recent.length === 0 &&
    state.illuminatedPages.size === 0
  );
}

/**
 * Serialize with zero-default omission and sorted mark lists so equal states
 * are byte-stable and untouched characters never grow a reliquary key.
 */
export function serializeReliquaryState(state: ReliquaryState): SavedReliquaryState | undefined {
  if (isReliquaryStateEmpty(state)) return undefined;
  const out: SavedReliquaryState = {};
  const firstKeys = Object.keys(state.firstFind).sort();
  if (firstKeys.length > 0) {
    const firstFind: Record<string, SavedReliquaryFirstFind> = {};
    for (const k of firstKeys) {
      const entry = state.firstFind[k];
      // Sparse per FIELD, not per entry: an entry with neither provenance nor
      // a tally still writes {}, because membership is the entry existing.
      const slim: SavedReliquaryFirstFind = {};
      if (entry.clears !== undefined) slim.clears = entry.clears;
      const count = state.counts[k];
      if (typeof count === 'number' && count >= 1) slim.count = count;
      firstFind[k] = slim;
    }
    out.firstFind = firstFind;
  }
  // Alphabetical key position (firstFind, illuminatedPages, marks, recent):
  // the wire memo's byte pin depends on insertion order here.
  if (state.illuminatedPages.size > 0) out.illuminatedPages = [...state.illuminatedPages].sort();
  if (state.marks.size > 0) out.marks = [...state.marks].sort();
  if (state.recent.length > 0) out.recent = [...state.recent];
  return out;
}

/**
 * Restore from a saved blob. Filters firstFind and marks to catalogued ids
 * only so a hand-edited save cannot grow unbounded membership. The marks and
 * recent arms delegate to the narrow helpers below (restoreReliquaryMarks /
 * restoreReliquaryRecent), which the public character-sheet path calls
 * directly rather than restoring the whole state for one surface: same
 * filters, one implementation, no second place for the rules to drift.
 */
export function restoreReliquaryState(saved: SavedReliquaryState | undefined): ReliquaryState {
  const state = freshReliquaryState();
  if (!saved) return state;
  if (saved.firstFind) {
    for (const [itemId, entry] of Object.entries(saved.firstFind)) {
      if (!isCataloguedRelicItem(itemId)) continue;
      // Array.isArray as well as the typeof gate: `typeof [] === 'object'`, so
      // a clone-mangled or hand-edited entry that arrived as an ARRAY used to
      // slip through and land as an empty carrier, quietly inventing
      // membership for a relic whose row was junk. Dropped whole, like every
      // other non-object entry.
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const slim: ReliquaryFirstFind = {};
      if (typeof entry.clears === 'number' && Number.isFinite(entry.clears)) {
        // Floor FIRST, then the >= 1 gate, so 0 and 0.x drop the field while
        // the entry survives, matching what the live stamp would have written.
        const clears = Math.floor(entry.clears);
        if (clears >= 1) slim.clears = clears;
      }
      // A pre-Phase-17 blob still carries the retired `pageId` diagnostic and
      // possibly a `clears: 0`. Neither is read: the entry loads clean, and
      // where a relic lives comes from the catalog index, which is where the
      // fallback arm always computed the identical answer. One release of
      // tolerance, then no save written since carries the field at all. That
      // clock never started in production: the Reliquary has not shipped, so
      // only feature-branch and PBE rows ever wrote `pageId`, and this
      // tolerance exists for THEM, not for any released save.
      state.firstFind[itemId] = slim;
      // The tally is split back out of its carrier entry, so counts keys can
      // only ever be a SUBSET of the entries that survived the filters above:
      // a count riding an entry this loop drops whole vanishes with it.
      const count = sanitizeObtainCount(entry.count);
      if (count !== undefined) state.counts[itemId] = count;
    }
  }
  // MERGE into the fresh state's container, never reassign it: under the sim's
  // immutability waiver a live container is FILLED in place and its identity is
  // what holders keep, so swapping the Set (or the array below) out detaches
  // every existing reference instead of updating it. Every sibling arm here
  // (firstFind, counts, illuminatedPages) already merges that way; these two are
  // the only arms that delegate to a helper returning a fresh container, so they
  // are the only ones where a bare assignment was ever spellable.
  for (const m of restoreReliquaryMarks(saved)) state.marks.add(m);
  // Sticky illumination record. Same catalog filter discipline as the other
  // surfaces: only string entries naming a live page id land (Object.hasOwn,
  // not `in`, so a prototype key on the pages index cannot invent a page),
  // and the Set target dedupes a hand-edited blob's repeats. A pre-Phase-18
  // blob has no field at all and restores to the empty set, a fixed point
  // (serialize omits the empty set right back).
  if (Array.isArray(saved.illuminatedPages)) {
    for (const pageId of saved.illuminatedPages) {
      if (typeof pageId !== 'string') continue;
      if (!Object.hasOwn(RELIQUARY_PAGES_BY_ID, pageId)) continue;
      state.illuminatedPages.add(pageId);
    }
  }
  // In place for the same reason as marks above: append into the fresh ring
  // rather than swapping the array out from under it. A push LOOP rather than
  // one spread call, so the ring's capacity is never coupled to the engine's
  // argument-count ceiling: RELIQUARY_RECENT_CAP is twelve today, but a spread
  // makes every restored entry an argument, and a future cap in the tens of
  // thousands would turn a legitimate save into a RangeError on load.
  for (const id of restoreReliquaryRecent(saved)) state.recent.push(id);
  return state;
}

/**
 * Narrow marks-only restore: the SAME catalog filter and the same corrupt-value
 * tolerance restoreReliquaryState applies, without building the other three
 * surfaces. Exists for the public character-sheet path
 * (server/character_sheet.ts sheetReliquaryFromState), which reads marks and
 * recent only and used to pay a full restore per sheet read for one of them.
 * restoreReliquaryState delegates here, so the two can never drift.
 *
 * Array.isArray, matching every sibling surface: this runs on stored blobs
 * reached from the public character-sheet path, so a corrupt marks value (a
 * bare number, an object) must drop whole, never throw.
 */
export function restoreReliquaryMarks(saved: SavedReliquaryState | undefined): Set<string> {
  const marks = new Set<string>();
  const raw = saved?.marks;
  if (!Array.isArray(raw)) return marks;
  for (const mark of raw) {
    if (typeof mark === 'string' && RELIQUARY_MARK_IDS.has(mark)) marks.add(mark);
  }
  return marks;
}

/**
 * Narrow recent-ring restore, OLDEST-first like the live ring. Same delegation
 * rationale as restoreReliquaryMarks; same drop-whole tolerance for a corrupt
 * value.
 *
 * The ring is OLDEST-first, and restore must agree with pushRecent: the live
 * ring holds each id once (a repeat moves to the tail rather than appending),
 * so a hand-edited or legacy blob carrying the same id twice must not burn two
 * of the twelve slots. LAST occurrence wins, because a repeat find refreshes
 * recency, and when the survivors exceed the cap the NEWEST ones survive (drop
 * from the head, the oldest side), exactly as pushRecent's shift does. Relative
 * order is preserved either way. Walking from the newest end makes both rules
 * fall out at once: the first time an id is seen going backwards IS its last
 * occurrence, and stopping at the cap keeps the newest survivors.
 */
export function restoreReliquaryRecent(saved: SavedReliquaryState | undefined): string[] {
  const recent: string[] = [];
  const raw = saved?.recent;
  if (!Array.isArray(raw)) return recent;
  const seen = new Set<string>();
  const newestFirst: string[] = [];
  for (let i = raw.length - 1; i >= 0; i--) {
    const id = raw[i];
    if (typeof id !== 'string') continue;
    // Recent may hold item or mark ids that are still catalogued.
    if (!isCataloguedRelicItem(id) && !RELIQUARY_MARK_IDS.has(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    newestFirst.push(id);
    if (newestFirst.length >= RELIQUARY_RECENT_CAP) break;
  }
  for (let i = newestFirst.length - 1; i >= 0; i--) {
    recent.push(newestFirst[i]);
  }
  return recent;
}

/** Load guard for a saved obtain tally: a finite number, floored, at least 1
 *  (0 and 0.x mean "never counted", which is the absent key), capped. Anything
 *  else is dropped rather than coerced. */
function sanitizeObtainCount(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
  const n = Math.floor(raw);
  if (n < 1) return undefined;
  return Math.min(n, RELIQUARY_OBTAIN_COUNT_CAP);
}

// ---------------------------------------------------------------------------
// Clear-count reads (existing state only; never invent a parallel map)
// ---------------------------------------------------------------------------

/** Lifetime clears for a catalog clear source from live meta fields. */
export function clearCountForSource(
  meta: Pick<PlayerMeta, 'deedStats' | 'delveClears'>,
  source: ReliquaryClearSource | undefined,
): number | undefined {
  if (!source || source.kind === 'none') return undefined;
  if (source.kind === 'delve') {
    // The only writer is grantDelveClearTo (src/sim/delves/runs.ts), whose
    // clearKey shape is `${delveId}:${tierId}`, so the lifetime count sums
    // every tier under the delve prefix like delveShopGateUnlocked does.
    // Each entry must be a finite number > 0 and is floored individually so
    // a hand-edited blob cannot inflate or poison provenance.
    const prefix = `${source.delveId}:`;
    let total = 0;
    for (const key in meta.delveClears) {
      if (!key.startsWith(prefix)) continue;
      const n = meta.delveClears[key];
      if (typeof n === 'number' && Number.isFinite(n) && n > 0) total += Math.floor(n);
    }
    return total;
  }
  if (source.kind === 'deed_stat') {
    // Only authored DEED_STAT_KEYS are readable; unknown strings yield 0 so a
    // hand-edited catalog cannot invent a parallel counter channel.
    if (!(DEED_STAT_KEYS as readonly string[]).includes(source.stat)) return 0;
    const n = meta.deedStats.counters[source.stat as DeedStatKey];
    // isFinite matches the display-only secondary arm (reliquarySecondaryClears
    // in src/ui/reliquary_view.ts): a poisoned Infinity counter reads 0 on both
    // meters instead of an infinity glyph on one and 0 on the other.
    return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }
  // dungeon
  return dungeonClearCount(meta.deedStats, source.dungeonId, source.difficulty);
}

function dungeonClearCount(
  stats: DeedStats,
  dungeonId: string,
  difficulty: 'normal' | 'heroic' | 'any' | undefined,
): number {
  if (difficulty === 'heroic') return stats.dungeonClears[`${dungeonId}:heroic`] ?? 0;
  if (difficulty === 'normal') return stats.dungeonClears[dungeonId] ?? 0;
  return (stats.dungeonClears[dungeonId] ?? 0) + (stats.dungeonClears[`${dungeonId}:heroic`] ?? 0);
}

// ---------------------------------------------------------------------------
// Mark path (called only from markItemDiscovered on first discover)
// ---------------------------------------------------------------------------

/**
 * Hook from markItemDiscovered after a NEW item id enters itemsDiscovered.
 * Writes sparse firstFind + capped recent only for catalogued relic item ids,
 * then emits id-only reliquaryUnlock for presentation (including curatorRank
 * when this fill crossed a cosmetic rank threshold). Syncs zero-Renown rank
 * deed bridges via grantDeed (durability path for titles only). Idempotent:
 * a second call for the same id is a no-op. Does not call saveCharacter on
 * pure silhouette fill and does not dual-write discovery.
 *
 * `opts.retro` is the join-time seed pass (seedItemDiscovery): the fill stays
 * SILENT (no recent push, no fabricated clear provenance) and every event it
 * emits carries the retro flag. That flag buys three things, and nothing
 * else: the CLIENT collapses retro fills into one catch-up summary line
 * instead of a toast per relic; the deedUnlocked grants this same join pass
 * produces stay out of the server's guild / activity-feed fan-out through
 * its ev.retro gate; and since Phase 18 the server's illumination marquee
 * (the detectActivity reliquaryUnlock arm in server/game.ts) drops retro
 * events too. reliquaryUnlock's presentation payload is self-scoped
 * (HEAVY_SELF_EVENTS), but its illuminatedPageId field DOES drive that
 * guild / follower fan-out: a new emit path that omits the retro flag on a
 * join-time or catch-up fill would marquee every back-catalog illumination
 * to the earner's guild.
 *
 * Mount reins are not catalogued item relics (Horizons owns them via live
 * ownedMounts). On first discovery of reins the item is already in bags, so
 * rank may cross a threshold: sync deeds without inventing firstFind or a
 * reliquaryUnlock toast (Phase 8 membership stays live-seam only).
 */
export function onItemDiscovered(
  ctx: SimContext,
  meta: PlayerMeta,
  itemId: string,
  opts?: Readonly<{ retro?: boolean; movement?: boolean }>,
): void {
  if (!isCataloguedRelicItem(itemId)) {
    if (ITEMS[itemId]?.kind === 'mount') {
      // ONE snapshot for both syncs: the reins discover is the join-heavy
      // path where rebuilding it per sync would rescan inventory + bank.
      const mountOwnership = characterReliquaryOwnership(meta);
      maybeSyncCuratorRankDeeds(ctx, meta, opts, mountOwnership);
      // Reins ownership is a Horizons mount fill, so the completion ladder
      // (shelf / catalog reads) can cross here too, beside the rank bridges.
      syncReliquaryCompletionDeeds(ctx, meta, opts, mountOwnership);
    }
    return;
  }
  // ONE ownership snapshot for this whole fill chain, threaded into the emit
  // and the rank sync instead of each rebuilding its own. Reusing it is exact,
  // not approximate: three of its four surfaces (itemsDiscovered, marks,
  // deedsEarned) are LIVE references, so any write the chain performs is
  // already visible through this object, and the fourth (ownedMounts, a fresh
  // Set built from a full inventory + bank scan, the expensive half) cannot
  // change inside a fill chain at all, since nothing here moves a reins item.
  const ownership = characterReliquaryOwnership(meta);
  // Rank is character-durable catalogued fills (items + marks + mounts + titles;
  // never account skins). Prior count is owned - 1 only when this discover
  // actually SCORED: the ledger add already happened (markItemDiscovered only
  // calls on first add), so a scoring id moved the count and an
  // excludeFromCompletion-only id left it unmoved. Assuming - 1 for a
  // non-scoring fill understates the prior count, and at an exact threshold
  // that fires a rank-up banner for a rank the player already held (the
  // riftbound bands are the live-mintable case).
  const owned = catalogRankOwned(ownership);
  const scored = relicFillScoresForRank('item', itemId);
  const previousRank = curatorRankFromOwned(scored ? Math.max(0, owned - 1) : owned);
  const newRank = curatorRankFromOwned(owned);
  const rankedUp = newRank > previousRank ? newRank : undefined;
  // The unlock event is the first-find MOMENT, so it fires only when a new
  // firstFind entry actually landed (an already-noted id must never re-toast).
  // The rank sync is keyed on the ledger add instead: a save whose sparse blob
  // ran ahead of itemsDiscovered would otherwise drop the threshold crossing
  // this discover just earned. grantDeed is idempotent, so the extra call is
  // a no-op whenever the bridges are already held.
  if (noteRelicItemFind(meta, itemId, opts)) {
    emitReliquaryUnlock(
      ctx,
      meta,
      { itemId, curatorRank: rankedUp, retro: opts?.retro },
      ownership,
    );
  }
  if (rankedUp !== undefined) syncCuratorRankDeeds(ctx, meta, opts, ownership);
  // The completion ladder runs on EVERY new fill, not only on a rank-up: any
  // single fill can be the one that completes a flagship page, the Conquerors
  // shelf, or the whole catalog, none of which need a threshold crossing.
  syncReliquaryCompletionDeeds(ctx, meta, opts, ownership);
}

/**
 * True when a deed id is a Horizons title relic (scores catalogRankOwned).
 * Border-only curator rank 5 is not on the list.
 */
export function isHorizonsTitleDeed(deedId: string): boolean {
  return HORIZON_TITLE_DEED_IDS.has(deedId);
}

/**
 * Re-sync zero-Renown Curator rank deed bridges when character-durable
 * ownership may have grown outside the item/mark unlock paths (mount reins
 * first discover, Horizons title deed grant). Fast no-op when every bridge
 * for the current rank is already earned. No reliquaryUnlock toast.
 */
export function maybeSyncCuratorRankDeeds(
  ctx: SimContext,
  meta: PlayerMeta,
  opts?: Readonly<{ retro?: boolean }>,
  /** The caller's already-built snapshot, when it has one (the mount-reins
   *  arm and the grantDeed title hook share one with the completion-ladder
   *  sync so neither path scans inventory + bank twice). */
  callerOwnership?: ReliquaryOwnershipSurfaces,
): void {
  // One snapshot for this chain too, handed to the sync below rather than
  // rebuilt there: the mount-reins arm is the join-time path, where a veteran
  // holding a bagful of reins would otherwise rescan inventory + bank twice
  // per discover. See the reuse note in onItemDiscovered.
  const ownership = callerOwnership ?? characterReliquaryOwnership(meta);
  const owned = catalogRankOwned(ownership);
  const rank = curatorRankFromOwned(owned);
  if (rank <= 0) return;
  for (let i = 0; i < rank; i++) {
    const deedId = CURATOR_RANK_DEFS[i]?.deedId;
    if (deedId && !meta.deedsEarned.has(deedId)) {
      syncCuratorRankDeeds(ctx, meta, opts, ownership);
      return;
    }
  }
}

/**
 * Record first-find meta and push the recent ring for a catalogued item relic.
 * Safe to call only when the item is already in itemsDiscovered (the deeds hub
 * owns that set). Retro ownership without this call leaves firstFind absent.
 * `opts.retro` is the join-time seed: the entry lands sparse with NO clears
 * key (the clear count now is not the count at the real first obtain, and
 * provenance is never fabricated) and the recent ring is left alone (logging
 * in is not a find moment). A live find whose page meter still reads zero
 * lands the same sparse way, for the same reason: see ReliquaryFirstFind.
 * @returns true when a new firstFind entry was written.
 */
export function noteRelicItemFind(
  meta: PlayerMeta,
  itemId: string,
  opts?: Readonly<{ retro?: boolean; movement?: boolean }>,
): boolean {
  // The SAME catalogue predicate noteRelicObtain gates on, so the two writers
  // can never disagree about what a relic is (they used to differ: this one
  // asked whether the item-to-pages index held a NON-EMPTY array, which would
  // have parted company with isCataloguedRelicItem had content ever mapped an
  // id to an empty page list).
  if (!isCataloguedRelicItem(itemId)) return false;

  const state = meta.reliquary;
  if (state.firstFind[itemId] !== undefined) {
    // Already noted: do not re-stamp clears or re-push recent.
    return false;
  }

  const entry: ReliquaryFirstFind = {};
  // Provenance is stamped only for a find the player's own play produced.
  // `retro` is the join-time seed (today's meter is not the meter at the real
  // first obtain) and `movement` is a grant that relocated somebody's existing
  // copy (a trade, mail, a market buy, a re-mint). Both leave the entry
  // sparse, because in both the clear count the meter happens to read has
  // nothing to do with how this relic was acquired: a player sitting on twelve
  // Hollow Crypt clears who BUYS the drop did not find it on clear twelve.
  // Provenance only; the fill itself is real, so the unlock event, the toast,
  // and the recent push below are deliberately unchanged on a movement find.
  if (!opts?.retro && !opts?.movement) {
    const pageId = RELIQUARY_ITEM_TO_PAGES.get(itemId)?.[0];
    const page = pageId !== undefined ? RELIQUARY_PAGES_BY_ID[pageId] : undefined;
    const clears = clearCountForSource(meta, page?.clearSource);
    // >= 1 only. A page with no clear meter answers undefined; a meter that
    // has not turned over answers 0, and both mean the same thing here, that
    // there is no clear to name, so both leave the entry sparse.
    if (clears !== undefined && clears >= 1) entry.clears = clears;
  }
  state.firstFind[itemId] = entry;
  if (!opts?.retro) pushRecent(state, itemId);
  bumpReliquaryWireRev(state);
  return true;
}

/**
 * Count one WORLD-SOURCED acquisition of a catalogued relic item. Information,
 * never a score: nothing reads this for power, drop rate, pity, Curator rank,
 * or membership (ownership stays on deedStats.itemsDiscovered), and no page,
 * deed, or reward looks at it.
 *
 * World-sourced is the whole rule. The grant hub calls this for every
 * acquisition EXCEPT the ones flagged `movement: true` (trade, mail, the
 * market, an enchant re-mint, an unbind stack split, a returned commission),
 * which relocate or re-mint copies somebody already held. Counting those would
 * let two players hand one relic back and forth and watch both tallies climb,
 * which is exactly the reading the number must not support.
 *
 * Deliberately quiet: no event, no recent push, no saveCharacter, no rank
 * sync. The tally rides the sparse blob's 30s autosave like the rest.
 */
export function noteRelicObtain(meta: PlayerMeta, itemId: string, copies = 1): void {
  if (!(copies >= 1)) return;
  const state = meta.reliquary;
  const units = Math.floor(copies);
  // The SAME heroic walk the discovery ledger runs (deeds.ts
  // markItemDiscovered): a heroic instance drops the generated heroic_<base>
  // variant in place of the base item, the catalog lists BASE ids only
  // (pinned in tests/reliquary_content.test.ts), and the tally has to agree
  // with the slot that fill lands in or roughly half the catalog would show an
  // owned relic whose count never moves. Every catalogued id in the chain
  // increments, so a catalogued variant would count itself as well as its
  // base. Bases are never variants themselves, so the walk visits at most two
  // ids; the depth cap only guards against a malformed def cycle in content.
  let id: string | undefined = itemId;
  let wrote = false;
  for (let depth = 0; id !== undefined && depth < 3; depth++) {
    // Annotated for the same reason deeds.ts annotates its walk: indexing by
    // the reassigned `id` would otherwise infer circularly through heroicOf.
    const def: ItemDef | undefined = ITEMS[id];
    if (!def) break;
    if (isCataloguedRelicItem(id)) {
      state.counts[id] = Math.min((state.counts[id] ?? 0) + units, RELIQUARY_OBTAIN_COUNT_CAP);
      // The saved blob folds each tally onto its firstFind entry, so the entry
      // is the carrier the count needs to survive a round trip. A relic
      // discovered BEFORE the Reliquary shipped has no entry and can never
      // grow one on its own: markItemDiscovered fires the first-find hook only
      // on an id's first ever discovery, and the join-time seed cannot re-enter
      // it for an id already on the ledger. So the re-obtain that starts such a
      // relic's tally writes the empty carrier here. Sparse {} is the honest
      // shape and already ships: it is what a retro fill writes. Owned,
      // provenance unknown.
      if (state.firstFind[id] === undefined) state.firstFind[id] = {};
      wrote = true;
    }
    id = def.heroicOf;
  }
  if (wrote) bumpReliquaryWireRev(state);
}

/**
 * Grant an authored non-item Reliquary mark (profession trophy, etc.).
 * Only catalog mark ids land; unknown ids are ignored. Cosmetic only: no
 * skill power, drop rate, or pity. No saveCharacter on pure mark fill.
 * @returns true when a new mark was written.
 */
export function noteReliquaryMark(ctx: SimContext, meta: PlayerMeta, markId: string): boolean {
  if (!RELIQUARY_MARK_IDS.has(markId)) return false;
  if (meta.reliquary.marks.has(markId)) return false;
  // One snapshot for the chain (see onItemDiscovered). The EVALUATION POINTS
  // are unchanged: previousOwned is still read BEFORE the add below, and every
  // later read still happens after it. Reusing the object is what carries the
  // add to those later reads, because `marks` on it is the live Set itself.
  const ownership = characterReliquaryOwnership(meta);
  // Rank uses pre-add owned so this mark is the +1 that may cross a threshold.
  // The +1 applies only when the mark SCORES (sits on a completion-scoring
  // page): every authored mark does today, so the other arm is the documented
  // dead guard compensated by the catalog-wide pin, but a future mark on an
  // excludeFromCompletion page must not fake a threshold crossing (the item
  // path's riftbound-band defect, fixed in the same change as this guard).
  const previousOwned = catalogRankOwned(ownership);
  meta.reliquary.marks.add(markId);
  pushRecent(meta.reliquary, markId);
  bumpReliquaryWireRev(meta.reliquary);
  const newOwned = relicFillScoresForRank('mark', markId) ? previousOwned + 1 : previousOwned;
  const previousRank = curatorRankFromOwned(previousOwned);
  const newRank = curatorRankFromOwned(newOwned);
  const rankedUp = newRank > previousRank ? newRank : undefined;
  emitReliquaryUnlock(ctx, meta, { markId, curatorRank: rankedUp }, ownership);
  if (rankedUp !== undefined) syncCuratorRankDeeds(ctx, meta, undefined, ownership);
  // Every new mark fill can complete a shelf or catalog read (see the item
  // path); a mark is never a flagship-page relic today, but the catalog read
  // counts it, so the ladder runs here too.
  syncReliquaryCompletionDeeds(ctx, meta, undefined, ownership);
  return true;
}

/**
 * Join / load retro: copy every catalog mark id already on the deed visit
 * ledger (gather_event:*, masterwork:*, slain:*) into the sparse marks Set.
 * The namespaces are an enumeration of what the ledger holds today, never a
 * filter: the sweep copies every id RELIQUARY_MARK_IDS knows. Silent:
 * no unlock toast and no recent push. Nothing is invented here: a mark only
 * fills from a visit its own live call site wrote when the real event
 * happened, so the ledger is proof, never a guess. Returns how many marks
 * were added.
 */
export function syncReliquaryMarksFromVisited(meta: PlayerMeta): number {
  let added = 0;
  for (const mark of meta.deedStats.visited) {
    if (!RELIQUARY_MARK_IDS.has(mark)) continue;
    if (meta.reliquary.marks.has(mark)) continue;
    meta.reliquary.marks.add(mark);
    added++;
  }
  // Every writer of the serialized surfaces bumps, this one included. It runs
  // at join, ahead of the session's first snapshot, so today no cached blob
  // can predate it; bumping anyway means the memo stays correct if the join
  // order ever changes rather than silently shipping a stale mark list.
  if (added > 0) bumpReliquaryWireRev(meta.reliquary);
  return added;
}

/**
 * Join-time self-heal for the sticky illumination record: sweep every catalog
 * page and record the complete ones missing from illuminatedPages. Exists for
 * pre-Phase-18 blobs, which predate the set entirely: a veteran whose pages
 * were already complete before the set shipped must have them recorded at
 * join, or a later catalog-growth re-completion would read as a FIRST
 * illumination and marquee. Silent (no events, no recent push); bumps the
 * wire revision once when anything landed. Returns how many pages were added.
 * Deliberately not save-forcing: the sweep is idempotent and re-runs on
 * every join, so a save lost to a crash costs a repeat sweep, never state.
 *
 * Running on EVERY join, forever, has two standing consequences beyond the
 * Phase 18 migration. Forward: when later content ships a page a veteran's
 * collection already completes, their next join records it silently, so its
 * first-illumination celebration never fires for them (consistent with the
 * retro doctrine: the seed pass would have flagged it retro anyway). And the
 * sticky record is join-eventually-consistent for the non-emit live paths: a
 * page completed by a mount fill or by a title grant is recorded here at the
 * NEXT join, not at the moment of completion, which any Phase 19+ celebration
 * added to those pages must account for.
 *
 * The sweep records the three no-emit Horizons pages too (mounts, titles,
 * weapon skins) BY DESIGN: those pages never pass through emitReliquaryUnlock
 * (mount and title fills sync deeds without an unlock emit), so they never
 * banner or marquee; their celebrations are the rank bridges and capstone
 * deeds, which fan out through the deed channel. Recording them silently
 * here is the correct migration posture for any celebration a later phase
 * adds. The weapon-skins page is further out of reach on this side: the
 * ownership surfaces deliberately omit account skins (the W3 note above),
 * so it can never read complete from the sim even when the client shows it
 * complete.
 */
export function syncIlluminatedPages(
  meta: PlayerMeta,
  /** Optional-with-?? like the ladder sync (never an eager default), for the
   *  same reason: the shape must not re-teach the eager-default trap even
   *  though this sweep has no early-out to protect. */
  ownership?: ReliquaryOwnershipSurfaces,
): number {
  const own = ownership ?? characterReliquaryOwnership(meta);
  let added = 0;
  for (const page of RELIQUARY_PAGES) {
    if (meta.reliquary.illuminatedPages.has(page.id)) continue;
    if (!pageCompletion(page, own).complete) continue;
    meta.reliquary.illuminatedPages.add(page.id);
    added++;
  }
  if (added > 0) bumpReliquaryWireRev(meta.reliquary);
  return added;
}

/**
 * Id-only presentation event for a new catalogued relic or mark. Never
 * English. Membership authority stays on itemsDiscovered + sparse blob.
 * Optional curatorRank is the new cosmetic rank index when this fill ranked up.
 * Optional retro marks the join-time seed pass (silent on the client, no
 * server fan-out).
 *
 * Illumination computes from characterReliquaryOwnership, which deliberately
 * OMITS account weapon skins: the server cannot answer account cosmetics from
 * inside the sim, so any skin-aware read here would be online-inert and would
 * disagree with itself per host. That is safe because every catalog page is
 * single-kind (pinned in tests/reliquary_content.test.ts) and an item or mark
 * fill can only ever reach item or mark pages, never a weapon-skin page. The
 * online window-vs-emit skin gap (parity W3) stays open BY DESIGN until a
 * mixed-kind page ships; the single-kind pin is what keeps that honest.
 *
 * Phase 18 semantics: `illuminatedPageId` on the event means FIRST-EVER
 * illumination for this character, not "some page reads complete right now".
 * Despite the emit name this function is a WRITER: every complete candidate
 * page missing from the sticky meta.reliquary.illuminatedPages set is
 * recorded there (one wire-rev bump per sweep); the event names the FIRST
 * newly illuminated one and stays silent (undefined) when none is new.
 * Every downstream celebration (the client banner, the Phase 18 server
 * marquee) therefore inherits once-ever semantics: after catalog growth, a
 * re-completion of an already-recorded page adds nothing to the set and emits
 * no illuminatedPageId. Accepted edge, reachable on shipped content rather
 * than theoretical: relics sitting on two Conquerors pages at once (a
 * dungeon or raid page plus its tier-set page) mean one drop can complete
 * both, and the second page's Illumination is then permanently uncelebrated
 * because the event still names only the first (the single-id event shape is
 * pinned in tests/reliquary_wire.test.ts) and the set records both.
 *
 * Two bounded tolerances on "once-ever", both accepted: (1) it means once
 * per DURABLE record, not an absolute guarantee: the write rides the normal
 * save cadence (an immediate saveCharacter here would break the design
 * doc's "never save because a silhouette filled" rule), so a crash before
 * the next save loses the record; the join sweep re-heals it silently while
 * the page still reads complete, and only catalog growth landing inside
 * that same window can produce a second celebration. The two halves of that
 * window are CORRELATED, not independent rarities: an unclean restart that
 * also ships catalog growth is one event, and the graceful-shutdown save
 * plus the unconditional autosave sweep confine the loss to a SIGKILL/OOM
 * class stop, not an ordinary deploy. (2) The blob-ran-ahead
 * re-discover tolerance (see the noteRelicItemFind gate in onItemDiscovered)
 * skips this emit entirely, so a flagship completion deed can in that shape
 * be granted while the set records nothing until the next join sweep; the
 * two records answer the same question and re-agree there.
 */
function emitReliquaryUnlock(
  ctx: SimContext,
  meta: PlayerMeta,
  ids: { itemId?: string; markId?: string; curatorRank?: number; retro?: boolean },
  // Required, not defaulted: both call sites already hold their chain's
  // snapshot, and a default initializer would silently hand any future
  // caller that omits the argument a fresh inventory + bank scan. Requiring
  // it makes that cost a visible decision at the call site. Module-private,
  // so the stricter signature costs nothing.
  ownership: ReliquaryOwnershipSurfaces,
): void {
  const pageIds =
    ids.itemId !== undefined
      ? RELIQUARY_ITEM_TO_PAGES.get(ids.itemId)
      : ids.markId !== undefined
        ? RELIQUARY_MARK_TO_PAGES.get(ids.markId)
        : undefined;
  let illuminatedPageId: string | undefined;
  if (pageIds && pageIds.length > 0) {
    let added = false;
    for (const pageId of pageIds) {
      const page = RELIQUARY_PAGES_BY_ID[pageId];
      if (!page) continue;
      if (meta.reliquary.illuminatedPages.has(pageId)) continue;
      if (!pageCompletion(page, ownership).complete) continue;
      meta.reliquary.illuminatedPages.add(pageId);
      added = true;
      if (illuminatedPageId === undefined) illuminatedPageId = pageId;
    }
    // One bump for the whole candidate sweep, not one per page: the memo only
    // needs to know the serialized surfaces moved.
    if (added) bumpReliquaryWireRev(meta.reliquary);
  }
  ctx.emit({
    type: 'reliquaryUnlock',
    pid: meta.entityId,
    ...(ids.itemId !== undefined ? { itemId: ids.itemId } : {}),
    ...(ids.markId !== undefined ? { markId: ids.markId } : {}),
    ...(pageIds && pageIds.length > 0 ? { pageIds: [...pageIds] } : {}),
    ...(illuminatedPageId !== undefined ? { illuminatedPageId } : {}),
    ...(ids.curatorRank !== undefined && ids.curatorRank > 0
      ? { curatorRank: ids.curatorRank }
      : {}),
    ...(ids.retro ? { retro: true } : {}),
  });
}

// ---------------------------------------------------------------------------
// Wire memo: build once per CHANGE, not once per heavy tick
// ---------------------------------------------------------------------------

/**
 * Monotonic revision per live ReliquaryState, bumped by every writer that can
 * move the serialized blob (a find, a mark, an obtain, an illumination
 * landing in the sticky set). Restore needs no bump: it returns a NEW state
 * object, so the cache below simply has no entry for it.
 *
 * Both maps are WeakMaps keyed on state IDENTITY. That buys three things at
 * once: nothing leaks into the save shape or the live-meta goldens (the
 * bookkeeping is not on PlayerMeta at all), nothing leaks between tests (a
 * fresh Sim builds a fresh state object, so no exported reset hook is needed),
 * and a departed character's entry drops with the character.
 */
const reliquaryWireRev = new WeakMap<ReliquaryState, number>();
const reliquaryWireCache = new WeakMap<ReliquaryState, { rev: number; json: string }>();

function bumpReliquaryWireRev(state: ReliquaryState): void {
  reliquaryWireRev.set(state, (reliquaryWireRev.get(state) ?? 0) + 1);
}

/**
 * The sparse `reliq` self blob as JSON, built once per change. The heavy self
 * gate re-runs on a staggered refresh even when nothing moved, and the old
 * path rebuilt and re-stringified this blob on every one of those ticks purely
 * to hand the delta gate a string it had already seen.
 *
 * Byte-identical to JSON.stringify(serializeReliquaryState(state) ?? {}), the
 * exact expression the caller used to pass through `maybe`, so a session's
 * lastSent comparison sees the same bytes across the swap and no client gets
 * a spurious re-ship. Never a second full itemsDiscovered array.
 */
export function reliquaryWireJson(state: ReliquaryState): string {
  const rev = reliquaryWireRev.get(state) ?? 0;
  const cached = reliquaryWireCache.get(state);
  if (cached !== undefined && cached.rev === rev) return cached.json;
  const json = JSON.stringify(serializeReliquaryState(state) ?? {});
  reliquaryWireCache.set(state, { rev, json });
  return json;
}

/** Test-only probe: the live cache record for a state. It exists so a pin can
 *  prove a quiet tick REUSED a build by object identity, which is the thing
 *  the memo is for; equal bytes alone would pass with no memo at all. */
export function reliquaryWireCacheProbe(
  state: ReliquaryState,
): Readonly<{ rev: number; json: string }> | undefined {
  return reliquaryWireCache.get(state);
}

function pushRecent(state: ReliquaryState, id: string): void {
  // Ring layout: new entries land at the TAIL and the cap drops the HEAD, so
  // index 0 is the OLDEST entry and the last index is the newest. De-dupe:
  // only an id that is ALREADY the newest is left alone; anything else (the
  // oldest entry included) moves to the tail.
  const existing = state.recent.indexOf(id);
  if (existing >= 0 && existing === state.recent.length - 1) return;
  if (existing >= 0) state.recent.splice(existing, 1);
  state.recent.push(id);
  while (state.recent.length > RELIQUARY_RECENT_CAP) state.recent.shift();
}

// ---------------------------------------------------------------------------
// Pure ownership + completion (no mutation)
// ---------------------------------------------------------------------------

/** Any set-like container of owned item ids (itemsDiscovered or a test Set). */
export interface OwnedIdLookup {
  has(id: string): boolean;
}

/** True when an item relic is owned via the discovery ledger. */
export function ownsItemRelic(ownedItems: OwnedIdLookup, itemId: string): boolean {
  return ownedItems.has(itemId);
}

/** True when a relic slot is filled for the given ownership surfaces. */
export function isRelicFilled(
  relic: ReliquaryRelicDef,
  opts: {
    itemsDiscovered: OwnedIdLookup;
    marks?: OwnedIdLookup;
    ownedMounts?: OwnedIdLookup;
    weaponSkins?: OwnedIdLookup;
    deedsEarned?: OwnedIdLookup;
  },
): boolean {
  switch (relic.kind) {
    case 'item':
      return opts.itemsDiscovered.has(relic.itemId);
    case 'mark':
      return opts.marks?.has(relic.markId) === true;
    case 'mount':
      return opts.ownedMounts?.has(relic.mountId) === true;
    case 'weapon_skin':
      return opts.weaponSkins?.has(relic.skinId) === true;
    case 'title':
      return opts.deedsEarned?.has(relic.deedId) === true;
  }
}

/**
 * The player-INDEPENDENT half of every catalog-wide completion read: the unique
 * relic ids per kind, de-duped across pages, in the order the page walk first
 * encounters them. Nothing here reads ownership, so the lists (and therefore
 * every `total`) depend only on the page table. Ownership is still counted per
 * call against these ids; only the walk that discovers them is shared.
 */
export interface ReliquaryCatalogIndex {
  items: readonly string[];
  marks: readonly string[];
  mounts: readonly string[];
  skins: readonly string[];
  titles: readonly string[];
}

/**
 * Lazily-filled catalog index per page table, behind a WeakMap keyed on the
 * pages array IDENTITY. Same sanctioned module-global shape as the wire memo
 * above, in its content-table form: the key here is an immutable table rather
 * than live state, so there is no revision to bump. RELIQUARY_PAGES is frozen
 * at the content site (array, pages, and each page's relics list), which is
 * what makes "the contents behind this key can never change" an enforced
 * contract instead of an assumption. Lazy rather than eager at module load
 * because this module is in the client bundle and most sessions never open the
 * Reliquary: the walk is paid on the first completion read, not at import.
 *
 * Why identity and not length or content: a caller's own page array must never
 * be able to answer with the default catalog's index, or a fixture that happens
 * to look like the real catalog would hide a cache bug, and a fixture could
 * poison the shared answer. Keying on identity gives every distinct array its
 * own entry (a structurally identical COPY of the default included), so custom
 * page tables memoize safely too rather than rebuilding on every call, and the
 * entry drops with the array. The caller owns a CUSTOM table's immutability:
 * identity keying isolates it from the shared catalog, but a caller mutating
 * its own array between reads gets the stale entry back, and a fresh array
 * built per call memoizes correctly while gaining nothing.
 *
 * Index integrity is a SAVE-CORRECTNESS matter, not a cosmetic one:
 * catalogCharacterCompletion reads these lists for the `owned === total` gate
 * that grants col_reliquary_complete through ctx.grantDeed
 * (syncReliquaryCompletionDeeds below), a persisted deed and its permanent
 * "Curator of the Vault" title, on all three hosts. An index that answered for
 * the wrong page table would hand out or withhold that grant. Reuse and
 * cross-table isolation are pinned in tests/reliquary_state.test.ts
 * ("catalog index memo").
 */
const catalogIndexByPages = new WeakMap<readonly ReliquaryPageDef[], ReliquaryCatalogIndex>();

function buildCatalogIndex(pages: readonly ReliquaryPageDef[]): ReliquaryCatalogIndex {
  const items: string[] = [];
  const marks: string[] = [];
  const mounts: string[] = [];
  const skins: string[] = [];
  const titles: string[] = [];
  const seenItems = new Set<string>();
  const seenMarks = new Set<string>();
  const seenMounts = new Set<string>();
  const seenSkins = new Set<string>();
  const seenTitles = new Set<string>();
  for (const page of pages) {
    for (const relic of page.relics) {
      if (relic.kind === 'item') {
        if (seenItems.has(relic.itemId)) continue;
        seenItems.add(relic.itemId);
        items.push(relic.itemId);
      } else if (relic.kind === 'mark') {
        if (seenMarks.has(relic.markId)) continue;
        seenMarks.add(relic.markId);
        marks.push(relic.markId);
      } else if (relic.kind === 'mount') {
        if (seenMounts.has(relic.mountId)) continue;
        seenMounts.add(relic.mountId);
        mounts.push(relic.mountId);
      } else if (relic.kind === 'weapon_skin') {
        if (seenSkins.has(relic.skinId)) continue;
        seenSkins.add(relic.skinId);
        skins.push(relic.skinId);
      } else if (relic.kind === 'title') {
        if (seenTitles.has(relic.deedId)) continue;
        seenTitles.add(relic.deedId);
        titles.push(relic.deedId);
      }
    }
  }
  // Frozen because the index is SHARED: every completion read for this page
  // table gets these exact arrays, so one caller's in-place sort or push would
  // rewrite what every later `total` counts, process-wide and server included.
  return {
    items: Object.freeze(items),
    marks: Object.freeze(marks),
    mounts: Object.freeze(mounts),
    skins: Object.freeze(skins),
    titles: Object.freeze(titles),
  };
}

function catalogIndexFor(pages: readonly ReliquaryPageDef[]): ReliquaryCatalogIndex {
  const cached = catalogIndexByPages.get(pages);
  if (cached !== undefined) return cached;
  const built = buildCatalogIndex(pages);
  catalogIndexByPages.set(pages, built);
  return built;
}

/**
 * The pages completion math is allowed to count: every page except the
 * excludeFromCompletion ones (retired shelf, class-personal grants), rule 7 in
 * docs/design/reliquary.md.
 * Both catalog completion pairs route through this at the top so OWNED and
 * TOTAL always move together: filtering one side alone would either hand out
 * free progress or make 100% unreachable. Memoized on the pages array's
 * identity (the catalogIndexByPages regime above, same reasons) and
 * IDENTITY-STABLE: a table with nothing excluded answers with the caller's own
 * array, and a filtered answer is minted once and reused, so catalogIndexFor's
 * memo keys stay hot instead of rebuilding the index per read.
 */
const completionScoringPagesByPages = new WeakMap<
  readonly ReliquaryPageDef[],
  readonly ReliquaryPageDef[]
>();

function completionScoringPages(pages: readonly ReliquaryPageDef[]): readonly ReliquaryPageDef[] {
  const cached = completionScoringPagesByPages.get(pages);
  if (cached !== undefined) return cached;
  const scoring = pages.some((p) => p.excludeFromCompletion !== undefined)
    ? Object.freeze(pages.filter((p) => p.excludeFromCompletion === undefined))
    : pages;
  completionScoringPagesByPages.set(pages, scoring);
  return scoring;
}

/**
 * True when a catalogued relic id contributes to the character-durable rank
 * count: it sits on at least one completion-scoring page. An id that lives
 * ONLY on excludeFromCompletion pages (the riftbound bands; the vault items)
 * fills its silhouette without moving catalogRankOwned, so the rank-crossing
 * math in both fill paths must treat such a fill as +0, never +1: at an exact
 * Curator threshold the +1 assumption re-announces a rank the player already
 * held (the false-banner defect the Phase 21 QA parity leg reproduced).
 * Exported for the direct pin in tests/reliquary_state.test.ts; the mark arm
 * is otherwise unreachable today because every authored mark scores (the
 * catalog-wide pin in tests/reliquary_content.test.ts is the compensating
 * guard, the M4 pattern).
 */
export function relicFillScoresForRank(kind: 'item' | 'mark', id: string): boolean {
  const index = catalogIndexFor(completionScoringPages(RELIQUARY_PAGES));
  // A linear includes, deliberately: this runs once per FIRST fill of an id
  // (beside a whole inventory + bank scan), and the arrays are the memoized
  // index's own frozen lists, so there is no cheap place to hang a Set
  // without a second per-table memo.
  return (kind === 'item' ? index.items : index.marks).includes(id);
}

/** Test-only probe: the memoized index for a page table, or undefined when no
 *  read has built one yet. Mirrors reliquaryWireCacheProbe and exists for the
 *  same reason: a pin can prove a second read REUSED the build by object
 *  identity, which is the thing the memo is for, and that a custom page table
 *  never shares the default catalog's entry. Equal contents alone would pass
 *  with no memo at all. */
export function reliquaryCatalogIndexProbe(
  pages: readonly ReliquaryPageDef[],
): ReliquaryCatalogIndex | undefined {
  return catalogIndexByPages.get(pages);
}

/** Test-only probe for the SCORING-pages memo, the sibling of
 *  reliquaryCatalogIndexProbe and the same shape: the memoized answer for a
 *  page table, or undefined before any read has built one. The identity claim
 *  it exists to prove is load-bearing rather than cosmetic: catalogIndexFor
 *  keys its own memo on the array this function returns, so an answer that is
 *  merely EQUAL instead of identical would rebuild the whole catalog index on
 *  every completion read. */
export function reliquaryScoringPagesProbe(
  pages: readonly ReliquaryPageDef[],
): readonly ReliquaryPageDef[] | undefined {
  return completionScoringPagesByPages.get(pages);
}

/** Page progress X/Y over item (+ optional other) ownership. */
export function pageCompletion(
  page: ReliquaryPageDef,
  opts: {
    itemsDiscovered: OwnedIdLookup;
    marks?: OwnedIdLookup;
    ownedMounts?: OwnedIdLookup;
    weaponSkins?: OwnedIdLookup;
    deedsEarned?: OwnedIdLookup;
  },
): { owned: number; total: number; complete: boolean } {
  let owned = 0;
  const total = page.relics.length;
  for (const relic of page.relics) {
    if (isRelicFilled(relic, opts)) owned++;
  }
  return { owned, total, complete: total > 0 && owned === total };
}

/**
 * Catalog-wide unique item-relic progress (item ids de-duped across pages).
 *
 * The ONE completion read that deliberately does NOT apply
 * completionScoringPages: it counts whatever table it is handed, because its
 * single internal caller (catalogRelicCompletion) has already filtered, and
 * the catalog-index memo pins drive it with synthetic tables on purpose. Do
 * not call it directly for a shipped surface: an excludeFromCompletion page in
 * the table would score, and the pair would disagree with every other read.
 */
export function catalogItemCompletion(
  itemsDiscovered: OwnedIdLookup,
  pages: readonly ReliquaryPageDef[] = RELIQUARY_PAGES,
): { owned: number; total: number } {
  // One ownership test per UNIQUE item id, which is what the old inline walk
  // did too: it de-duped and counted against the same set, so a relic repeated
  // across pages was tested (and scored) exactly once.
  const { items } = catalogIndexFor(pages);
  let owned = 0;
  for (const itemId of items) {
    if (itemsDiscovered.has(itemId)) owned++;
  }
  return { owned, total: items.length };
}

/**
 * Catalog-wide unique relic progress for Curator rank and Overview totals:
 * de-duped item relics, authored mark relics, and Horizons mounts / skins /
 * titles. Ownership stays on existing seams (itemsDiscovered, marks,
 * ownedMounts, weaponSkins, deedsEarned); never a second discovery set.
 */
export function catalogRelicCompletion(
  opts: {
    itemsDiscovered: OwnedIdLookup;
    marks?: OwnedIdLookup;
    ownedMounts?: OwnedIdLookup;
    weaponSkins?: OwnedIdLookup;
    deedsEarned?: OwnedIdLookup;
  },
  pages: readonly ReliquaryPageDef[] = RELIQUARY_PAGES,
): { owned: number; total: number } {
  // Retired pages are outside completion on BOTH sides of the pair (see
  // completionScoringPages): the whole read below runs over the scoring set.
  const scoring = completionScoringPages(pages);
  const items = catalogItemCompletion(opts.itemsDiscovered, scoring);
  // Same one-test-per-unique-id shape as the item arm: the old walk de-duped
  // against the very set it was building, so each of these ids was scored once
  // no matter how many pages carry it. `=== true` is kept deliberately, the
  // lookups are optional and an absent surface must score zero, not throw.
  const index = catalogIndexFor(scoring);
  let marksOwned = 0;
  let mountsOwned = 0;
  let skinsOwned = 0;
  let titlesOwned = 0;
  for (const markId of index.marks) {
    if (opts.marks?.has(markId) === true) marksOwned++;
  }
  for (const mountId of index.mounts) {
    if (opts.ownedMounts?.has(mountId) === true) mountsOwned++;
  }
  for (const skinId of index.skins) {
    if (opts.weaponSkins?.has(skinId) === true) skinsOwned++;
  }
  for (const deedId of index.titles) {
    if (opts.deedsEarned?.has(deedId) === true) titlesOwned++;
  }
  return {
    owned: items.owned + marksOwned + mountsOwned + skinsOwned + titlesOwned,
    total:
      items.total +
      index.marks.length +
      index.mounts.length +
      index.skins.length +
      index.titles.length,
  };
}

/**
 * Character-durable fills for Curator rank thresholds and rank-deed grants:
 * items + marks + mounts + titles. Account weapon skins never score rank
 * (they are not on PlayerMeta; Overview totals still count them via
 * catalogRelicCompletion). Keeps grant path and display rank aligned.
 */
export function catalogRankOwned(
  opts: {
    itemsDiscovered: OwnedIdLookup;
    marks?: OwnedIdLookup;
    ownedMounts?: OwnedIdLookup;
    deedsEarned?: OwnedIdLookup;
  },
  pages: readonly ReliquaryPageDef[] = RELIQUARY_PAGES,
): number {
  return catalogCharacterCompletion(opts, pages).owned;
}

/**
 * Character-scoped Reliquary completion pair for character sheet and public
 * sheet fields. Owned matches catalogRankOwned (items + marks + mounts +
 * titles). Total excludes account weapon-skin slots so the pair never invents
 * character progress from account cosmetics. Overview still uses the full
 * catalogRelicCompletion (skins included when the host has them).
 */
export function catalogCharacterCompletion(
  opts: {
    itemsDiscovered: OwnedIdLookup;
    marks?: OwnedIdLookup;
    ownedMounts?: OwnedIdLookup;
    deedsEarned?: OwnedIdLookup;
  },
  pages: readonly ReliquaryPageDef[] = RELIQUARY_PAGES,
): { owned: number; total: number } {
  // Excluded pages are outside completion on BOTH sides of the pair (see
  // completionScoringPages); filtering here keeps the skin subtraction below
  // reading the exact index the full read counted against.
  //
  // This filters, then hands `scoring` to catalogRelicCompletion, which
  // filters again: the memo therefore holds TWO entries per table, the
  // original mapping to its filtered answer and the filtered answer mapping to
  // ITSELF. Deliberate. The second pass is a WeakMap hit that returns the same
  // array by identity, so it costs nothing and no walk repeats, and the
  // alternative (an unfiltered internal entry point) would be one more way to
  // score an excluded page by accident.
  const scoring = completionScoringPages(pages);
  const full = catalogRelicCompletion(
    {
      itemsDiscovered: opts.itemsDiscovered,
      marks: opts.marks,
      ownedMounts: opts.ownedMounts,
      deedsEarned: opts.deedsEarned,
      // Explicitly omit weapon skins from character-scoped sheet math.
      weaponSkins: undefined,
    },
    scoring,
  );
  // The account weapon-skin slots to subtract are the same de-duped list the
  // full read counted, so take the count off the shared index rather than
  // walking the pages a second time for a number that is player-independent.
  const skinSlots = catalogIndexFor(scoring).skins.length;
  return { owned: full.owned, total: full.total - skinSlots };
}

/**
 * Pure ownership surfaces for Reliquary completion reads. Prefer this helper
 * so Sim, ClientWorld, and tests share one opts shape (no parallel discovery).
 */
export function reliquaryOwnershipOpts(input: {
  itemsDiscovered: OwnedIdLookup;
  marks?: OwnedIdLookup;
  ownedMounts?: readonly string[] | OwnedIdLookup;
  weaponSkinIds?: readonly string[] | OwnedIdLookup;
  deedsEarned?: OwnedIdLookup;
}): {
  itemsDiscovered: OwnedIdLookup;
  marks?: OwnedIdLookup;
  ownedMounts?: OwnedIdLookup;
  weaponSkins?: OwnedIdLookup;
  deedsEarned?: OwnedIdLookup;
} {
  return {
    itemsDiscovered: input.itemsDiscovered,
    marks: input.marks,
    ownedMounts: asOwnedLookup(input.ownedMounts),
    weaponSkins: asOwnedLookup(input.weaponSkinIds),
    deedsEarned: input.deedsEarned,
  };
}

/**
 * Character-scoped ownership for mutation paths and join sync: items, marks,
 * live ownedMounts (bags+bank reins), and deedsEarned. Weapon skins are
 * account cosmetics and are not on PlayerMeta; hosts pass them separately
 * for page/Overview fills only (never rank grants).
 */
export interface ReliquaryOwnershipSurfaces {
  itemsDiscovered: OwnedIdLookup;
  marks: OwnedIdLookup;
  ownedMounts: OwnedIdLookup;
  deedsEarned: OwnedIdLookup;
}

export function characterReliquaryOwnership(meta: PlayerMeta): ReliquaryOwnershipSurfaces {
  return {
    itemsDiscovered: meta.deedStats.itemsDiscovered,
    marks: meta.reliquary.marks,
    ownedMounts: new Set(ownedMountKeys(meta)),
    deedsEarned: meta.deedsEarned,
  };
}

function asOwnedLookup(
  value: readonly string[] | OwnedIdLookup | undefined,
): OwnedIdLookup | undefined {
  if (value === undefined) return undefined;
  if (typeof (value as OwnedIdLookup).has === 'function' && !Array.isArray(value)) {
    return value as OwnedIdLookup;
  }
  const set = new Set(value as readonly string[]);
  return set;
}

/**
 * Pure Curator rank tiers: cosmetic-only. Rank from unique catalogued relic
 * fills (never kill count alone). Rewards are titles / borders / window seal
 * chrome; never combat stats, drop rate, pity, or actionable combat info.
 * Thresholds are inclusive minimums for rank 1..N. Rank 0 = none.
 */
export interface CuratorRankDef {
  /** Rank index 1..N (matches curatorRankFromOwned). */
  rank: number;
  /** Inclusive unique-owned minimum for this rank. */
  threshold: number;
  /** Window seal chrome id (CSS data-seal); derived, never stored. */
  sealId: string;
  /**
   * Optional zero-Renown deed bridge granted when this rank is first reached.
   * Titles/borders only; renown must stay 0 (luck/catalog prestige never
   * scores Renown). grantDeed is the sticky set; no rankRewardsGranted blob.
   */
  deedId?: string;
}

export const CURATOR_RANK_DEFS: readonly CuratorRankDef[] = [
  { rank: 1, threshold: 1, sealId: 'apprentice' },
  { rank: 2, threshold: 10, sealId: 'keeper', deedId: 'col_reliquary_rank_2' },
  { rank: 3, threshold: 25, sealId: 'master', deedId: 'col_reliquary_rank_3' },
  { rank: 4, threshold: 50, sealId: 'grand', deedId: 'col_reliquary_rank_4' },
  { rank: 5, threshold: 100, sealId: 'eternal', deedId: 'col_reliquary_rank_5' },
];

/** Inclusive unique-owned thresholds for rank 1..N (derived from CURATOR_RANK_DEFS). */
export const CURATOR_RANK_THRESHOLDS: readonly number[] = CURATOR_RANK_DEFS.map((d) => d.threshold);

export function curatorRankFromOwned(
  ownedUnique: number,
  thresholds: readonly number[] = CURATOR_RANK_THRESHOLDS,
): number {
  if (!(ownedUnique > 0)) return 0;
  let rank = 0;
  for (let i = 0; i < thresholds.length; i++) {
    if (ownedUnique >= thresholds[i]) rank = i + 1;
    else break;
  }
  return rank;
}

/** Seal chrome id for a rank, or null when unranked. Pure; never invents power. */
export function curatorSealIdForRank(rank: number): string | null {
  if (!(rank > 0)) return null;
  const def = CURATOR_RANK_DEFS[rank - 1];
  return def?.sealId ?? null;
}

/**
 * Grant zero-Renown Curator rank deed bridges for every rank the player has
 * already earned by unique catalogued fill count. Idempotent via grantDeed.
 * Does not force saveCharacter itself: grantDeed (title/border durability)
 * is the existing durability-critical path when a new deed lands.
 */
export function syncCuratorRankDeeds(
  ctx: SimContext,
  meta: PlayerMeta,
  opts?: Readonly<{ retro?: boolean }>,
  /** The chain's already-built ownership snapshot, when a caller has one. Its
   *  item / mark / deed surfaces are live references, so a snapshot taken
   *  earlier in the same fill chain scores exactly what a rebuild here would. */
  ownership: ReliquaryOwnershipSurfaces = characterReliquaryOwnership(meta),
): void {
  const owned = catalogRankOwned(ownership);
  const rank = curatorRankFromOwned(owned);
  if (rank <= 0) return;
  for (let i = 0; i < rank; i++) {
    const deedId = CURATOR_RANK_DEFS[i]?.deedId;
    if (!deedId) continue;
    ctx.grantDeed(meta, deedId, opts?.retro ? { retro: true } : undefined);
  }
}

/**
 * The Phase 18 completion-ladder deed ids in GRANT-CHECK order: the three
 * flagship page Illuminations, then the Conquerors shelf, then the whole
 * character catalog. The order is load-bearing for the CATALOG read only:
 * the ownership snapshot's deedsEarned surface is a LIVE reference, and each
 * of these deeds except col_reliquary_complete is itself a title relic on
 * horizons_titles, which feeds catalogCharacterCompletion, so a title granted
 * earlier in the pass is visible to the capstone check in the SAME pass. No
 * title moves the SHELF read today: every Conquerors page currently holds
 * item relics only (what the tests pin is weaker: single-kind pages and no
 * weapon-skin conquerors relic, so an all-title conquerors page remains legal
 * future content; the order here is robust to one, since the illumination
 * titles grant before the shelf check). The shelf sits before the catalog
 * because the capstone branch gates on the shelf grant this same pass just
 * made.
 */
export const RELIQUARY_COMPLETION_DEED_IDS = [
  'col_reliquary_illum_nythraxis_heroic',
  'col_reliquary_illum_thunzharr',
  'col_reliquary_illum_gravewyrm_heroic',
  'col_reliquary_conquerors',
  'col_reliquary_complete',
] as const;

/** Flagship page each Illumination deed reads (single-page, hand-paired).
 *  Exported for the dispatch-totality pin only (tests/reliquary_state.test.ts
 *  holds every key to RELIQUARY_COMPLETION_DEED_IDS membership and every
 *  ladder id to exactly one dispatch arm); no production consumer exists
 *  outside this module. */
export const RELIQUARY_ILLUMINATION_DEED_PAGES: Readonly<Record<string, string>> = {
  col_reliquary_illum_nythraxis_heroic: 'conquerors_nythraxis_heroic',
  col_reliquary_illum_thunzharr: 'conquerors_thunzharr',
  col_reliquary_illum_gravewyrm_heroic: 'conquerors_gravewyrm_sanctum_heroic',
};

/**
 * Grant the zero-Renown Phase 18 completion-ladder deeds the player's pure
 * completion reads already satisfy. Idempotent via grantDeed. Sticky by
 * construction: this only ever grants, so later catalog growth lowers the
 * live read without revoking the earned record. Pure reads only, and it MUST
 * NOT read reliquaryObtainCounts / state.counts: counts are information,
 * never a score (the pinned doctrine), and no completion read may depend on
 * how many copies the world handed over.
 *
 * col_reliquary_complete is unearnable in production while THREE catalogued
 * slots stay owner-pended: the masterwork:engineering mark (13b QA ruling: no
 * engineering recipe can proc a masterwork, so the slot is catalogued but
 * unwritable) and the two SOURCE_PENDING_RULING mounts (reins_drakemaw_raptor
 * has no acquisition path in content; reins_terrorspark_groundshaker is
 * dev-grant only). All three are owner decisions outside this packet; the
 * capstone becomes earnable with NO code change here once they all land.
 * Tests may still reach owned === total by granting marks and reins directly.
 * The deed carries feat: true so this pending window can never dead-end
 * feat_book_complete (see the record's comment in content/deeds.ts).
 *
 * Does not force saveCharacter itself: grantDeed (title durability) is the
 * existing durability-critical path when a new deed lands.
 */
export function syncReliquaryCompletionDeeds(
  ctx: SimContext,
  meta: PlayerMeta,
  opts?: Readonly<{ retro?: boolean }>,
  /** The chain's already-built ownership snapshot, when a caller has one. Its
   *  item / mark / deed surfaces are live references, so a snapshot taken
   *  earlier in the same fill chain scores exactly what a rebuild here would.
   *  Optional rather than defaulted because of PLACEMENT: a default
   *  initializer runs at call entry whenever the argument is omitted, which
   *  is BEFORE the five-Set early-out below, so an omitting caller would pay
   *  the inventory + bank mount scan even in the all-earned steady state.
   *  The `??` inside the body sits after the early-out, where the scan is
   *  only ever paid when there is ladder work to score. Every production
   *  caller threads one today; the optional form keeps the early-out free
   *  for any future caller that cannot. */
  ownership?: ReliquaryOwnershipSurfaces,
): void {
  // Fast no-op once the whole ladder is earned, and the recursion floor: a
  // grant below re-enters this sync through the grantDeed title hook, and
  // grants are monotone over this finite id set, so the re-entrant pass
  // either grants something new or falls through the per-deed earned checks
  // and terminates. While col_reliquary_complete stays owner-pended the
  // all-earned state is unreachable, so a shelf-complete player re-runs the
  // walks below on each new fill; per-new-fill cadence bounded by the
  // catalog's own size, accepted until the pends land.
  let missing = false;
  for (const deedId of RELIQUARY_COMPLETION_DEED_IDS) {
    if (!meta.deedsEarned.has(deedId)) {
      missing = true;
      break;
    }
  }
  if (!missing) return;
  const own = ownership ?? characterReliquaryOwnership(meta);
  const grantOpts = opts?.retro ? ({ retro: true } as const) : undefined;
  for (const deedId of RELIQUARY_COMPLETION_DEED_IDS) {
    // Live re-check on purpose: a grant earlier in this loop can have
    // re-entrantly granted a LATER ladder deed already.
    if (meta.deedsEarned.has(deedId)) continue;
    const flagshipPageId = RELIQUARY_ILLUMINATION_DEED_PAGES[deedId];
    if (flagshipPageId !== undefined) {
      const page = RELIQUARY_PAGES_BY_ID[flagshipPageId];
      if (!page || !pageCompletion(page, own).complete) continue;
    } else if (deedId === 'col_reliquary_conquerors') {
      let shelfComplete = true;
      for (const page of RELIQUARY_PAGES) {
        if (page.shelf !== 'conquerors') continue;
        // Future-proofing: an excludeFromCompletion page (retired or
        // class-personal) can never gate the shelf deed. No conquerors page
        // carries the flag today (the shape pin forbids an unearnable
        // conquerors slot), but the skip keeps this arm aligned with the
        // completion pairs, which already exclude such pages through
        // completionScoringPages.
        if (page.excludeFromCompletion !== undefined) continue;
        if (!pageCompletion(page, own).complete) {
          shelfComplete = false;
          break;
        }
      }
      if (!shelfComplete) continue;
    } else if (deedId === 'col_reliquary_complete') {
      // Every character-durable slot filled. The shelf capstone is a
      // NECESSARY precondition (the whole catalog contains every Conquerors
      // slot, and the ladder order above grants the shelf deed earlier in
      // this same pass), so gate the expensive whole-catalog walk behind it:
      // while the shelf is incomplete, and for every player who is not one
      // shelf slot from the capstone, this check stays a Set lookup. Also
      // the reason the loop cannot be reordered: the gate reads a grant the
      // same pass just made.
      if (!meta.deedsEarned.has('col_reliquary_conquerors')) continue;
      const { owned, total } = catalogCharacterCompletion(own);
      if (owned !== total) continue;
    } else {
      // Fail closed: an id appended to RELIQUARY_COMPLETION_DEED_IDS without
      // its own branch here (and absent from the pages map) must skip, never
      // inherit another deed's grant condition. Dispatch totality is pinned
      // in tests/reliquary_state.test.ts.
      continue;
    }
    ctx.grantDeed(meta, deedId, grantOpts);
  }
}

// Re-export catalog lookup helpers so callers can import from one runtime module.
export {
  isCataloguedRelicItem,
  isCataloguedRelicMark,
  RELIQUARY_ITEM_TO_PAGES,
  RELIQUARY_MARK_IDS,
  RELIQUARY_MARK_TO_PAGES,
  RELIQUARY_PAGE_ORDER,
  RELIQUARY_PAGES,
  RELIQUARY_PAGES_BY_ID,
};
