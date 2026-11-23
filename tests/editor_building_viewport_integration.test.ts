import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Exercise the real viewport methods without starting a Sim, GL context, asset
// preloads, or DOM surfaces. Geometry, projection and camera-ray math stay real.
vi.mock('../src/render/renderer', () => ({ Renderer: class {} }));
vi.mock('../src/render/characters', () => ({ setModularLookProvider: vi.fn() }));
vi.mock('../src/render/characters/npc_look_provider', () => ({ npcEntityLookFor: vi.fn() }));
vi.mock('../src/render/foliage_editor_scope', () => ({
  setFoliageBounds: vi.fn(),
  setFoliageFarPlacements: vi.fn(),
}));
vi.mock('../src/render/placed_assets', () => ({ unionRegion: vi.fn() }));
vi.mock('../src/render/ground_tex_gc', () => ({ gcGroundTextureSets: vi.fn() }));
// The stub keeps the real delve-module name table: the viewport's import graph reaches
// `src/ui/sim_i18n.ts`, which builds its reverse map from `DELVE_MODULE_NAMES` (re-exported
// by `sim/sim` from `sim/delves/runs`) at module load.
vi.mock('../src/sim/sim', async () => ({
  Sim: class {},
  DELVE_MODULE_NAMES: (await import('../src/sim/delves/runs')).DELVE_MODULE_NAMES,
}));

import { Editor3DViewport } from '../src/editor/3d/viewport';
import { newFlatCustomMap } from '../src/editor/custom_map';
import { type MapPlacement, MODEL_ASSET_ID } from '../src/sim/map_doc';
import type { PlacedAsset } from '../src/sim/types';
import * as world from '../src/sim/world';

const placement = (overrides: Partial<MapPlacement> = {}): MapPlacement => ({
  assetId: MODEL_ASSET_ID,
  x: 0,
  z: 0,
  scale: 1,
  rotY: 0,
  collide: false,
  ...overrides,
});

function harness(placements: MapPlacement[] = []) {
  const map = newFlatCustomMap('Viewport fixture', 'viewport-fixture', 42);
  map.placements = placements;
  const placedAssets = {
    setAssetCollision: vi.fn(),
    rebuildAll: vi.fn<(_assets: (PlacedAsset | null)[]) => void>(),
    setSelected: vi.fn(),
    addPlacement: vi.fn(),
    updatePlacement: vi.fn(),
    removePlacement: vi.fn(),
    removePlacementAt: vi.fn(),
    pickCandidates: vi.fn<() => { index: number; distance: number; direct: boolean }[]>(() => []),
  };
  const renderer = {
    scene: new THREE.Scene(),
    placedAssets,
    // the editor hooks live on the renderer's editor facade (renderer.editor)
    editor: {
      rebuildFluids: vi.fn(),
      setRaycasterFromCamera: vi.fn((raycaster: THREE.Raycaster, point: THREE.Vector2) => {
        raycaster.set(
          new THREE.Vector3(0, 10, 0),
          new THREE.Vector3(point.x, -1, point.y).normalize(),
        );
      }),
    },
  };
  const state = {
    map,
    renderer,
    seed: 42,
    visible: true,
    previewMode: false,
    studio: false,
    isolateRect: null,
    buildingFloorFilter: { id: null as string | null, level: 0, hideAbove: false },
    buildingFilteredIndices: new Set<number>(),
    buildingPlane: null as THREE.Plane | null,
    selectedIndex: null as number | null,
    multiSelIndices: [] as number[],
    multiSelGroup: null,
    collidersGroup: null as THREE.Group | null,
    colliderMeshes: new Map<number, THREE.Mesh>(),
    collidersUserHidden: false,
    cityGridGroup: null as THREE.Group | null,
    cityGridKey: '',
    tapCycle: null,
    placementPickCache: null,
    orthographic: false,
    picker: new THREE.Raycaster(),
    pickNdc: new THREE.Vector2(),
    planeHitV: new THREE.Vector3(),
    canvas: { getBoundingClientRect: () => ({ left: 10, top: 20, width: 100, height: 100 }) },
    marchSurface: vi.fn(() => ({ x: 99, z: -99 })),
  };
  Object.setPrototypeOf(state, Editor3DViewport.prototype);
  return { viewport: state as unknown as Editor3DViewport, state, map, placedAssets, renderer };
}

beforeEach(() => vi.spyOn(world, 'terrainHeight').mockReturnValue(7));
afterEach(() => vi.restoreAllMocks());

describe('building workspace through the real viewport methods', () => {
  it('rebuilds index-aligned visible slots, clears hidden selection, and restores all floors without editing the map', () => {
    const fixtures = [
      placement({ building: { id: 'castle', level: 0, kind: 'wall' } }),
      placement({ building: { id: 'castle', level: 2, kind: 'floor' } }),
      placement({ building: { id: 'tower', level: 3, kind: 'wall' } }),
      placement(),
      placement({ hidden: true }),
    ];
    const before = structuredClone(fixtures);
    const { viewport, state, placedAssets, map } = harness(fixtures);
    state.selectedIndex = 1;
    viewport.setBuildingFloorFilter('castle', 0, true);
    const first = placedAssets.rebuildAll.mock.calls[0][0];
    expect(first).toHaveLength(5);
    expect(first.map((asset) => asset === null)).toEqual([false, true, false, false, true]);
    expect(first[2]?.building?.id).toBe('tower');
    expect(state.selectedIndex).toBeNull();
    expect(placedAssets.setSelected).toHaveBeenLastCalledWith(null);
    expect(map.placements).toEqual(before);

    viewport.setBuildingFloorFilter('castle', 0, true);
    expect(placedAssets.rebuildAll).toHaveBeenCalledTimes(1);
    viewport.setBuildingFloorFilter('castle', 0, false);
    expect(placedAssets.rebuildAll.mock.calls[1][0].map((asset) => asset === null)).toEqual([
      false,
      false,
      false,
      false,
      true,
    ]);
    viewport.setBuildingFloorFilter(null, 0, true);
    expect(placedAssets.rebuildAll.mock.calls[2][0][1]?.building?.level).toBe(2);
    expect(map.placements).toEqual(before);
  });

  it('excludes hidden-floor candidates even if a stale renderer pick returns them', () => {
    const { viewport, placedAssets } = harness([
      placement({ building: { id: 'castle', level: 2, kind: 'wall' } }),
      placement({ building: { id: 'castle', level: 0, kind: 'wall' } }),
    ]);
    viewport.setBuildingFloorFilter('castle', 0, true);
    placedAssets.pickCandidates.mockReturnValue([
      { index: 0, distance: 1, direct: true },
      { index: 1, distance: 2, direct: true },
    ]);
    expect(viewport.pickPlacement(60, 70)).toBe(1);
    expect(viewport.pickBuildingSurface(60, 70)).toBeNull();
    viewport.setSelectedPlacement(0);
    expect(placedAssets.setSelected).toHaveBeenLastCalledWith(null);

    viewport.setBuildingFloorFilter('castle', 2, true);
    expect(viewport.pickPlacement(60, 70)).toBe(0);
    expect(viewport.pickBuildingSurface(60, 70)?.index).toBe(0);
    placedAssets.pickCandidates.mockReturnValue([{ index: 1, distance: 2, direct: false }]);
    expect(viewport.pickBuildingSurface(60, 70)).toBeNull();
  });

  it('keeps added and updated hidden pieces absent and restores membership moved to the active level', () => {
    const { viewport, map, placedAssets } = harness([
      placement({ building: { id: 'castle', level: 1, kind: 'wall' } }),
    ]);
    viewport.setBuildingFloorFilter('castle', 0, true);
    viewport.placementAdded(0);
    viewport.placementUpdated(0, { x: 4 });
    expect(placedAssets.addPlacement).not.toHaveBeenCalled();
    expect(placedAssets.updatePlacement).not.toHaveBeenCalled();
    expect(placedAssets.removePlacement).toHaveBeenCalledWith(0);
    map.placements[0].building = { id: 'castle', level: 0, kind: 'wall' };
    viewport.placementUpdated(0, { x: 4 });
    expect(placedAssets.addPlacement).toHaveBeenCalledWith(
      0,
      expect.objectContaining({
        building: { id: 'castle', level: 0, kind: 'wall' },
      }),
    );
    viewport.placementUpdated(0, { x: 5 });
    expect(placedAssets.updatePlacement).toHaveBeenCalledWith(0, { x: 5 });
  });

  it('intersects the selected building plane instead of terrain and does not fall through on a missed plane', () => {
    const { viewport, state, renderer } = harness();
    viewport.setBuildingPlane(4);
    expect(viewport.surfaceAt(85, 45)).toEqual({ x: 3, z: 3 });
    viewport.setBuildingPlane(8);
    expect(viewport.surfaceAt(85, 45)).toEqual({ x: 1, z: 1 });
    expect(state.marchSurface).not.toHaveBeenCalled();
    renderer.editor.setRaycasterFromCamera.mockImplementation((raycaster) => {
      raycaster.set(new THREE.Vector3(0, 10, 0), new THREE.Vector3(1, 0, 0));
    });
    expect(viewport.surfaceAt(85, 45)).toBeNull();
    expect(state.marchSurface).not.toHaveBeenCalled();
    viewport.setBuildingPlane(null);
    expect(viewport.surfaceAt(85, 45)).toEqual({ x: 99, z: -99 });
    expect(state.marchSurface).toHaveBeenCalledTimes(1);
  });

  it('draws grids at the selected floor height, invalidates the height cache, and disposes replaced lines', () => {
    const { viewport, state, renderer } = harness();
    const gridRoot = () => {
      if (!state.cityGridGroup) throw new Error('Expected a building grid');
      return state.cityGridGroup;
    };
    const gridHeights = () =>
      gridRoot().children.flatMap((child) => {
        const position = (child as THREE.LineSegments).geometry.getAttribute('position');
        return Array.from({ length: position.count }, (_, i) => position.getY(i));
      });
    viewport.setCityGridOverlay({ x: 0, z: 0 }, 2, 12);
    const first = gridRoot();
    expect(gridHeights().length).toBeGreaterThan(0);
    for (const height of gridHeights()) expect(height).toBeCloseTo(12.22);
    viewport.setCityGridOverlay({ x: 0, z: 0 }, 2, 12);
    expect(state.cityGridGroup).toBe(first);
    const disposed = vi.fn();
    const firstLine = first.children[0] as THREE.LineSegments;
    firstLine.geometry.addEventListener('dispose', disposed);
    viewport.setCityGridOverlay({ x: 0, z: 0 }, 2, 18);
    expect(state.cityGridGroup).not.toBe(first);
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(renderer.scene.children).not.toContain(first);
    for (const height of gridHeights()) expect(height).toBeCloseTo(18.22);
    viewport.setCityGridOverlay({ x: 0, z: 0 }, 2, 0);
    for (const height of gridHeights()) expect(height).toBeCloseTo(0.22);
    viewport.setCityGridOverlay({ x: 0, z: 0 }, 2);
    for (const height of gridHeights()) expect(height).toBeCloseTo(7.22);
    viewport.setCityGridOverlay(null, 2);
    expect(state.cityGridGroup).toBeNull();
    expect(renderer.scene.children).toHaveLength(0);
  });
});
