import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Exercise the real viewport methods without starting a Sim, GL context, asset
// preloads, or DOM surfaces. Geometry, projection and camera-ray math stay real.
vi.mock('../src/render/renderer', () => ({ Renderer: class {} }));
vi.mock('../src/render/characters', () => ({ setModularLookProvider: vi.fn() }));
vi.mock('../src/render/characters/npc_look_provider', () => ({ npcEntityLookFor: vi.fn() }));
vi.mock('../src/render/foliage', () => ({
  setFoliageBounds: vi.fn(),
  setFoliageFarPlacements: vi.fn(),
}));
vi.mock('../src/render/placed_assets', () => ({ unionRegion: vi.fn() }));
vi.mock('../src/render/ground_tex_gc', () => ({ gcGroundTextureSets: vi.fn() }));
vi.mock('../src/sim/sim', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Sim: class {},
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
    rebuildFluids: vi.fn(),
    setRaycasterFromCamera: vi.fn((raycaster: THREE.Raycaster, point: THREE.Vector2) => {
      raycaster.set(
        new THREE.Vector3(0, 10, 0),
        new THREE.Vector3(point.x, -1, point.y).normalize(),
      );
    }),
  };
  // This repo's renderer keeps its editor hooks on `renderer.editor`.
  Object.assign(renderer, { editor: renderer });
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
    hooks: { placementDragEnabled: () => true },
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

describe('precise placement picking through the actual viewport', () => {
  it('does not grab a large nearby asset when its visible mesh is missed', () => {
    const { viewport, placedAssets } = harness([placement()]);
    placedAssets.pickCandidates.mockReturnValue([{ index: 0, distance: 2, direct: false }]);
    expect(viewport.pickPlacement(40, 40)).toBeNull();
  });

  it('cycles stationary released clicks while pointerdown keeps the chosen drag target', () => {
    const { viewport, placedAssets } = harness([placement(), placement()]);
    placedAssets.pickCandidates.mockReturnValue([
      { index: 0, distance: 4, direct: true },
      { index: 1, distance: 6, direct: true },
    ]);
    expect(viewport.pickPlacementCycling(40, 40)).toBe(0);
    expect(viewport.pickPlacement(40, 40)).toBe(0);
    expect(viewport.pickPlacementCycling(40, 40)).toBe(1);
    expect(viewport.pickPlacement(40, 40)).toBe(1);
    expect(viewport.pickPlacementCycling(40, 40)).toBe(0);
    expect(viewport.pickPlacementCycling(70, 40)).toBe(0);
  });

  it('uses an explicit overlap choice for the next drag and invalidates it after structural changes', () => {
    const { viewport, state, placedAssets } = harness([placement(), placement()]);
    const choose = vi.fn();
    Object.assign(state, {
      hooks: { placementDragEnabled: () => true, onBoxSelect: choose },
      pickPoint: { x: 40, y: 40 },
      pickFeedbackGeneration: 0,
    });
    Object.assign(state.canvas, { focus: vi.fn() });
    placedAssets.pickCandidates.mockReturnValue([
      { index: 0, distance: 4, direct: true },
      { index: 1, distance: 6, direct: true },
    ]);
    const chooser = viewport as unknown as {
      choosePlacementOverlap(index: number, additive: boolean): void;
    };
    chooser.choosePlacementOverlap(1, true);
    expect(choose).toHaveBeenCalledWith([1], true);
    expect(viewport.pickPlacement(40, 40)).toBe(1);
    viewport.resetTapCycle();
    expect(viewport.pickPlacement(40, 40)).toBe(0);
  });

  it('does not reuse a hit across neighbouring pixels or include hidden objects', () => {
    const { viewport, placedAssets } = harness([placement(), placement({ hidden: true })]);
    placedAssets.pickCandidates.mockReturnValue([{ index: 0, distance: 4, direct: true }]);
    expect(viewport.pickPlacement(40, 40)).toBe(0);
    placedAssets.pickCandidates.mockReturnValue([{ index: 1, distance: 4, direct: true }]);
    expect(viewport.pickPlacement(41, 40)).toBeNull();
  });
  it('selects a higher-floor object at its rendered ray depth and respects explicit floor isolation', () => {
    const { viewport, state, placedAssets } = harness([
      placement({ building: { id: 'keep', level: 0, kind: 'wall' } }),
      placement({
        detached: true,
        groundY: 20,
        building: { id: 'keep', level: 2, kind: 'object' },
      }),
    ]);
    placedAssets.pickCandidates.mockReturnValue([
      { index: 1, distance: 2, direct: true },
      { index: 0, distance: 20, direct: true },
    ]);
    expect(viewport.pickPlacement(40, 40)).toBe(1);
    state.buildingFloorFilter = { id: 'keep', level: 1, hideAbove: true };
    viewport.resetTapCycle();
    expect(viewport.pickPlacement(40, 40)).toBe(0);
    state.buildingFloorFilter.hideAbove = false;
    viewport.resetTapCycle();
    expect(viewport.pickPlacement(40, 40)).toBe(1);
  });

  it('places additional selection rings at each member elevation instead of the terrain below', () => {
    const { viewport, renderer } = harness([
      placement({ x: 2, z: 4, detached: true, groundY: 20, y: 2, scale: 2 }),
      placement({ x: 8, z: 12, y: 3 }),
    ]);
    viewport.setMultiSelection([0, 1]);
    const group = renderer.scene.getObjectByName('editor-multi-selection')!;
    expect(group.children).toHaveLength(2);
    expect(group.children[0].position.x).toBe(2);
    expect(group.children[0].position.y).toBeCloseTo(22.12);
    expect(group.children[0].position.z).toBe(4);
    expect(group.children[1].position.toArray()).toEqual([8, 10.12, 12]);
    const mesh = group.children[0] as THREE.Mesh;
    mesh.geometry.computeBoundingBox();
    expect(mesh.geometry.boundingBox!.min.y).toBeCloseTo(0);
    expect(mesh.geometry.boundingBox!.max.y).toBeCloseTo(0);
    const geometryDisposed = vi.fn();
    mesh.geometry.addEventListener('dispose', geometryDisposed);
    viewport.setMultiSelection([]);
    expect(geometryDisposed).toHaveBeenCalledTimes(1);
    expect(renderer.scene.getObjectByName('editor-multi-selection')).toBeUndefined();
  });
});
