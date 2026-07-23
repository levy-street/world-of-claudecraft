import { describe, expect, it } from 'vitest';
import {
  buildSharedInterestCandidates,
  cellKeyForPosition,
  sharedQueryRadius,
} from '../server/interest_candidates';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import { SpatialGrid } from '../src/sim/spatial';
import type { Entity } from '../src/sim/types';

const CELL = 32;
const BASE = 130; // matches the server's INTEREST_QUERY_RADIUS

// A minimal entity: the grid and the module read only `id` and `pos`.
function mkEntity(id: number, x: number, z: number): Entity {
  return { id, pos: { x, y: 0, z } } as unknown as Entity;
}

// Re-apply a single viewer's EXACT baseRadius cutoff to a shared candidate list,
// exactly as the server does per viewer after the shared query. Returns the ids
// that survive the cutoff.
function survivingIds(
  list: readonly Entity[],
  viewerX: number,
  viewerZ: number,
  base = BASE,
): Set<number> {
  const out = new Set<number>();
  for (const e of list) {
    const dx = e.pos.x - viewerX;
    const dz = e.pos.z - viewerZ;
    if (dx * dx + dz * dz <= base * base) out.add(e.id);
  }
  return out;
}

describe('interest_candidates', () => {
  it('sharedQueryRadius adds half the cell diagonal to the base radius', () => {
    expect(sharedQueryRadius(130, 32)).toBeCloseTo(130 + (32 * Math.SQRT2) / 2);
    // a raw numeric pin, independent of the implementation expression: 130 plus
    // the 32-cell half-diagonal (16*sqrt2 = 22.62742) is 152.62742.
    expect(sharedQueryRadius(130, 32)).toBeCloseTo(152.62742, 4);
    // strictly between base and base + cellSize
    expect(sharedQueryRadius(BASE, CELL)).toBeGreaterThan(BASE);
    expect(sharedQueryRadius(BASE, CELL)).toBeLessThan(BASE + CELL);
  });

  it('a viewer at its cell center gets a superset the exact cutoff refines', () => {
    const grid = new SpatialGrid(CELL);
    const anchorId = 1;
    const anchor = mkEntity(anchorId, 48, 48); // center of cell (1,1)
    const inRange = mkEntity(2, 48 + 129.9, 48); // 129.9 < BASE along +x
    // 140 from the anchor: OUTSIDE BASE (130) but INSIDE the padded query
    // radius (~152.6), so it appears in the raw list yet the cutoff drops it.
    const decoy = mkEntity(3, 48 + 140, 48);
    grid.insert(anchor);
    grid.insert(inRange);
    grid.insert(decoy);

    const built = buildSharedInterestCandidates(grid, [{ sessionId: anchorId, anchor }], BASE);
    const list = built.forSession(anchorId);
    expect(list.some((e) => e.id === 2)).toBe(true); // in-range entity present
    expect(list.some((e) => e.id === 3)).toBe(true); // decoy present in the padded raw list

    const survivors = survivingIds(list, anchor.pos.x, anchor.pos.z);
    expect(survivors.has(2)).toBe(true); // survives the anchor cutoff
    expect(survivors.has(3)).toBe(false); // the re-applied cutoff excludes the decoy
    expect(survivors.has(anchorId)).toBe(true); // the anchor is within 0 of itself
  });

  it('a viewer at a cell edge midpoint still gets the superset', () => {
    const grid = new SpatialGrid(CELL);
    const anchorId = 10;
    const anchor = mkEntity(anchorId, 32, 48); // left-edge midpoint of cell (1,1)
    const target = mkEntity(11, 32 + 129, 48); // 129 < BASE from the anchor
    grid.insert(anchor);
    grid.insert(target);

    const built = buildSharedInterestCandidates(grid, [{ sessionId: anchorId, anchor }], BASE);
    const survivors = survivingIds(built.forSession(anchorId), anchor.pos.x, anchor.pos.z);
    expect(survivors.has(11)).toBe(true);
  });

  it('a viewer at a cell corner (the tight diagonal) still gets the superset', () => {
    const grid = new SpatialGrid(CELL);
    const anchorId = 20;
    const anchor = mkEntity(anchorId, 32, 32); // corner of cell (1,1); center (48,48)
    // ~129.5 from the corner, aimed opposite the cell center, so its cell-center
    // distance (~152.13) approaches BASE + halfDiagonal (~152.63), the tight edge.
    const d = 129.5;
    const target = mkEntity(21, 32 - d / Math.SQRT2, 32 - d / Math.SQRT2);
    grid.insert(anchor);
    grid.insert(target);

    const built = buildSharedInterestCandidates(grid, [{ sessionId: anchorId, anchor }], BASE);
    const list = built.forSession(anchorId);
    expect(list.some((e) => e.id === 21)).toBe(true); // present in the padded list
    const survivors = survivingIds(list, anchor.pos.x, anchor.pos.z);
    expect(survivors.has(21)).toBe(true); // and survives the anchor cutoff
  });

  it('preserves per-viewer traversal ORDER across a multi-cell scatter, not just membership', () => {
    // The load-bearing byte-identity contract is about ORDER, not only membership:
    // the shared cell-center query, refined by the viewer's exact cutoff IN ORDER,
    // must reproduce the OLD per-viewer grid.forEachInRadius(viewer, BASE) sequence
    // exactly. Every other unit case here asserts Set membership via survivingIds,
    // so this pins the sequence a direct array comparison would catch a traversal
    // reorder (e.g. a center-relative iteration) that a Set check would miss.
    const grid = new SpatialGrid(CELL);
    const viewerId = 500;
    const viewer = mkEntity(viewerId, 48, 48); // cell (1,1)
    // Entities scattered across several distinct cells (both cx and cz vary), all
    // within BASE of the viewer, inserted out of grid order.
    const scattered = [
      mkEntity(40, 48, 48 - 100), // north, cell (1,-2)
      mkEntity(41, 48 - 90, 48), // west, cell (-2,1)
      mkEntity(42, 48 + 90, 48 + 40), // east, cell (4,2)
      mkEntity(43, 48, 48 + 110), // south (just inside BASE), cell (1,4)
      mkEntity(44, 48 - 60, 48 - 60), // nw diagonal, cell (-1,-1)
      mkEntity(45, 48 + 20, 48 - 20), // near, cell (2,0)
    ];
    grid.insert(viewer);
    for (const e of scattered) grid.insert(e);

    // module path: the shared cell-center candidate list refined by the viewer's
    // EXACT cutoff, keeping the module's returned order.
    const built = buildSharedInterestCandidates(
      grid,
      [{ sessionId: viewerId, anchor: viewer }],
      BASE,
    );
    const sharedOrdered: number[] = [];
    for (const e of built.forSession(viewerId)) {
      const dx = e.pos.x - viewer.pos.x;
      const dz = e.pos.z - viewer.pos.z;
      if (dx * dx + dz * dz <= BASE * BASE) sharedOrdered.push(e.id);
    }

    // old path: a direct per-viewer query, in the grid's own traversal order.
    const perViewerOrdered: number[] = [];
    grid.forEachInRadius(viewer.pos.x, viewer.pos.z, BASE, (e) => perViewerOrdered.push(e.id));

    // ORDER and membership must both match (array equality, not a Set).
    expect(sharedOrdered).toEqual(perViewerOrdered);
    // non-vacuous: a real multi-entity ordered sequence (viewer + 6 scattered).
    expect(sharedOrdered.length).toBeGreaterThanOrEqual(6);
  });

  it('two viewers in the same cell share one query and one candidate array', () => {
    const grid = new SpatialGrid(CELL);
    const aId = 100;
    const bId = 101;
    const a = mkEntity(aId, 40, 48); // both inside cell (1,1)
    const b = mkEntity(bId, 56, 48);
    // Distinct per-viewer in-range sets: nearA is within BASE of A but not B,
    // nearB within BASE of B but not A; both sit in the shared raw list.
    const nearA = mkEntity(102, 40 - 120, 48); // 120 from A, 136 from B
    const nearB = mkEntity(103, 56 + 120, 48); // 120 from B, 136 from A
    grid.insert(a);
    grid.insert(b);
    grid.insert(nearA);
    grid.insert(nearB);

    const built = buildSharedInterestCandidates(
      grid,
      [
        { sessionId: aId, anchor: a },
        { sessionId: bId, anchor: b },
      ],
      BASE,
    );
    expect(built.cellQueryCount).toBe(1); // one query served both viewers
    expect(built.forSession(aId)).toBe(built.forSession(bId)); // same array reference

    const survivorsA = survivingIds(built.forSession(aId), a.pos.x, a.pos.z);
    const survivorsB = survivingIds(built.forSession(bId), b.pos.x, b.pos.z);
    expect(survivorsA.has(102)).toBe(true); // nearA in A's set
    expect(survivorsA.has(103)).toBe(false); // nearB not in A's set
    expect(survivorsB.has(103)).toBe(true); // nearB in B's set
    expect(survivorsB.has(102)).toBe(false); // nearA not in B's set
  });

  it('viewers in distinct, non-adjacent cells each get their own query', () => {
    const grid = new SpatialGrid(CELL);
    const aId = 200;
    const bId = 201;
    const a = mkEntity(aId, 48, 48); // cell (1,1)
    const b = mkEntity(bId, 48 + 500, 48); // ~16 cells away
    grid.insert(a);
    grid.insert(b);

    const built = buildSharedInterestCandidates(
      grid,
      [
        { sessionId: aId, anchor: a },
        { sessionId: bId, anchor: b },
      ],
      BASE,
    );
    expect(built.cellQueryCount).toBe(2); // one query per session
  });

  it('a same-tick displaced entity is still covered after the end-of-tick refresh', () => {
    // Freshness guarantee via the REAL sim: an entity knocked across a cell
    // boundary is re-bucketed by sim.grid.refresh (end of tick), so the shared
    // query run from the anchor's cell center at broadcast time still covers it.
    const sim = new Sim({ seed: 5150, playerClass: 'warrior' });
    const displaced = sim.entities.get(sim.playerId)!; // the entity that moves
    displaced.gm = true; // an L1 warrior would otherwise be irrelevant; keeps it alive
    // Flat Eastbrook ground near origin, right beside the x=0 cell boundary.
    displaced.pos.x = 0.5;
    displaced.pos.y = 0;
    displaced.pos.z = 0;

    // A separate anchor (the viewer), a couple of cells away but well within BASE.
    const anchor = createMob(900800, MOBS.forest_wolf, displaced.level, { x: 10, y: 0, z: 0 });
    sim.entities.set(anchor.id, anchor);
    sim.grid.insert(anchor);

    const cellBefore = cellKeyForPosition(displaced.pos.x, displaced.pos.z, sim.grid.cellSize);

    // Source on the +x side so the shove drives the target toward -x, across x=0.
    const source = createMob(900801, MOBS.forest_wolf, displaced.level, { x: 6, y: 0, z: 0 });
    const moved = (
      sim as unknown as { applyKnockback: (s: Entity, t: Entity, d: number) => number }
    ).applyKnockback(source, displaced, 8);
    expect(moved).toBeGreaterThan(0.5); // actually shoved past the x=0 boundary

    sim.grid.refresh(sim.entities.values()); // the sim's end-of-tick rebucket

    const cellAfter = cellKeyForPosition(displaced.pos.x, displaced.pos.z, sim.grid.cellSize);
    expect(cellAfter).not.toBe(cellBefore); // it crossed a cell boundary

    const built = buildSharedInterestCandidates(sim.grid, [{ sessionId: 7, anchor }], BASE);
    const survivors = survivingIds(built.forSession(7), anchor.pos.x, anchor.pos.z);
    expect(survivors.has(displaced.id)).toBe(true); // still found within BASE of the anchor
  });

  it('the pad is load-bearing: a too-small pad drops the tight corner entity', () => {
    const grid = new SpatialGrid(CELL);
    const anchor = mkEntity(30, 32, 32); // corner of cell (1,1); center (48,48)
    const d = 129.5;
    const target = mkEntity(31, 32 - d / Math.SQRT2, 32 - d / Math.SQRT2);
    grid.insert(anchor);
    grid.insert(target);

    // With the correct pad the MODULE includes the tight corner entity.
    const built = buildSharedInterestCandidates(grid, [{ sessionId: 1, anchor }], BASE);
    expect(built.forSession(1).some((e) => e.id === 31)).toBe(true);

    // With a deliberately-too-small pad (quarter cell) the same cell-center query
    // excludes it, proving the pad term is doing real work (the test is not vacuous).
    const centerX = 48;
    const centerZ = 48;
    const shrunkRadius = sharedQueryRadius(BASE, CELL / 4);
    const withShrunk = new Set<number>();
    grid.forEachInRadius(centerX, centerZ, shrunkRadius, (e) => withShrunk.add(e.id));
    expect(withShrunk.has(31)).toBe(false);

    // sanity: the correct radius from the same center DOES reach it
    const correctRadius = sharedQueryRadius(BASE, CELL);
    const withCorrect = new Set<number>();
    grid.forEachInRadius(centerX, centerZ, correctRadius, (e) => withCorrect.add(e.id));
    expect(withCorrect.has(31)).toBe(true);
  });

  it('forSession returns entities, never bare cell-center distances', () => {
    const grid = new SpatialGrid(CELL);
    const anchor = mkEntity(1, 48, 48);
    const other = mkEntity(2, 60, 48);
    grid.insert(anchor);
    grid.insert(other);

    const built = buildSharedInterestCandidates(grid, [{ sessionId: 1, anchor }], BASE);
    const list = built.forSession(1);
    expect(list.length).toBeGreaterThan(0);
    for (const e of list) {
      expect(typeof e).not.toBe('number'); // not a leaked cell-center distance
      expect(typeof e.id).toBe('number');
      expect(typeof e.pos.x).toBe('number');
      expect(typeof e.pos.z).toBe('number');
    }
  });

  it('an unknown session gets the shared empty array, not a fresh allocation', () => {
    const grid = new SpatialGrid(CELL);
    const anchor = mkEntity(1, 48, 48);
    grid.insert(anchor);

    const built = buildSharedInterestCandidates(grid, [{ sessionId: 1, anchor }], BASE);
    expect(built.forSession(999)).toHaveLength(0);
    expect(built.forSession(999)).toBe(built.forSession(888)); // same shared EMPTY reference
  });
});
