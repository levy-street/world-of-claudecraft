// Pure post-projection pass: stacks overlapping nameplates into a vertical
// column the way the classic client does, instead of letting a knot of nearby
// mobs render their labels on top of each other. DOM/Three-free so it unit-tests
// directly.
//
// The stacking rules, and why each one is the way it is:
//
//  - PLATES ONLY EVER MOVE UP. A plate's projected anchor is the floor: it is
//    drawn at its own head height or above it, never below, so a label can never
//    slide down over the character it belongs to (or over a plate that has
//    already settled below it). The pass this replaced re-anchored a whole
//    cluster around its MEAN y, which yanked the bottom half of the cluster down
//    and detached those labels from their owners.
//  - THE ANCHOR PLATE KEEPS ITS SPOT. Anchors flagged `pinned` (the painter pins
//    the current target) are placed first at their projected position and are
//    never displaced, so the one plate the player is actually reading stays put
//    while everything else flows around it.
//  - PLATES CLOSEST TO THE CAMERA WIN. The rest are placed bottom-most first
//    (descending sy, which is descending screen depth for entities standing on
//    the same ground), so foreground plates keep their natural position and
//    background ones ride up above them. The sy ordering key is QUANTIZED
//    (STACK_ORDER_QUANTUM_PX) so two plates drifting past each other keep a
//    stable id order instead of trading rows every frame.
//  - SEPARATION FOLLOWS THE REAL PLATE HEIGHT. Plates are bottom-anchored, so
//    each occupies `[sy - height, sy]`; a tall player plate (guild tag, deed
//    title, cast bar) therefore pushes the plate above it further than a bare
//    mob plate does. `height` comes from nameplate_extent_core.
//  - A CROWDED RUN COMPRESSES INSTEAD OF EXPLODING. Full-height separation for
//    30 plates in one spot would run labels off the top of the screen, so a plate
//    whose own lift overruns MAX_STACK_LIFT_PX re-resolves against an even
//    compressed step (never below MIN_STACK_STEP_PX); the band is MAX_STACK_LIFT_PX
//    or the room left under `topLimitPx`, whichever is smaller. Compression is keyed off
//    the plates that ACTUALLY collide, not off how many share the column, so a
//    column of mobs at different depths (looking down a road) keeps full
//    separation. Compressed plates clip each other, but each keeps a distinct
//    row, which a hard cap-and-pile does not.
//  - NO PLATE IS LIFTED OFF SCREEN. The caller's `topLimitPx` clamps the column
//    (the painter passes the viewport top): an invisible nameplate is information
//    the player acts on, so a column with nowhere left to go piles at the edge.
//
// Determinism: the placement order is fully determined by (pinned, quantized sy,
// id), so the same frame always produces the same stack regardless of the order
// the painter iterated its view map in.
//
// This runs for EVERY visible plate on EVERY rendered frame, so the hot path
// (`declutterNameplatesInPlace`) keeps its scratch at high-water capacity, tests
// each plate only against the already-placed plates in its own screen column and
// the two neighbouring ones, and keeps each of those columns sorted by screen y
// so the scan can binary-search into the collision window and break out of it.

import { NAMEPLATE_BASE_HEIGHT_PX, NAMEPLATE_MAX_HEIGHT_PX } from './nameplate_extent_core';

export interface NameplateAnchor {
  id: number;
  sx: number;
  sy: number;
  /**
   * Rendered plate height in px (plates are bottom-anchored at `sy`).
   * Defaults to DEFAULT_PLATE_HEIGHT_PX when omitted or not a finite positive
   * number, so a caller that does not track heights still gets sane spacing.
   */
  height?: number;
  /** Never displaced: placed first, at its projected position (the current target). */
  pinned?: boolean;
}

export interface NameplateDeclutterMetrics {
  /** Placed-plate visits during collision resolution, not total operations. */
  candidateChecks: number;
  /** Plates placed in a column crowded enough that its step had to compress. */
  compressedPlates: number;
}

// Anchors within this horizontal distance share a screen column: nameplate
// labels render much wider than the anchor point itself (name + level + hp
// bar), so this approximates half of a typical label's on-screen width rather
// than the anchor point spacing.
export const OVERLAP_THRESHOLD_X_PX = 80;
// Breathing room between two stacked plates, on top of the lower plate's height.
export const STACK_GAP_PX = 2;
// Height assumed for an anchor that does not carry one: a plain mob plate.
export const DEFAULT_PLATE_HEIGHT_PX = NAMEPLATE_BASE_HEIGHT_PX;
// How far a column may run above its bottom plate before its step compresses.
export const MAX_STACK_LIFT_PX = 200;
// The compressed step floor: below this the names stop being separable at all,
// so a truly enormous column overshoots MAX_STACK_LIFT_PX rather than pile up.
export const MIN_STACK_STEP_PX = 12;
// Ordering hysteresis: sy differences smaller than this do not reorder the
// stack (the id tiebreak decides), so plates at nearly equal depth do not swap
// rows every frame as the camera drifts.
export const STACK_ORDER_QUANTUM_PX = 8;
// Defensive bound on the resolve loop. Each iteration moves the plate strictly
// above every plate it currently collides with, so it can only run once per
// distinct occupied band; this just keeps a pathological input finite.
const MAX_RESOLVE_ITERATIONS = 64;
// The widest separation any single plate can demand, used to bound the scan
// window into a column's sorted placed list.
const MAX_SEPARATION_PX = NAMEPLATE_MAX_HEIGHT_PX + STACK_GAP_PX;

// ---------------------------------------------------------------------------
// Reusable workspace. The painter calls this once per frame on one thread, so a
// module-level scratch is safe and keeps the buckets at their high-water
// capacity instead of reallocating every frame.
// ---------------------------------------------------------------------------
const placeOrder: number[] = [];
/** column index -> indices of the plates already placed there, sorted by descending sy */
const columns = new Map<number, number[]>();
/** the columns this frame touched, so the reset knows what to hand back to the pool */
const usedColumns: number[] = [];
/** Recycled list objects. `sx` is NOT viewport-clamped (an entity beside the camera
 *  plane projects arbitrarily far out), so column ids are unbounded and keeping a
 *  Map entry per id ever seen would grow for the life of the session: the keys are
 *  dropped each frame and only the ARRAYS are pooled, which is what kept the
 *  allocation-free property. */
const columnPool: number[][] = [];

function plateHeight(anchor: NameplateAnchor): number {
  const h = anchor.height;
  if (typeof h !== 'number' || !Number.isFinite(h) || h <= 0) return DEFAULT_PLATE_HEIGHT_PX;
  return Math.min(NAMEPLATE_MAX_HEIGHT_PX, h);
}

function columnFor(sx: number): number {
  const c = Math.floor(sx / OVERLAP_THRESHOLD_X_PX);
  // Beyond safe integer column ids the division collapses distinct representable
  // screen coordinates into one bucket. That can only ever ADD candidates, and
  // the explicit |dx| test below filters them, so it stays correct.
  return Number.isSafeInteger(c) ? c : 0;
}

/** Clearance a plate must leave above `anchor` (its height, compressed if crowded). */
function separationAbove(anchor: NameplateAnchor, stepCap: number): number {
  return Math.min(plateHeight(anchor) + STACK_GAP_PX, stepCap);
}

/** Insert `index` into a column list kept sorted by DESCENDING sy. */
function insertPlaced(list: number[], index: number, anchors: NameplateAnchor[]): void {
  const y = anchors[index].sy;
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (anchors[list[mid]].sy > y) lo = mid + 1;
    else hi = mid;
  }
  list.splice(lo, 0, index);
}

/** First index in a descending-sy list whose plate can still reach up to `y`. */
function scanStart(list: number[], anchors: NameplateAnchor[], y: number): number {
  const ceiling = y + MAX_SEPARATION_PX;
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (anchors[list[mid]].sy >= ceiling) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Outputs of `resolve`, module-level so the hot path returns two numbers without
// allocating a result object per plate per frame.
let resolvedY = 0;
let resolvedRun = 0;

/**
 * Find the lowest position at or above `anchor.sy` that clears every plate
 * already placed in its column neighbourhood, given a per-step ceiling
 * (`stepCap`, POSITIVE_INFINITY for full-height separation). Writes the result
 * to `resolvedY` and the number of plates that pushed it to `resolvedRun`.
 */
function resolve(
  anchors: NameplateAnchor[],
  anchor: NameplateAnchor,
  column: number,
  stepCap: number,
  metrics?: NameplateDeclutterMetrics,
): void {
  const ownSeparation = separationAbove(anchor, stepCap);
  let y = anchor.sy;
  let run = 0;
  for (let iteration = 0; iteration < MAX_RESOLVE_ITERATIONS; iteration++) {
    let clearY = Number.POSITIVE_INFINITY;
    for (let dc = -1; dc <= 1; dc++) {
      const list = columns.get(column + dc);
      if (!list || list.length === 0) continue;
      // Walk the whole contiguous run of plates this one would collide with,
      // carrying the frontier up as it goes: a packed column resolves in ONE
      // pass instead of one hop (and one full rescan) per plate above.
      let frontier = y;
      for (let p = scanStart(list, anchors, y); p < list.length; p++) {
        const other = anchors[list[p]];
        // Sorted descending: once a placed plate sits far enough above the
        // frontier, so does every plate after it in the list.
        if (other.sy <= frontier - ownSeparation) break;
        if (metrics) metrics.candidateChecks++;
        if (Math.abs(other.sx - anchor.sx) > OVERLAP_THRESHOLD_X_PX) continue;
        const clear = other.sy - separationAbove(other, stepCap);
        if (frontier <= clear) continue;
        frontier = clear;
        run++;
      }
      if (frontier < clearY) clearY = frontier;
    }
    // The columns interleave, so a frontier raised by one of them can collide
    // with another's plates; that is what the outer iteration is for.
    if (clearY >= y) break;
    y = clearY;
  }
  resolvedY = y;
  resolvedRun = run;
}

/**
 * Stack overlapping anchors into a vertical column, MUTATING `anchors` in place.
 *
 * `count` bounds the live prefix, so the caller can hand in a pooled array that
 * is longer than this frame's anchor list without any slicing. `topLimitPx` is
 * the screen y no plate may be lifted past (the painter passes the viewport top);
 * the default leaves the column unclamped, for callers with no viewport.
 */
export function declutterNameplatesInPlace(
  anchors: NameplateAnchor[],
  count = anchors.length,
  metrics?: NameplateDeclutterMetrics,
  topLimitPx = Number.NEGATIVE_INFINITY,
): NameplateAnchor[] {
  const n = Math.min(count, anchors.length);
  if (metrics) {
    metrics.candidateChecks = 0;
    metrics.compressedPlates = 0;
  }
  if (n < 2) return anchors;

  for (const column of usedColumns) {
    const list = columns.get(column);
    if (list) {
      list.length = 0;
      columnPool.push(list);
    }
    columns.delete(column);
  }
  usedColumns.length = 0;

  placeOrder.length = 0;
  for (let i = 0; i < n; i++) {
    // A plate that did not project to finite screen coordinates cannot be
    // stacked meaningfully; leave it exactly where the painter put it.
    if (!Number.isFinite(anchors[i].sx) || !Number.isFinite(anchors[i].sy)) continue;
    placeOrder.push(i);
    const column = columnFor(anchors[i].sx);
    if (!columns.has(column)) {
      columns.set(column, columnPool.pop() ?? []);
      usedColumns.push(column);
    }
  }
  placeOrder.sort((a, b) => {
    const pinnedDelta = (anchors[b].pinned === true ? 1 : 0) - (anchors[a].pinned === true ? 1 : 0);
    if (pinnedDelta !== 0) return pinnedDelta;
    // bottom-most (nearest) first, quantized so near-equal depths keep id order
    const syDelta =
      Math.round(anchors[b].sy / STACK_ORDER_QUANTUM_PX) -
      Math.round(anchors[a].sy / STACK_ORDER_QUANTUM_PX);
    if (syDelta !== 0) return syDelta;
    return anchors[a].id - anchors[b].id;
  });

  for (let k = 0; k < placeOrder.length; k++) {
    const index = placeOrder[k];
    const anchor = anchors[index];
    const column = columnFor(anchor.sx);
    let y = anchor.sy;

    if (anchor.pinned !== true) {
      // Pass one asks for full-height separation. Only if THIS plate's own lift
      // then overruns the band does its colliding RUN get an even compressed
      // step: keying compression off the run (rather than off how many plates
      // happen to share the column) leaves a column of well-separated plates at
      // different depths at full separation, which is the common case.
      // The band is the room this plate actually has: MAX_STACK_LIFT_PX, or less
      // when the viewport top is nearer than that. On a short mobile-landscape
      // viewport that is what turns a pile at the screen edge into a tight fan.
      const height = plateHeight(anchor);
      const band = Math.max(0, Math.min(MAX_STACK_LIFT_PX, anchor.sy - (topLimitPx + height)));
      resolve(anchors, anchor, column, Number.POSITIVE_INFINITY, metrics);
      y = resolvedY;
      if (anchor.sy - y > band) {
        const step = Math.max(MIN_STACK_STEP_PX, band / Math.max(1, resolvedRun));
        resolve(anchors, anchor, column, step, metrics);
        y = resolvedY;
        if (metrics) metrics.compressedPlates++;
      }
      // Never lift a plate off the top of the viewport: an invisible nameplate
      // is lost information (enemy presence and position), so a column that runs
      // out of screen piles up at the edge instead. Never pushes a plate DOWN,
      // including one whose own anchor is already above the limit.
      const clamp = topLimitPx + height;
      if (y < clamp) y = Math.max(y, Math.min(anchor.sy, clamp));
    }

    anchor.sy = y;
    const list = columns.get(column);
    if (list) insertPlaced(list, index, anchors);
  }

  return anchors;
}

/**
 * Non-mutating wrapper: returns fresh anchors and leaves the input untouched.
 * It allocates, so it is NOT the per-frame path.
 */
export function declutterNameplates(anchors: NameplateAnchor[]): NameplateAnchor[] {
  return declutterNameplatesInPlace(anchors.map((a) => ({ ...a })));
}
