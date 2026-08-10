import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadHdr = vi.fn(
  async (_url: string, _opts?: { maxWidth?: number }) => new THREE.DataTexture(),
);
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

  it('classifies a dome-arrived biome as non-resident until its env HDR lands', async () => {
    const sky = await import('../src/render/sky');
    const biomes = sky.skyBiomesAt(0, 0);
    // The dome (2k) and env (1k, maxWidth 512) fetches settle independently:
    // resolve every dome immediately, hang every env until released.
    const releaseEnv: Array<(tex: THREE.DataTexture) => void> = [];
    loadHdr.mockImplementation((url) =>
      url.includes('_1k.hdr')
        ? new Promise<THREE.DataTexture>((resolve) => {
            releaseEnv.push(resolve);
          })
        : Promise.resolve(new THREE.DataTexture()),
    );
    try {
      const pending = sky.ensureSkyBiomeAssets(biomes);
      // Let the settled dome fetches land in their store; the envs stay in flight.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const view = sky.buildSky(false, new THREE.Vector3(90, 140, 50));
      for (const biome of biomes) {
        // The regression trap: BOTH texture accessors read non-null here
        // (envTexture falls back to the dome HDR), so neither can probe env
        // residency. The predicate must still say NOT resident, or the
        // prewarm would PMREM the full-size dome fallback and cache that
        // wrong prefilter for the session.
        expect(view.domeTexture(biome)).not.toBeNull();
        expect(view.envTexture(biome)).not.toBeNull();
        expect(view.skyBiomeAssetsResident(biome)).toBe(false);
      }
      for (const release of releaseEnv) release(new THREE.DataTexture());
      await pending;
      for (const biome of biomes) {
        expect(view.skyBiomeAssetsResident(biome)).toBe(true);
      }
    } finally {
      loadHdr.mockImplementation(async () => new THREE.DataTexture());
    }
  });

  it('renders the shipping HDRI dome after opaques at far depth', async () => {
    const { buildSky, ensureSkyBiomeAssets, skyBiomesAt, SKY_BACKGROUND_RENDER_ORDER } =
      await import('../src/render/sky');
    await ensureSkyBiomeAssets(skyBiomesAt(0, 0));

    const sky = buildSky(false, new THREE.Vector3(90, 140, 50));
    const material = sky.dome.material as THREE.ShaderMaterial;
    expect(SKY_BACKGROUND_RENDER_ORDER).toBe(1000);
    expect(sky.dome.renderOrder).toBe(1000);
    expect(material.depthWrite).toBe(false);
    expect(material.vertexShader).toContain(
      'gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    );
    expect(material.vertexShader).toContain('gl_Position.z = gl_Position.w;');
  });
});
