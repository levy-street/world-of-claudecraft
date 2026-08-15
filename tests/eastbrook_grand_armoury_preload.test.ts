import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadGltf: vi.fn(),
  loadTexture: vi.fn(),
  releaseGltf: vi.fn(),
  registerPreload: vi.fn(),
}));

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

vi.mock('../src/render/assets/loader', () => ({
  loadGltf: mocks.loadGltf,
  loadTexture: mocks.loadTexture,
  releaseGltf: mocks.releaseGltf,
}));

vi.mock('../src/render/assets/preload', () => ({
  registerPreload: mocks.registerPreload,
  // Deferred lane: start the thunk immediately so these registration-order and
  // asset-set assertions observe the same promises the eager lane produced.
  registerDeferredPreload: (start: () => Promise<unknown>) => mocks.registerPreload(start()),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.resetModules();
});

describe('Eastbrook Grand Armoury preload', () => {
  it('registers the exact shipping GLB before a browser renderer can build the landmark', async () => {
    vi.stubGlobal('window', { location: { search: '' } });
    vi.stubGlobal('location', { search: '' });
    const scene = new THREE.Group();
    const stone = new THREE.MeshStandardMaterial({ vertexColors: true });
    stone.name = 'ArmouryStone';
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), stone));
    const gltfLoad = deferred<{ scene: THREE.Group }>();
    mocks.loadGltf.mockReturnValue(gltfLoad.promise);
    const atlas = new THREE.Texture();
    const textureLoad = deferred<THREE.Texture>();
    mocks.loadTexture.mockReturnValue(textureLoad.promise);

    const module = await import('../src/render/eastbrook_grand_armoury');

    expect(mocks.loadGltf).toHaveBeenCalledTimes(1);
    expect(mocks.loadGltf).toHaveBeenCalledWith('/models/props/eastbrook_grand_armoury.glb');
    const atlasLoads = mocks.loadTexture.mock.calls
      .map(([url], index) => ({
        url,
        order: mocks.loadTexture.mock.invocationCallOrder[index],
      }))
      .filter(({ url }) => url === '/textures/eastbrook_surface_atlas.webp');
    expect(atlasLoads.map(({ url }) => url)).toEqual(['/textures/eastbrook_surface_atlas.webp']);
    const registrationOrders = new Set(mocks.registerPreload.mock.invocationCallOrder);
    expect(registrationOrders).toContain(mocks.loadGltf.mock.invocationCallOrder[0] + 1);
    expect(registrationOrders).toContain(atlasLoads[0].order + 1);
    const registered = mocks.registerPreload.mock.calls.map(([promise]) => promise);
    expect(registered.every((promise) => promise instanceof Promise)).toBe(true);
    let gateSettled = false;
    const gate = Promise.all(registered).then(() => {
      gateSettled = true;
    });
    await Promise.resolve();
    expect(gateSettled).toBe(false);
    gltfLoad.resolve({ scene });
    await Promise.resolve();
    expect(gateSettled).toBe(false);
    textureLoad.resolve(atlas);
    await gate;

    const building = {
      kind: 'inn',
      landmark: 'eastbrook_grand_armoury',
      x: 17.5,
      z: -5.5,
      w: 13,
      d: 9,
      rot: -Math.PI / 2,
    } as const;
    const first = module.eastbrookGrandArmouryInternalsForTest.buildView(building, () => 1.5);
    const second = module.eastbrookGrandArmouryInternalsForTest.buildView(building, () => 1.5);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    if (!first || !second) throw new Error('preloaded armoury fixture did not build');
    expect(first.group).not.toBe(second.group);
    expect(first.group.position.toArray()).toEqual([17.5, 0.1499999999999999, -5.5]);
    expect(first.group.rotation.y).toBe(-Math.PI / 2);
    expect(first.group.scale.toArray()).toEqual([1, 1, 1]);
    expect(first.cameraTopY).toBe(16.5);
    expect(second.group.position.toArray()).toEqual(first.group.position.toArray());
    expect(second.group.rotation.y).toBe(first.group.rotation.y);
    expect(second.group.scale.toArray()).toEqual(first.group.scale.toArray());
    expect(second.cameraTopY).toBe(first.cameraTopY);

    const uneven = module.eastbrookGrandArmouryInternalsForTest.buildView(building, (x, z) =>
      Math.abs(x - 17) < 1e-8 && Math.abs(z + 4.5) < 1e-8 ? -5 : 1.5,
    );
    expect(uneven).not.toBeNull();
    if (!uneven) throw new Error('uneven-terrain armoury fixture did not build');
    expect(uneven.group.userData.foundationSkirtDepth).toBeCloseTo(5.15, 8);
    expect(uneven.group.userData.foundationSkirtDraws).toBe(1);
    const skirt = uneven.group.getObjectByName('eastbrookGrandArmouryFoundationSkirt');
    expect(skirt).toBeInstanceOf(THREE.Mesh);
    const skirtBounds = new THREE.Box3().setFromObject(skirt as THREE.Mesh);
    expect(skirtBounds.max.x - skirtBounds.min.x).toBeCloseTo(13, 8);
    expect(skirtBounds.max.z - skirtBounds.min.z).toBeCloseTo(9, 8);
    expect(mocks.releaseGltf).toHaveBeenCalledTimes(1);
    expect(mocks.releaseGltf).toHaveBeenCalledWith('/models/props/eastbrook_grand_armoury.glb');
  });
});
