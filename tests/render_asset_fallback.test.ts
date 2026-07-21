import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

function mockEmptyAssetLoads(): void {
  vi.doMock('../src/render/assets/loader', () => ({
    loadGltf: vi.fn(() => new Promise(() => {})),
    loadHdr: vi.fn(() => new Promise(() => {})),
    loadTexture: vi.fn(() => new Promise(() => {})),
    releaseGltf: vi.fn(),
  }));
  const texture = (): THREE.DataTexture => {
    const data = new Uint8Array([255, 255, 255, 255]);
    const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
    tex.needsUpdate = true;
    return tex;
  };
  vi.doMock('../src/render/textures', () => ({
    groundDetailTexture: vi.fn(texture),
    groundSplatMaps: vi.fn(() => ({
      grass: texture(),
      dirt: texture(),
      rock: texture(),
      sand: texture(),
      mud: texture(),
      snow: texture(),
    })),
    macroNoiseTexture: vi.fn(texture),
    skyTexture: vi.fn(texture),
    waterNormalish: vi.fn(texture),
    waterNormalMaps: vi.fn(() => [texture(), texture()]),
  }));
}

describe('render asset preload fallbacks', () => {
  it('keeps sky construction non-fatal when HDRI assets were not preloaded', async () => {
    vi.resetModules();
    mockEmptyAssetLoads();

    const { buildSky, hasSkyHdriAssets } = await import('../src/render/sky');
    expect(hasSkyHdriAssets()).toBe(false);

    const sky = buildSky(false, new THREE.Vector3(90, 140, 50));
    expect(sky.envTexture('vale')).toBe(null);
    expect(sky.dome).toBeInstanceOf(THREE.Mesh);
  });

  it('keeps water construction non-fatal when shader normal maps were not preloaded', async () => {
    vi.resetModules();
    mockEmptyAssetLoads();

    const { buildWater, hasWaterShaderAssets } = await import('../src/render/water');
    expect(hasWaterShaderAssets()).toBe(false);

    const water = buildWater(20061);
    expect(water.meshes.length).toBeGreaterThan(0);
  });

  it('keeps terrain construction non-fatal when splat textures were not preloaded', async () => {
    vi.resetModules();
    mockEmptyAssetLoads();

    const { buildTerrain, hasTerrainSplatAssets } = await import('../src/render/terrain');
    expect(hasTerrainSplatAssets()).toBe(false);

    const terrain = buildTerrain(20061);
    expect(terrain.group.children.length).toBeGreaterThan(0);
    // Real timers, never cancelled: without this the far-chunk stream keeps
    // building on a setTimeout chain in the background for the rest of the suite.
    terrain.cancelStreaming();
  });
});
