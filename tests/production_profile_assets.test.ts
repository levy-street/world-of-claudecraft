import * as THREE from 'three';
import { expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({ load: vi.fn(), tier: 'high' }));
vi.mock('../src/render/assets/loader', () => ({ loadKtx2Texture: boundary.load }));
vi.mock('../src/render/assets/preload', () => ({ registerDeferredPreload: vi.fn() }));
vi.mock('../src/render/gfx', () => ({ GFX: boundary }));

import {
  bakedTexture,
  prepareProductionProfileAssets,
} from '../src/render/ability_vfx/production_assets';
import type { GfxSettings } from '../src/render/gfx';

it('shares preparation within each resolution and retries without mutating source textures', async () => {
  const source = new THREE.Texture();
  const clone = vi.spyOn(source, 'clone');
  boundary.load.mockResolvedValue(source).mockRejectedValueOnce(new Error('retry'));
  const profile = (tier: string) => ({ tier }) as GfxSettings;
  await expect(prepareProductionProfileAssets(profile('high'))).rejects.toThrow('retry');
  expect(clone).not.toHaveBeenCalled();
  boundary.load.mockClear();
  await Promise.all(
    ['low', 'medium', 'high'].map((tier) => prepareProductionProfileAssets(profile(tier))),
  );
  expect(boundary.load).toHaveBeenCalledTimes(2);
  expect(boundary.load.mock.calls.every(([url]) => url.endsWith('_2k.ktx2'))).toBe(true);
  const small = bakedTexture('pyroblast');
  expect(small).not.toBe(source);
  expect(small?.generateMipmaps).toBe(false);
  expect(source.generateMipmaps).toBe(true);
  await prepareProductionProfileAssets(profile('ultra'));
  boundary.tier = 'ultra';
  expect(bakedTexture('pyroblast')).not.toBe(small);
  await prepareProductionProfileAssets(profile('insane'));
  expect(boundary.load).toHaveBeenCalledTimes(4);
  boundary.tier = 'medium';
  expect(bakedTexture('pyroblast')).toBe(small);
});
