// Pure post-projection pass: nudges apart nameplates whose screen positions
// would otherwise fully overlap (e.g. two same-named mobs standing close
// together). Most visible on short mobile-landscape viewports, where entities
// need to be much farther apart in world space before their projections
// separate on their own. DOM/Three-free so it unit-tests directly.
//
// This runs for EVERY visible plate on EVERY rendered frame, so the hot path
// (`declutterNameplatesInPlace`) reuses high-water scratch capacity and finds
// each anchor's collision cluster through a reusable spatial hash rather than
// rescanning all anchors, which made the pass quadratic in a crowd.
//
// A plate's vertical envelope is the bare label's plus whatever it paints ABOVE
// its name row (`extraLift`, a pixel count): the deed heraldry's seal and
// ribbon, or the player's own dot row, which at 300% is taller than three bare
// labels. The lift is consumed as a NUMBER everywhere it matters: a pair
// collides when the taller of its two lifts still reaches the other plate, the
// hash sweep reaches as many cells as the tallest live lift needs, and a
// stacked component fans at the pitch its tallest member needs. Reading it as
// a yes/no and applying the 8px heraldry envelope left two dotted plates 28px
// apart under 39px icons.

import { NAMEPLATE_HERALDRY_EXTRA_LIFT } from './nameplate_heraldry_core';

export interface NameplateAnchor {
  id: number;
  sx: number;
  sy: number;
  /**
   * Extra pixels this plate paints ABOVE its name row, and therefore how much
   * further its envelope reaches than a bare label's. Two sources add into it:
   * the deed heraldry's seal and ribbon, and the player's own dot row (which
   * draws under the name row and so lifts everything above it). Zero for a
   * borderless plate with no dots. Consumed as a pixel count, not a flag: the
   * vertical collision reach and the stack pitch both grow by exactly this.
   */
  extraLift?: number;
}

export interface NameplateDeclutterMetrics {
  /** Anchor visits in component collection and diagonal queries, not total operations. */
  candidateChecks: number;
  /** Spatial-hash neighbour lookups, used to pin the 3x3/5x5 sweep choice. */
  neighborCellProbes: number;
  /** Explicit typed-buffer growth events, not transient engine or Array.sort allocations. */
  spatialHashResizes: number;
}

// Borderless plates retain the established label envelope. A lifted plate
// (heraldry or a dot row) widens its pairs to the heraldry envelope sideways
// and extends their vertical reach by its own lift, so ordinary town crowds do
// not pay for absent reward chrome.
export const OVERLAP_THRESHOLD_X_PX = 80;
export const OVERLAP_THRESHOLD_Y_PX = 18;
export const STACK_OFFSET_PX = 20;
// The accepted E45 world-heraldry envelope reserves 15px beyond the established
// 80px label reach for the left-mounted seal hardware. A dot row takes the same
// fixed sideways reach (a width term of its own is a known follow-up).
export const HERALDRY_OVERLAP_THRESHOLD_X_PX = 95;
// The heraldry instance of the general vertical rule: a lift of L px extends
// the collision reach and the stack pitch by exactly L.
export const HERALDRY_OVERLAP_THRESHOLD_Y_PX =
  OVERLAP_THRESHOLD_Y_PX + NAMEPLATE_HERALDRY_EXTRA_LIFT;
export const HERALDRY_STACK_OFFSET_PX = STACK_OFFSET_PX + NAMEPLATE_HERALDRY_EXTRA_LIFT;

// Cell size equals the BORDERLESS thresholds, so every cell remains an atomic
// collision clique (a wider reach only adds overlaps, never removes one). Two
// anchors within reach `r` of each other sit at most floor(r / cell) + 1 cells
// apart, so a lifted pair needs this many cells sideways (95px is under two
// cells) and `liftedNeighborRadiusY` cells downwards, which grows with the
// tallest live lift and is derived per pass.
const LIFTED_NEIGHBOR_RADIUS_X =
  Math.floor(HERALDRY_OVERLAP_THRESHOLD_X_PX / OVERLAP_THRESHOLD_X_PX) + 1;

function liftedNeighborRadiusY(maxLift: number): number {
  return Math.floor((OVERLAP_THRESHOLD_Y_PX + maxLift) / OVERLAP_THRESHOLD_Y_PX) + 1;
}

function cellCoord(v: number, size: number): number | null {
  if (!Number.isFinite(v)) return null;
  const coord = Math.floor(v / size);
  // Beyond safe integer cell ids, division can collapse distinct representable
  // screen coordinates into one bucket. At that magnitude the float ULP is
  // already wider than the overlap threshold, so only equal coordinates can
  // collide; keying by the original value preserves that distinction. Its
  // magnitude also exceeds every safe cell id, so the keyspaces cannot alias.
  if (!Number.isSafeInteger(coord)) return v;
  return coord === 0 ? 0 : coord;
}

// ---------------------------------------------------------------------------
// Reusable workspace. The painter calls this once per frame on one thread, so a
// module-level scratch is safe and keeps the explicit hash/traversal buffers at
// their established high-water capacity.
// ---------------------------------------------------------------------------
const cluster: number[] = [];
const cellQueue: number[] = [];
const occupiedSlots: number[] = [];
const spatialOrder: number[] = [];
let cellX = new Float64Array(128);
let cellY = new Float64Array(128);
let cellStamp = new Uint32Array(128);
let cellVisitedStamp = new Uint32Array(128);
let cellSortedStart = new Int32Array(128);
let cellSortedEnd = new Int32Array(128);
let anchorCellSlot = new Int32Array(64);
let suffixMinY = new Float64Array(64);
let suffixMaxY = new Float64Array(64);
// A lifted anchor's sy pushed outward by its own lift on BOTH sides. The pair
// test is symmetric in which plate carries the lift (the E45 rule), so the
// reach a lifted anchor offers its neighbours is too: a plate collides with it
// when the gap between them is within the bare threshold of these edges.
let suffixMinLiftReach = new Float64Array(64);
let suffixMaxLiftReach = new Float64Array(64);
let cellMinHeraldryX = new Float64Array(128);
let cellMaxHeraldryX = new Float64Array(128);
let cellMinLiftReach = new Float64Array(128);
let cellMaxLiftReach = new Float64Array(128);
let neighborSlots = new Int32Array(25);
let cellEpoch = 0;
const hashFloat = new Float64Array(1);
const hashBits = new Uint32Array(hashFloat.buffer);

function ensureSpatialHashCapacity(count: number): number {
  let resizes = 0;
  let tableCapacity = 128;
  while (tableCapacity < count * 4) tableCapacity *= 2;
  if (cellStamp.length < tableCapacity) {
    cellX = new Float64Array(tableCapacity);
    cellY = new Float64Array(tableCapacity);
    cellStamp = new Uint32Array(tableCapacity);
    cellVisitedStamp = new Uint32Array(tableCapacity);
    cellSortedStart = new Int32Array(tableCapacity);
    cellSortedEnd = new Int32Array(tableCapacity);
    cellMinHeraldryX = new Float64Array(tableCapacity);
    cellMaxHeraldryX = new Float64Array(tableCapacity);
    cellMinLiftReach = new Float64Array(tableCapacity);
    cellMaxLiftReach = new Float64Array(tableCapacity);
    cellEpoch = 0;
    resizes++;
  }
  if (anchorCellSlot.length < count) {
    let anchorCapacity = anchorCellSlot.length;
    while (anchorCapacity < count) anchorCapacity *= 2;
    anchorCellSlot = new Int32Array(anchorCapacity);
    suffixMinY = new Float64Array(anchorCapacity);
    suffixMaxY = new Float64Array(anchorCapacity);
    suffixMinLiftReach = new Float64Array(anchorCapacity);
    suffixMaxLiftReach = new Float64Array(anchorCapacity);
    resizes++;
  }
  cellEpoch = (cellEpoch + 1) >>> 0;
  if (cellEpoch === 0) {
    cellStamp.fill(0);
    cellVisitedStamp.fill(0);
    cellEpoch = 1;
  }
  return resizes;
}

/** The neighbour sweep dedupes far-keyed cells whose probes alias, so it needs
 *  one slot per probe of the current radius. Grows to a high-water mark like
 *  the hash buffers and counts as one resize when it does. */
function ensureNeighborSlotCapacity(radiusX: number, radiusY: number): number {
  const span = (2 * radiusX + 1) * (2 * radiusY + 1);
  if (neighborSlots.length >= span) return 0;
  neighborSlots = new Int32Array(span);
  return 1;
}

function mixCellHash(hash: number, value: number): number {
  hashFloat[0] = value;
  hash = Math.imul(hash ^ hashBits[0], 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13) ^ hashBits[1], 0xc2b2ae35);
  return (hash ^ (hash >>> 16)) >>> 0;
}

function findCellSlot(cx: number, cy: number, create: boolean): number {
  const mask = cellStamp.length - 1;
  let slot = mixCellHash(mixCellHash(0x9e3779b9, cx), cy) & mask;
  while (cellStamp[slot] === cellEpoch) {
    if (cellX[slot] === cx && cellY[slot] === cy) return slot;
    slot = (slot + 1) & mask;
  }
  if (!create) return -1;
  cellStamp[slot] = cellEpoch;
  cellX[slot] = cx;
  cellY[slot] = cy;
  occupiedSlots.push(slot);
  return slot;
}

function firstAnchorInCell(slot: number): number {
  return spatialOrder[cellSortedStart[slot]];
}

function lastAnchorInCell(slot: number): number {
  return spatialOrder[cellSortedEnd[slot] - 1];
}

/** The anchor's lift as a usable pixel count: a plate reaches past the
 *  bare-label envelope when this is positive, for deed heraldry AND for a plate
 *  carrying the player's own dot row (both take the wider sideways envelope,
 *  and each extends the vertical one by exactly its lift). An absent, negative
 *  or non-finite value reads as zero, so a corrupt lift can neither shrink a
 *  plate's envelope below the bare label nor make the sweep radius unbounded. */
function liftOf(anchor: NameplateAnchor): number {
  const lift = anchor.extraLift;
  return lift !== undefined && Number.isFinite(lift) && lift > 0 ? lift : 0;
}

function cellHasLift(slot: number): boolean {
  return cellMinHeraldryX[slot] !== Number.POSITIVE_INFINITY;
}

/**
 * Does `candidate` (in the right-hand cell) overlap any anchor of the x-sorted
 * left-hand segment [leftStart, leftEnd)? A binary search finds the first left
 * anchor within `overlapX`; the suffix extrema from there answer the vertical
 * test in O(1). With `liftedOnly` the extrema are the lifted anchors' reach
 * edges (sy pushed out by each one's own lift), so `overlapY` is then the bare
 * threshold and every left anchor contributes its own lift to the test.
 */
function candidateOverlapsSuffix(
  candidate: NameplateAnchor,
  leftStart: number,
  leftEnd: number,
  leftIsLower: boolean,
  anchors: NameplateAnchor[],
  overlapX: number,
  overlapY: number,
  liftedOnly: boolean,
): boolean {
  let low = leftStart;
  let high = leftEnd;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (candidate.sx - anchors[spatialOrder[mid]].sx > overlapX) low = mid + 1;
    else high = mid;
  }
  if (low >= leftEnd) return false;
  const minY = liftedOnly ? suffixMinLiftReach[low] : suffixMinY[low];
  const maxY = liftedOnly ? suffixMaxLiftReach[low] : suffixMaxY[low];
  return leftIsLower ? candidate.sy - maxY <= overlapY : minY - candidate.sy <= overlapY;
}

/**
 * Cells are cliques because their width and height equal the inclusive overlap
 * thresholds. This tests whether two neighbouring cliques share at least one
 * edge without enumerating their Cartesian product.
 *
 * A pair overlaps when it is within the sideways reach (80px bare, 95px once
 * either plate is lifted) AND within 18px + the taller of its two lifts
 * vertically. That taller-lift rule splits into two one-sided tests, each
 * exact on its own: the candidate's lift against the other cell's raw anchors,
 * and the other cell's lifted anchors' reach edges against the candidate's raw
 * position. Together they are the whole predicate, so the hot path agrees
 * with the O(N^2) reference anchor for anchor.
 */
function cellsOverlap(
  aSlot: number,
  bSlot: number,
  anchors: NameplateAnchor[],
  metrics?: NameplateDeclutterMetrics,
): boolean {
  const hasLiftedPair = cellHasLift(aSlot) || cellHasLift(bSlot);
  const cellDeltaX = Math.abs(cellX[aSlot] - cellX[bSlot]);
  const cellDeltaY = Math.abs(cellY[aSlot] - cellY[bSlot]);
  const canBaseOverlap = cellDeltaX <= 1 && cellDeltaY <= 1;
  if (!canBaseOverlap && !hasLiftedPair) return false;

  if (cellY[aSlot] === cellY[bSlot]) {
    // One row: every pair is already within the bare vertical reach, and a
    // lift never changes the sideways envelope, so only the x reach decides.
    const left = cellX[aSlot] < cellX[bSlot] ? aSlot : bSlot;
    const right = left === aSlot ? bSlot : aSlot;
    const rightMinX = anchors[firstAnchorInCell(right)].sx;
    const leftMaxX = anchors[lastAnchorInCell(left)].sx;
    if (canBaseOverlap && rightMinX - leftMaxX <= OVERLAP_THRESHOLD_X_PX) return true;
    if (!hasLiftedPair) return false;
    return (
      cellMinHeraldryX[right] - leftMaxX <= HERALDRY_OVERLAP_THRESHOLD_X_PX ||
      rightMinX - cellMaxHeraldryX[left] <= HERALDRY_OVERLAP_THRESHOLD_X_PX
    );
  }

  if (cellX[aSlot] === cellX[bSlot]) {
    // One column: every pair is already within the bare sideways reach. The
    // two one-sided lift tests compare a lifted anchor's reach edge in either
    // cell against the nearest raw anchor of the other.
    const above = cellY[aSlot] < cellY[bSlot] ? aSlot : bSlot;
    const below = above === aSlot ? bSlot : aSlot;
    const belowMinY = suffixMinY[cellSortedStart[below]];
    const aboveMaxY = suffixMaxY[cellSortedStart[above]];
    if (canBaseOverlap && belowMinY - aboveMaxY <= OVERLAP_THRESHOLD_Y_PX) return true;
    if (!hasLiftedPair) return false;
    return (
      cellMinLiftReach[below] - aboveMaxY <= OVERLAP_THRESHOLD_Y_PX ||
      belowMinY - cellMaxLiftReach[above] <= OVERLAP_THRESHOLD_Y_PX
    );
  }

  // Diagonal cells need a two-dimensional dominance query: independent x/y
  // bounds can claim an overlap even when different anchors provide each bound.
  // The left cell is sorted by x; suffix extrema answer each right-cell query
  // in O(log cell-size), so dense non-overlapping neighbours stay subquadratic.
  const left = cellX[aSlot] < cellX[bSlot] ? aSlot : bSlot;
  const right = left === aSlot ? bSlot : aSlot;
  const leftStart = cellSortedStart[left];
  const leftEnd = cellSortedEnd[left];
  const leftIsLower = cellY[left] < cellY[right];
  const rightStart = cellSortedStart[right];
  const rightEnd = cellSortedEnd[right];
  if (canBaseOverlap) {
    for (let p = rightStart; p < rightEnd; p++) {
      if (metrics) metrics.candidateChecks++;
      if (
        candidateOverlapsSuffix(
          anchors[spatialOrder[p]],
          leftStart,
          leftEnd,
          leftIsLower,
          anchors,
          OVERLAP_THRESHOLD_X_PX,
          OVERLAP_THRESHOLD_Y_PX,
          false,
        )
      ) {
        return true;
      }
    }
  }
  if (!hasLiftedPair) return false;

  const leftHasLift = cellHasLift(left);
  for (let p = rightStart; p < rightEnd; p++) {
    const candidate = anchors[spatialOrder[p]];
    const candidateLift = liftOf(candidate);
    if (candidateLift > 0) {
      if (metrics) metrics.candidateChecks++;
      if (
        candidateOverlapsSuffix(
          candidate,
          leftStart,
          leftEnd,
          leftIsLower,
          anchors,
          HERALDRY_OVERLAP_THRESHOLD_X_PX,
          OVERLAP_THRESHOLD_Y_PX + candidateLift,
          false,
        )
      ) {
        return true;
      }
    }
    if (leftHasLift) {
      if (metrics) metrics.candidateChecks++;
      if (
        candidateOverlapsSuffix(
          candidate,
          leftStart,
          leftEnd,
          leftIsLower,
          anchors,
          HERALDRY_OVERLAP_THRESHOLD_X_PX,
          OVERLAP_THRESHOLD_Y_PX,
          true,
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Stack overlapping anchors apart, MUTATING `anchors` in place.
 *
 * Members of each collision component are stacked in ascending id order so the
 * same entities always stack the same way frame to frame, independent of render
 * order.
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
    metrics.neighborCellProbes = 0;
    metrics.spatialHashResizes = 0;
  }
  if (n < 2) return anchors;

  let spatialHashResizes = ensureSpatialHashCapacity(n);

  occupiedSlots.length = 0;
  spatialOrder.length = 0;
  let maxLift = 0;
  for (let i = 0; i < n; i++) {
    const cx = cellCoord(anchors[i].sx, OVERLAP_THRESHOLD_X_PX);
    const cy = cellCoord(anchors[i].sy, OVERLAP_THRESHOLD_Y_PX);
    if (cx === null || cy === null) continue;
    const lift = liftOf(anchors[i]);
    if (lift > maxLift) maxLift = lift;
    const slot = findCellSlot(cx, cy, true);
    anchorCellSlot[i] = slot;
    spatialOrder.push(i);
  }

  // Group each cell into one x-sorted segment and build suffix y-extrema for
  // exact diagonal neighbour checks. Every collection reuses high-water space.
  spatialOrder.sort((a, b) => {
    const slotDelta = anchorCellSlot[a] - anchorCellSlot[b];
    if (slotDelta !== 0) return slotDelta;
    const xDelta = anchors[a].sx - anchors[b].sx;
    if (xDelta !== 0) return xDelta;
    const yDelta = anchors[a].sy - anchors[b].sy;
    return yDelta !== 0 ? yDelta : anchors[a].id - anchors[b].id;
  });
  for (const slot of occupiedSlots) {
    cellSortedStart[slot] = -1;
    cellSortedEnd[slot] = -1;
  }
  for (let p = 0; p < spatialOrder.length; p++) {
    const slot = anchorCellSlot[spatialOrder[p]];
    if (cellSortedStart[slot] < 0) cellSortedStart[slot] = p;
    cellSortedEnd[slot] = p + 1;
  }
  for (const slot of occupiedSlots) {
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let minHeraldryX = Number.POSITIVE_INFINITY;
    let maxHeraldryX = Number.NEGATIVE_INFINITY;
    let minLiftReach = Number.POSITIVE_INFINITY;
    let maxLiftReach = Number.NEGATIVE_INFINITY;
    for (let p = cellSortedEnd[slot] - 1; p >= cellSortedStart[slot]; p--) {
      const anchor = anchors[spatialOrder[p]];
      const sy = anchor.sy;
      minY = Math.min(minY, sy);
      maxY = Math.max(maxY, sy);
      suffixMinY[p] = minY;
      suffixMaxY[p] = maxY;
      const lift = liftOf(anchor);
      if (lift > 0) {
        minHeraldryX = Math.min(minHeraldryX, anchor.sx);
        maxHeraldryX = Math.max(maxHeraldryX, anchor.sx);
        minLiftReach = Math.min(minLiftReach, sy - lift);
        maxLiftReach = Math.max(maxLiftReach, sy + lift);
      }
      suffixMinLiftReach[p] = minLiftReach;
      suffixMaxLiftReach[p] = maxLiftReach;
    }
    cellMinHeraldryX[slot] = minHeraldryX;
    cellMaxHeraldryX[slot] = maxHeraldryX;
    cellMinLiftReach[slot] = minLiftReach;
    cellMaxLiftReach[slot] = maxLiftReach;
  }

  // Borderless frames retain the original 3x3 sweep. A live lifted anchor
  // widens it to the second cell ring sideways and to as many rings downwards
  // as the tallest lift on screen can reach (two for heraldry, five for a
  // 300% dot row), so no colliding pair is ever out of a cell's sweep.
  const neighborRadiusX = maxLift > 0 ? LIFTED_NEIGHBOR_RADIUS_X : 1;
  const neighborRadiusY = maxLift > 0 ? liftedNeighborRadiusY(maxLift) : 1;
  spatialHashResizes += ensureNeighborSlotCapacity(neighborRadiusX, neighborRadiusY);
  if (metrics) metrics.spatialHashResizes = spatialHashResizes;
  for (const seedSlot of occupiedSlots) {
    if (cellVisitedStamp[seedSlot] === cellEpoch) continue;

    // Walk the connected component of occupied cells. A cell is an atomic
    // clique, so this preserves transitive anchor overlap without rescanning
    // dense buckets once per member.
    cluster.length = 0;
    cellQueue.length = 0;
    cellQueue.push(seedSlot);
    cellVisitedStamp[seedSlot] = cellEpoch;
    for (let q = 0; q < cellQueue.length; q++) {
      const slot = cellQueue[q];
      const start = cellSortedStart[slot];
      const end = cellSortedEnd[slot];
      for (let p = start; p < end; p++) cluster.push(spatialOrder[p]);
      if (metrics) metrics.candidateChecks += end - start;

      let neighborSlotCount = 0;
      for (let dx = -neighborRadiusX; dx <= neighborRadiusX; dx++) {
        for (let dy = -neighborRadiusY; dy <= neighborRadiusY; dy++) {
          if (metrics) metrics.neighborCellProbes++;
          const neighbor = findCellSlot(cellX[slot] + dx, cellY[slot] + dy, false);
          if (neighbor < 0 || neighbor === slot) continue;
          let seenSlot = false;
          for (let s = 0; s < neighborSlotCount; s++) {
            if (neighborSlots[s] !== neighbor) continue;
            seenSlot = true;
            break;
          }
          if (seenSlot) continue;
          neighborSlots[neighborSlotCount++] = neighbor;
          if (cellVisitedStamp[neighbor] === cellEpoch) continue;
          if (!cellsOverlap(slot, neighbor, anchors, metrics)) continue;
          cellVisitedStamp[neighbor] = cellEpoch;
          cellQueue.push(neighbor);
        }
      }
    }

    if (cluster.length < 2) continue;
    // the whole pass stacks in ascending id order
    cluster.sort((a, b) => anchors[a].id - anchors[b].id);

    let sum = 0;
    let tallestLift = 0;
    for (const j of cluster) {
      sum += anchors[j].sy;
      const lift = liftOf(anchors[j]);
      if (lift > tallestLift) tallestLift = lift;
    }
    // The tallest member selects ONE pitch for the whole connected component:
    // the bare 20px plus its lift (28px for a heraldry wearer, 20px plus the
    // row height for a dotted plate at the live slider scale). Mixed crowds
    // share that pitch deliberately so the fan stays visually regular instead
    // of alternating between ragged gap sizes.
    const stackOffset = STACK_OFFSET_PX + tallestLift;
    const baseSy = sum / cluster.length;
    const mid = (cluster.length - 1) / 2;
    for (let k = 0; k < cluster.length; k++) {
      const j = cluster[k];
      anchors[j].sy = baseSy + (k - mid) * stackOffset;
    }
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
