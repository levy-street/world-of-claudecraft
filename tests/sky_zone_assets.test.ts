import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadHdr = vi.fn(async () => new THREE.DataTexture());
const loadTexture = vi.fn(async () => new THREE.Texture());

describe('zone-scoped sky assets', () => {
  beforeEach(() => {
    vi.resetModules();
    loadHdr.mockClear();
    loadTexture.mockClear();
    vi.doMock('../src/render/gfx', () => ({ GFX: { standardMaterials: true } }));
    vi.doMock('../src/render/assets/loader', () => ({
      loadGltf: vi.fn(),
      loadHdr,
      loadTexture,
      releaseGltf: vi.fn(),
    }));
    vi.doMock('../src/render/textures', () => ({
      cloudTexture: vi.fn(() => new THREE.Texture()),
      skyTexture: vi.fn(() => new THREE.Texture()),
    }));
  });

  it('loads only requested biomes and deduplicates repeated calls', async () => {
    const { ensureSkyBiomeAssets, hasSkyHdriAssets } = await import('../src/render/sky');

    expect(loadHdr).not.toHaveBeenCalled();
    await ensureSkyBiomeAssets(['vale', 'vale']);
    // The visible dome keeps its high-resolution HDR while PMREM uses a
    // separate 1k source, so one biome intentionally requests two HDR assets.
    expect(loadHdr).toHaveBeenCalledTimes(2);
    expect(loadHdr).toHaveBeenNthCalledWith(1, '/env/vale_day_2k.hdr');
    expect(loadHdr).toHaveBeenNthCalledWith(2, '/env/vale_day_1k.hdr', { maxWidth: 512 });
    // All shipped backdrop strengths are zero: dead 8k panoramas must not be
    // fetched merely because their biome's HDRI is requested.
    expect(loadTexture).not.toHaveBeenCalled();
    expect(hasSkyHdriAssets(['vale'])).toBe(true);
    expect(hasSkyHdriAssets(['marsh'])).toBe(false);

    await ensureSkyBiomeAssets(['vale']);
    expect(loadHdr).toHaveBeenCalledTimes(2);
    expect(loadTexture).not.toHaveBeenCalled();
  });
});
