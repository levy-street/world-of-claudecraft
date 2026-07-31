import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadTexture: vi.fn(),
  registerPreload: vi.fn(),
  registerDeferredPreload: vi.fn((start: () => unknown) => start()),
}));

vi.mock('../src/render/assets/loader', () => ({
  loadTexture: mocks.loadTexture,
}));

vi.mock('../src/render/assets/preload', () => ({
  registerPreload: mocks.registerPreload,
  registerDeferredPreload: mocks.registerDeferredPreload,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.resetModules();
});

describe('Eastbrook surface atlas preload', () => {
  it.each([
    ['Low', '?gfx=low'],
    ['Standard', '?gfx=ultra'],
  ] as const)('loads one shared linear detail texture resource on %s', async (_path, search) => {
    vi.stubGlobal('window', { location: { search } });
    vi.stubGlobal('location', { search });
    const atlas = new THREE.Texture();
    mocks.loadTexture.mockResolvedValue(atlas);

    const module = await import('../src/render/eastbrook_surface_atlas');
    expect(mocks.loadTexture).toHaveBeenCalledTimes(1);
    expect(mocks.loadTexture).toHaveBeenCalledWith(module.EASTBROOK_SURFACE_ATLAS_URL);
    expect(mocks.registerDeferredPreload).toHaveBeenCalledTimes(1);
    await mocks.registerDeferredPreload.mock.results[0].value;
    expect(module.eastbrookSurfaceAtlasTexture()).toBe(atlas);
    expect(atlas.colorSpace).toBe(THREE.NoColorSpace);
    expect(atlas.name).toBe('');
    expect(atlas.userData).toEqual({});
    expect(module.eastbrookSurfaceAtlasMetadata(new THREE.Group(), atlas)).toEqual({
      url: module.EASTBROOK_SURFACE_ATLAS_URL,
      textureUuid: atlas.uuid,
      materialBindings: 0,
    });
  });
});
