// One broadcast's historical readable-print index. A trail contributes at
// most one entry per occupied print cell (at most FOOTPRINT_MAX entries), not
// every cell in its bounding box: a teleport cannot expand the index across
// the empty space between prints. Cell lists retain original roster order.
import { FOOTPRINT_READ_RADIUS, type FootprintSourceView } from '../src/sim/stealth_footprints';
import type { Entity } from '../src/sim/types';

const cellOf = (v: number): number => Math.floor(v / FOOTPRINT_READ_RADIUS);
const keyOf = (x: number, z: number): string => `${x},${z}`;

export class StealthFootprintCandidates {
  private readonly cells = new Map<string, number[]>();

  constructor(private readonly views: readonly FootprintSourceView[]) {
    for (let index = 0; index < views.length; index++) {
      const occupied = new Set<string>();
      for (const print of views[index].prints) {
        const key = keyOf(cellOf(print.x), cellOf(print.z));
        if (occupied.has(key)) continue;
        occupied.add(key);
        const cell = this.cells.get(key);
        if (cell) cell.push(index);
        else this.cells.set(key, [index]);
      }
    }
  }

  /** Diagnostic bound: no more occupied cells than readable prints. */
  cellCount(): number {
    return this.cells.size;
  }

  /** Merge nine sorted lists lazily, deduplicating sources and retaining the
   *  exact roster order. The consumer's 64-print cap stops the merge too. */
  *forViewer(viewer: Entity): Iterable<FootprintSourceView> {
    const nearby: number[][] = [];
    const cx = cellOf(viewer.pos.x);
    const cz = cellOf(viewer.pos.z);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const cell = this.cells.get(keyOf(cx + dx, cz + dz));
        if (cell) nearby.push(cell);
      }
    }
    const cursors = new Array<number>(nearby.length).fill(0);
    while (true) {
      let next = Number.POSITIVE_INFINITY;
      for (let i = 0; i < nearby.length; i++) {
        const index = nearby[i][cursors[i]];
        if (index !== undefined && index < next) next = index;
      }
      if (!Number.isFinite(next)) return;
      for (let i = 0; i < nearby.length; i++) {
        if (nearby[i][cursors[i]] === next) cursors[i]++;
      }
      yield this.views[next];
    }
  }
}
