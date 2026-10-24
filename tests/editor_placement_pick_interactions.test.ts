// @vitest-environment happy-dom
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

import { type Editor3DHooks, Editor3DViewport } from '../src/editor/3d/viewport';
import { newFlatCustomMap } from '../src/editor/custom_map';
import { type MapPlacement, MODEL_ASSET_ID } from '../src/sim/map_doc';
import * as world from '../src/sim/world';

const place = (assetId = MODEL_ASSET_ID): MapPlacement => ({
  assetId,
  x: 0,
  z: 0,
  rotY: 0,
  scale: 1,
  collide: false,
});

function setup() {
  const map = newFlatCustomMap('Picking', 'picking', 42);
  map.placements = [place(), place()];
  const hooks = {
    toolActive: () => false,
    shiftEditsTool: () => false,
    placementDragEnabled: () => true,
    placementPickingEnabled: undefined as undefined | (() => boolean),
    placementDragUsesCursor: undefined as undefined | (() => boolean),
    onChoosePlacement: undefined as undefined | ((index: number, additive: boolean) => void),
    placementLabel: (index: number) => `Piece ${index}`,
    onBoxSelect: vi.fn(),
    onPlacementDragStart: vi.fn(() => true),
    onPlacementDragMove: vi.fn(),
    onPlacementDragEnd: vi.fn(),
    onHover: vi.fn(),
    onTap: vi.fn(),
    onRightTap: vi.fn(),
  };
  const parent = document.createElement('div');
  document.body.append(parent);
  const viewport = new Editor3DViewport(parent, map, hooks as unknown as Editor3DHooks);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 3, 20);
  camera.lookAt(0, 3, 0);
  camera.updateMatrixWorld(true);
  const renderer = {
    camera,
    scene: new THREE.Scene(),
    pick: () => null,
    setEditorOrthographic: vi.fn(),
    prepareZoneAt: vi.fn(async () => {}),
    rebuildFluids: vi.fn(),
    shutdown: vi.fn(async () => ({ context: { getExtension: () => null } })),
    placedAssets: {
      pickCandidates: vi.fn(() => [
        { index: 0, distance: 4, direct: true },
        { index: 1, distance: 8, direct: true },
      ]),
      assetPreviewTemplate: vi.fn<
        () => Promise<{ object: THREE.Object3D; norm: number; minY: number } | null>
      >(async () => null),
      removePlacementAt: vi.fn(),
      setSelected: vi.fn(),
    },
    setRaycasterFromCamera: vi.fn((raycaster: THREE.Raycaster, point: THREE.Vector2) => {
      raycaster.set(new THREE.Vector3(point.x * 10, 40, point.y * 10), new THREE.Vector3(0, -1, 0));
    }),
  };
  // This repo's renderer keeps its editor hooks on `renderer.editor`.
  Object.assign(renderer, { editor: renderer });
  const driver = viewport as unknown as {
    canvas: HTMLCanvasElement;
    pickChoice: unknown;
    pickPoint: { x: number; y: number };
    placementPickCache: unknown;
    lastHoverPickAt: number;
    choosePlacementOverlap(index: number, additive: boolean): void;
    onPointerDown(event: PointerEvent): void;
    onPointerMove(event: PointerEvent): void;
    onPointerUp(event: PointerEvent): void;
    onPointerLeave(): void;
    onContext(event: MouseEvent): void;
    updateHoverCursor(x: number, y: number): void;
    previewPlacementPick(index: number | null, front?: number): Promise<void>;
  };
  Object.assign(viewport, {
    renderer,
    visible: true,
    pickPoint: { x: 40, y: 40 },
    surfaceAt: () => ({ x: 1, z: 2 }),
  });
  driver.canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect;
  driver.canvas.setPointerCapture = vi.fn();
  return { map, viewport, driver, hooks, renderer, parent };
}

beforeEach(() => vi.spyOn(world, 'terrainHeight').mockReturnValue(0));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('asset picking gesture and feedback lifecycle', () => {
  it('drags exactly the explicitly chosen overlapping piece through the real pointer threshold path', () => {
    const { viewport, driver, hooks } = setup();
    driver.choosePlacementOverlap(1, false);
    driver.onPointerDown(new PointerEvent('pointerdown', { button: 0, clientX: 40, clientY: 40 }));
    driver.onPointerMove(new PointerEvent('pointermove', { buttons: 1, clientX: 60, clientY: 40 }));
    expect(hooks.onPlacementDragStart).toHaveBeenCalledWith(1);
    expect(hooks.onPlacementDragMove).toHaveBeenCalledTimes(1);
    expect(hooks.onPlacementDragMove.mock.calls[0][0].x).toBeCloseTo(4);
    expect(hooks.onPlacementDragMove.mock.calls[0][0].z).toBe(0);
    viewport.resetTapCycle();
  });

  it('moves a raised object relative to its press point without moving its elevation', () => {
    const { driver, hooks, map, renderer } = setup();
    renderer.setRaycasterFromCamera.mockImplementation((ray, point) => {
      ray.set(new THREE.Vector3(0, 40, 0), new THREE.Vector3(point.x, -1, point.y).normalize());
    });
    map.placements[0] = { ...place(), x: 12, z: 18, detached: true, groundY: 20, y: 2 };
    driver.onPointerDown(new PointerEvent('pointerdown', { button: 0, clientX: 40, clientY: 40 }));
    expect(hooks.onPlacementDragStart).not.toHaveBeenCalled();
    driver.onPointerMove(new PointerEvent('pointermove', { buttons: 1, clientX: 60, clientY: 40 }));
    expect(hooks.onPlacementDragMove.mock.calls.at(-1)?.[0].x).toBeCloseTo(19.2);
    expect(hooks.onPlacementDragMove.mock.calls.at(-1)?.[0].z).toBeCloseTo(18);
    expect(map.placements[0]).toMatchObject({ groundY: 20, y: 2 });
  });

  it('supplies cursor-based transforms the actual off-centre cursor on the raised plane', () => {
    const { driver, hooks, map, renderer } = setup();
    hooks.placementDragUsesCursor = () => true;
    map.placements[0] = { ...place(), x: 12, z: 18, detached: true, groundY: 20, y: 2 };
    renderer.setRaycasterFromCamera.mockImplementation((ray, point) => {
      ray.set(new THREE.Vector3(0, 40, 0), new THREE.Vector3(point.x, -1, point.y).normalize());
    });
    driver.onPointerDown(new PointerEvent('pointerdown', { button: 0, clientX: 40, clientY: 40 }));
    driver.onPointerMove(new PointerEvent('pointermove', { buttons: 1, clientX: 60, clientY: 40 }));
    const first = hooks.onPlacementDragMove.mock.calls.at(-1)?.[0];
    expect(first.x).toBeCloseTo(3.6);
    expect(first.z).toBeCloseTo(3.6);
    driver.onPointerMove(new PointerEvent('pointermove', { buttons: 1, clientX: 70, clientY: 30 }));
    const second = hooks.onPlacementDragMove.mock.calls.at(-1)?.[0];
    expect(second.x).toBeCloseTo(7.2);
    expect(second.z).toBeCloseTo(7.2);
    expect(map.placements[0]).toMatchObject({ x: 12, z: 18, groundY: 20, y: 2 });
  });

  it('advances on stationary release only, then drags the already selected overlap', () => {
    const { driver, hooks, viewport } = setup();
    hooks.onTap.mockImplementation((x: number, y: number) => {
      viewport.pickPlacementCycling(x, y);
    });
    for (const expected of [0, 1]) {
      driver.onPointerDown(
        new PointerEvent('pointerdown', { button: 0, clientX: 40, clientY: 40 }),
      );
      driver.onPointerUp(new PointerEvent('pointerup', { button: 0, clientX: 40, clientY: 40 }));
      expect(viewport.pickPlacement(40, 40)).toBe(expected);
    }
    driver.onPointerDown(new PointerEvent('pointerdown', { button: 0, clientX: 40, clientY: 40 }));
    expect(viewport.pickPlacement(40, 40)).toBe(1);
    driver.onPointerMove(new PointerEvent('pointermove', { buttons: 1, clientX: 60, clientY: 40 }));
    expect(hooks.onPlacementDragStart).toHaveBeenCalledWith(1);
  });

  it('frames a raised placement at its actual height while ordinary focus keeps terrain seating', () => {
    const { viewport } = setup();
    const camera = (viewport as unknown as { cam: { target: THREE.Vector3 } }).cam;
    viewport.focusOn(10, 12, 5, 22);
    expect(camera.target.toArray()).toEqual([10, 24, 12]);
    viewport.focusOn(10, 12, 5);
    expect(camera.target.toArray()).toEqual([10, 2, 12]);
  });

  it('opens and chooses overlapping objects while Build owns normal placement clicks', () => {
    const { driver, hooks, parent } = setup();
    const choose = vi.fn();
    hooks.placementDragEnabled = () => false;
    hooks.placementPickingEnabled = () => true;
    hooks.onChoosePlacement = choose;
    driver.onPointerDown(new PointerEvent('pointerdown', { button: 2, clientX: 40, clientY: 40 }));
    driver.onPointerUp(new PointerEvent('pointerup', { button: 2, clientX: 40, clientY: 40 }));
    const rows = parent.querySelectorAll<HTMLButtonElement>('.ed-pick-list button');
    expect(rows).toHaveLength(2);
    rows[1].click();
    expect(choose).toHaveBeenCalledWith(1, false);
    expect((parent.querySelector('.ed-pick-list') as HTMLElement).hidden).toBe(false);
  });

  it.each(['focusOn', 'focusClose', 'teleportCamera', 'setOrthographic'] as const)(
    'invalidates explicit targets and named chooser on %s',
    (method) => {
      const { viewport, driver, parent } = setup();
      driver.choosePlacementOverlap(1, false);
      expect(viewport.pickPlacement(40, 40)).toBe(1);
      if (method === 'setOrthographic') viewport.setOrthographic(true);
      else if (method === 'teleportCamera') viewport.teleportCamera(12, 13);
      else viewport[method](12, 13, 4);
      expect(driver.pickChoice).toBeNull();
      expect(driver.placementPickCache).toBeNull();
      expect((parent.querySelector('.ed-pick-panel') as HTMLElement).hidden).toBe(true);
    },
  );

  it('invalidates the chooser through the actual placement removal path', () => {
    const { viewport, driver, map } = setup();
    driver.choosePlacementOverlap(1, false);
    map.placements.splice(0, 1);
    viewport.placementRemoved(0);
    expect(driver.pickChoice).toBeNull();
    expect(driver.placementPickCache).toBeNull();
  });

  it('previews the same exact name and cursor as clicking and reuses that exact ray', () => {
    const { viewport, driver, hooks, renderer, parent } = setup();
    driver.lastHoverPickAt = -1000;
    driver.updateHoverCursor(40, 40);
    expect(viewport.pickPlacement(40, 40)).toBe(0);
    expect(parent.querySelector('[role="status"]')?.textContent).toContain('Piece 0');
    expect(driver.canvas.style.cursor).toBe('grab');
    expect(renderer.placedAssets.pickCandidates).toHaveBeenCalledTimes(1);
    expect(hooks.onBoxSelect).not.toHaveBeenCalled();
  });

  it('updates to the final pointer position after a throttled move stops without polling', () => {
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] });
    const { viewport, driver, renderer, parent } = setup();
    driver.lastHoverPickAt = -1000;
    const preview = vi.spyOn(driver, 'previewPlacementPick');
    renderer.placedAssets.pickCandidates
      .mockReturnValueOnce([{ index: 0, distance: 4, direct: true }])
      .mockReturnValue([{ index: 1, distance: 8, direct: true }]);
    driver.updateHoverCursor(40, 40);
    expect(parent.querySelector('[role="status"]')?.textContent).toContain('Piece 0');
    vi.advanceTimersByTime(20);
    driver.updateHoverCursor(55, 40);
    vi.advanceTimersByTime(20);
    driver.updateHoverCursor(70, 40);
    expect(renderer.placedAssets.pickCandidates).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(80);
    expect(parent.querySelector('[role="status"]')?.textContent).toContain('Piece 1');
    expect(preview).toHaveBeenLastCalledWith(1, 1);
    expect(viewport.pickPlacement(70, 40)).toBe(1);
    expect(renderer.placedAssets.pickCandidates).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1000);
    expect(renderer.placedAssets.pickCandidates).toHaveBeenCalledTimes(2);
    viewport.resetTapCycle();
  });

  it.each(['reset', 'leave', 'pointerdown', 'dispose'] as const)(
    'cancels the trailing hover when the viewport receives %s',
    (action) => {
      vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] });
      const { viewport, driver, renderer } = setup();
      driver.lastHoverPickAt = -1000;
      driver.updateHoverCursor(40, 40);
      vi.advanceTimersByTime(20);
      driver.updateHoverCursor(70, 40);
      expect(vi.getTimerCount()).toBe(1);
      if (action === 'reset') viewport.resetTapCycle();
      else if (action === 'leave') driver.onPointerLeave();
      else if (action === 'dispose') viewport.dispose();
      else driver.onPointerDown(new PointerEvent('pointerdown', { button: 2 }));
      const calls = renderer.placedAssets.pickCandidates.mock.calls.length;
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(1000);
      expect(renderer.placedAssets.pickCandidates).toHaveBeenCalledTimes(calls);
      viewport.resetTapCycle();
    },
  );

  it('does not repaint a pending hover after the active editor tool changes', () => {
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] });
    const { viewport, driver, renderer, hooks, parent } = setup();
    driver.lastHoverPickAt = -1000;
    driver.updateHoverCursor(40, 40);
    vi.advanceTimersByTime(20);
    driver.updateHoverCursor(70, 40);
    hooks.placementDragEnabled = () => false;
    vi.advanceTimersByTime(1000);
    expect(renderer.placedAssets.pickCandidates).toHaveBeenCalledTimes(1);
    expect((parent.querySelector('.ed-pick-panel') as HTMLElement).hidden).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    viewport.resetTapCycle();
  });

  it('keeps the selected raised outline when the pointer leaves the viewport', async () => {
    const { viewport, driver, map, renderer, parent } = setup();
    map.placements[0] = { ...place('biome/beach_barrel'), detached: true, groundY: 10 };
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 1));
    mesh.geometry.translate(0, 2, 0);
    renderer.camera.position.set(0, 15, 20);
    renderer.camera.lookAt(0, 12, 0);
    renderer.camera.updateMatrixWorld(true);
    renderer.placedAssets.assetPreviewTemplate.mockResolvedValue({
      object: mesh,
      norm: 1,
      minY: 0,
    });
    viewport.setSelectedPlacement(0);
    await Promise.resolve();
    await Promise.resolve();
    driver.onPointerLeave();
    await Promise.resolve();
    await Promise.resolve();
    const outline = parent.querySelector('.ed-pick-outline') as HTMLElement;
    expect(outline.hidden).toBe(false);
    expect(parseFloat(outline.style.top)).toBeGreaterThan(0);
    expect(parent.querySelector('[role="status"]')?.textContent).toContain('Piece 0');
    mesh.geometry.dispose();
  });

  it('does not measure canvas layout or prepare a model again for unchanged selected frames', async () => {
    const { driver, map, renderer } = setup();
    map.placements[0] = { ...place('biome/beach_barrel'), detached: true, groundY: 10 };
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 1));
    renderer.placedAssets.assetPreviewTemplate.mockResolvedValue({
      object: mesh,
      norm: 1,
      minY: 0,
    });
    const measure = vi.spyOn(driver.canvas, 'getBoundingClientRect');
    await driver.previewPlacementPick(0, 0);
    expect(measure).toHaveBeenCalledTimes(1);
    for (let frame = 0; frame < 60; frame++) await driver.previewPlacementPick(0, 0);
    expect(measure).toHaveBeenCalledTimes(1);
    expect(renderer.placedAssets.assetPreviewTemplate).toHaveBeenCalledTimes(1);
    map.placements[0].y = 3;
    await driver.previewPlacementPick(0, 0);
    expect(measure).toHaveBeenCalledTimes(1);
    expect(renderer.placedAssets.assetPreviewTemplate).toHaveBeenCalledTimes(2);
    mesh.geometry.dispose();
  });

  it('rejects a late outline after a camera reset', async () => {
    const { viewport, driver, map, renderer, parent } = setup();
    map.placements[0] = place('biome/beach_barrel');
    let finish!: (value: { object: THREE.Object3D; norm: number; minY: number }) => void;
    renderer.placedAssets.assetPreviewTemplate.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const pending = driver.previewPlacementPick(0, 0);
    viewport.focusOn(50, 50, 10);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 1));
    finish({ object: mesh, norm: 1, minY: 0 });
    await pending;
    expect((parent.querySelector('.ed-pick-outline') as HTMLElement).hidden).toBe(true);
    mesh.geometry.dispose();
  });

  it('opens on a stationary context click and closes before a new canvas gesture', () => {
    const { driver, parent } = setup();
    driver.onPointerDown(new PointerEvent('pointerdown', { button: 2, clientX: 40, clientY: 40 }));
    driver.onPointerUp(new PointerEvent('pointerup', { button: 2, clientX: 40, clientY: 40 }));
    expect((parent.querySelector('.ed-pick-list') as HTMLElement).hidden).toBe(false);
    driver.onPointerDown(new PointerEvent('pointerdown', { button: 0, clientX: 40, clientY: 40 }));
    expect((parent.querySelector('.ed-pick-list') as HTMLElement).hidden).toBe(true);
  });

  it('does not open the chooser from a press-time contextmenu (macOS and Linux order)', () => {
    const { driver, parent } = setup();
    driver.onPointerDown(new PointerEvent('pointerdown', { button: 2, clientX: 40, clientY: 40 }));
    driver.onContext(new MouseEvent('contextmenu', { clientX: 40, clientY: 40 }));
    expect((parent.querySelector('.ed-pick-list') as HTMLElement).hidden).toBe(true);
    driver.onPointerMove(new PointerEvent('pointermove', { buttons: 2, clientX: 80, clientY: 40 }));
    driver.onPointerUp(new PointerEvent('pointerup', { button: 2, clientX: 80, clientY: 40 }));
    expect((parent.querySelector('.ed-pick-list') as HTMLElement).hidden).toBe(true);
  });

  it('does not open the chooser after a right-button orbit drag', () => {
    const { driver, parent } = setup();
    driver.onPointerDown(new PointerEvent('pointerdown', { button: 2, clientX: 40, clientY: 40 }));
    driver.onPointerMove(new PointerEvent('pointermove', { buttons: 2, clientX: 70, clientY: 40 }));
    driver.onPointerUp(new PointerEvent('pointerup', { button: 2, clientX: 70, clientY: 40 }));
    expect((parent.querySelector('.ed-pick-list') as HTMLElement).hidden).toBe(true);
  });
});
