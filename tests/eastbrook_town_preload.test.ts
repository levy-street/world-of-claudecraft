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

describe('Eastbrook town preload', () => {
  it.each([
    ['Low', '?gfx=low'],
    ['Standard', '?gfx=ultra'],
  ] as const)(
    'registers all nine shipping assets plus both support models on %s',
    async (_materialPath, search) => {
      vi.stubGlobal('window', { location: { search } });
      vi.stubGlobal('location', { search });
      const scene = new THREE.Group();
      const material = new THREE.MeshStandardMaterial({ vertexColors: true });
      material.name = 'TownOpaque';
      scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material));
      const gltfLoad = deferred<{ scene: THREE.Group }>();
      mocks.loadGltf.mockReturnValue(gltfLoad.promise);
      const atlas = new THREE.Texture();
      const textureLoad = deferred<THREE.Texture>();
      mocks.loadTexture.mockReturnValue(textureLoad.promise);

      const module = await import('../src/render/eastbrook_town');
      const allUrls = [...module.EASTBROOK_TOWN_ASSET_URLS];
      const newUrls = [...module.EASTBROOK_TOWN_NEW_ASSET_URLS];
      expect(newUrls).toHaveLength(9);
      expect(new Set(newUrls).size).toBe(9);
      expect(allUrls).toHaveLength(11);
      expect(mocks.loadGltf.mock.calls.map(([url]) => url)).toEqual(allUrls);
      const eastbrookTextureUrls = [
        '/textures/eastbrook_surface_atlas.webp',
        '/textures/eastbrook_surface_normal.webp',
        '/textures/eastbrook_surface_rough.webp',
      ];
      const registrationOrders = new Set(mocks.registerPreload.mock.invocationCallOrder);
      for (const order of mocks.loadGltf.mock.invocationCallOrder) {
        expect(registrationOrders).toContain(order + 1);
      }
      const eastbrookTextureLoads = mocks.loadTexture.mock.calls
        .map(([url], index) => ({
          url,
          order: mocks.loadTexture.mock.invocationCallOrder[index],
        }))
        .filter(({ url }) => eastbrookTextureUrls.includes(url));
      expect(eastbrookTextureLoads.map(({ url }) => url)).toEqual(eastbrookTextureUrls);
      for (const { order } of eastbrookTextureLoads) {
        expect(registrationOrders).toContain(order + 1);
      }
      const registered = mocks.registerPreload.mock.calls.map(([promise]) => promise);
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

      const data = await import('../src/sim/data');
      data.setActiveWorldContent({ ...data.BUILTIN_WORLD, zones: [] });
      const custom = module.buildEastbrookTownView(20061);
      expect(custom.group.name).toBe(module.EASTBROOK_TOWN_ROOT_NAME);
      expect(custom.group.children).toEqual([]);
      expect(mocks.releaseGltf.mock.calls.map(([url]) => url)).toEqual(allUrls);

      data.setActiveWorldContent(data.BUILTIN_WORLD);
      const first = module.buildEastbrookTownView(20061);
      const second = module.buildEastbrookTownView(20061);
      expect(first.group.name).toBe(module.EASTBROOK_TOWN_ROOT_NAME);
      expect(second.group.name).toBe(module.EASTBROOK_TOWN_ROOT_NAME);
      expect(first.group).not.toBe(second.group);
      expect(mocks.releaseGltf.mock.calls.map(([url]) => url)).toEqual(allUrls);
      data.setActiveWorldContent(null);
    },
  );
});
