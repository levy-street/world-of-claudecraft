// Spatial hash grid over entity positions for radius queries that would
// otherwise scan every entity. Cells are re-bucketed once per tick (gradual
// movement) and kept exact on spawn/despawn/teleport, so queries always see
// the same roster as the entities map.
import type { Entity } from './types';

// shifts negative cell coordinates into the positive range before packing
const OFFSET = 32768;

export class SpatialGrid {
  private cells = new Map<number, Entity[]>();
  private where = new Map<number, number>(); // entity id -> occupied cell key

  constructor(readonly cellSize = 32) {}

  private keyAt(x: number, z: number): number {
    return (
      (Math.floor(x / this.cellSize) + OFFSET) * 65536 + (Math.floor(z / this.cellSize) + OFFSET)
    );
  }

  insert(e: Entity): void {
    const key = this.keyAt(e.pos.x, e.pos.z);
    let list = this.cells.get(key);
    if (!list) {
      list = [];
      this.cells.set(key, list);
    }
    list.push(e);
    this.where.set(e.id, key);
  }

  remove(e: Entity): void {
    const key = this.where.get(e.id);
    if (key === undefined) return;
    this.where.delete(e.id);
    const list = this.cells.get(key);
    if (!list) return;
    const i = list.indexOf(e);
    if (i >= 0) {
      list[i] = list[list.length - 1];
      list.pop();
    }
    // An emptied cell is dropped entirely rather than left as dead weight.
    // `insert()` reuses an existing array, so `cells.size` was already bounded
    // by the number of distinct cells ever occupied (not by movement/spawn
    // churn), so this is not unbounded growth. Still, a stale empty array
    // serves no purpose (a re-`insert` recreates it on demand), so reclaim it
    // now to keep `cells.size` tracking the true occupied-cell count.
    if (list.length === 0) this.cells.delete(key);
  }

  // Number of occupied cells currently tracked, for tests/diagnostics: proves
  // an emptied cell is reclaimed rather than left behind as dead weight.
  cellCount(): number {
    return this.cells.size;
  }

  // Re-bucket an entity whose position changed cells (movement, teleport).
  update(e: Entity): void {
    if (this.where.get(e.id) === this.keyAt(e.pos.x, e.pos.z)) return;
    this.remove(e);
    this.insert(e);
  }

  // Re-bucket entities that crossed a cell boundary since the last call.
  // Most entities stay inside their 32-unit cell from one tick to the next,
  // so this is a key comparison per entity and rarely any bucket work.
  refresh(entities: Iterable<Entity>): void {
    for (const e of entities) this.update(e);
  }

  // Visit every entity within `radius` of (x, z) in the ground plane,
  // passing the squared 2D distance. The cell window is padded by one unit
  // so entities that drifted since the last rebuild still fall inside it;
  // the distance check itself uses current positions.
  forEachInRadius(x: number, z: number, radius: number, fn: (e: Entity, d2: number) => void): void {
    const cs = this.cellSize;
    const minCx = Math.floor((x - radius - 1) / cs) + OFFSET;
    const maxCx = Math.floor((x + radius + 1) / cs) + OFFSET;
    const minCz = Math.floor((z - radius - 1) / cs) + OFFSET;
    const maxCz = Math.floor((z + radius + 1) / cs) + OFFSET;
    const r2 = radius * radius;
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const list = this.cells.get(cx * 65536 + cz);
        if (!list) continue;
        for (const e of list) {
          const dx = e.pos.x - x;
          const dz = e.pos.z - z;
          const d2 = dx * dx + dz * dz;
          if (d2 <= r2) fn(e, d2);
        }
      }
    }
  }
}
