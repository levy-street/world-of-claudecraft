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

export interface NameplateAnchor {
  id: number;
  sx: number;
  sy: number;
}

export interface NameplateDeclutterMetrics {
  candidateChecks: number;
  spatialHashResizes: number;
}

// Anchors within this horizontal distance are treated as colliding: nameplate
// labels render much wider than the anchor point itself (name + level + hp
// bar), so this approximates half of a typical label's on-screen width rather
// than the anchor point spacing.
const OVERLAP_THRESHOLD_X_PX = 80;
// Vertical anchors this close are considered the "same row" (labels are a
// single text line anchored at their bottom, so the tolerance is much
// tighter than the horizontal one).
const OVERLAP_THRESHOLD_Y_PX = 18;
// Vertical gap applied between stacked members of a cluster.
const STACK_OFFSET_PX = 20;

// Cell size equals the collision thresholds, so two colliding anchors are never
// more than one cell apart on either axis and a 3x3 neighbourhood is exhaustive.
function cellCoord(v: number, size: number): number | null {
  if (!Number.isFinite(v)) return null;
  const coord = Math.floor(v / size);
  return coord === 0 ? 0 : coord;
}

// ---------------------------------------------------------------------------
// Reusable workspace. The painter calls this once per frame on one thread, so a
// module-level scratch is safe and keeps the pass allocation-free after its
// high-water capacity is established.
// ---------------------------------------------------------------------------
const order: number[] = [];
const cluster: number[] = [];
let visited = new Uint8Array(64);
let cellX = new Float64Array(128);
let cellY = new Float64Array(128);
let cellHead = new Int32Array(128);
let cellStamp = new Uint32Array(128);
let nextInCell = new Int32Array(64);
const neighborSlots = new Int32Array(9);
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
    cellHead = new Int32Array(tableCapacity);
    cellStamp = new Uint32Array(tableCapacity);
    cellEpoch = 0;
    resizes++;
  }
  if (nextInCell.length < count) {
    let linkCapacity = nextInCell.length;
    while (linkCapacity < count) linkCapacity *= 2;
    nextInCell = new Int32Array(linkCapacity);
    resizes++;
  }
  cellEpoch = (cellEpoch + 1) >>> 0;
  if (cellEpoch === 0) {
    cellStamp.fill(0);
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
  cellHead[slot] = -1;
  return slot;
}

/**
 * Stack overlapping anchors apart, MUTATING `anchors` in place.
 *
 * Anchors are processed in ascending id order so the same entities always stack
 * the same way frame to frame, independent of render order.
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
    metrics.spatialHashResizes = 0;
  }
  if (n < 2) return anchors;

  if (visited.length < n) visited = new Uint8Array(Math.max(n, visited.length * 2));
  else visited.fill(0, 0, n);
  const spatialHashResizes = ensureSpatialHashCapacity(n);
  if (metrics) metrics.spatialHashResizes = spatialHashResizes;

  order.length = 0;
  for (let i = 0; i < n; i++) order.push(i);
  order.sort((a, b) => anchors[a].id - anchors[b].id);

  for (let i = 0; i < n; i++) {
    const cx = cellCoord(anchors[i].sx, OVERLAP_THRESHOLD_X_PX);
    const cy = cellCoord(anchors[i].sy, OVERLAP_THRESHOLD_Y_PX);
    if (cx === null || cy === null) continue;
    const slot = findCellSlot(cx, cy, true);
    nextInCell[i] = cellHead[slot];
    cellHead[slot] = i;
  }

  for (let o = 0; o < n; o++) {
    const i = order[o];
    if (visited[i]) continue;
    const ax = anchors[i].sx;
    const ay = anchors[i].sy;

    // gather this anchor's collision cluster from the 3x3 cell neighbourhood
    cluster.length = 0;
    const cx = cellCoord(ax, OVERLAP_THRESHOLD_X_PX);
    const cy = cellCoord(ay, OVERLAP_THRESHOLD_Y_PX);
    if (cx === null || cy === null) {
      visited[i] = 1;
      continue;
    }
    let neighborSlotCount = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const slot = findCellSlot(cx + dx, cy + dy, false);
        if (slot < 0) continue;
        let seenSlot = false;
        for (let s = 0; s < neighborSlotCount; s++) {
          if (neighborSlots[s] !== slot) continue;
          seenSlot = true;
          break;
        }
        if (seenSlot) continue;
        neighborSlots[neighborSlotCount++] = slot;
        for (let j = cellHead[slot]; j >= 0; j = nextInCell[j]) {
          if (metrics) metrics.candidateChecks++;
          if (visited[j]) continue;
          if (Math.abs(anchors[j].sx - ax) > OVERLAP_THRESHOLD_X_PX) continue;
          if (Math.abs(anchors[j].sy - ay) > OVERLAP_THRESHOLD_Y_PX) continue;
          cluster.push(j);
        }
      }
    }

    if (cluster.length < 2) {
      visited[i] = 1;
      continue;
    }
    // the whole pass stacks in ascending id order
    cluster.sort((a, b) => anchors[a].id - anchors[b].id);

    let sum = 0;
    for (const j of cluster) sum += anchors[j].sy;
    const baseSy = sum / cluster.length;
    const mid = (cluster.length - 1) / 2;
    for (let k = 0; k < cluster.length; k++) {
      const j = cluster[k];
      anchors[j].sy = baseSy + (k - mid) * STACK_OFFSET_PX;
      visited[j] = 1;
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
