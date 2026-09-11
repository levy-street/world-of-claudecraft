// The instancing contract, as a test rather than a frame-rate observation:
// N placements over M assets must cost about M draw calls, and the slot table
// that makes LOD/selection cheap must never leave a hole in the instance buffer.

import { describe, expect, it } from 'vitest';
import {
  batchKey,
  placementBatchable,
  projectedDrawCalls,
  SlotTable,
} from '../src/render/placed_batch_core';
import type { PlacedAsset } from '../src/sim/types';

const asset = (path: string, extra: Partial<PlacedAsset> = {}): PlacedAsset =>
  ({ path, x: 0, z: 0, rotY: 0, scale: 1, ...extra }) as PlacedAsset;

describe('batch keys', () => {
  it('shares one key across copies of the same sub-mesh', () => {
    expect(batchKey('/models/props/crate_wooden.glb', 0, true)).toBe(
      batchKey('/models/props/crate_wooden.glb', 0, true),
    );
  });

  it('separates sub-meshes, assets, and caster/non-caster', () => {
    const a = batchKey('/models/props/crate_wooden.glb', 0, true);
    expect(a).not.toBe(batchKey('/models/props/crate_wooden.glb', 1, true));
    expect(a).not.toBe(batchKey('/models/props/barrel.glb', 0, true));
    // An InstancedMesh casts as a whole, so these can never share a draw.
    expect(a).not.toBe(batchKey('/models/props/crate_wooden.glb', 0, false));
  });
});

describe('batch eligibility', () => {
  it('accepts a plain placement', () => {
    expect(placementBatchable(asset('/models/props/barrel.glb'))).toBe(true);
  });

  it('rejects per-placement material overrides', () => {
    // applyMaterialOverride clones the shared template materials for exactly
    // these, so an overridden placement cannot share a program with siblings.
    expect(placementBatchable(asset('/models/props/barrel.glb', { tint: 0xff0000 }))).toBe(false);
    expect(placementBatchable(asset('/models/props/barrel.glb', { opacity: 0.5 }))).toBe(false);
    expect(placementBatchable(asset('/models/props/barrel.glb', { glow: 2 }))).toBe(false);
    expect(placementBatchable(asset('/models/props/barrel.glb', { glowStrength: 2 }))).toBe(false);
  });

  it('still batches an authored fire: the flames are their own group', () => {
    // applyFireFx seats the flame/ember/light group from the placement record,
    // never from the model's geometry, so the log pile instances regardless.
    expect(placementBatchable(asset('/models/props/bonfire.glb', { fire: true }))).toBe(true);
    const withEmitter = asset('/models/props/bonfire.glb');
    (withEmitter as { fireEffects?: unknown }).fireEffects = [{ id: 'a', enabled: true }];
    expect(placementBatchable(withEmitter)).toBe(true);
  });
});

describe('projected draw calls', () => {
  it('collapses many copies of few assets to about one draw per sub-mesh', () => {
    // 600 placements, 3 assets, 2 sub-meshes each -> 6 draws, not 600.
    const paths = ['/models/props/barrel.glb', '/models/props/crate_wooden.glb', '/models/a.glb'];
    const placements = Array.from({ length: 600 }, (_, i) => asset(paths[i % paths.length]));
    expect(projectedDrawCalls(placements, () => 2)).toBe(6);
  });

  it('charges an un-batchable placement its own draws', () => {
    const placements = [
      asset('/models/props/barrel.glb'),
      asset('/models/props/barrel.glb'),
      asset('/models/props/barrel.glb', { tint: 0x00ff00 }),
    ];
    // one batch for the two plain barrels + one clone's own sub-mesh
    expect(projectedDrawCalls(placements, () => 1)).toBe(2);
  });

  it('treats a template with no sub-meshes as one draw', () => {
    expect(projectedDrawCalls([asset('/models/props/barrel.glb')], () => 0)).toBe(1);
  });
});

describe('SlotTable', () => {
  it('appends densely and reports slots', () => {
    const t = new SlotTable();
    expect(t.alloc(10)).toBe(0);
    expect(t.alloc(11)).toBe(1);
    expect(t.alloc(12)).toBe(2);
    expect(t.count).toBe(3);
    expect(t.slotOf(11)).toBe(1);
    expect(t.has(12)).toBe(true);
  });

  it('is idempotent for a live id', () => {
    const t = new SlotTable();
    t.alloc(10);
    expect(t.alloc(10)).toBe(0);
    expect(t.count).toBe(1);
  });

  it('swaps the last instance into a freed hole', () => {
    const t = new SlotTable();
    t.alloc(10);
    t.alloc(11);
    t.alloc(12);
    // Free the middle: 12 moves down into slot 1, count drops to 2.
    expect(t.free(11)).toEqual({ freed: 1, moved: 12 });
    expect(t.count).toBe(2);
    expect(t.slotOf(12)).toBe(1);
    expect(t.liveIds()).toEqual([10, 12]);
  });

  it('reports no move when the freed slot was already last', () => {
    const t = new SlotTable();
    t.alloc(10);
    t.alloc(11);
    expect(t.free(11)).toEqual({ freed: 1, moved: null });
    expect(t.liveIds()).toEqual([10]);
  });

  it('ignores a free for an id it does not hold', () => {
    const t = new SlotTable();
    t.alloc(10);
    expect(t.free(99)).toBeNull();
    expect(t.count).toBe(1);
  });

  it('stays dense through an interleaved churn', () => {
    const t = new SlotTable();
    for (let i = 0; i < 50; i++) t.alloc(i);
    for (let i = 0; i < 50; i += 2) t.free(i);
    const live = t.liveIds();
    expect(live).toHaveLength(25);
    // Every live id must sit at a slot inside [0, count) and agree with the
    // reverse index: that is exactly what lets `mesh.count` gate the draw.
    for (const id of live) {
      const slot = t.slotOf(id);
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(t.count);
      expect(live[slot as number]).toBe(id);
    }
  });

  it('renames in place after a document reindex', () => {
    const t = new SlotTable();
    t.alloc(10);
    t.alloc(11);
    // Removing document index 9 shifts 11 down to 10 and 10 down to 9. The
    // instances must keep their slots: only the ids they answer to change.
    // Ascending order, like reindexAfterRemoval, renaming 11->10 first would
    // clobber the id 10 that is still live.
    t.rename(10, 9);
    t.rename(11, 10);
    expect(t.count).toBe(2);
    expect(t.liveIds()).toEqual([9, 10]);
    expect(t.slotOf(9)).toBe(0);
    expect(t.slotOf(10)).toBe(1);
  });
});
