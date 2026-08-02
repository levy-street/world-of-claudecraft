import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadTexture: vi.fn(),
  registerPreload: vi.fn(),
}));

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

vi.mock('../src/render/assets/loader', () => ({
  loadTexture: mocks.loadTexture,
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

describe('Eastbrook surface atlas preload', () => {
  it.each([
    ['Low', '?gfx=low'],
    ['Standard', '?gfx=ultra'],
  ] as const)('loads one shared linear detail texture resource on %s', async (_path, search) => {
    vi.stubGlobal('window', { location: { search } });
    vi.stubGlobal('location', { search });
    const atlas = new THREE.Texture();
    const normal = new THREE.Texture();
    const roughness = new THREE.Texture();
    const entries: Array<readonly [string, THREE.Texture]> = [
      ['/textures/eastbrook_surface_atlas.webp', atlas],
      ['/textures/eastbrook_surface_normal.webp', normal],
      ['/textures/eastbrook_surface_rough.webp', roughness],
    ];
    const pending = new Map(
      entries.map(([url, texture]) => [url, { texture, ...deferred<THREE.Texture>() }] as const),
    );
    mocks.loadTexture.mockImplementation((url: string) => {
      const load = pending.get(url);
      return load?.promise ?? Promise.resolve(new THREE.Texture());
    });

    const module = await import('../src/render/eastbrook_surface_atlas');
    const eastbrookUrls = [
      module.EASTBROOK_SURFACE_ATLAS_URL,
      module.EASTBROOK_SURFACE_NORMAL_URL,
      module.EASTBROOK_SURFACE_ROUGH_URL,
    ];
    const eastbrookLoads = mocks.loadTexture.mock.calls
      .map(([url], index) => ({
        url,
        order: mocks.loadTexture.mock.invocationCallOrder[index],
      }))
      .filter(({ url }) => eastbrookUrls.includes(url));
    expect(eastbrookLoads.map(({ url }) => url)).toEqual(eastbrookUrls);
    const registrationOrders = new Set(mocks.registerPreload.mock.invocationCallOrder);
    for (const { order } of eastbrookLoads) expect(registrationOrders).toContain(order + 1);
    const registered = mocks.registerPreload.mock.calls.map(([promise]) => promise);
    let gateSettled = false;
    const gate = Promise.all(registered).then(() => {
      gateSettled = true;
    });
    await Promise.resolve();
    expect(gateSettled).toBe(false);
    for (const load of pending.values()) load.resolve(load.texture);
    await gate;
    expect(module.eastbrookSurfaceAtlasTexture()).toBe(atlas);
    expect(module.eastbrookSurfaceNormalTexture()).toBe(normal);
    expect(module.eastbrookSurfaceRoughnessTexture()).toBe(roughness);
    expect(atlas.colorSpace).toBe(THREE.NoColorSpace);
    expect(normal.colorSpace).toBe(THREE.NoColorSpace);
    expect(roughness.colorSpace).toBe(THREE.NoColorSpace);
    expect(atlas.name).toBe('');
    expect(atlas.userData).toEqual({});
    expect(module.eastbrookSurfaceAtlasMetadata(new THREE.Group(), atlas)).toEqual({
      url: module.EASTBROOK_SURFACE_ATLAS_URL,
      textureUuid: atlas.uuid,
      materialBindings: 0,
    });

    const source = new THREE.MeshStandardMaterial({ roughness: 0.73 });
    source.name = 'ArmouryStone';
    const converted = module.eastbrookSurfaceMaterial(source, atlas) as THREE.MeshStandardMaterial;
    if (search === '?gfx=ultra') {
      expect(converted.map).toBe(atlas);
      expect(converted.normalMap).toBe(normal);
      expect(converted.roughnessMap).toBe(roughness);
      expect(converted.roughness).toBe(1);
      expect(converted.normalScale.toArray()).toEqual([
        module.EASTBROOK_SURFACE_NORMAL_SCALE,
        module.EASTBROOK_SURFACE_NORMAL_SCALE,
      ]);
    } else {
      expect(converted).toBeInstanceOf(THREE.MeshLambertMaterial);
      expect(converted.map).toBe(atlas);
      expect((converted as THREE.MeshStandardMaterial).normalMap ?? null).toBeNull();
      expect((converted as THREE.MeshStandardMaterial).roughnessMap ?? null).toBeNull();
    }
  });

  it('registers the loader-derived promise, including rejection', async () => {
    vi.stubGlobal('window', { location: { search: '?gfx=ultra' } });
    vi.stubGlobal('location', { search: '?gfx=ultra' });
    const failure = new Error('normal atlas failed');
    const pending = new Map(
      [
        '/textures/eastbrook_surface_atlas.webp',
        '/textures/eastbrook_surface_normal.webp',
        '/textures/eastbrook_surface_rough.webp',
      ].map((url) => [url, deferred<THREE.Texture>()] as const),
    );
    mocks.loadTexture.mockImplementation((url: string) => {
      const load = pending.get(url);
      return load?.promise ?? Promise.resolve(new THREE.Texture());
    });

    await import('../src/render/eastbrook_surface_atlas');
    const registered = mocks.registerPreload.mock.calls.map(([promise]) => promise);
    const outcomes = Promise.allSettled(registered);
    pending.get('/textures/eastbrook_surface_atlas.webp')?.resolve(new THREE.Texture());
    pending.get('/textures/eastbrook_surface_rough.webp')?.resolve(new THREE.Texture());
    pending.get('/textures/eastbrook_surface_normal.webp')?.reject(failure);

    const settled = await outcomes;
    expect(settled.filter((result) => result.status === 'rejected')).toEqual([
      { status: 'rejected', reason: failure },
    ]);
  });
});
