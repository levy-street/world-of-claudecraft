import { describe, expect, it, vi } from 'vitest';
import { meshTerrainHeight } from '../src/render/terrain_mesh_height';
import { WORLD_MAX_X, WORLD_MAX_Z, WORLD_MIN_X, WORLD_MIN_Z, ZONES } from '../src/sim/data';

vi.mock('../src/render/assets/loader', () => ({
  loadGltf: vi.fn(() => new Promise(() => {})),
  loadHdr: vi.fn(() => new Promise(() => {})),
  loadTexture: vi.fn(() => new Promise(() => {})),
  releaseGltf: vi.fn(),
}));

vi.mock('../src/render/textures', () => ({
  groundDetailTexture: vi.fn(),
  groundSplatMaps: vi.fn(),
  macroNoiseTexture: vi.fn(),
}));

describe('terrain macro-normal world mapping', () => {
  it('selects the literal Farshore texel region from the asymmetric live world bounds', async () => {
    const { terrainNormalRegionsFor } = await import('../src/render/terrain');
    const farshore = ZONES.find((zone) => zone.id === 'farshore_isle');
    expect(farshore).toBeDefined();
    expect(terrainNormalRegionsFor(farshore!, [])).toEqual([{ i0: 214, i1: 319, j0: 0, j1: 196 }]);
  });

  it('samples the live asymmetric WORLD_MIN..WORLD_MAX rectangle', async () => {
    const {
      bakeTerrainNormalRegion,
      TERRAIN_NORMAL_TEXTURE_HEIGHT: height,
      TERRAIN_NORMAL_TEXTURE_STRENGTH: strength,
      TERRAIN_NORMAL_TEXTURE_WIDTH: width,
    } = await import('../src/render/terrain');
    const seed = 20_061;
    const data = new Uint8Array(width * height * 4);
    const stepX = (WORLD_MAX_X - WORLD_MIN_X) / width;
    const stepZ = (WORLD_MAX_Z - WORLD_MIN_Z) / height;
    const samples = [
      [0, 160],
      [37, 480],
      [161, 640],
      [width - 1, 800],
    ] as const;

    for (const [i, j] of samples) {
      bakeTerrainNormalRegion(data, seed, i, i, j, j);
      const iw = Math.max(0, i - 1);
      const ie = Math.min(width - 1, i + 1);
      const jn = Math.max(0, j - 1);
      const js = Math.min(height - 1, j + 1);
      const heightAt = (tx: number, tz: number): number =>
        meshTerrainHeight(WORLD_MIN_X + (tx + 0.5) * stepX, WORLD_MIN_Z + (tz + 0.5) * stepZ, seed);
      const dhdx = (heightAt(ie, j) - heightAt(iw, j)) / ((ie - iw) * stepX);
      const dhdz = (heightAt(i, js) - heightAt(i, jn)) / ((js - jn) * stepZ);
      const nx = -dhdx * strength;
      const nz = -dhdz * strength;
      const inv = 1 / Math.hypot(nx, 1, nz);
      const offset = (j * width + i) * 4;
      expect([...data.slice(offset, offset + 4)]).toEqual([
        ...Uint8Array.from([
          (nx * inv * 0.5 + 0.5) * 255,
          (nz * inv * 0.5 + 0.5) * 255,
          (inv * 0.5 + 0.5) * 255,
          255,
        ]),
      ]);
    }
  });
});
