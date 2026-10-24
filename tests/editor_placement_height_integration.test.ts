// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { EditorApp } from '../src/editor/app';
import { newFlatCustomMap } from '../src/editor/custom_map';
import { parseMap, serializeMapCompact } from '../src/editor/persist';
import { placementHeightPanel } from '../src/editor/placement_height_panel';
import { CommitCoalescer } from '../src/editor/placement_transform_core';
import { UndoStack } from '../src/editor/undo_core';
import type { MapPlacement } from '../src/sim/map_doc';

function fixture() {
  const map = newFlatCustomMap('Height check', 'height-check', 42);
  map.placements = [
    { assetId: 'props/crate', x: 2, z: 3, rotY: 0, scale: 1, collide: false },
    {
      assetId: 'props/crate',
      x: 5,
      z: 7,
      y: 4,
      rotY: 0.4,
      scale: 2,
      collide: true,
      detached: true,
      groundY: 12,
      groupId: 'castle-detail',
    },
  ];
  const undo = new UndoStack();
  // Exercise the real app command and undo snapshots without constructing WebGL.
  const app = Object.assign(Object.create(EditorApp.prototype), {
    // This repo's movable gameplay objects (dummies) share the undo flush.
    objectMoves: { commitPending: () => {}, selectedKey: null },
    map,
    undo,
    selectedPlacement: 0,
    selectedSet: new Set([0, 1]),
    placementDragBase: null,
    groupDragBase: null,
    hitboxEdit: null,
    selectedFireEmitter: null,
    viewport3d: null,
    transformCoalescer: new CommitCoalescer(400),
    transformTimer: 0,
    commitNpcMove: vi.fn(),
    commitMobMove: vi.fn(),
    markDirty: vi.fn(),
    syncUndoUi: vi.fn(),
    syncMultiSelectionView: vi.fn(),
  });
  const controls = placementHeightPanel({
    getSelection: () => ({ y: map.placements[0].y ?? null }),
    getSelectionHeights: () => map.placements.map((p) => p.y ?? 0),
    commitSelectionTransform: () => app.flushTransformCommit(),
    updateSelection: (change, commit) => app.updateSelectedPlacement(change, commit),
    getStep: () => 0.5,
    setStep: vi.fn(),
  });
  const click = (text: string) => {
    const control = [...controls.querySelectorAll('button')].find((b) => b.textContent === text);
    if (!control) throw new Error(`Missing ${text}`);
    control.click();
  };
  return { map, undo, click, app };
}

describe('asset height through the editor placement command', () => {
  it('moves a grounded and detached selection together, saves signed offsets, and undoes exactly', () => {
    const f = fixture();
    const before: MapPlacement[] = structuredClone(f.map.placements);
    f.click('Lower');
    expect(f.map.placements).toEqual([
      { ...before[0], y: -0.5 },
      { ...before[1], y: 3.5 },
    ]);
    expect(f.undo.depth).toBe(1);
    expect(parseMap(serializeMapCompact(f.map))?.placements).toEqual(f.map.placements);
    f.undo.undo();
    expect(f.map.placements).toEqual(before);
    expect(f.map.placements[0]).not.toHaveProperty('y');
    f.undo.redo();
    expect(f.map.placements.map((p) => p.y)).toEqual([-0.5, 3.5]);
    f.click('Raise');
    expect(f.map.placements.map((p) => p.y)).toEqual([0, 4]);
    expect(f.undo.depth).toBe(2);
  });

  it('keeps group spacing at the authoring limit and makes blocked clicks no-ops', () => {
    const f = fixture();
    f.map.placements[1].y = 199.75;
    f.click('Raise');
    expect(f.map.placements.map((p) => p.y)).toEqual([0.25, 200]);
    expect(f.undo.depth).toBe(1);
    f.click('Raise');
    expect(f.map.placements.map((p) => p.y)).toEqual([0.25, 200]);
    expect(f.undo.depth).toBe(1);
    f.undo.undo();
    expect(f.map.placements.map((p) => p.y)).toEqual([undefined, 199.75]);
  });

  it('commits an open rotation burst separately before the height click', () => {
    const f = fixture();
    f.app.updateSelectedPlacement({ rotY: 0.2 }, false);
    f.app.transformCoalescer.tick(0);
    f.click('Raise');
    expect(f.map.placements[0]).toMatchObject({ rotY: 0.2, y: 0.5 });
    expect(f.undo.depth).toBe(2);
    expect(f.app.transformCoalescer.pending).toBe(false);
    f.undo.undo();
    expect(f.map.placements[0].rotY).toBe(0.2);
    expect(f.map.placements[0]).not.toHaveProperty('y');
    f.undo.undo();
    expect(f.map.placements[0].rotY).toBe(0);
  });
});
