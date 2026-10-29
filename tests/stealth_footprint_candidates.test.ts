import { describe, expect, it, vi } from 'vitest';
import { StealthFootprintCandidates } from '../server/stealth_footprint_candidates';
import { StealthFootprintWire } from '../server/stealth_footprint_wire';
import { type FootprintSourceView, forEachVisibleFootprint } from '../src/sim/stealth_footprints';
import type { Entity } from '../src/sim/types';

const viewerAt = (x = 0, z = 0): Entity => ({ id: -1, pos: { x, y: 0, z }, dead: false }) as Entity;
function trail(id: number, points: [number, number][]): FootprintSourceView {
  const prints = points.map(([x, z], i) => ({
    x,
    y: 0,
    z,
    facing: 0,
    t: 1,
    foot: (i % 2) as 0 | 1,
  }));
  return {
    // The current body is deliberately nowhere near its historical prints.
    src: {
      id,
      kind: 'player',
      pos: { x: -1e6, y: 0, z: -1e6 },
      stealthTrail: { prints },
    } as Entity,
    prints,
    minX: Math.min(...points.map(([x]) => x)),
    maxX: Math.max(...points.map(([x]) => x)),
    minZ: Math.min(...points.map(([, z]) => z)),
    maxZ: Math.max(...points.map(([, z]) => z)),
  };
}

describe('historical footprint candidates', () => {
  it('does not visit distant realm trail bounds for dispersed viewers', () => {
    const views = Array.from({ length: 1000 }, (_, i) => trail(i, [[1000 + i * 100, 1000]]));
    views.push(trail(1000, [[0, 0]]));
    let boundsRead = 0;
    for (const view of views) {
      const minX = view.minX;
      Object.defineProperty(view, 'minX', {
        get: () => {
          boundsRead++;
          return minX;
        },
      });
    }
    const index = new StealthFootprintCandidates(views);
    const world = { time: 4, isHostileTo: vi.fn(() => true) };
    for (let i = 0; i < 10; i++) {
      expect(
        forEachVisibleFootprint(world, viewerAt(i), index.forViewer(viewerAt(i)), () => {}),
      ).toBe(1);
    }
    expect(boundsRead).toBe(10); // one local trail, not 1,001 trails per viewer
    expect(world.isHostileTo).toHaveBeenCalledTimes(10);
  });

  it('matches full-filter packet order, exact radius and cap across cells and teleport trails', () => {
    const points: [number, number][] = [
      [-25.1, -0.1],
      [0, 0],
      [24.9, 24.9],
      [50, 0],
      [1e9, -1e9],
    ];
    const views = [
      trail(10, points),
      ...Array.from({ length: 4 }, (_, i) =>
        trail(
          20 + i,
          Array.from({ length: 32 }, (_, j) => [j % 2 ? 24.9 : 25.1, 0]),
        ),
      ),
    ];
    const index = new StealthFootprintCandidates(views);
    const world = {
      time: 4,
      isHostileTo: (_a: Entity, b: Entity) => b.id !== 21,
      players: new Map(views.map((v) => [v.src.id, { entityId: v.src.id }])),
      entities: new Map(views.map((v) => [v.src.id, v.src])),
    };
    const wire = new StealthFootprintWire(world).beginBroadcast();
    for (const [x, z] of [
      [0, 0],
      [25, 0],
      [-0.1, -0.1],
      [1e9, -1e9],
      [1000, 1000],
    ]) {
      const viewer = viewerAt(x, z);
      const expected: number[][] = [];
      forEachVisibleFootprint(world, viewer, views, (p) =>
        expected.push([p.x, p.y, p.z, p.facing, p.t, p.foot]),
      );
      const actual: number[][] = [];
      forEachVisibleFootprint(world, viewer, index.forViewer(viewer), (p) =>
        actual.push([p.x, p.y, p.z, p.facing, p.t, p.foot]),
      );
      expect(actual).toEqual(expected);
      const suffix = wire.suffixFor(viewer, {});
      expect(suffix).toBe(expected.length ? `,"sfp":${JSON.stringify(expected)}` : '');
    }
  });

  it('indexes only occupied print cells and stops lazy candidates at the output cap', () => {
    const teleport = trail(
      1,
      Array.from({ length: 32 }, (_, i) => [i * 1e9, -i * 1e9]),
    );
    const teleIndex = new StealthFootprintCandidates([teleport]);
    expect(teleIndex.cellCount()).toBe(32); // never the enormous bounding-box area
    expect([...teleIndex.forViewer(viewerAt(1e9, -1e9))]).toEqual([teleport]);
    const local = Array.from({ length: 1000 }, (_, i) =>
      trail(
        i,
        Array.from({ length: 32 }, () => [0, 0]),
      ),
    );
    const index = new StealthFootprintCandidates(local);
    const world = { time: 4, isHostileTo: vi.fn(() => true) };
    expect(forEachVisibleFootprint(world, viewerAt(), index.forViewer(viewerAt()), () => {})).toBe(
      64,
    );
    expect(world.isHostileTo).toHaveBeenCalledTimes(2);
  });
});
