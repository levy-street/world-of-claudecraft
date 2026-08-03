// The far-terrain VIEW lifecycle (build streaming, teardown, editor
// invalidation), driven in plain Node: three's geometry classes need no GL,
// and the idle pacing goes through requestIdleCallback, which these tests
// stub to run deterministically. The pure tile math lives in
// far_terrain_core.test.ts; here the subjects are the behaviors the review
// of #2793 flagged: a teardown racing the idle build, and editor edits
// that must invalidate the static far snapshot.

import { afterEach, describe, expect, it } from 'vitest';
import { buildFarTerrain, type FarTerrainView } from '../src/render/far_terrain';
import type { FarVistaPlan } from '../src/render/far_terrain_core';

// A coarse plan keeps each tile a couple of idle slots: the LAW under test
// is lifecycle, not sampling cost.
const plan: FarVistaPlan = { enabled: true, spacing: 96, envelopeFar: 3200, cameraFar: 3600 };

type IdleCb = (deadline?: { didTimeout: boolean; timeRemaining: () => number }) => void;

interface IdleStub {
  pending: IdleCb[];
  /** run every queued callback once (new ones queue for the next flush) */
  flush(): number;
}

function installIdleStub(): IdleStub {
  const stub: IdleStub = {
    pending: [],
    flush() {
      const batch = stub.pending;
      stub.pending = [];
      for (const cb of batch) cb({ didTimeout: false, timeRemaining: () => 50 });
      return batch.length;
    },
  };
  (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback = (cb: IdleCb) => {
    stub.pending.push(cb);
    return 0;
  };
  return stub;
}

async function microtasks(): Promise<void> {
  // a few macrotask turns so chained `await idleSlot()` continuations run
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
}

async function driveToComplete(view: FarTerrainView, stub: IdleStub): Promise<void> {
  for (let guard = 0; guard < 500; guard++) {
    if (view.builtTileCount() >= view.plannedTileCount()) return;
    stub.flush();
    await microtasks();
  }
  throw new Error('far build never completed under the idle stub');
}

afterEach(() => {
  (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback = undefined;
});

describe('buildFarTerrain lifecycle', () => {
  it('cancelStreaming BEFORE the first idle slot builds nothing and goes quiet', async () => {
    // The editor teardown race: cancelTerrainStreaming right before the
    // WebGL context is destroyed. The old far builder kept allocating
    // geometries against the dead renderer; cancelled means NO tile may
    // attach and the idle queue must drain to silence.
    const stub = installIdleStub();
    const view = buildFarTerrain(20061, plan, { x: 0, z: 0 });
    expect(view.plannedTileCount()).toBeGreaterThan(0);
    view.cancelStreaming();
    for (let i = 0; i < 20; i++) {
      stub.flush();
      await microtasks();
    }
    expect(view.builtTileCount()).toBe(0);
    expect(view.group.children).toHaveLength(0);
    // quiet: nothing left re-scheduling itself
    expect(stub.flush()).toBe(0);
  });

  it('builds every planned tile, which is the renderer readiness signal', async () => {
    const stub = installIdleStub();
    const view = buildFarTerrain(20061, plan, { x: 0, z: 0 });
    expect(view.builtTileCount()).toBeLessThan(view.plannedTileCount());
    await driveToComplete(view, stub);
    expect(view.builtTileCount()).toBe(view.plannedTileCount());
    expect(view.group.children).toHaveLength(view.plannedTileCount());
    view.dispose();
  });

  it('rebuildRegion re-samples exactly the intersecting tiles, holes never open', async () => {
    const stub = installIdleStub();
    const view = buildFarTerrain(20061, plan, { x: 0, z: 0 });
    await driveToComplete(view, stub);
    const before = view.group.children.map((c) => (c as { geometry?: object }).geometry as object);
    // a small edit box: hits one tile's interior (plus spacing padding)
    view.rebuildRegion(10, 10, 30, 30);
    const total = view.plannedTileCount();
    for (let guard = 0; guard < 500; guard++) {
      stub.flush();
      await microtasks();
      // the built count NEVER dips: the stale mesh stands until its
      // replacement geometry is complete
      expect(view.builtTileCount()).toBe(total);
      const changed = view.group.children.filter(
        (c, i) => ((c as { geometry?: object }).geometry as object) !== before[i],
      ).length;
      if (changed > 0) {
        // only tiles the padded edit box intersects re-sampled
        expect(changed).toBeLessThanOrEqual(4);
        view.dispose();
        return;
      }
    }
    throw new Error('rebuildRegion never swapped a tile geometry');
  });

  it('rebuildRegion coalesces repeat edits of one tile instead of queueing dupes', async () => {
    const stub = installIdleStub();
    const view = buildFarTerrain(20061, plan, { x: 0, z: 0 });
    await driveToComplete(view, stub);
    // hammer the same spot, stroke-end style
    for (let i = 0; i < 8; i++) view.rebuildRegion(10, 10, 30, 30);
    let swaps = 0;
    let lastGeos = view.group.children.map((c) => (c as { geometry?: object }).geometry as object);
    for (let guard = 0; guard < 200; guard++) {
      stub.flush();
      await microtasks();
      const geos = view.group.children.map((c) => (c as { geometry?: object }).geometry as object);
      swaps += geos.filter((g, i) => g !== lastGeos[i]).length;
      lastGeos = geos;
    }
    // 8 queued edits of one region collapse to at most TWO re-samples per
    // tile hit (one drain, plus one legitimate re-queue for the tile whose
    // rebuild was already in flight when a later edit landed; that
    // in-flight build may have sampled pre-edit rows, so re-queueing it is
    // correctness, not a dedupe miss), never the naive 8-per-tile.
    expect(swaps).toBeGreaterThan(0);
    expect(swaps).toBeLessThanOrEqual(8);
    view.dispose();
  });
});
