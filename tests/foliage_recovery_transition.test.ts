import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  starts: [] as Array<() => Promise<unknown>>,
  loadGltf: vi.fn(),
  releaseGltf: vi.fn(),
}));
vi.mock('../src/render/assets/loader', () => ({
  loadGltf: mocks.loadGltf,
  releaseGltf: mocks.releaseGltf,
  releaseTexture: vi.fn(),
  loadKtx2Texture: vi.fn(() => new Promise(() => {})),
  loadTexture: vi.fn(() => new Promise(() => {})),
}));
vi.mock('../src/render/assets/preload', () => ({
  registerDeferredPreload: (start: () => Promise<unknown>) => mocks.starts.push(start),
  registerPreload: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  mocks.starts.length = 0;
  mocks.loadGltf.mockReset();
  mocks.releaseGltf.mockReset();
});

function uniqueBytes(...geometries: THREE.BufferGeometry[]): number {
  const buffers = new Set<ArrayBufferLike>();
  for (const geometry of geometries) {
    if (geometry.index) buffers.add(geometry.index.array.buffer);
    for (const attr of Object.values(geometry.attributes)) buffers.add(attr.array.buffer);
  }
  return [...buffers].reduce((sum, buffer) => sum + buffer.byteLength, 0);
}

async function boot(initial: number, recovered: number, probePreset = 2) {
  vi.resetModules();
  mocks.starts.length = 0;
  mocks.releaseGltf.mockClear();
  const storage = new Map<string, string>([
    ['woc_settings', JSON.stringify({ graphicsPreset: initial })],
  ]);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal('navigator', {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile',
    platform: 'iPhone',
    maxTouchPoints: 5,
    hardwareConcurrency: 6,
  });
  vi.stubGlobal('location', { search: '' });
  const source = new THREE.SphereGeometry(1, 40, 32);
  const sourceDispose = vi.spyOn(source, 'dispose');
  const material = new THREE.MeshBasicMaterial();
  const materialDispose = vi.spyOn(material, 'dispose');
  material.name = 'Bark_NormalTree';
  const scene = new THREE.Group();
  scene.add(new THREE.Mesh(source, material));
  const url = 'models/foliage/oak_1_field.glb';
  mocks.loadGltf.mockImplementation((requested: string) =>
    requested === url ? Promise.resolve({ scene }) : new Promise(() => {}),
  );
  const gfx = await import('../src/render/gfx');
  const foliage = await import('../src/render/foliage');
  expect(gfx.GFX.tier).toBe(initial === 1 ? 'low' : initial === 2 ? 'medium' : 'high');
  const { Settings } = await import('../src/game/settings');
  const { markEntryTightMode } = await import('../src/device_memory_hint');
  const { planEntryCrashRecovery, serializeProbe } = await import('../src/game/entry_crash_guard');
  const settings = new Settings();
  const recovery = planEntryCrashRecovery(
    serializeProbe({ preset: probePreset, at: Date.now() }),
    Date.now(),
  );
  if (!recovery) throw new Error('Expected a fresh recovery probe');
  expect(recovery.to).toBe(Math.max(1, probePreset - 1));
  settings.set('graphicsPreset', recovered === 1 ? recovery.to : recovered);
  settings.set('graphicsDefaultApplied', true);
  markEntryTightMode();
  gfx.refreshBootGfxProfile();
  for (const start of mocks.starts) void start();
  await vi.waitFor(() => expect(mocks.releaseGltf).toHaveBeenCalledWith(url));
  const before = foliage.foliageResidencySources();
  const geometry = before.extractedGeometries[0];
  expect(geometry).toBeDefined();
  expect(before.parsedScenes).not.toContain(scene);
  expect(sourceDispose).not.toHaveBeenCalled();
  expect(materialDispose).not.toHaveBeenCalled();
  const derivedDispose = vi.spyOn(geometry, 'dispose');
  const getContext = () => ({
    getExtension: () => null,
    getParameter: () => 'Apple GPU',
    RENDERER: 0,
  });
  gfx.initGfxTier({ getContext } as unknown as THREE.WebGLRenderer);
  const after = foliage.foliageResidencySources();
  expect(after.extractedGeometries[0]).toBe(geometry);
  expect(derivedDispose).not.toHaveBeenCalled();
  return {
    count: geometry.index?.count,
    bytes: uniqueBytes(geometry),
    source,
    geometry,
    tier: gfx.GFX.tier,
  };
}

describe('foliage recovery transition', () => {
  it('refreshes in the production entry before deferred preloads', () => {
    const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    const refresh = source.indexOf('refreshBootGfxProfile();');
    const deferred = source.indexOf('const deferredStarted = beginDeferredPreloads();');
    expect(refresh).toBeGreaterThan(0);
    expect(refresh).toBeLessThan(deferred);
  });
  it('counts shared buffers only once across geometries', () => {
    const attribute = new THREE.BufferAttribute(new Float32Array(12), 3);
    const a = new THREE.BufferGeometry().setAttribute('position', attribute);
    const b = new THREE.BufferGeometry().setAttribute('position', attribute);
    expect(uniqueBytes(a, b)).toBe(attribute.array.byteLength);
  });
  it('retains the same Low geometry as a clean Low boot after High recovery', async () => {
    // A stale Medium probe and a newer High setting can coexist at module load.
    const recovered = await boot(3, 1);
    const clean = await boot(1, 1);
    expect(recovered.tier).toBe('low');
    expect(clean.tier).toBe('low');
    expect(recovered.bytes).toBe(clean.bytes);
    expect(recovered.count).toBe(clean.count);
    expect(clean.count).toBe(306);
    expect(clean.bytes).toBe(4396);
  });
  it('matches a clean High boot when Low changes to High before entry', async () => {
    const changed = await boot(1, 3);
    const clean = await boot(3, 3);
    expect(changed.tier).toBe('high');
    expect(changed.count).toBe(clean.count);
    expect(changed.bytes).toBe(clean.bytes);
  });
});
