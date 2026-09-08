import * as THREE from 'three';
import { loadGltf, loadKtx2Texture, loadTexture, releaseGltf } from '../assets/loader';
import { registerDeferredPreload } from '../assets/preload';
import { GFX, type GfxSettings } from '../gfx';

export type BakedKind =
  | 'smoke'
  | 'shout_dust'
  | 'warrior_power'
  | 'shockwave'
  | 'pyroblast'
  | 'frost_nova'
  | 'chain_heal';
export type FragmentKind = 'ice_shard' | 'stone_chip' | 'metal_splinter';
export const BAKED_URLS = {
  smoke: '/textures/vfx/production/smoke.webp',
  shout_dust: '/textures/vfx/production/shout_dust.webp',
  warrior_power: '/textures/vfx/production/warrior_power.webp',
  shockwave: '/textures/vfx/production/shockwave.webp',
  pyroblast: '/textures/vfx/production/pyroblast.ktx2',
  frost_nova: '/textures/vfx/production/frost_nova.ktx2',
  chain_heal: '/textures/vfx/production/chain_heal.ktx2',
} as const;
export const FRAGMENT_URL = '/models/vfx/production_fragments.glb';
const textures = new Map<BakedKind, THREE.Texture>();
const PRESSURE_URL = '/textures/vfx/production/warrior_pressure.png';
const BLOOD_URL = '/textures/vfx/production/warrior_blood_blade.png';
const STEEL_URL = '/textures/vfx/production/warrior_forged_steel.png';
let steelTexture: THREE.Texture | null = null;
export function warriorSteelTexture(): THREE.Texture | null {
  return steelTexture;
}
let bloodTexture: THREE.Texture | null = null;
export function warriorBloodTexture(): THREE.Texture | null {
  return bloodTexture;
}
let pressureTexture: THREE.Texture | null = null;
export function warriorPressureTexture(): THREE.Texture | null {
  return pressureTexture;
}
const profileTextures = new Map<string, Map<BakedKind, THREE.Texture>>();
const pending = new Map<string, Promise<void>>();
const quality = (target: Readonly<GfxSettings>): string =>
  target.tier === 'ultra' || target.tier === 'insane' ? '4k' : '2k';
export async function prepareProductionProfileAssets(target: Readonly<GfxSettings>): Promise<void> {
  const key = quality(target);
  if (profileTextures.has(key)) return;
  const existing = pending.get(key);
  if (existing) return existing;
  const task = (async () => {
    const kinds = ['pyroblast', 'chain_heal'] as const;
    const sources = await Promise.all(
      kinds.map((kind) =>
        loadKtx2Texture(BAKED_URLS[kind].replace('.ktx2', key === '2k' ? '_2k.ktx2' : '.ktx2'), {
          large: true,
        }),
      ),
    );
    const prepared = new Map<BakedKind, THREE.Texture>();
    for (let i = 0; i < kinds.length; i++) {
      const texture = sources[i].clone();
      texture.generateMipmaps = false;
      texture.minFilter = texture.magFilter = THREE.LinearFilter;
      texture.needsUpdate = true;
      prepared.set(kinds[i], texture);
    }
    profileTextures.set(key, prepared);
  })();
  pending.set(key, task);
  try {
    await task;
  } finally {
    pending.delete(key);
  }
}
const geometry = new Map<FragmentKind, THREE.BufferGeometry>();
registerDeferredPreload(async () => {
  await prepareProductionProfileAssets(GFX);
  await Promise.all(
    Object.entries(BAKED_URLS)
      .filter(([kind]) => kind !== 'pyroblast' && kind !== 'chain_heal')
      .map(async ([kind, url]) => {
        const texture = (
          await (url.endsWith('.ktx2')
            ? loadKtx2Texture(url, { large: true })
            : loadTexture(url, { srgb: true }))
        ).clone();
        // No mip cross-contamination between cells. Fixed framing has baked gutters.
        texture.generateMipmaps = false;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        textures.set(kind as BakedKind, texture);
      }),
  );
  pressureTexture = (await loadTexture(PRESSURE_URL, { srgb: false })).clone();
  pressureTexture.colorSpace = THREE.NoColorSpace;
  pressureTexture.generateMipmaps = false;
  pressureTexture.minFilter = pressureTexture.magFilter = THREE.LinearFilter;
  bloodTexture = (await loadTexture(BLOOD_URL, { srgb: true })).clone();
  bloodTexture.generateMipmaps = false;
  bloodTexture.minFilter = bloodTexture.magFilter = THREE.LinearFilter;
  steelTexture = (await loadTexture(STEEL_URL, { srgb: true })).clone();
  steelTexture.generateMipmaps = true;
  steelTexture.minFilter = THREE.LinearMipmapLinearFilter;
  steelTexture.magFilter = THREE.LinearFilter;
  const model = await loadGltf(FRAGMENT_URL);
  model.scene.updateMatrixWorld(true);
  for (const name of ['ice_shard', 'stone_chip', 'metal_splinter'] as const) {
    const mesh = model.scene.getObjectByName(name) as THREE.Mesh | undefined;
    if (!mesh?.isMesh) throw new Error(`Missing production fragment: ${name}`);
    // Shared preparation-owned source; per-renderer pools clone it and dispose their clone.
    geometry.set(name, mesh.geometry.clone().applyMatrix4(mesh.matrixWorld));
  }
  releaseGltf(FRAGMENT_URL);
}, true);
export const productionPreloadInternalsForTest = {
  urls: [
    ...Object.values(BAKED_URLS),
    PRESSURE_URL,
    BLOOD_URL,
    STEEL_URL,
    '/textures/vfx/production/pyroblast_2k.ktx2',
    '/textures/vfx/production/chain_heal_2k.ktx2',
    FRAGMENT_URL,
  ],
};
export function bakedTexture(kind: BakedKind): THREE.Texture | null {
  return profileTextures.get(quality(GFX))?.get(kind) ?? textures.get(kind) ?? null;
}
export function fragmentGeometry(kind: FragmentKind): THREE.BufferGeometry | null {
  return geometry.get(kind) ?? null;
}
