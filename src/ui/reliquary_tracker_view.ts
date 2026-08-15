// Pure view-core for the always-on Reliquary tracker (#reliquary-tracker), the
// deed-tracker recipe scoped to The Reliquary: DOM/i18n-free selection, page
// progress, and the fill-delta flash, over one reused container the slow-band
// painter draws. Registered in UI_PURE_CORES; unit-tested in
// tests/reliquary_tracker_view.test.ts.
//
// WHAT IT SHOWS, in priority order:
//   1. The player's pinned pages, in the order they pinned them (the deeds
//      watchlist contract: insertion order is the display order).
//   2. With nothing pinned, the top nearly-complete pages, ranked by the SAME
//      rule as the Overview strip (isReliquaryNearlyComplete + rankNearlyComplete
//      in reliquary_view.ts, so the two surfaces can never disagree about what
//      "nearly complete" means).
// A pinned page that has just been illuminated drops off the strip the way an
// earned deed leaves the watchlist (ReliquaryWindow prunes the stored set on the
// same predicate, so display and storage cannot diverge).
//
// WHY THE DEFAULT SCAN IS MEMOIZED: reliquaryPageCompletion mints a fresh
// ownership bag (two Sets plus the live mount list) per CALL in both hosts, so
// the whole-catalog default scan would mint dozens of throwaway Sets every slow tick
// for an always-on strip. The scan therefore re-runs only when the cheap
// ownership signature moves (reliquaryTrackerOwnershipSig), which is exactly
// when a page's progress can have changed; pinned pages, capped at
// RELIQUARY_TRACK_CAP, are read live on every build. The signature arrives as a
// thunk so a player WITH pins never pays for it at all: gathering it costs the
// host five live ownership reads that only the default branch consults.
//
// The container is REUSED across builds, so it is also the delta source: the
// previous build's owned count per page is what decides the fill flash. No
// clock, no Math.random, no Date.now (this core is scanned for determinism):
// the flash rides RELIQUARY_FLASH_BUILDS slow-band builds, which is what gives
// the CSS pulse room to finish instead of being cut off mid-animation.
//
// Confirming the intended read of one consequence: the relic that COMPLETES a
// page never flashes, because that page leaves the strip on the very build that
// fills it (the skip predicate above), and the Illumination banner plus the chat
// line own that moment instead.

import { RELIQUARY_PAGES_BY_ID } from '../sim/content/reliquary';
import type { ReliquaryPageCompletion } from '../world_api/reliquary';
import { isReliquaryNearlyComplete, rankNearlyComplete } from './reliquary_view';

/** Pinned pages, and therefore tracker lines, per character. */
export const RELIQUARY_TRACK_CAP = 5;

/**
 * How many consecutive builds a fill keeps its flash flag. The slow band runs
 * at 500ms, so two builds hold the CSS class about a second: long enough for
 * the pulse to play out, short enough that it reads as "this just happened".
 */
export const RELIQUARY_FLASH_BUILDS = 2;

export interface ReliquaryTrackerLine {
  pageId: string;
  owned: number;
  total: number;
  /** Owned rose since the previous build (see RELIQUARY_FLASH_BUILDS). */
  flash: boolean;
}

/** One ranked default row, held across builds by the memo. */
interface ReliquaryTrackerRow {
  pageId: string;
  owned: number;
  total: number;
}

/** Previous-build state for one page: the flash's whole memory. */
interface ReliquaryTrackerPrev {
  pageId: string;
  owned: number;
  /** Builds this page's flash flag still has to run (0 = not flashing). */
  hold: number;
}

export interface ReliquaryTrackerView {
  visible: boolean;
  collapsed: boolean;
  /**
   * Compact touch tier: the header is a count chip that opens The Reliquary
   * rather than a disclosure toggle (the rows are folded away there). Set by
   * the host from document.body, not by buildReliquaryTrackerViewInto (which
   * stays DOM-free); the painter drops the disclosure a11y when it is true.
   */
  chip: boolean;
  /** Live line count; `lines` slots past it hold stale data by design. */
  count: number;
  lines: ReliquaryTrackerLine[];
  /**
   * Builder-owned state below. The painter never reads any of it; it lives on
   * the container because the container IS this core's per-instance memory.
   */
  memoSig: number | null;
  memoCount: number;
  memoRows: ReliquaryTrackerRow[];
  prevCount: number;
  prev: ReliquaryTrackerPrev[];
  /** Scratch holds for the build in flight (see the three-pass build below). */
  holds: number[];
}

export interface ReliquaryTrackerInput {
  /** Player-pinned page ids in pin order (ReliquaryWindow owns the store). */
  pinned: ReadonlySet<string>;
  /** Authored catalog page ids: the default scan's order and tie-break source. */
  pageIds: readonly string[];
  /** Page progress read (the IWorldReliquary facet member, both hosts). */
  completion(pageId: string): ReliquaryPageCompletion | null;
  /**
   * Cheap ownership signature; the default scan re-runs only when it moves.
   * A THUNK, not a number, because only the nothing-pinned branch reads it: the
   * host has to gather five live ownership counts to produce one (one of them a
   * bags-plus-bank copy), and a player with pins would otherwise pay for a
   * signature nothing consults. Called at most once per build.
   */
  ownershipSig(): number;
  collapsed: boolean;
}

/** Preallocate the reused tracker container (one per painter instance). */
export function makeReliquaryTrackerView(): ReliquaryTrackerView {
  const lines: ReliquaryTrackerLine[] = [];
  const memoRows: ReliquaryTrackerRow[] = [];
  const prev: ReliquaryTrackerPrev[] = [];
  const holds: number[] = [];
  for (let i = 0; i < RELIQUARY_TRACK_CAP; i++) {
    lines.push({ pageId: '', owned: 0, total: 0, flash: false });
    memoRows.push({ pageId: '', owned: 0, total: 0 });
    prev.push({ pageId: '', owned: 0, hold: 0 });
    holds.push(0);
  }
  return {
    visible: false,
    collapsed: false,
    chip: false,
    count: 0,
    lines,
    memoSig: null,
    memoCount: 0,
    memoRows,
    prevCount: 0,
    prev,
    holds,
  };
}

/**
 * Cheap change key over every ownership surface a page's progress folds: item
 * relics, marks, title deeds, mounts, and account weapon skins. Sizes only, and
 * mixed with distinct primes so a gain on one surface can never be cancelled by
 * a loss on another within the same tick. These sets only grow in practice
 * (relics are never un-discovered, deeds never un-earned), so a size move
 * catches every fill; the one blind spot, a same-surface add and remove inside
 * one 500ms band, self-heals on the next ownership change.
 */
export function reliquaryTrackerOwnershipSig(parts: {
  itemsDiscovered: number;
  marks: number;
  deedsEarned: number;
  mounts: number;
  weaponSkins: number;
}): number {
  // Math.imul per step keeps every intermediate in int32: one trailing |0 over
  // float products would start rounding low bits away once an intermediate
  // passes 2^53 (about 8,700 discovered items), silently disarming the memo.
  let sig = parts.itemsDiscovered | 0;
  sig = (Math.imul(sig, 1009) + parts.marks) | 0;
  sig = (Math.imul(sig, 1009) + parts.deedsEarned) | 0;
  sig = (Math.imul(sig, 1009) + parts.mounts) | 0;
  sig = (Math.imul(sig, 1009) + parts.weaponSkins) | 0;
  return sig;
}

/**
 * Fill `out` with the tracked pages (pinned first, else the nearly-complete
 * default) and their live progress. Mutates and returns the SAME container: the
 * slow band allocates nothing per call except when the default scan re-runs.
 */
export function buildReliquaryTrackerViewInto(
  out: ReliquaryTrackerView,
  input: ReliquaryTrackerInput,
): ReliquaryTrackerView {
  // Pass 1: which pages, and their progress.
  let count = 0;
  if (input.pinned.size > 0) {
    for (const pageId of input.pinned) {
      if (count >= out.lines.length) break;
      const c = input.completion(pageId);
      // A catalog-unknown id (content drift) and an illuminated page both drop
      // off here, the exact predicate ReliquaryWindow prunes its stored set on.
      if (c === null || c.total <= 0 || c.complete) continue;
      const line = out.lines[count];
      line.pageId = pageId;
      line.owned = c.owned;
      line.total = c.total;
      count++;
    }
  } else {
    refreshDefaultRows(out, input);
    for (let i = 0; i < out.memoCount && count < out.lines.length; i++) {
      const row = out.memoRows[i];
      const line = out.lines[count];
      line.pageId = row.pageId;
      line.owned = row.owned;
      line.total = row.total;
      count++;
    }
  }

  // Pass 2: the fill delta, read against the PREVIOUS build's state. Keyed by
  // page id, never by slot: a pin (or a re-rank of the default set) reshuffles
  // which page sits in which line, and an index-keyed diff would then read one
  // page's count against another's and flash a page nothing happened to.
  for (let i = 0; i < count; i++) {
    const line = out.lines[i];
    const prev = findPrev(out, line.pageId);
    let hold = prev === null ? 0 : prev.hold;
    // First sighting of a page never flashes: there is no previous count to
    // have risen from, and every pin would otherwise pulse the moment it lands.
    if (prev !== null && line.owned > prev.owned) hold = RELIQUARY_FLASH_BUILDS;
    line.flash = hold > 0;
    out.holds[i] = hold > 0 ? hold - 1 : 0;
  }

  // Pass 3: commit this build as the next build's previous state. Separate from
  // pass 2 because that pass reads the whole previous table by page id, and a
  // commit interleaved with those reads would let one line clobber the entry
  // another line has not read yet.
  for (let i = 0; i < count; i++) {
    const entry = out.prev[i];
    entry.pageId = out.lines[i].pageId;
    entry.owned = out.lines[i].owned;
    entry.hold = out.holds[i];
  }
  out.prevCount = count;

  out.count = count;
  out.visible = count > 0;
  out.collapsed = input.collapsed;
  return out;
}

export interface ReliquaryPinToggleResult {
  pinned: ReadonlySet<string>;
  /** True when the add was refused at the cap. Informational: the window
   *  branches on `changed` and re-derives its own at-cap rendering, so this
   *  flag has test consumers only; it states the refusal reason the host
   *  surfaces however it chooses. */
  full: boolean;
  changed: boolean;
}

/** Toggle a page on the pin set, enforcing the cap of RELIQUARY_TRACK_CAP.
 *  Returns the UNCHANGED set plus the full flag when an add hits the cap. */
export function toggleReliquaryPin(
  pinned: ReadonlySet<string>,
  pageId: string,
): ReliquaryPinToggleResult {
  if (pinned.has(pageId)) {
    const next = new Set(pinned);
    next.delete(pageId);
    return { pinned: next, full: false, changed: true };
  }
  if (pinned.size >= RELIQUARY_TRACK_CAP) return { pinned, full: true, changed: false };
  const next = new Set(pinned);
  next.add(pageId);
  return { pinned: next, full: false, changed: true };
}

export interface ReliquaryPinPruneResult {
  pinned: ReadonlySet<string>;
  changed: boolean;
}

/** Drop illuminated and catalog-unknown pages from the pin set: the exact skip
 *  predicate buildReliquaryTrackerViewInto applies to a pinned page, so the
 *  stored set and the strip can never diverge. An illuminated page loses its
 *  unpin button, so without this prune it would hold its cap slot forever.
 *  Returns the SAME set instance on the common nothing-dropped path. */
export function pruneReliquaryPins(
  pinned: ReadonlySet<string>,
  completion: (pageId: string) => ReliquaryPageCompletion | null,
): ReliquaryPinPruneResult {
  // Single pass, one completion() read per page: each read folds a full
  // ownership bag offline, so the drop path must not re-ask. The survivor set
  // is minted lazily on the first drop, which keeps the common no-drop path
  // allocation-free and returning the same instance.
  let next: Set<string> | null = null;
  for (const pageId of pinned) {
    const c = completion(pageId);
    if (c !== null && c.total > 0 && !c.complete) {
      if (next !== null) next.add(pageId);
      continue;
    }
    if (next === null) {
      next = new Set<string>();
      // Back-fill the survivors already walked (all kept: next was null until
      // this first drop). Iteration only, no completion() re-reads.
      for (const seen of pinned) {
        if (seen === pageId) break;
        next.add(seen);
      }
    }
  }
  if (next === null) return { pinned, changed: false };
  return { pinned: next, changed: true };
}

/** The previous build's entry for a page, or null when it was not tracked. */
function findPrev(out: ReliquaryTrackerView, pageId: string): ReliquaryTrackerPrev | null {
  for (let i = 0; i < out.prevCount; i++) {
    if (out.prev[i].pageId === pageId) return out.prev[i];
  }
  return null;
}

/**
 * Re-rank the default (nothing-pinned) selection when ownership has moved, and
 * hold it otherwise. The full scan reads every catalog page, which is why it is
 * gated: see the module comment on what one completion() call actually costs.
 */
function refreshDefaultRows(out: ReliquaryTrackerView, input: ReliquaryTrackerInput): void {
  const sig = input.ownershipSig();
  if (out.memoSig === sig) return;
  const candidates: ReliquaryTrackerRow[] = [];
  for (const pageId of input.pageIds) {
    // An excludeFromCompletion catalog page never self-selects: its missing
    // relics can no longer be won (retired) or never could be by one character
    // (class-personal), so nudging a player toward them would be a lie. Same
    // skip as buildNearlyComplete in reliquary_view.ts; resolved off the
    // authored def because this core only receives ids. A deliberate PIN on
    // such a page still tracks (player choice, pass 1).
    if (
      Object.hasOwn(RELIQUARY_PAGES_BY_ID, pageId) &&
      RELIQUARY_PAGES_BY_ID[pageId].excludeFromCompletion !== undefined
    )
      continue;
    const c = input.completion(pageId);
    if (c === null || !isReliquaryNearlyComplete(c.owned, c.total)) continue;
    candidates.push({ pageId, owned: c.owned, total: c.total });
  }
  const ranked = rankNearlyComplete(candidates);
  const kept = Math.min(ranked.length, out.memoRows.length);
  for (let i = 0; i < kept; i++) {
    out.memoRows[i].pageId = ranked[i].pageId;
    out.memoRows[i].owned = ranked[i].owned;
    out.memoRows[i].total = ranked[i].total;
  }
  out.memoCount = kept;
  out.memoSig = sig;
}
