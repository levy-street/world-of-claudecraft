import * as THREE from 'three';
import { expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({ load: vi.fn(), tier: 'high' }));
vi.mock('../src/render/assets/loader', () => ({ loadKtx2Texture: boundary.load }));
vi.mock('../src/render/assets/preload', () => ({ registerDeferredPreload: vi.fn() }));
vi.mock('../src/render/gfx', () => ({ GFX: boundary }));

import {
  liquidSurfaceMaps,
  prepareSimulationProfileAssets,
} from '../src/render/ability_vfx/simulation_assets';
import type { GfxSettings } from '../src/render/gfx';

it('prepares linear 2K and 4K data once, keeps source textures immutable, and retries a failed preparation', async () => {
  const sources: THREE.Texture[] = [];
  boundary.load.mockImplementation(async () => {
    const t = new THREE.Texture();
    t.colorSpace = THREE.SRGBColorSpace;
    sources.push(t);
    return t;
  });
  const profile = (tier: string) => ({ tier }) as GfxSettings;
  await prepareSimulationProfileAssets(profile('low'));
  expect(boundary.load).not.toHaveBeenCalled();
  boundary.load.mockRejectedValueOnce(new Error('transient'));
  await expect(prepareSimulationProfileAssets(profile('high'))).rejects.toThrow('transient');
  boundary.load.mockClear();
  await Promise.all([
    prepareSimulationProfileAssets(profile('high')),
    prepareSimulationProfileAssets(profile('medium')),
  ]);
  expect(boundary.load).toHaveBeenCalledTimes(3);
  expect(boundary.load.mock.calls.every(([url]) => url.endsWith('_2k.ktx2'))).toBe(true);
  const maps = liquidSurfaceMaps()!;
  for (const texture of Object.values(maps)) {
    expect(texture.colorSpace).toBe(THREE.NoColorSpace);
    expect(texture.generateMipmaps).toBe(false);
    expect(sources).not.toContain(texture);
  }
  expect(sources.every((t) => t.colorSpace === THREE.SRGBColorSpace)).toBe(true);
  await prepareSimulationProfileAssets(profile('ultra'));
  boundary.tier = 'ultra';
  expect(liquidSurfaceMaps()).not.toBe(maps);
  const calls = boundary.load.mock.calls.length;
  await prepareSimulationProfileAssets(profile('insane'));
  expect(boundary.load).toHaveBeenCalledTimes(calls);
  boundary.tier = 'low';
  expect(liquidSurfaceMaps()).toBeNull();
  boundary.tier = 'high';
  expect(liquidSurfaceMaps()).toBe(maps);
});
