import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadGltf: vi.fn(),
  loadTexture: vi.fn(),
  releaseGltf: vi.fn(),
  registerPreload: vi.fn(),
}));

vi.mock('../src/render/assets/loader', () => ({
  loadGltf: mocks.loadGltf,
  loadTexture: mocks.loadTexture,
  releaseGltf: mocks.releaseGltf,
}));

vi.mock('../src/render/assets/preload', () => ({
  registerPreload: mocks.registerPreload,
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
      mocks.loadGltf.mockReturnValue(Promise.resolve({ scene }));
      const atlas = new THREE.Texture();
      mocks.loadTexture.mockResolvedValue(atlas);

      const module = await import('../src/render/eastbrook_town');
      const allUrls = [...module.EASTBROOK_TOWN_ASSET_URLS];
      const newUrls = [...module.EASTBROOK_TOWN_NEW_ASSET_URLS];
      expect(newUrls).toHaveLength(9);
      expect(new Set(newUrls).size).toBe(9);
      expect(allUrls).toHaveLength(11);
      expect(mocks.loadGltf.mock.calls.map(([url]) => url)).toEqual(allUrls);
      expect(mocks.loadTexture).toHaveBeenCalledWith('/textures/eastbrook_surface_atlas.webp');
      expect(mocks.registerPreload).toHaveBeenCalledTimes(allUrls.length + 1);
      await Promise.all(mocks.registerPreload.mock.calls.map(([registered]) => registered));

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
