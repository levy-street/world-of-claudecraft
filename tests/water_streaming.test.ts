import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function mockWaterShaderAssets(): void {
  vi.doMock('../src/render/assets/loader', () => ({
    loadTexture: vi.fn(async () => new THREE.Texture()),
  }));
  vi.doMock('../src/render/assets/preload', () => ({
    registerPreload: vi.fn(),
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
});
