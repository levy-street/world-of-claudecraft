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
//    background ones ride up above them.
//  - SEPARATION FOLLOWS THE REAL PLATE HEIGHT. Plates are bottom-anchored, so
//    each occupies `[sy - height, sy]`; a tall player plate (guild tag, deed
//    title, cast bar) therefore pushes the plate above it further than a bare
//    mob plate does. `height` comes from nameplate_extent_core.
//  - THE COLUMN IS BOUNDED. Total lift is capped (MAX_STACK_LIFT_PX) so a dense
//    crowd cannot build a tower of labels running off the top of the screen.
//
// Determinism: the placement order is fully determined by (pinned, sy, id), so
// the same frame always produces the same stack regardless of the order the
// painter iterated its view map in.
//
// This runs for EVERY visible plate on EVERY rendered frame, so the hot path
// (`declutterNameplatesInPlace`) keeps its scratch at high-water capacity and
// only tests each plate against the already-placed plates that share its screen
// column, via a reusable bucket index, rather than against every other plate.

import { NAMEPLATE_MIN_HEIGHT_PX } from './nameplate_extent_core';

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
  /** Plates that hit the lift cap and were left stacked at it (still overlapping). */
  cappedPlates: number;
}

// Anchors within this horizontal distance share a screen column: nameplate
// labels render much wider than the anchor point itself (name + level + hp
// bar), so this approximates half of a typical label's on-screen width rather
// than the anchor point spacing.
export const OVERLAP_THRESHOLD_X_PX = 80;
// Breathing room between two stacked plates, on top of the lower plate's height.
export const STACK_GAP_PX = 2;
// Height assumed for an anchor that does not carry one.
export const DEFAULT_PLATE_HEIGHT_PX = 26;
// A plate is lifted at most this far above its own head before the pass gives
// up and lets it overlap: an unbounded column in a 30-mob pull would run labels
// off the top of the viewport, far from the entities they name.
export const MAX_STACK_LIFT_PX = 160;
// Defensive bound on the resolve loop. Each iteration moves the plate strictly
// above every plate it currently collides with, so it can only run once per
// distinct occupied band; this just keeps a pathological input finite.
const MAX_RESOLVE_ITERATIONS = 64;

// ---------------------------------------------------------------------------
// Reusable workspace. The painter calls this once per frame on one thread, so a
// module-level scratch is safe and keeps the buckets at their high-water
// capacity instead of reallocating every frame.
// ---------------------------------------------------------------------------
const placeOrder: number[] = [];
/** column index -> indices of the plates already placed in that column */
const columns = new Map<number, number[]>();
const usedColumns: number[] = [];

function plateHeight(anchor: NameplateAnchor): number {
  const h = anchor.height;
  if (typeof h !== 'number' || !Number.isFinite(h) || h <= 0) return DEFAULT_PLATE_HEIGHT_PX;
  return Math.max(NAMEPLATE_MIN_HEIGHT_PX, h);
}

function columnFor(sx: number): number {
  const c = Math.floor(sx / OVERLAP_THRESHOLD_X_PX);
  // Beyond safe integer column ids the division collapses distinct representable
  // screen coordinates into one bucket. That can only ever ADD candidates, and
  // the explicit |dx| test below filters them, so it stays correct.
  return Number.isSafeInteger(c) ? c : 0;
}

function bucket(column: number): number[] {
  let list = columns.get(column);
  if (!list) {
    list = [];
    columns.set(column, list);
  }
  // Every bucket() call is followed by a push, so an empty list is always one
  // this frame has not touched yet: no membership scan needed.
  if (list.length === 0) usedColumns.push(column);
  return list;
}

/**
 * Stack overlapping anchors into a vertical column, MUTATING `anchors` in place.
 *
 * `count` bounds the live prefix, so the caller can hand in a pooled array that
 * is longer than this frame's anchor list without any slicing.
 */
export function declutterNameplatesInPlace(
  anchors: NameplateAnchor[],
  count = anchors.length,
  metrics?: NameplateDeclutterMetrics,
): NameplateAnchor[] {
  const n = Math.min(count, anchors.length);
  if (metrics) {
    metrics.candidateChecks = 0;
    metrics.cappedPlates = 0;
  }
  if (n < 2) return anchors;

  for (const column of usedColumns) {
    const list = columns.get(column);
    if (list) list.length = 0;
  }
  usedColumns.length = 0;

  placeOrder.length = 0;
  for (let i = 0; i < n; i++) {
    // A plate that did not project to finite screen coordinates cannot be
    // stacked meaningfully; leave it exactly where the painter put it.
    if (!Number.isFinite(anchors[i].sx) || !Number.isFinite(anchors[i].sy)) continue;
    placeOrder.push(i);
  }
  placeOrder.sort((a, b) => {
    const pinnedDelta = (anchors[b].pinned === true ? 1 : 0) - (anchors[a].pinned === true ? 1 : 0);
    if (pinnedDelta !== 0) return pinnedDelta;
    // bottom-most (nearest) first, so foreground plates keep their own spot
    const syDelta = anchors[b].sy - anchors[a].sy;
    if (syDelta !== 0) return syDelta;
    return anchors[a].id - anchors[b].id;
  });

  for (let k = 0; k < placeOrder.length; k++) {
    const index = placeOrder[k];
    const anchor = anchors[index];
    const height = plateHeight(anchor);
    const column = columnFor(anchor.sx);
    let y = anchor.sy;

    if (anchor.pinned !== true) {
      const floorY = anchor.sy - MAX_STACK_LIFT_PX;
      for (let iteration = 0; iteration < MAX_RESOLVE_ITERATIONS; iteration++) {
        // Top edge of the lowest plate this one currently collides with: moving
        // just above it clears every collision found this iteration at once.
        let clearY = Number.POSITIVE_INFINITY;
        for (let dc = -1; dc <= 1; dc++) {
          const list = columns.get(column + dc);
          if (!list) continue;
          for (const j of list) {
            if (metrics) metrics.candidateChecks++;
            const other = anchors[j];
            if (Math.abs(other.sx - anchor.sx) > OVERLAP_THRESHOLD_X_PX) continue;
            const otherTop = other.sy - plateHeight(other);
            // No vertical overlap: this plate sits entirely above or below it.
            if (y <= otherTop - STACK_GAP_PX || y - height >= other.sy + STACK_GAP_PX) continue;
            if (otherTop < clearY) clearY = otherTop;
          }
        }
        if (clearY === Number.POSITIVE_INFINITY) break;
        const nextY = clearY - STACK_GAP_PX;
        if (nextY < floorY) {
          // The column is full: park the plate at the cap and accept the
          // overlap rather than sending the label off the top of the screen.
          y = floorY;
          if (metrics) metrics.cappedPlates++;
          break;
        }
        y = nextY;
      }
    }

    anchor.sy = y;
    bucket(column).push(index);
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
