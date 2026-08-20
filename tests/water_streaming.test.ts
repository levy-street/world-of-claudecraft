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

/** The zone sheet's shore attributes as the MAIN-THREAD bake produces them,
 *  the reference every pooled arm below has to reproduce exactly. */
async function mainThreadShoreBake(): Promise<{ depth: number[]; slope: number[] }> {
  vi.resetModules();
  mockWaterShaderAssets();
  const { buildWater } = await import('../src/render/water');
  const { zoneAt } = await import('../src/sim/data');
  await Promise.resolve();

  const plain = buildWater(20061);
  const plainTask = plain.ensureZone(zoneAt(0, 0));
  await vi.runAllTimersAsync();
  const [mesh] = await plainTask;
  return {
    depth: Array.from((mesh.geometry.attributes.aShoreDepth as THREE.BufferAttribute).array),
    slope: Array.from((mesh.geometry.attributes.aShoreSlope as THREE.BufferAttribute).array),
  };
}

const shoreAttributes = (mesh: THREE.Mesh): { depth: number[]; slope: number[] } => ({
  depth: Array.from((mesh.geometry.attributes.aShoreDepth as THREE.BufferAttribute).array),
  slope: Array.from((mesh.geometry.attributes.aShoreSlope as THREE.BufferAttribute).array),
});

describe('progressive water build', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    // vi.resetModules() drops the module cache but NOT the mock registry, so
    // the pool stub below has to be lifted or it leaks into later tests.
    vi.doUnmock('../src/render/zone_build_pool');
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

  // The shore-attribute bake (32k vertices of shoreDepthAt + shoreSlopeAt) is
  // the single biggest term in a zone's water prepare, and it now rides the
  // shared zone-build workers on BOTH paces. The pins: the sheet really is
  // baked off-thread when a pool exists, and the attributes it lands are the
  // ones the main-thread bake produces.
  // Both paces take the pool: a background idle prepare pays the same 32k
  // vertex bake as a gating one, so an idle arm left on the main thread would
  // keep the very cost this moved off it.
  for (const pace of ['gating', 'idle'] as const) {
    it(`bakes the shore attributes on the worker pool at ${pace} pace and matches the main-thread bake`, async () => {
      const expected = await mainThreadShoreBake();
      expect(new Set(expected.depth).size).toBeGreaterThan(1);

      vi.resetModules();
      mockWaterShaderAssets();
      const fills: number[] = [];
      vi.doMock('../src/render/zone_build_pool', async () => {
        const { buildWaterFillArrays } = await import('../src/render/zone_build_worker');
        return {
          zoneBuildPool: () => ({
            size: 3,
            async buildChunk() {
              return null;
            },
            async fillWater(job: { x: Float32Array; z: Float32Array; seed: number }) {
              fills.push(job.x.length);
              await new Promise((resolve) => setTimeout(resolve, 0));
              return buildWaterFillArrays({ ...job, kind: 'water-fill', id: fills.length });
            },
            dispose() {},
          }),
          disposeZoneBuildPool: () => {},
        };
      });
      const { buildWater } = await import('../src/render/water');
      const { zoneAt } = await import('../src/sim/data');
      const pooled = buildWater(20061);
      await Promise.resolve();
      const pooledTask = pooled.ensureZone(
        zoneAt(0, 0),
        pace === 'idle' ? { pace: 'idle' } : undefined,
      );
      await vi.runAllTimersAsync();
      const [pooledMesh] = await pooledTask;

      // The fill really went through the pool, over the whole sheet.
      expect(fills.length).toBeGreaterThan(0);
      expect(fills[0]).toBe(expected.depth.length);
      expect(shoreAttributes(pooledMesh)).toEqual(expected);
    });
  }

  // The pool is FALLIBLE by contract: a failed job returns null and the sheet
  // must be baked here instead, through the row-sliced fallback. Same numbers
  // either way, or shorelines would foam differently depending on a worker.
  it('bakes on the main thread when the pool declines the fill, with the same attributes', async () => {
    const expected = await mainThreadShoreBake();

    vi.resetModules();
    mockWaterShaderAssets();
    let declined = 0;
    vi.doMock('../src/render/zone_build_pool', () => ({
      zoneBuildPool: () => ({
        size: 3,
        async buildChunk() {
          return null;
        },
        async fillWater() {
          declined++;
          return null;
        },
        dispose() {},
      }),
      disposeZoneBuildPool: () => {},
    }));
    const { buildWater } = await import('../src/render/water');
    const { zoneAt } = await import('../src/sim/data');
    const fallback = buildWater(20061);
    await Promise.resolve();
    const task = fallback.ensureZone(zoneAt(0, 0));
    await vi.runAllTimersAsync();
    const [mesh] = await task;

    expect(declined).toBeGreaterThan(0);
    expect(shoreAttributes(mesh)).toEqual(expected);
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
