// The spatial index behind the world trees' camera-occluder fade. The fade
// asks, every frame, which of the world's trees (thousands) the eye-to-camera
// segment crosses, and which are within the ghost-program prefetch reach of
// the camera; both are questions about a few square yards, so the trees are
// bucketed once into a coarse XZ grid and each frame touches only the cells
// the segment's box covers, the unlatched trees of the cells the prefetch
// reach touches (and those only when the camera moved, since a still camera
// brings no tree into reach), and the trees whose fade is in flight.
// Everything a frame decides stays in tree_hide_fade.ts; this module only
// answers WHICH trees to look at, with an answer that is a superset of the
// linear walk's hits (a box query never misses a circle the segment can
// touch, and a cell whose nearest point is inside the reach holds every tree
// of it that could be).
//
// Node-only (RENDER_PURE_CORES): no three.js, no DOM, no randomness.

export interface TreeHideIndexEntry {
  x: number;
  z: number;
  r: number;
  prefetched: boolean;
}

/** A camera boom spans one to four cells; the prefetch reach (60 yd) a few
 *  dozen, most of them skipped once their trees latched. */
export const TREE_HIDE_CELL_SIZE = 16;

// Cell coordinates are packed into one exact double: +/- 2^16 cells, which at
// the 16 yd cell is +/- 1,048,576 world units, ten times the farthest
// instanced band (the rift band ends near x = 109,400). Beyond that a key would
// alias silently, so the constructor clamps such a tree into the edge cell
// instead (it then fades only for a camera at that edge, a degraded fade for
// a tree no player can stand near) and warns once per build: the index is
// built on the frame path, so it never throws.
const KEY_BIAS = 0x10000;
const KEY_SPAN = 0x20000;
const CELL_MAX = KEY_BIAS - 1;

function cellKey(cx: number, cz: number): number {
  return (cx + KEY_BIAS) * KEY_SPAN + (cz + KEY_BIAS);
}

function clampCell(c: number): number {
  return c > CELL_MAX ? CELL_MAX : c < -CELL_MAX ? -CELL_MAX : c;
}

interface Cell {
  cx: number;
  cz: number;
  trees: number[];
  /** The trees of the cell that have not latched their prefetch yet. */
  unlatched: number[];
}

export class TreeHideIndex {
  /** Number of trees the index was built over: a grown registry rebuilds. */
  readonly count: number;
  /** The largest trunk radius, the segment box's margin. */
  readonly maxR: number;
  /** Trees whose fade is in flight (ghosted or fading back), by tree index. */
  readonly active = new Set<number>();
  private readonly cells = new Map<number, Cell>();
  private readonly cellOfTree: Float64Array;
  private readonly stamp: Int32Array;
  private frame = 0;
  private sweepX = Number.NaN;
  private sweepZ = Number.NaN;

  constructor(
    trees: readonly TreeHideIndexEntry[],
    readonly cellSize: number = TREE_HIDE_CELL_SIZE,
    /** The in-flight fades of the index this one replaces (a grown registry
     *  keeps its earlier trees at the same indices), so a rebuild never strands
     *  a ghosted tree. */
    carriedActive: Iterable<number> = [],
  ) {
    this.count = trees.length;
    for (const i of carriedActive) if (i < trees.length) this.active.add(i);
    this.cellOfTree = new Float64Array(trees.length);
    this.stamp = new Int32Array(trees.length);
    let maxR = 0;
    let clamped = 0;
    for (let i = 0; i < trees.length; i++) {
      const t = trees[i];
      if (t.r > maxR) maxR = t.r;
      const rawCx = Math.floor(t.x / cellSize);
      const rawCz = Math.floor(t.z / cellSize);
      const cx = clampCell(rawCx);
      const cz = clampCell(rawCz);
      if (cx !== rawCx || cz !== rawCz) clamped++;
      const key = cellKey(cx, cz);
      this.cellOfTree[i] = key;
      let cell = this.cells.get(key);
      if (!cell) {
        cell = { cx, cz, trees: [], unlatched: [] };
        this.cells.set(key, cell);
      }
      cell.trees.push(i);
      if (!t.prefetched) cell.unlatched.push(i);
    }
    this.maxR = maxR;
    if (clamped > 0) {
      console.warn(
        `TreeHideIndex: ${clamped} trees lie outside the key range and were clamped to its edge cells`,
      );
    }
  }

  /** Opens a frame: the per-frame visit stamps start fresh. */
  beginFrame(): void {
    this.frame++;
  }

  /** Whether `visit` already saw this tree in the current frame. */
  visitedThisFrame(i: number): boolean {
    return this.stamp[i] === this.frame;
  }

  /** Records that the tree latched its prefetch: it leaves its cell's
   *  unlatched list (swap-remove, safe under the backwards visit below). */
  notePrefetched(i: number): void {
    const cell = this.cells.get(this.cellOfTree[i]);
    if (!cell) return;
    const at = cell.unlatched.indexOf(i);
    if (at < 0) return;
    const last = cell.unlatched.length - 1;
    cell.unlatched[at] = cell.unlatched[last];
    cell.unlatched.length = last;
  }

  /** Every tree whose trunk circle can touch the segment from (ax, az) to
   *  (bx, bz): the cells under the segment's box grown by the largest radius.
   *  Each visited tree is stamped for the frame. */
  forEachNearSegment(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    visit: (i: number) => void,
  ): void {
    const m = this.maxR;
    const size = this.cellSize;
    const cx0 = Math.floor((Math.min(ax, bx) - m) / size);
    const cx1 = Math.floor((Math.max(ax, bx) + m) / size);
    const cz0 = Math.floor((Math.min(az, bz) - m) / size);
    const cz1 = Math.floor((Math.max(az, bz) + m) / size);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const cell = this.cells.get(cellKey(cx, cz));
        if (!cell) continue;
        for (const i of cell.trees) {
          this.stamp[i] = this.frame;
          visit(i);
        }
      }
    }
  }

  /** Whether a prefetch sweep from (x, z) can latch anything: only a camera
   *  that moved since the last sweep brings a new tree into reach. */
  sweepDue(x: number, z: number): boolean {
    if (x === this.sweepX && z === this.sweepZ) return false;
    this.sweepX = x;
    this.sweepZ = z;
    return true;
  }

  /** Every unlatched tree in a cell whose nearest point lies within `radius`
   *  of (x, z); a cell that latched every tree costs one compare. `visit` may
   *  call notePrefetched for the tree it was handed. */
  forEachUnprefetchedWithin(
    x: number,
    z: number,
    radius: number,
    visit: (i: number) => void,
  ): void {
    const size = this.cellSize;
    const r2 = radius * radius;
    const cx0 = Math.floor((x - radius) / size);
    const cx1 = Math.floor((x + radius) / size);
    const cz0 = Math.floor((z - radius) / size);
    const cz1 = Math.floor((z + radius) / size);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const cell = this.cells.get(cellKey(cx, cz));
        if (!cell || cell.unlatched.length === 0) continue;
        // Nearest point of the cell's box to (x, z).
        const nx = Math.max(cell.cx * size, Math.min(x, (cell.cx + 1) * size));
        const nz = Math.max(cell.cz * size, Math.min(z, (cell.cz + 1) * size));
        const dx = nx - x;
        const dz = nz - z;
        if (dx * dx + dz * dz > r2) continue;
        const unlatched = cell.unlatched;
        for (let k = unlatched.length - 1; k >= 0; k--) visit(unlatched[k]);
      }
    }
  }
}
