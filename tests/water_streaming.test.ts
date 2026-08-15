import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function mockWaterShaderAssets(): void {
  vi.doMock('../src/render/assets/loader', () => ({
    loadTexture: vi.fn(async () => new THREE.Texture()),
  }));
  vi.doMock('../src/render/assets/preload', () => ({
    registerPreload: vi.fn(),
    registerDeferredPreload: vi.fn((start: () => unknown) => start()),
  }));
  vi.doMock('../src/render/gfx', () => ({
    GFX: { standardMaterials: true },
    SUN_DIR: new THREE.Vector3(1, 1, 1).normalize(),
    sharedUniforms: { uTime: { value: 0 } },
  }));
  vi.doMock('../src/render/textures', () => ({
    waterNormalish: vi.fn(() => new THREE.Texture()),
    waterNormalMaps: vi.fn(() => [new THREE.Texture(), new THREE.Texture()]),
  }));
}

describe('progressive water build', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('coalesces an idle zone build and stages its mesh hidden for renderer prewarm', async () => {
    vi.resetModules();
    mockWaterShaderAssets();
    const { buildWater, hasWaterShaderAssets } = await import('../src/render/water');
    const { zoneAt } = await import('../src/sim/data');
    // Let the resolved preload promises publish their textures into WATER_TEX.
    await Promise.resolve();
    expect(hasWaterShaderAssets()).toBe(true);

    const water = buildWater(20061);
    const zone = zoneAt(0, 0);
    const first = water.ensureZone(zone, { pace: 'idle' });
    expect(water.ensureZone(zone, { pace: 'idle' })).toBe(first);
    expect(water.isZoneLoaded(zone.id)).toBe(false);

    await vi.runAllTimersAsync();
    const [mesh] = await first;

    expect(water.isZoneLoaded(zone.id)).toBe(true);
    expect(mesh).toBeInstanceOf(THREE.Mesh);
    expect(mesh.visible).toBe(false);
    expect(water.group.children).toContain(mesh);
    expect(await water.ensureZone(zone, { pace: 'idle' })).toEqual([]);
  });

  it('unloadZone releases a streamed zone sheet (and its underside twin) and a later ensureZone rebuilds it', async () => {
    vi.resetModules();
    mockWaterShaderAssets();
    const { buildWater } = await import('../src/render/water');
    const { zoneAt } = await import('../src/sim/data');
    await Promise.resolve();

    const water = buildWater(20061);
    const zone = zoneAt(0, 0);
    const first = water.ensureZone(zone, { pace: 'idle' });
    await vi.runAllTimersAsync();
    const [mesh] = await first;
    expect(mesh).toBeInstanceOf(THREE.Mesh);
    const meshCountBefore = water.meshes.length;
    const groupCountBefore = water.group.children.length;

    const disposeSpy = vi.spyOn(mesh.geometry, 'dispose');

    water.unloadZone(zone.id);

    expect(water.isZoneLoaded(zone.id)).toBe(false);
    expect(water.group.children).not.toContain(mesh);
    // The front mesh AND its underside twin both leave meshes/group (exact
    // counts, not just "fewer"): a mutation that drops only the front mesh
    // would leave the twin's disposed geometry referenced by a still-live
    // Mesh in both collections, and a loose `toBeLessThan` would not catch it.
    expect(water.meshes.length).toBe(meshCountBefore - 2);
    expect(water.group.children.length).toBe(groupCountBefore - 2);
    expect(disposeSpy).toHaveBeenCalledTimes(1);

    const second = water.ensureZone(zone, { pace: 'idle' });
    await vi.runAllTimersAsync();
    const [rebuilt] = await second;
    expect(rebuilt).toBeInstanceOf(THREE.Mesh);
    expect(water.isZoneLoaded(zone.id)).toBe(true);
    expect(water.group.children).toContain(rebuilt);
  });

  it('unloadZone on a zone with nothing built is a no-op', async () => {
    vi.resetModules();
    mockWaterShaderAssets();
    const { buildWater } = await import('../src/render/water');
    const { zoneAt } = await import('../src/sim/data');
    await Promise.resolve();

    const water = buildWater(20061);
    const zone = zoneAt(0, 0);
    expect(() => water.unloadZone(zone.id)).not.toThrow();
    expect(water.isZoneLoaded(zone.id)).toBe(false);
  });

  // gfx.ts: standardMaterials is unconditionally false whenever
  // iosMemoryProfile is true (every iOS host, Safari and the native app
  // alike), so buildWater ALWAYS takes this Phong branch on iOS: it is the
  // one water tier the constrained-memory eviction pass actually has to be
  // safe on for the platform the reported crash was on.
  it('unloadZone is a safe no-op on the low (Phong) tier, which iOS always runs', async () => {
    vi.resetModules();
    vi.doMock('../src/render/gfx', () => ({
      GFX: { standardMaterials: false },
      SUN_DIR: new THREE.Vector3(1, 1, 1).normalize(),
      sharedUniforms: { uTime: { value: 0 } },
    }));
    vi.doMock('../src/render/textures', () => ({
      waterNormalish: vi.fn(() => new THREE.Texture()),
      waterNormalMaps: vi.fn(() => [new THREE.Texture(), new THREE.Texture()]),
    }));
    const { buildWater, hasWaterShaderAssets } = await import('../src/render/water');
    const { zoneAt } = await import('../src/sim/data');

    const water = buildWater(20061);
    // The low tier is one plane spanning the whole map, never per-zone: real
    // residency the shader tier's tests exercise (isZoneLoaded, ensureZone
    // returning a mesh) does not apply here on purpose (see buildWater's
    // low-tier arm), so this test only pins that unloadZone is harmless.
    expect(hasWaterShaderAssets).toBeTypeOf('function');
    const zone = zoneAt(0, 0);
    const meshCountBefore = water.meshes.length;
    const groupCountBefore = water.group.children.length;

    expect(() => water.unloadZone(zone.id)).not.toThrow();

    expect(water.meshes.length).toBe(meshCountBefore);
    expect(water.group.children.length).toBe(groupCountBefore);
    expect(water.isZoneLoaded(zone.id)).toBe(true); // low tier: unconditionally resident
  });
});
