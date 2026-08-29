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

import { NAMEPLATE_HERALDRY_EXTRA_LIFT } from './nameplate_heraldry_core';

export interface NameplateAnchor {
  id: number;
  sx: number;
  sy: number;
  /** Extra pixels painted above the name row. Zero for borderless plates. */
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

// Borderless plates retain the established label envelope. A pair expands to
// the heraldry envelope only when at least one anchor actually paints the seal
// and ribbon, so ordinary town crowds do not pay for absent reward chrome.
export const OVERLAP_THRESHOLD_X_PX = 80;
export const OVERLAP_THRESHOLD_Y_PX = 18;
export const STACK_OFFSET_PX = 20;
// The accepted E45 world-heraldry envelope reserves 15px beyond the established
// 80px label reach for the left-mounted seal hardware.
export const HERALDRY_OVERLAP_THRESHOLD_X_PX = 95;
export const HERALDRY_OVERLAP_THRESHOLD_Y_PX =
  OVERLAP_THRESHOLD_Y_PX + NAMEPLATE_HERALDRY_EXTRA_LIFT;
export const HERALDRY_STACK_OFFSET_PX = STACK_OFFSET_PX + NAMEPLATE_HERALDRY_EXTRA_LIFT;

// Cell size equals the BORDERLESS thresholds, so every cell remains an atomic
// collision clique. Heraldry reach is less than two cells on either axis, so a
// 5x5 neighbourhood is exhaustive without making borderless cells wider.
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
let suffixMinHeraldryY = new Float64Array(64);
let suffixMaxHeraldryY = new Float64Array(64);
let cellMinHeraldryX = new Float64Array(128);
let cellMaxHeraldryX = new Float64Array(128);
let cellMinHeraldryY = new Float64Array(128);
let cellMaxHeraldryY = new Float64Array(128);
const neighborSlots = new Int32Array(25);
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
    cellMinHeraldryY = new Float64Array(tableCapacity);
    cellMaxHeraldryY = new Float64Array(tableCapacity);
    cellEpoch = 0;
    resizes++;
  }
  if (anchorCellSlot.length < count) {
    let anchorCapacity = anchorCellSlot.length;
    while (anchorCapacity < count) anchorCapacity *= 2;
    anchorCellSlot = new Int32Array(anchorCapacity);
    suffixMinY = new Float64Array(anchorCapacity);
    suffixMaxY = new Float64Array(anchorCapacity);
    suffixMinHeraldryY = new Float64Array(anchorCapacity);
    suffixMaxHeraldryY = new Float64Array(anchorCapacity);
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

function hasHeraldry(anchor: NameplateAnchor): boolean {
  return (anchor.extraLift ?? 0) > 0;
}

function cellHasHeraldry(slot: number): boolean {
  return cellMinHeraldryX[slot] !== Number.POSITIVE_INFINITY;
}

function candidateOverlapsSuffix(
  candidate: NameplateAnchor,
  leftStart: number,
  leftEnd: number,
  leftIsLower: boolean,
  anchors: NameplateAnchor[],
  overlapX: number,
  overlapY: number,
  heraldryOnly: boolean,
): boolean {
  let low = leftStart;
  let high = leftEnd;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (candidate.sx - anchors[spatialOrder[mid]].sx > overlapX) low = mid + 1;
    else high = mid;
  }
  if (low >= leftEnd) return false;
  const minY = heraldryOnly ? suffixMinHeraldryY[low] : suffixMinY[low];
  const maxY = heraldryOnly ? suffixMaxHeraldryY[low] : suffixMaxY[low];
  return leftIsLower ? candidate.sy - maxY <= overlapY : minY - candidate.sy <= overlapY;
}

/**
 * Cells are cliques because their width and height equal the inclusive overlap
 * thresholds. This tests whether two neighbouring cliques share at least one
 * edge without enumerating their Cartesian product.
 */
function cellsOverlap(
  aSlot: number,
  bSlot: number,
  anchors: NameplateAnchor[],
  metrics?: NameplateDeclutterMetrics,
): boolean {
  const aHasHeraldry = cellHasHeraldry(aSlot);
  const bHasHeraldry = cellHasHeraldry(bSlot);
  const hasHeraldryPair = aHasHeraldry || bHasHeraldry;
  const cellDeltaX = Math.abs(cellX[aSlot] - cellX[bSlot]);
  const cellDeltaY = Math.abs(cellY[aSlot] - cellY[bSlot]);
  const canBaseOverlap = cellDeltaX <= 1 && cellDeltaY <= 1;
  if (!canBaseOverlap && !hasHeraldryPair) return false;

  if (cellY[aSlot] === cellY[bSlot]) {
    const left = cellX[aSlot] < cellX[bSlot] ? aSlot : bSlot;
    const right = left === aSlot ? bSlot : aSlot;
    const rightMinX = anchors[firstAnchorInCell(right)].sx;
    const leftMaxX = anchors[lastAnchorInCell(left)].sx;
    if (canBaseOverlap && rightMinX - leftMaxX <= OVERLAP_THRESHOLD_X_PX) return true;
    if (!hasHeraldryPair) return false;
    return (
      cellMinHeraldryX[right] - leftMaxX <= HERALDRY_OVERLAP_THRESHOLD_X_PX ||
      rightMinX - cellMaxHeraldryX[left] <= HERALDRY_OVERLAP_THRESHOLD_X_PX
    );
  }

  if (cellX[aSlot] === cellX[bSlot]) {
    const lower = cellY[aSlot] < cellY[bSlot] ? aSlot : bSlot;
    const upper = lower === aSlot ? bSlot : aSlot;
    const upperMinY = suffixMinY[cellSortedStart[upper]];
    const lowerMaxY = suffixMaxY[cellSortedStart[lower]];
    if (canBaseOverlap && upperMinY - lowerMaxY <= OVERLAP_THRESHOLD_Y_PX) return true;
    if (!hasHeraldryPair) return false;
    return (
      cellMinHeraldryY[upper] - lowerMaxY <= HERALDRY_OVERLAP_THRESHOLD_Y_PX ||
      upperMinY - cellMaxHeraldryY[lower] <= HERALDRY_OVERLAP_THRESHOLD_Y_PX
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
  if (!hasHeraldryPair) return false;

  for (let p = rightStart; p < rightEnd; p++) {
    const candidate = anchors[spatialOrder[p]];
    if (hasHeraldry(candidate)) {
      if (metrics) metrics.candidateChecks++;
      if (
        candidateOverlapsSuffix(
          candidate,
          leftStart,
          leftEnd,
          leftIsLower,
          anchors,
          HERALDRY_OVERLAP_THRESHOLD_X_PX,
          HERALDRY_OVERLAP_THRESHOLD_Y_PX,
          false,
        )
      ) {
        return true;
      }
    }
    if (cellHasHeraldry(left)) {
      if (metrics) metrics.candidateChecks++;
      if (
        candidateOverlapsSuffix(
          candidate,
          leftStart,
          leftEnd,
          leftIsLower,
          anchors,
          HERALDRY_OVERLAP_THRESHOLD_X_PX,
          HERALDRY_OVERLAP_THRESHOLD_Y_PX,
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

  const spatialHashResizes = ensureSpatialHashCapacity(n);
  if (metrics) metrics.spatialHashResizes = spatialHashResizes;

  occupiedSlots.length = 0;
  spatialOrder.length = 0;
  let anyHeraldry = false;
  for (let i = 0; i < n; i++) {
    const cx = cellCoord(anchors[i].sx, OVERLAP_THRESHOLD_X_PX);
    const cy = cellCoord(anchors[i].sy, OVERLAP_THRESHOLD_Y_PX);
    if (cx === null || cy === null) continue;
    if (hasHeraldry(anchors[i])) anyHeraldry = true;
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
    let minHeraldryY = Number.POSITIVE_INFINITY;
    let maxHeraldryY = Number.NEGATIVE_INFINITY;
    for (let p = cellSortedEnd[slot] - 1; p >= cellSortedStart[slot]; p--) {
      const anchor = anchors[spatialOrder[p]];
      const sy = anchor.sy;
      minY = Math.min(minY, sy);
      maxY = Math.max(maxY, sy);
      suffixMinY[p] = minY;
      suffixMaxY[p] = maxY;
      if (hasHeraldry(anchor)) {
        minHeraldryX = Math.min(minHeraldryX, anchor.sx);
        maxHeraldryX = Math.max(maxHeraldryX, anchor.sx);
        minHeraldryY = Math.min(minHeraldryY, sy);
        maxHeraldryY = Math.max(maxHeraldryY, sy);
      }
      suffixMinHeraldryY[p] = minHeraldryY;
      suffixMaxHeraldryY[p] = maxHeraldryY;
    }
    cellMinHeraldryX[slot] = minHeraldryX;
    cellMaxHeraldryX[slot] = maxHeraldryX;
    cellMinHeraldryY[slot] = minHeraldryY;
    cellMaxHeraldryY[slot] = maxHeraldryY;
  }

  // Borderless frames retain the original 3x3 sweep. Radius two is required
  // only when a live heraldry anchor can reach into the second cell ring.
  const neighborRadius = anyHeraldry ? 2 : 1;
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
      for (let dx = -neighborRadius; dx <= neighborRadius; dx++) {
        for (let dy = -neighborRadius; dy <= neighborRadius; dy++) {
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
    let stackOffset = STACK_OFFSET_PX;
    for (const j of cluster) {
      sum += anchors[j].sy;
      if (hasHeraldry(anchors[j])) stackOffset = HERALDRY_STACK_OFFSET_PX;
    }
    // One wearer selects a uniform 28px pitch for the whole connected
    // component. Mixed crowds share that pitch deliberately so the fan stays
    // visually regular instead of alternating between ragged gap sizes.
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
