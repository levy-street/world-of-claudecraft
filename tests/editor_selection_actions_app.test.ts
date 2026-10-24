// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import { EditorApp } from '../src/editor/app';
import type { AssetPlacement, CustomMap } from '../src/editor/custom_map';
import {
  SelectionQuickActions,
  type SelectionQuickActionsDeps,
} from '../src/editor/selection_quick_actions';
import { UndoStack } from '../src/editor/undo_core';
import { MAX_PLACEMENTS } from '../src/sim/map_doc';

vi.mock('../src/render/terrain', () => ({ DEFAULT_TEXTURE_TILE_YD: 14 }));
vi.mock('../src/editor/3d/viewport', () => ({ Editor3DViewport: class {} }));
vi.mock('../src/game/music', () => ({ MUSIC_ZONES: [], ALL_MUSIC_ZONES: [] }));

interface AppHarness {
  map: CustomMap;
  selectedPlacement: number | null;
  selectedSet: Set<number>;
  undo: UndoStack;
  doUndo(): void;
  doRedo(): void;
  selectionQuickActions: SelectionQuickActions;
  previewOn: boolean;
  tool: string;
  hitboxEdit: object | null;
  beginPlacementDrag(index: number): boolean;
  placementDragMove(point: { x: number; z: number }): void;
  endPlacementDrag(): void;
  placementPickingHooks(): {
    placementPickingEnabled(): boolean;
    placementDragUsesCursor(): boolean;
    onChoosePlacement(index: number, additive: boolean): void;
    onPickFloorVisibilityChange(on: boolean): void;
  };
  buildingWorkspace: {
    panelDeps(): { setHideAbove(on: boolean): void };
    cancel(): void;
    syncView(): void;
  };
  selectionQuickActionsDeps(): SelectionQuickActionsDeps;
  viewport3d: { focusOn: ReturnType<typeof vi.fn> };
  duplicateSelectedPlacement(): void;
  removeSelectedPlacements(): void;
  updateSelectedPlacement(change: { rotY?: number; scale?: number }, commit: boolean): void;
  setSelectedPlacement(index: number | null): void;
}
const placement = (x = 0): AssetPlacement => ({
  assetId: 'castle/column',
  x,
  z: 4,
  rotY: 0,
  scale: 1,
  collide: false,
  detached: true,
  groundY: 24,
  y: 2,
});

// Exercise the production selection, append/remove and transform commands; only
// browser/render notifications are stubbed. Undo operates on the real document.
function harness(placements: AssetPlacement[]): AppHarness {
  return Object.assign(Object.create(EditorApp.prototype), {
    // This repo's movable gameplay objects (dummies) share the undo flush.
    objectMoves: { commitPending: () => {}, selectedKey: null },
    roadEdit: { endDrag: () => {} },
    map: { placements, buildings: [], meta: { seed: 1, updatedAt: 0 } },
    selectedPlacement: 0,
    selectedSet: new Set([0]),
    selectedFireEmitter: null,
    placementDragBase: null,
    groupDragBase: null,
    hitboxEdit: null,
    collisionMaster: null,
    buildSession: null,
    tool: 'select',
    previewOn: false,
    fineBuildRotation: false,
    placementLabel: () => 'Royal column',
    setTool(this: AppHarness, tool: string) {
      this.tool = tool;
    },
    undo: new UndoStack(),
    clearNpcSelection: vi.fn(),
    flushTransformCommit: vi.fn(),
    inspector: { refresh: vi.fn() },
    toasts: { error: vi.fn() },
    viewport3d: {
      focusOn: vi.fn(),
      setSelectedPlacement: vi.fn(),
      setMultiSelection: vi.fn(),
      setFireEmitterEdit: vi.fn(),
      rebuildPlacements: vi.fn(),
      placementAdded: vi.fn(),
      placementRemoved: vi.fn(),
      placementUpdated: vi.fn(),
    },
    markDirty: vi.fn(),
    topbar: { setUndoDepth: vi.fn(), setUndoState: vi.fn() },
    refreshCaveGuides: vi.fn(),
    refreshRockGuides: vi.fn(),
  }) as AppHarness;
}

describe('selected asset actions through EditorApp', () => {
  it('keeps the current selection when duplicate has no capacity', () => {
    const app = harness(Array.from({ length: MAX_PLACEMENTS }, () => placement()));
    app.duplicateSelectedPlacement();
    expect(app.map.placements).toHaveLength(MAX_PLACEMENTS);
    expect(app.selectedPlacement).toBe(0);
    expect([...app.selectedSet]).toEqual([0]);
    expect(app.undo.depth).toBe(0);
  });

  it('selects only successfully appended copies at the placement limit', () => {
    const app = harness(Array.from({ length: MAX_PLACEMENTS - 1 }, () => placement()));
    app.selectedSet.add(1);
    app.duplicateSelectedPlacement();
    expect(app.map.placements).toHaveLength(MAX_PLACEMENTS);
    expect([...app.selectedSet]).toEqual([MAX_PLACEMENTS - 1]);
    expect(app.undo.depth).toBe(1);
  });

  it('duplicates and removes a raised selection with one undo per action', () => {
    const original = [placement(), placement(6)];
    const app = harness(structuredClone(original));
    app.selectedSet.add(1);
    app.duplicateSelectedPlacement();
    expect(app.map.placements.slice(2)).toEqual(
      original.map((p) => ({ ...p, x: p.x + 2, z: p.z + 2 })),
    );
    expect([...app.selectedSet]).toEqual([2, 3]);
    expect(app.undo.depth).toBe(1);
    app.removeSelectedPlacements();
    expect(app.map.placements).toEqual(original);
    expect(app.undo.depth).toBe(2);
    app.undo.undo();
    expect(app.map.placements).toHaveLength(4);
    app.undo.undo();
    expect(app.map.placements).toEqual(original);
    app.undo.redo();
    expect(app.map.placements).toHaveLength(4);
  });

  it('rotates and uniformly scales selected pieces while retaining their height', () => {
    const app = harness([placement(), placement(6)]);
    const before = structuredClone(app.map.placements);
    app.selectedSet.add(1);
    app.updateSelectedPlacement({ rotY: Math.PI / 4, scale: 1.1 }, true);
    expect(app.undo.depth).toBe(1);
    for (const p of app.map.placements) {
      expect(p.rotY).toBeCloseTo(Math.PI / 4);
      expect(p.scale).toBe(1.1);
      expect(p.groundY).toBe(24);
      expect(p.y).toBe(2);
    }
    app.undo.undo();
    expect(app.map.placements).toEqual(before);
    app.undo.redo();
    expect(app.map.placements[0].scale).toBe(1.1);
  });

  it('wires the visible quick buttons into real app edits and elevated framing', () => {
    const app = harness([placement()]);
    const panel = new SelectionQuickActions(app.selectionQuickActionsDeps());
    document.body.append(panel.root);
    app.selectionQuickActions = panel;
    const click = (action: string) =>
      panel.root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!.click();
    click('frame');
    expect(app.viewport3d.focusOn).toHaveBeenCalledWith(0, 4, 2, 26);
    click('move');
    expect(app.tool).toBe('move');
    click('rotateRight');
    expect(app.map.placements[0].rotY).toBeCloseTo(Math.PI / 4);
    click('larger');
    expect(app.map.placements[0].scale).toBe(1.1);
    click('duplicate');
    expect(app.map.placements).toHaveLength(2);
    expect(app.selectedPlacement).toBe(1);
    click('remove');
    expect(app.map.placements).toHaveLength(1);
    expect(app.undo.depth).toBe(4);
    expect(panel.root.hidden).toBe(true);
    app.doUndo();
    expect(app.map.placements).toHaveLength(2);
    app.setSelectedPlacement(1);
    expect(panel.root.hidden).toBe(false);
    app.doUndo();
    expect(app.map.placements).toHaveLength(1);
    expect(panel.root.hidden).toBe(true);
    panel.dispose();
  });

  it('suppresses quick actions in preview, Build drawing and hitbox edit', () => {
    const app = harness([placement()]);
    const deps = app.selectionQuickActionsDeps();
    expect(deps.getState()?.label).toBe('Royal column');
    app.previewOn = true;
    expect(deps.getState()).toBeNull();
    app.previewOn = false;
    app.tool = 'building';
    expect(deps.getState()).toBeNull();
    app.tool = 'select';
    app.hitboxEdit = { index: 0 };
    expect(deps.getState()).toBeNull();
  });

  it('moves an upper-floor group with stable height and one exact undo', () => {
    const app = harness([placement(), placement(6)]);
    const original = structuredClone(app.map.placements);
    app.selectedSet.add(1);
    expect(app.beginPlacementDrag(0)).toBe(true);
    app.placementDragMove({ x: 3, z: 7 });
    app.placementDragMove({ x: 5, z: 8 });
    app.endPlacementDrag();
    expect(app.map.placements.map((p) => ({ x: p.x, z: p.z, groundY: p.groundY, y: p.y }))).toEqual(
      [
        { x: 5, z: 8, groundY: 24, y: 2 },
        { x: 11, z: 8, groundY: 24, y: 2 },
      ],
    );
    expect(app.undo.depth).toBe(1);
    app.undo.undo();
    expect(app.map.placements).toEqual(original);
    app.undo.redo();
    expect(app.map.placements[0].x).toBe(5);
    expect(app.map.placements[1].groundY).toBe(24);
  });

  it('uses off-centre cursor angles for direct Rotate drags without changing elevation', () => {
    const app = harness([placement()]);
    app.tool = 'rotate';
    app.beginPlacementDrag(0);
    app.placementDragMove({ x: 3, z: 8 });
    app.placementDragMove({ x: 4, z: 7 });
    app.endPlacementDrag();
    expect(app.map.placements[0].rotY).toBeCloseTo(Math.atan2(4, 3) - Math.atan2(3, 4));
    expect(app.map.placements[0].scale).toBe(1);
    expect(app.map.placements[0].groundY).toBe(24);
    expect(app.undo.depth).toBe(1);
    app.doUndo();
    expect(app.map.placements[0]).toEqual(placement());
  });

  it('uses off-centre cursor distance for direct Scale drags', () => {
    const app = harness([placement()]);
    app.tool = 'scale';
    app.beginPlacementDrag(0);
    app.placementDragMove({ x: 3, z: 8 });
    app.placementDragMove({ x: 6, z: 12 });
    app.endPlacementDrag();
    expect(app.map.placements[0].scale).toBe(2);
    expect(app.map.placements[0].groundY).toBe(24);
    expect(app.map.placements[0].y).toBe(2);
    expect(app.undo.depth).toBe(1);
    app.doUndo();
    expect(app.map.placements[0]).toEqual(placement());
  });

  it('routes the Build chooser to selection and its floor toggle to the workspace', () => {
    const app = harness([placement(), placement(6)]);
    app.tool = 'building';
    const hideAbove = vi.fn();
    app.buildingWorkspace = {
      panelDeps: () => ({ setHideAbove: hideAbove }),
      cancel: vi.fn(),
      syncView: vi.fn(),
    };
    const hooks = app.placementPickingHooks();
    expect(hooks.placementPickingEnabled()).toBe(true);
    hooks.onChoosePlacement(1, false);
    expect(app.tool).toBe('move');
    expect(app.selectedPlacement).toBe(1);
    hooks.onChoosePlacement(0, true);
    expect([...app.selectedSet]).toEqual([1, 0]);
    hooks.onChoosePlacement(10, false);
    expect(app.selectedPlacement).toBe(0);
    hooks.onPickFloorVisibilityChange(false);
    hooks.onPickFloorVisibilityChange(true);
    expect(hideAbove.mock.calls).toEqual([[false], [true]]);
    for (const [tool, cursor] of [
      ['move', false],
      ['select', false],
      ['rotate', true],
      ['scale', true],
    ] as const) {
      app.tool = tool;
      expect(hooks.placementDragUsesCursor()).toBe(cursor);
    }
    app.previewOn = true;
    expect(hooks.placementPickingEnabled()).toBe(false);
  });
});
