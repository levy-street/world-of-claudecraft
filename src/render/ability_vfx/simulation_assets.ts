import * as THREE from 'three';
import { loadKtx2Texture } from '../assets/loader';
import { registerDeferredPreload } from '../assets/preload';
import { GFX, type GfxSettings } from '../gfx';

export interface LiquidSurfaceMaps {
  normal: THREE.Texture;
  motion: THREE.Texture;
  lighting: THREE.Texture;
}
const resident = new Map<string, LiquidSurfaceMaps>();
const pending = new Map<string, Promise<void>>();
function quality(target: Readonly<GfxSettings>): string {
  return target.tier === 'low'
    ? ''
    : target.tier === 'ultra' || target.tier === 'insane'
      ? '4k'
      : '2k';
}
/** Two immutable preparation-owned sets, never loaded during a cast. */
export async function prepareSimulationProfileAssets(target: Readonly<GfxSettings>): Promise<void> {
  const key = quality(target);
  if (!key || resident.has(key)) return;
  const existing = pending.get(key);
  if (existing) return existing;
  const task = (async () => {
    const suffix = key === '2k' ? '_2k' : '';
    const sources = await Promise.all(
      ['normal_depth', 'motion_depth', 'lighting'].map((name) =>
        loadKtx2Texture(`/textures/vfx/production/liquid_${name}${suffix}.ktx2`, { large: true }),
      ),
    );
    const loaded = sources.map((source) => {
      const texture = source.clone();
      texture.colorSpace = THREE.NoColorSpace;
      texture.generateMipmaps = false;
      texture.minFilter = texture.magFilter = THREE.LinearFilter;
      texture.needsUpdate = true;
      return texture;
    });
    resident.set(key, { normal: loaded[0], motion: loaded[1], lighting: loaded[2] });
  })();
  pending.set(key, task);
  try {
    await task;
  } finally {
    pending.delete(key);
  }
}
export function liquidSurfaceMaps(): LiquidSurfaceMaps | null {
  return resident.get(quality(GFX)) ?? null;
}
registerDeferredPreload(() => prepareSimulationProfileAssets(GFX), true);
