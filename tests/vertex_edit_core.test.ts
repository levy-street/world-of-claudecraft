import { describe, expect, it } from 'vitest';
import {
  applySelection,
  clearVertexEdits,
  moveVertices,
  nearestVertex,
  packVertex,
  unpackVertex,
  vertexEditRegion,
  vertexWorld,
  verticesInRect,
  verticesNear,
} from '../src/editor/vertex_edit_core';
import { VERTEX_LATTICE } from '../src/render/terrain_vertex_edits';
import type { TerrainVertexEdit } from '../src/sim/types';

describe('lattice', () => {
  it('round-trips a packed node, including negatives', () => {
    for (const [col, row] of [
      [0, 0],
      [17, -42],
      [-380, 1320],
    ] as const) {
      expect(unpackVertex(packVertex(col, row))).toEqual({ col, row });
    }
  });

  it('packs distinct nodes to distinct ids', () => {
    const ids = new Set<number>();
    for (let c = -20; c <= 20; c++) for (let r = -20; r <= 20; r++) ids.add(packVertex(c, r));
    expect(ids.size).toBe(41 * 41);
  });

  it('snaps a world point to the nearest lattice node', () => {
    expect(nearestVertex(0.4, -0.4)).toEqual({ col: 0, row: 0 });
    const v = nearestVertex(VERTEX_LATTICE * 3 + 0.1, VERTEX_LATTICE * -2 - 0.1);
    expect(v).toEqual({ col: 3, row: -2 });
    expect(vertexWorld(3, -2).x).toBeCloseTo(VERTEX_LATTICE * 3, 6);
  });
});

describe('gathering', () => {
  it('collects every node inside a rect', () => {
    const ids = verticesInRect(0, 0, VERTEX_LATTICE * 2, VERTEX_LATTICE * 1);
    expect(ids.length).toBe(3 * 2); // cols 0..2, rows 0..1
  });

  it('honours the cap on a huge rect', () => {
    expect(verticesInRect(-500, -500, 500, 500, 100).length).toBe(100);
  });

  it('collects a disc of nodes, all inside the radius', () => {
    const r = VERTEX_LATTICE * 3;
    const ids = verticesNear(0, 0, r);
    expect(ids.length).toBeGreaterThan(10);
    for (const id of ids) {
      const { col, row } = unpackVertex(id);
      const w = vertexWorld(col, row);
      expect(Math.hypot(w.x, w.z)).toBeLessThanOrEqual(r + 1e-9);
    }
  });
});

describe('selection', () => {
  it('replace returns the SAME set when nothing changed', () => {
    const a = new Set([1, 2, 3]);
    expect(applySelection(a, [1, 2, 3], 'replace')).toBe(a);
  });

  it('add, remove and toggle behave', () => {
    const a: ReadonlySet<number> = new Set([1, 2]);
    expect([...applySelection(a, [3], 'add')].sort()).toEqual([1, 2, 3]);
    expect([...applySelection(a, [2], 'remove')]).toEqual([1]);
    expect([...applySelection(a, [2, 5], 'toggle')].sort()).toEqual([1, 5]);
  });

  it('returns the same set when a no-op add changes nothing', () => {
    const a = new Set([1, 2]);
    expect(applySelection(a, [1], 'add')).toBe(a);
  });
});

describe('moving', () => {
  const sel = (...ids: number[]): ReadonlySet<number> => new Set(ids);

  it('creates one edit per selected node, on the lattice', () => {
    const out = moveVertices([], sel(packVertex(2, 3)), 1.5, 100);
    expect(out).toHaveLength(1);
    expect(out[0].dy).toBeCloseTo(1.5, 6);
    expect(out[0].x).toBeCloseTo(VERTEX_LATTICE * 2, 3);
    expect(out[0].z).toBeCloseTo(VERTEX_LATTICE * 3, 3);
  });

  it('ACCUMULATES on a node that already carries an edit', () => {
    const first = moveVertices([], sel(packVertex(1, 1)), 2, 100);
    const second = moveVertices(first, sel(packVertex(1, 1)), -0.5, 100);
    expect(second).toHaveLength(1);
    expect(second[0].dy).toBeCloseTo(1.5, 6);
  });

  it('drops an edit dragged back to zero', () => {
    const first = moveVertices([], sel(packVertex(1, 1)), 2, 100);
    expect(moveVertices(first, sel(packVertex(1, 1)), -2, 100)).toHaveLength(0);
  });

  it('leaves a hand-authored wide disc alone instead of folding into it', () => {
    const wide: TerrainVertexEdit[] = [{ x: 0, z: 0, dy: 1, r: 4 }];
    const out = moveVertices(wide, sel(packVertex(0, 0)), 1, 100);
    expect(out).toHaveLength(2);
    expect(out.find((e) => e.r === 4)?.dy).toBeCloseTo(1, 6);
  });

  it('is a no-op for an empty selection or a zero nudge', () => {
    const e: TerrainVertexEdit[] = [{ x: 0, z: 0, dy: 1 }];
    expect(moveVertices(e, sel(), 5, 100)).toBe(e);
    expect(moveVertices(e, sel(packVertex(0, 0)), 0, 100)).toBe(e);
  });

  it('honours the cap', () => {
    const ids = verticesInRect(0, 0, VERTEX_LATTICE * 9, VERTEX_LATTICE * 9);
    expect(moveVertices([], new Set(ids), 1, 5)).toHaveLength(5);
  });
});

describe('clearing and region', () => {
  it('clears only the selected nodes', () => {
    const edits = moveVertices([], new Set(verticesInRect(0, 0, VERTEX_LATTICE, 0)), 1, 100);
    expect(edits).toHaveLength(2);
    const out = clearVertexEdits(edits, new Set([packVertex(0, 0)]));
    expect(out).toHaveLength(1);
    expect(out[0].x).toBeCloseTo(VERTEX_LATTICE, 3);
  });

  it('region covers what changed and is null when nothing did', () => {
    const a = moveVertices([], new Set([packVertex(10, 10)]), 1, 100);
    expect(vertexEditRegion(a, a)).toBeNull();
    const r = vertexEditRegion([], a);
    expect(r).not.toBeNull();
    expect(r!.minX).toBeLessThan(VERTEX_LATTICE * 10);
    expect(r!.maxX).toBeGreaterThan(VERTEX_LATTICE * 10);
  });
});
