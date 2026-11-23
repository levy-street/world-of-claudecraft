import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Editor3DViewport } from '../src/editor/3d/viewport';
import { BuildingWorkspace, type BuildingWorkspaceDeps } from '../src/editor/building_workspace';
import type { AssetPlacement, CustomMap } from '../src/editor/custom_map';
import { UndoStack } from '../src/editor/undo_core';
import { importWallTexture } from '../src/editor/wall_texture_import';
import { modelMaterialOptions } from '../src/render/model_materials';
import { MAX_BUILDINGS } from '../src/sim/building';
import { MAX_PLACEMENTS } from '../src/sim/map_doc';
import { editorStrings } from '../src/ui/i18n.catalog/editor';

// Keep rendering and image I/O outside this controller test. Geometry, metadata,
// finish decisions and the command stack all use their production modules.
vi.mock('../src/render/assets/ground_textures', () => ({
  groundTextureUrl: (sha: string) => `blob:test/${sha}`,
}));
vi.mock('../src/render/assets/media', () => ({ assetUrl: (path: string) => path }));
vi.mock('../src/render/model_materials', () => ({
  modelMaterialOptions: vi.fn(() => [
    { key: 'Stone01', name: 'Stone', group: 'stone', file: 'stone.webp' },
  ]),
}));
vi.mock('../src/ui/i18n', () => ({
  t: (key: string) => key,
  formatNumber: (value: number) => String(value),
}));
vi.mock('../src/editor/asset_catalog.generated', () => ({
  assetById: (id: string) => ({ id, path: `/models/${id}.glb` }),
}));
vi.mock('../src/editor/collision_defaults', () => ({
  applyDefaultCollision: (p: AssetPlacement) => {
    p.collisionMode = 'baked';
  },
}));
vi.mock('../src/editor/wall_texture_import', () => ({ importWallTexture: vi.fn() }));

function existingPlacement(overrides: Partial<AssetPlacement> = {}): AssetPlacement {
  return { assetId: 'props/crate', x: 0, z: 0, scale: 1, rotY: 0, collide: true, ...overrides };
}

function harness(initial: Partial<CustomMap> = {}) {
  let map = { placements: [], ...initial } as unknown as CustomMap;
  const stack = new UndoStack();
  const viewport = {
    setBuildingPlane: vi.fn(),
    setBuildingFloorFilter: vi.fn(),
    setBuildingPreview: vi.fn(),
    setCityGridOverlay: vi.fn(),
    setCityGhostAsset: vi.fn(),
    updateCityGhost: vi.fn(),
    cameraFocus: vi.fn(() => ({ x: 0, z: 0 })),
    cityAssetFootprint: vi.fn(async (_path: string) => ({ sizeX: 2, sizeY: 2, sizeZ: 0.2 })),
    pickBuildingSurface: vi.fn<
      (_x: number, _y: number) => { index: number; side: 'front' | 'back' } | null
    >(() => null),
  };
  let workspace: BuildingWorkspace;
  const deps: BuildingWorkspaceDeps = {
    map: () => map,
    viewport: () => viewport as unknown as Editor3DViewport,
    terrain: vi.fn((point) => 36 + point.x / 10),
    execute: vi.fn((command) => {
      command.redo();
      stack.push(command);
    }),
    changed: vi.fn(() => workspace.syncView()),
    refresh: vi.fn(),
    arm: vi.fn(() => workspace.setActive(true)),
    selectExisting: vi.fn(),
    openAssets: vi.fn(),
    clearSelection: vi.fn(),
    error: vi.fn(),
  };
  workspace = new BuildingWorkspace(deps);
  workspace.reset();
  workspace.setActive(true);
  const panel = workspace.panelDeps();
  const draw = (x = 4, z = 0) => {
    workspace.begin({ x: 0, z: 0 });
    workspace.hover({ x, z });
    workspace.end({ x, z });
  };
  return {
    workspace,
    panel,
    stack,
    viewport,
    deps,
    draw,
    map: () => map,
    replaceMap: (next: Partial<CustomMap>) => {
      map = { placements: [], ...next } as unknown as CustomMap;
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe('building workspace gesture commands', () => {
  it('labels every wall finish offered by the live material registry', async () => {
    const actual = await vi.importActual<typeof import('../src/render/model_materials')>(
      '../src/render/model_materials',
    );
    const h = harness();
    vi.mocked(modelMaterialOptions).mockReturnValueOnce(actual.modelMaterialOptions());
    const options = h.panel.getState().textureOptions.filter((option) => option.value);
    expect(options.some((option) => option.value === 'WardenStone')).toBe(true);
    for (const option of options) {
      const labels: Record<string, string> = editorStrings.buildMode.materialNames;
      expect(labels[option.value], option.value).toBeTypeOf('string');
      expect(option.label).toBe(`editor.buildMode.materialNames.${option.value}`);
    }
  });

  it('previews and commits diagonal bare walls as one undoable grid-snapped run', () => {
    const h = harness();
    expect(h.panel.getState().diagonal).toBe(false);
    h.panel.setDiagonal(true);
    expect(h.panel.getState().diagonal).toBe(true);
    h.workspace.begin({ x: 0.2, z: 0.1 });
    h.workspace.hover({ x: 3.9, z: 3.2 });
    const preview = structuredClone(h.viewport.setBuildingPreview.mock.lastCall?.[0]);
    expect(preview).toHaveLength(5);
    expect(h.map().placements).toEqual([]);
    h.workspace.end({ x: 3.9, z: 3.2 });
    const placed = structuredClone(h.map().placements);
    expect(placed.map(({ cityId: _run, ...p }) => p)).toEqual(preview);
    const centers = [
      [0.4, 0.3],
      [1.2, 0.9],
      [2, 1.5],
      [2.8, 2.1],
      [3.6, 2.7],
    ];
    placed.forEach((p, i) => {
      expect(p.x).toBeCloseTo(centers[i][0]);
      expect(p.z).toBeCloseTo(centers[i][1]);
    });
    for (const p of placed) expect(p.rotY).toBeCloseTo(-Math.atan2(3, 4));
    expect(h.stack.depth).toBe(1);
    h.stack.undo();
    expect(h.map().placements).toEqual([]);
    h.stack.redo();
    expect(h.map().placements).toEqual(placed);
  });

  it('fits chosen wall pieces along a diagonal and restores axis locking when disabled', async () => {
    const h = harness();
    await h.workspace.pickAsset('tidehold_parts/castle_wall', 'Castle wall');
    h.panel.setDiagonal(true);
    h.draw(8, 6);
    expect(h.map().placements).toHaveLength(2);
    expect(h.map().placements.map((p) => [p.x, p.z])).toEqual([
      [2, 1.5],
      [6, 4.5],
    ]);
    for (const p of h.map().placements) {
      expect(p.rotY).toBeCloseTo(-Math.atan2(6, 8));
      expect(p.scaleX).toBeCloseTo(5 / 6);
    }
    h.stack.undo();
    h.panel.setDiagonal(false);
    h.draw(8, 6);
    expect(h.map().placements).toHaveLength(1);
    expect(h.map().placements.every((p) => p.z === 0 && p.rotY === 0)).toBe(true);
  });

  it('cancels an unfinished run when its diagonal constraint changes', () => {
    const h = harness();
    h.workspace.begin({ x: 0, z: 0 });
    h.workspace.hover({ x: 4, z: 3 });
    h.panel.setDiagonal(true);
    expect(h.viewport.setBuildingPreview).toHaveBeenLastCalledWith([]);
    h.workspace.end({ x: 4, z: 3 });
    expect(h.map().placements).toEqual([]);
    expect(h.stack.depth).toBe(0);
    h.panel.setMode('room');
    h.draw(4, 3);
    const rectangular = harness();
    rectangular.panel.setMode('room');
    rectangular.draw(4, 3);
    expect(h.map().placements).toEqual(rectangular.map().placements);
    expect(h.map().placements).toHaveLength(15);
    expect(h.map().placements.filter((p) => p.building?.kind === 'floor')).toHaveLength(1);
  });

  it('commits an entire room and its building metadata as one undoable command', () => {
    const original = existingPlacement();
    const h = harness({ placements: [original] });
    h.panel.setMode('room');
    h.workspace.begin({ x: 0, z: 0 });
    h.workspace.hover({ x: 4, z: 3 });
    expect(h.map().placements).toEqual([original]);
    expect(h.stack.depth).toBe(0);
    expect(h.viewport.setBuildingPreview.mock.lastCall?.[0]).toHaveLength(15);
    h.workspace.end({ x: 4, z: 3 });
    expect(h.stack.depth).toBe(1);
    expect(h.map().placements).toHaveLength(16);
    expect(h.map().buildings).toEqual([
      { id: 'building_1', baseY: 36.05, floorHeight: 6.6, levels: 1 },
    ]);
    expect(
      new Set(
        h
          .map()
          .placements.slice(1)
          .map((p) => p.cityId),
      ).size,
    ).toBe(1);
    const built = structuredClone(h.map().placements);
    expect(h.stack.undo()?.label).toBe('building-gesture');
    expect(h.map().placements).toEqual([original]);
    expect(h.map().buildings).toBeUndefined();
    expect(h.stack.redo()?.label).toBe('building-gesture');
    expect(h.map().placements).toEqual(built);
    expect(h.map().buildings).toHaveLength(1);
    expect(h.stack.depth).toBe(1);
  });

  it('captures one foundation height for every wall section on uneven terrain', () => {
    const h = harness();
    h.workspace.begin({ x: 10, z: 0 });
    h.workspace.end({ x: 18, z: 0 });
    expect(h.map().buildings?.[0].baseY).toBe(37.05);
    expect(h.map().placements.every((p) => p.groundY === 37.05 && p.detached)).toBe(true);
    expect(h.viewport.setBuildingPlane).toHaveBeenLastCalledWith(37.05);
  });

  it('applies foundation clearance equally to the grid, wall bases, floor top and walkable deck', () => {
    const h = harness();
    h.panel.setMode('room');
    h.workspace.hover({ x: 0, z: 0 });
    expect(h.viewport.setCityGridOverlay).toHaveBeenLastCalledWith({ x: 0, z: 0 }, 1, 36.05);
    h.draw(4, 3);
    expect(h.map().buildings?.[0].baseY).toBe(36.05);
    expect(h.viewport.setBuildingPlane).toHaveBeenLastCalledWith(36.05);
    expect(h.viewport.setCityGridOverlay.mock.lastCall?.[2]).toBe(36.05);
    const floor = h.map().placements.find((p) => p.building?.kind === 'floor');
    const floorMeshTop = Math.max(
      ...(floor?.meshes?.[0].verts.filter((_, i) => i % 3 === 1) ?? []),
    );
    expect(floor?.groundY).toBe(36.05);
    expect(floorMeshTop).toBe(0);
    expect(floor?.ramps?.[0].y0).toBe(0);
    expect(floor?.ramps?.[0].y1).toBe(0);
    for (const wall of h.map().placements.filter((p) => p.building?.kind === 'wall')) {
      expect(wall.groundY).toBe(floor?.groundY);
      const hitbox = wall.hitboxes?.[0];
      expect((hitbox?.y ?? NaN) - (hitbox?.hy ?? NaN)).toBe(0);
    }
  });

  it('preserves an explicitly chosen foundation without adding automatic clearance', () => {
    const h = harness();
    h.panel.setBaseY(20);
    h.panel.setMode('room');
    h.workspace.hover({ x: 0, z: 0 });
    expect(h.viewport.setCityGridOverlay).toHaveBeenLastCalledWith({ x: 0, z: 0 }, 1, 20);
    h.draw(4, 3);
    expect(h.map().buildings?.[0].baseY).toBe(20);
    expect(h.map().placements.every((p) => p.groundY === 20)).toBe(true);
  });

  it('previews object foundation clearance before the first placement', async () => {
    const h = harness();
    h.panel.setMode('object');
    await h.workspace.pickAsset('props/crate', 'Crate');
    h.workspace.hover({ x: 10, z: 0 });
    expect(h.viewport.updateCityGhost).toHaveBeenLastCalledWith(10, 0, 0, 3, false, 37.05);
    h.workspace.begin({ x: 10, z: 0 });
    expect(h.map().placements[0].groundY).toBe(37.05);
  });

  it('adds an adjacent room without duplicate shared walls and undoes only its new pieces', () => {
    const h = harness();
    h.panel.setMode('room');
    h.draw(4, 3);
    const shared = h.map().placements.filter((p) => p.x === 4 && p.building?.kind === 'wall');
    for (const p of shared) {
      p.wallFinishes = { front: { texture: 'Stone01' }, back: { texture: 'Plaster01' } };
    }
    const firstRoom = structuredClone(h.map().placements);
    const buildings = structuredClone(h.map().buildings);
    h.workspace.begin({ x: 4, z: 0 });
    h.workspace.end({ x: 8, z: 3 });
    expect(h.map().placements).toHaveLength(27);
    expect(h.stack.depth).toBe(2);
    expect(h.map().placements.filter((p) => p.x === 4 && p.building?.kind === 'wall')).toEqual(
      shared,
    );
    expect(h.stack.undo()?.label).toBe('building-gesture');
    expect(h.map().placements).toEqual(firstRoom);
    expect(h.map().buildings).toEqual(buildings);
    expect(h.map().placements).toEqual(expect.arrayContaining(shared));
    h.stack.redo();
    expect(h.map().placements).toHaveLength(27);
    expect(h.map().placements.slice(0, firstRoom.length)).toEqual(firstRoom);
  });

  it('redrawing the same wall produces no empty undo command or duplicate metadata', () => {
    const h = harness();
    h.draw();
    const before = structuredClone(h.map());
    h.draw();
    h.workspace.begin({ x: 4, z: 0 });
    h.workspace.end({ x: 0, z: 0 });
    expect(h.map()).toEqual(before);
    expect(h.stack.depth).toBe(1);
    expect(h.deps.execute).toHaveBeenCalledOnce();
    expect(h.deps.error).not.toHaveBeenCalled();
    h.stack.undo();
    expect(h.map().placements).toEqual([]);
  });

  it('cancels a preview without committing and clears it when leaving build mode', () => {
    const h = harness();
    h.workspace.begin({ x: 0, z: 0 });
    h.workspace.hover({ x: 8, z: 0 });
    h.workspace.cancel();
    h.workspace.end({ x: 8, z: 0 });
    expect(h.stack.depth).toBe(0);
    expect(h.map().placements).toEqual([]);
    expect(h.map().buildings).toBeUndefined();
    expect(h.viewport.setBuildingPreview).toHaveBeenLastCalledWith([]);
    h.workspace.begin({ x: 0, z: 0 });
    h.workspace.hover({ x: 8, z: 0 });
    h.workspace.setActive(false);
    h.workspace.end({ x: 8, z: 0 });
    expect(h.stack.depth).toBe(0);
    expect(h.viewport.setBuildingPlane).toHaveBeenLastCalledWith(null);
    expect(h.viewport.setCityGridOverlay).toHaveBeenLastCalledWith(null, 0);
  });

  it('switching drawing modes cancels the in-progress gesture', () => {
    const h = harness();
    h.workspace.begin({ x: 0, z: 0 });
    h.workspace.hover({ x: 8, z: 0 });
    h.panel.setMode('floor');
    h.workspace.end({ x: 8, z: 4 });
    expect(h.stack.depth).toBe(0);
    expect(h.map().placements).toEqual([]);
  });

  it('rejects over-capacity gestures atomically and rechecks capacity at commit time', () => {
    const h = harness();
    h.draw(257);
    expect(h.deps.error).toHaveBeenLastCalledWith('editor.buildMode.capacity');
    expect(h.map().placements).toEqual([]);
    expect(h.stack.depth).toBe(0);
    h.workspace.begin({ x: 0, z: 0 });
    h.workspace.hover({ x: 4, z: 0 });
    h.map().placements = Array.from({ length: MAX_PLACEMENTS - 3 }, () => existingPlacement());
    h.workspace.end();
    expect(h.map().placements).toHaveLength(MAX_PLACEMENTS - 3);
    expect(h.map().buildings).toBeUndefined();
    expect(h.stack.depth).toBe(0);
  });

  it('refuses a new building at the metadata cap without adding any geometry', () => {
    const buildings = Array.from({ length: MAX_BUILDINGS }, (_, i) => ({
      id: `building_${i + 1}`,
      baseY: 36,
      floorHeight: 6,
      levels: 1,
    }));
    const h = harness({ buildings });
    h.panel.newBuilding();
    h.draw();
    expect(h.deps.error).toHaveBeenLastCalledWith('editor.buildMode.capacity');
    expect(h.map().placements).toEqual([]);
    expect(h.map().buildings).toEqual(buildings);
    expect(h.stack.depth).toBe(0);
  });
});

describe('building workspace floors and assets', () => {
  it.each(['floor', 'building', 'new', 'add', 'hide', 'show'] as const)(
    'clears object selection when changing the active building context: %s',
    (action) => {
      const h = harness({
        buildings: [
          { id: 'castle', baseY: 36, floorHeight: 6, levels: 2 },
          { id: 'tower', baseY: 36, floorHeight: 4, levels: 2 },
        ],
      });
      vi.mocked(h.deps.clearSelection).mockClear();
      if (action === 'floor') h.panel.selectLevel(1);
      else if (action === 'building') h.panel.selectBuilding('tower');
      else if (action === 'new') h.panel.newBuilding();
      else if (action === 'add') h.panel.addLevel();
      else h.panel.setHideAbove(action === 'hide');
      expect(h.deps.clearSelection).toHaveBeenCalledOnce();
    },
  );

  it('adds an undoable level, selects its plane and draws its floor there', () => {
    const h = harness();
    h.draw();
    h.panel.addLevel();
    expect(h.stack.depth).toBe(2);
    expect(h.panel.getState()).toMatchObject({ level: 1, levels: 2 });
    expect(h.viewport.setBuildingPlane).toHaveBeenLastCalledWith(42.65);
    expect(h.stack.undo()?.label).toBe('building-level');
    expect(h.map().buildings?.[0].levels).toBe(1);
    expect(h.panel.getState()).toMatchObject({ level: 0, levels: 1 });
    h.stack.redo();
    h.panel.selectLevel(1);
    h.panel.setMode('floor');
    h.draw(4, 3);
    expect(h.map().placements.at(-1)).toMatchObject({
      groundY: 42.65,
      building: { id: 'building_1', level: 1, kind: 'floor' },
    });
    h.panel.selectLevel(0);
    h.panel.setHideAbove(false);
    expect(h.viewport.setBuildingFloorFilter).toHaveBeenLastCalledWith('building_1', 0, false);
  });

  it('keeps New Building selected when a subsequent mode switch re-arms the tool', () => {
    const h = harness();
    h.draw();
    h.panel.newBuilding();
    h.panel.setFloorHeight(4);
    h.panel.setMode('room');
    h.workspace.begin({ x: 50, z: 0 });
    h.workspace.end({ x: 54, z: 3 });
    expect(h.map().buildings).toEqual([
      { id: 'building_1', baseY: 36.05, floorHeight: 6.6, levels: 1 },
      { id: 'building_2', baseY: 41.05, floorHeight: 4, levels: 1 },
    ]);
    expect(h.panel.getState().activeBuildingId).toBe('building_2');
  });

  it('locks an existing foundation and caps additional levels at sixteen', () => {
    const h = harness({ buildings: [{ id: 'castle', baseY: 36, floorHeight: 6, levels: 15 }] });
    h.panel.setFloorHeight(10);
    h.panel.setBaseY(80);
    expect(h.panel.getState()).toMatchObject({ floorHeight: 6, baseY: 36, foundationLocked: true });
    h.panel.addLevel();
    h.panel.addLevel();
    expect(h.map().buildings?.[0].levels).toBe(16);
    expect(h.stack.depth).toBe(1);
  });

  it('measures selected wall assets by their resolved path and fits their preview before committing', async () => {
    const h = harness();
    await h.workspace.pickAsset('tidehold_parts/castle_wall', 'Castle wall');
    expect(h.viewport.cityAssetFootprint).toHaveBeenCalledWith(
      '/models/tidehold_parts/castle_wall.glb',
    );
    expect(h.deps.clearSelection).toHaveBeenCalled();
    h.workspace.setTransform({ scale: 2, rotY: Math.PI });
    h.draw(8);
    expect(h.map().placements).toHaveLength(2);
    expect(h.map().placements.every((p) => p.assetId === 'tidehold_parts/castle_wall')).toBe(true);
    expect(h.map().placements[0]).toMatchObject({ scale: 2, scaleY: 1.65, rotY: Math.PI });
  });

  it('does not create a bare wall while a chosen asset footprint is unavailable', async () => {
    const h = harness();
    h.viewport.cityAssetFootprint.mockResolvedValueOnce({ sizeX: 2, sizeY: 0, sizeZ: 0.2 });
    await h.workspace.pickAsset('tidehold_parts/castle_wall', 'Castle wall');
    h.draw();
    expect(h.deps.error).toHaveBeenLastCalledWith('editor.buildMode.chooseWall');
    expect(h.map().placements).toEqual([]);
    expect(h.stack.depth).toBe(0);
  });

  it('places and previews an object using cursor transforms on the selected floor', async () => {
    const h = harness({ buildings: [{ id: 'castle', baseY: 36, floorHeight: 6, levels: 3 }] });
    h.panel.setMode('object');
    h.panel.selectLevel(2);
    await h.workspace.pickAsset('props/crate', 'Crate');
    h.workspace.setTransform({ scale: 4, rotY: Math.PI / 2 });
    h.workspace.hover({ x: 3.3, z: 2.8 });
    expect(h.viewport.updateCityGhost).toHaveBeenLastCalledWith(3, 3, Math.PI / 2, 4, false, 48);
    h.workspace.begin({ x: 3.3, z: 2.8 });
    expect(h.map().placements).toHaveLength(1);
    expect(h.map().placements[0]).toMatchObject({
      x: 3,
      z: 3,
      scale: 4,
      rotY: Math.PI / 2,
      groundY: 48,
      building: { id: 'castle', level: 2, kind: 'object' },
    });
    expect(h.stack.depth).toBe(1);
  });
});

describe('building workspace wall finishes', () => {
  it('paints a legacy City Build wall run without building metadata and leaves other objects alone', () => {
    const placements = [
      existingPlacement({
        assetId: 'castle/wall_01',
        cityId: 'legacy_run',
        wallFinishes: { front: { color: 0x123456 } },
      }),
      existingPlacement({ assetId: 'castle/wall_02', cityId: 'legacy_run', x: 1 }),
      existingPlacement({ assetId: 'castle/floor_01', cityId: 'legacy_run' }),
      existingPlacement({ assetId: 'castle/wall_01', cityId: 'other_run' }),
      existingPlacement({
        assetId: 'castle/wall_decoration',
        cityId: 'legacy_run',
        building: { id: 'castle', kind: 'object', level: 0 },
      }),
    ];
    const h = harness({ placements });
    const before = structuredClone(placements);
    h.panel.setMode('finish');
    h.panel.setFinishTexture('Stone01');
    h.panel.setFinishSide('both');
    h.panel.setFinishRun(true);
    h.viewport.pickBuildingSurface.mockReturnValue({ index: 0, side: 'front' });
    h.workspace.begin({ x: 0, z: 0 }, { clientX: 10, clientY: 20 });
    expect(h.stack.depth).toBe(1);
    for (const p of placements.slice(0, 2)) {
      expect(p.wallFinishes).toEqual({
        front: { texture: 'Stone01', tileSize: 3 },
        back: { texture: 'Stone01', tileSize: 3 },
      });
      expect(p.building).toBeUndefined();
    }
    for (const p of placements.slice(2)) expect(p.wallFinishes).toBeUndefined();
    h.stack.undo();
    expect(placements).toEqual(before);
    expect(h.deps.error).not.toHaveBeenCalled();
  });

  it('paints both faces across one wall run and undoes them together without touching floors or neighbors', () => {
    const h = harness();
    h.panel.setMode('room');
    h.draw(4, 3);
    h.panel.setMode('wall');
    h.workspace.begin({ x: 20, z: 0 });
    h.workspace.end({ x: 24, z: 0 });
    const roomRun = h.map().placements[0].cityId;
    const first = h.map().placements[0];
    first.wallFinishes = { front: { color: 0x123456 }, back: { texture: 'OldStone', tileSize: 2 } };
    h.panel.setMode('finish');
    h.panel.setFinishTexture('Stone01');
    h.panel.setFinishTile(4);
    h.panel.setFinishSide('both');
    h.panel.setFinishRun(true);
    h.viewport.pickBuildingSurface.mockReturnValue({ index: 0, side: 'back' });
    const before = structuredClone(h.map().placements);
    h.workspace.begin({ x: 0, z: 0 }, { clientX: 40, clientY: 50 });
    expect(h.stack.depth).toBe(3);
    for (const p of h.map().placements) {
      if (p.cityId === roomRun && p.building?.kind === 'wall') {
        expect(p.wallFinishes).toEqual({
          front: { texture: 'Stone01', tileSize: 4 },
          back: { texture: 'Stone01', tileSize: 4 },
        });
      } else expect(p.wallFinishes).toBeUndefined();
    }
    expect(h.stack.undo()?.label).toBe('building-finish');
    expect(h.map().placements).toEqual(before);
    h.stack.redo();
    expect(first.wallFinishes?.back?.texture).toBe('Stone01');
    expect(first.wallFinishes).not.toBe(h.map().placements[1].wallFinishes);
    expect(first.wallFinishes?.front).not.toBe(first.wallFinishes?.back);
  });

  it('uses the clicked face, preserves the opposite finish and supports removing one side', () => {
    const h = harness();
    h.draw();
    const first = h.map().placements[0];
    first.wallFinishes = { front: { texture: 'Stone01' } };
    h.panel.setMode('finish');
    h.panel.setFinishTexture('Plaster01');
    h.viewport.pickBuildingSurface.mockReturnValue({ index: 0, side: 'back' });
    h.workspace.begin({ x: 0, z: 0 }, { clientX: 1, clientY: 2 });
    expect(first.wallFinishes).toEqual({
      front: { texture: 'Stone01' },
      back: { texture: 'Plaster01', tileSize: 3 },
    });
    h.panel.setFinishTexture('');
    h.workspace.begin({ x: 0, z: 0 }, { clientX: 1, clientY: 2 });
    expect(first.wallFinishes).toEqual({ front: { texture: 'Stone01' } });
    h.stack.undo();
    expect(first.wallFinishes?.back?.texture).toBe('Plaster01');
  });

  it('refuses misses and non-wall surfaces without adding undo entries', () => {
    const h = harness({ placements: [existingPlacement()] });
    h.panel.setMode('finish');
    h.workspace.begin({ x: 0, z: 0 }, { clientX: 1, clientY: 2 });
    h.viewport.pickBuildingSurface.mockReturnValue({ index: 0, side: 'front' });
    h.workspace.begin({ x: 0, z: 0 }, { clientX: 1, clientY: 2 });
    expect(h.deps.error).toHaveBeenLastCalledWith('editor.buildMode.choosePaintWall');
    expect(h.stack.depth).toBe(0);
    expect(h.map().placements[0].wallFinishes).toBeUndefined();
  });
});

describe('building workspace map reset', () => {
  it('cancels the previous map gesture and selects the new map foundation at its first floor', () => {
    const h = harness({ buildings: [{ id: 'old', baseY: 36, floorHeight: 6, levels: 3 }] });
    h.panel.selectLevel(2);
    h.workspace.begin({ x: 0, z: 0 });
    h.workspace.hover({ x: 8, z: 0 });
    h.replaceMap({ buildings: [{ id: 'new', baseY: 80, floorHeight: 4, levels: 2 }] });
    h.workspace.reset();
    h.workspace.end({ x: 8, z: 0 });
    expect(h.map().placements).toEqual([]);
    expect(h.stack.depth).toBe(0);
    expect(h.panel.getState()).toMatchObject({
      activeBuildingId: 'new',
      level: 0,
      baseY: 80,
      floorHeight: 4,
      levels: 2,
    });
    expect(h.viewport.setBuildingPlane).toHaveBeenLastCalledWith(80);
    expect(h.viewport.setBuildingFloorFilter).toHaveBeenLastCalledWith('new', 0, true);
  });

  it('ignores an image import that completes after loading another map', async () => {
    const h = harness();
    let resolveImport: ((value: Awaited<ReturnType<typeof importWallTexture>>) => void) | undefined;
    vi.mocked(importWallTexture).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveImport = resolve;
        }),
    );
    const pending = h.workspace.importTexture({ name: 'stone.png' } as File);
    expect(h.panel.getState().importing).toBe(true);
    h.replaceMap({});
    h.workspace.reset();
    expect(h.panel.getState().importing).toBe(false);
    resolveImport?.({
      name: 'Stone',
      sha256: 'a'.repeat(64),
      width: 16,
      height: 16,
      mimeType: 'image/webp',
    });
    await pending;
    expect(h.panel.getState().finishTexture).toBe('');
    expect(
      h.panel.getState().textureOptions.some((option) => option.value.startsWith('custom:')),
    ).toBe(false);
    expect(h.deps.error).not.toHaveBeenCalled();
  });
});
