// The world trees' camera-occluder fade (tree_hide_fade.ts) over its spatial
// index (tree_hide_index_core.ts): a frame touches only the trees the
// eye-to-camera segment can cross, the unprefetched trees inside the prefetch
// reach, and the trees whose fade is in flight, and every tree ends each
// frame in the state the linear walk over the whole registry left it in.
import { describe, expect, it, vi } from 'vitest';
import type { InstancedOccluderGhosts } from '../src/render/instanced_occluder_ghosts';
import { OCCLUDER_FADE_PREFETCH_YD } from '../src/render/occluder_fade_core';
import {
  cameraSegmentHitsTree,
  stepTreeHide,
  type TreeHideable,
  updateTreeHides,
} from '../src/render/tree_hide_fade';
import { TreeHideIndex } from '../src/render/tree_hide_index_core';

// A ghost pool that never touches three: readiness always granted, handles
// counted, alpha and release recorded per handle.
function fakeGhosts(): InstancedOccluderGhosts & {
  acquired: number;
  released: number;
  prefetched: number;
  consulted: number;
} {
  const pool = {
    acquired: 0,
    released: 0,
    prefetched: 0,
    consulted: 0,
    allReady: () => {
      pool.consulted++;
      return true;
    },
    ready: () => true,
    prefetch: () => {
      pool.prefetched++;
    },
    prefetchAll: (parts: readonly unknown[]) => {
      pool.prefetched += parts.length;
    },
    acquire: () => {
      pool.acquired++;
      return { alpha: 1 } as unknown as ReturnType<InstancedOccluderGhosts['acquire']>;
    },
    setAlpha: (handle: { alpha: number }, alpha: number) => {
      handle.alpha = alpha;
    },
    release: () => {
      pool.released++;
    },
  };
  return pool as unknown as ReturnType<typeof fakeGhosts>;
}

// Deterministic tree field: a lattice with a hash jitter, trunk radii 0.6 to 1.4.
function field(count: number, spacing: number): TreeHideable[] {
  const trees: TreeHideable[] = [];
  const side = Math.ceil(Math.sqrt(count));
  for (let i = 0; i < count; i++) {
    const gx = (i % side) - side / 2;
    const gz = Math.floor(i / side) - side / 2;
    const jitter = ((i * 7919) % 97) / 97;
    trees.push({
      x: gx * spacing + jitter * 3,
      z: gz * spacing + ((i * 104729) % 89) / 89,
      r: 0.6 + (jitter % 0.8),
      topY: 8,
      hidden: false,
      alpha: 1,
      ghosts: [],
      // One part on a fake instanced mesh: the ghost pool is what is exercised,
      // the matrix writes land on inert stand-ins.
      parts: [
        {
          mesh: {
            setMatrixAt: () => {},
            instanceMatrix: { addUpdateRange: () => {}, needsUpdate: false },
          } as unknown as TreeHideable['parts'][number]['mesh'],
          index: 0,
          visibleMatrix: {} as TreeHideable['parts'][number]['visibleMatrix'],
          hiddenMatrix: {} as TreeHideable['parts'][number]['hiddenMatrix'],
        },
      ],
      prefetched: false,
    });
  }
  return trees;
}

const snapshot = (trees: readonly TreeHideable[]) =>
  trees.map((t) => [t.hidden, +t.alpha.toFixed(6), t.ghosts.length, t.prefetched]);

/** The linear walk the index replaced, over the same per-tree step. */
function referenceUpdate(
  trees: TreeHideable[],
  ghosts: InstancedOccluderGhosts,
  eye: [number, number, number],
  cam: [number, number, number],
  dt: number,
): void {
  for (const t of trees) {
    const dx = t.x - cam[0];
    const dz = t.z - cam[2];
    if (!t.prefetched && dx * dx + dz * dz <= OCCLUDER_FADE_PREFETCH_YD ** 2) {
      t.prefetched = true;
      ghosts.prefetchAll(t.parts);
    }
    const hide = cameraSegmentHitsTree(t, eye[0], eye[1], eye[2], cam[0], cam[1], cam[2]);
    stepTreeHide(t, ghosts, hide, dt, false);
  }
}

describe('updateTreeHides', () => {
  it('leaves every tree exactly where the linear walk leaves it, frame after frame', () => {
    const indexed = field(900, 6);
    const reference = field(900, 6);
    const ghostsA = fakeGhosts();
    const ghostsB = fakeGhosts();
    // The camera orbits the eye at boom length 9 while the eye drifts across
    // the field, so trunks enter and leave the segment and the fade runs both ways.
    for (let frame = 0; frame < 240; frame++) {
      const ex = -40 + frame * 0.45;
      const ez = 3 + Math.sin(frame * 0.05) * 12;
      const yaw = frame * 0.11;
      const eye: [number, number, number] = [ex, 1.7, ez];
      const cam: [number, number, number] = [
        ex - Math.sin(yaw) * 9,
        2.4 + Math.sin(frame * 0.2),
        ez - Math.cos(yaw) * 9,
      ];
      updateTreeHides(
        indexed,
        ghostsA,
        eye[0],
        eye[1],
        eye[2],
        cam[0],
        cam[1],
        cam[2],
        1 / 60,
        false,
      );
      referenceUpdate(reference, ghostsB, eye, cam, 1 / 60);
      expect(snapshot(indexed), `frame ${frame}`).toEqual(snapshot(reference));
    }
    // The run actually faded trees (the equality above is not vacuous).
    expect(ghostsA.acquired).toBeGreaterThan(5);
    expect(ghostsA.released).toBeGreaterThan(0);
    expect(ghostsA.acquired).toBe(ghostsB.acquired);
    expect(ghostsA.released).toBe(ghostsB.released);
    expect(ghostsA.prefetched).toBe(ghostsB.prefetched);
    // The pool is consulted for the same occlusions (never for every tree).
    expect(ghostsA.consulted).toBeGreaterThan(0);
    expect(ghostsA.consulted).toBe(ghostsB.consulted);
  });

  it('reads no tree at all on an idle frame away from every trunk', () => {
    let reads = 0;
    const trees = field(3000, 5).map(
      (t) =>
        new Proxy(t, {
          get(target, key, receiver) {
            reads++;
            return Reflect.get(target, key, receiver);
          },
        }),
    );
    const ghosts = fakeGhosts();
    // Warm frame: the index builds, the prefetch reach latches what it covers.
    updateTreeHides(trees, ghosts, 0, 1.7, 0, 0, 2.4, -9, 1 / 60, false);
    // The camera is parked far outside the field (the lattice spans about
    // 140 yd; the camera sits 500 yd away), in a spot with no tree in reach.
    updateTreeHides(trees, ghosts, 500, 1.7, 500, 500, 2.4, 491, 1 / 60, false);
    reads = 0;
    for (let frame = 0; frame < 60; frame++) {
      updateTreeHides(trees, ghosts, 500, 1.7, 500, 500, 2.4, 491, 1 / 60, false);
    }
    expect(reads).toBe(0);
  });

  it('sweeps the prefetch reach only where a tree is still unlatched', () => {
    let reads = 0;
    // A sparse field (one tree per 20 yd) so a cell's trees are few.
    const trees = field(3000, 20).map(
      (t) =>
        new Proxy(t, {
          get(target, key, receiver) {
            reads++;
            return Reflect.get(target, key, receiver);
          },
        }),
    );
    const ghosts = fakeGhosts();
    // Standing in a clearing: the first frame latches every tree in reach.
    updateTreeHides(trees, ghosts, 3, 1.7, 3, 3, 2.4, 1.5, 1 / 60, false);
    const latched = ghosts.prefetched;
    expect(latched).toBeGreaterThan(10);
    // The camera moves a hair: the sweep runs again but skips every cell whose
    // trees all latched, so the frame reads a few dozen trees, not the field.
    reads = 0;
    updateTreeHides(trees, ghosts, 3, 1.7, 3, 3, 2.4, 1.49, 1 / 60, false);
    expect(ghosts.prefetched).toBe(latched);
    expect(reads).toBeLessThan(trees.length / 20);
    expect(ghosts.acquired).toBe(0);
  });
});

describe('TreeHideIndex', () => {
  it('answers the cells under a segment box and the unlatched trees in reach', () => {
    const trees = [
      { x: 0, z: 0, r: 1, prefetched: false },
      { x: 40, z: 0, r: 1, prefetched: false },
      { x: 33, z: 0, r: 2, prefetched: true },
      { x: 200, z: 200, r: 1, prefetched: false },
      // Inside the reach's box but outside its circle (82 yd away): its
      // cell's nearest corner (48, 48) is 68 yd off, so the cell is skipped.
      { x: 58, z: 58, r: 1, prefetched: false },
    ];
    const index = new TreeHideIndex(trees, 16);
    expect(index.maxR).toBe(2);
    index.beginFrame();
    const near: number[] = [];
    index.forEachNearSegment(1, 0, 20, 0, (i) => near.push(i));
    // The box [1 - 2, 20 + 2] covers cells 0 and 1 along x: tree 0 only.
    expect(near).toEqual([0]);
    expect(index.visitedThisFrame(0)).toBe(true);
    expect(index.visitedThisFrame(1)).toBe(false);
    expect(index.sweepDue(0, 0)).toBe(true);
    expect(index.sweepDue(0, 0)).toBe(false);
    expect(index.sweepDue(0.5, 0)).toBe(true);
    const inReach: number[] = [];
    index.forEachUnprefetchedWithin(0, 0, 60, (i) => inReach.push(i));
    expect(inReach).toEqual([0, 1]);
    index.notePrefetched(0);
    index.notePrefetched(1);
    const later: number[] = [];
    index.forEachUnprefetchedWithin(0, 0, 60, (i) => later.push(i));
    expect(later).toEqual([]);
    // Latching while being visited is safe: the visit walks backwards.
    const fresh = new TreeHideIndex(trees, 16);
    const seen: number[] = [];
    fresh.forEachUnprefetchedWithin(0, 0, 60, (i) => {
      seen.push(i);
      fresh.notePrefetched(i);
    });
    expect(seen).toEqual([0, 1]);
  });

  it('clamps a tree beyond the key range into the edge cell and warns, never throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // Cell 0x10000 along x aliases with the key packing; both stray trees
      // land in the last honest cell (0xffff) instead, and the well-placed
      // tree is indexed exactly as before.
      const trees = [
        { x: 0, z: 0, r: 1, prefetched: false },
        { x: 16 * 0x10000 + 3, z: 0, r: 1, prefetched: false },
        { x: 0, z: -16 * 0x20000, r: 1, prefetched: false },
      ];
      let index: TreeHideIndex | null = null;
      expect(() => {
        index = new TreeHideIndex(trees, 16);
      }).not.toThrow();
      if (!index) throw new Error('index not built');
      const built: TreeHideIndex = index;
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('2 trees');
      built.beginFrame();
      const origin: number[] = [];
      built.forEachNearSegment(0, 0, 1, 0, (i) => origin.push(i));
      expect(origin).toEqual([0]);
      const edgeX: number[] = [];
      built.forEachNearSegment(16 * 0xffff, 0, 16 * 0xffff + 1, 0, (i) => edgeX.push(i));
      expect(edgeX).toEqual([1]);
      const edgeZ: number[] = [];
      built.forEachNearSegment(0, -16 * 0xffff, 1, -16 * 0xffff, (i) => edgeZ.push(i));
      expect(edgeZ).toEqual([2]);
      built.notePrefetched(1);
      const still: number[] = [];
      built.forEachUnprefetchedWithin(16 * 0xffff, 0, 8, (i) => still.push(i));
      expect(still).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('updateTreeHides over a grown registry', () => {
  it('keeps an in-flight fade stepping across the index rebuild', () => {
    const trees = field(400, 6);
    const ghosts = fakeGhosts();
    // Find a tree and cross it with the segment until it holds ghosts.
    const target = trees[0];
    const eye = [target.x - 3, 1.7, target.z] as const;
    const cam = [target.x + 3, 2.4, target.z] as const;
    updateTreeHides(trees, ghosts, eye[0], eye[1], eye[2], cam[0], cam[1], cam[2], 1 / 60, false);
    expect(target.ghosts.length).toBeGreaterThan(0);
    // The registry grows (a later build appends), and the camera moves away:
    // the ghosted tree must still fade back and release its ghosts.
    trees.push(...field(20, 6).map((t) => ({ ...t, x: t.x + 5000 })));
    for (let frame = 0; frame < 120; frame++) {
      updateTreeHides(trees, ghosts, 900, 1.7, 900, 900, 2.4, 891, 1 / 60, false);
    }
    expect(target.ghosts.length).toBe(0);
    expect(target.alpha).toBe(1);
    expect(ghosts.released).toBe(ghosts.acquired);
    // And a tree the growth added fades when the segment crosses it.
    const added = trees[trees.length - 1];
    updateTreeHides(
      trees,
      ghosts,
      added.x - 3,
      1.7,
      added.z,
      added.x + 3,
      2.4,
      added.z,
      1 / 60,
      false,
    );
    expect(added.ghosts.length).toBeGreaterThan(0);
    expect(added.hidden).toBe(true);
  });
});
