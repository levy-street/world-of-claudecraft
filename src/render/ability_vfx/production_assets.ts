import * as THREE from 'three';
import { armBitmapSheetRelease, restoreBitmapSheet } from '../assets/bitmap_sheet_release';
import { loadBitmapTexture, loadGltf, loadKtx2Texture, releaseGltf } from '../assets/loader';
import { ensureContactSheets } from './contact_assets';

export type BakedKind =
  | 'smoke'
  | 'shout_dust'
  | 'warrior_power'
  | 'warrior_fervor'
  | 'harvest_impact'
  | 'warrior_bite'
  | 'warrior_shear'
  | 'warrior_crush';
export type FragmentKind = 'ice_shard' | 'stone_chip' | 'metal_splinter';
export const BAKED_URLS = {
  smoke: '/textures/vfx/production/smoke.webp',
  shout_dust: '/textures/vfx/production/shout_dust.webp',
  warrior_power: '/textures/vfx/production/warrior_power.webp',
  warrior_fervor: '/textures/vfx/production/warrior_fervor.webp',
  harvest_impact: '/textures/vfx/production/harvest_impact.webp',
  warrior_bite: '/textures/vfx/production/warrior_bite.webp',
  warrior_shear: '/textures/vfx/production/warrior_shear.webp',
  warrior_crush: '/textures/vfx/production/warrior_crush.ktx2',
} as const;
export const FRAGMENT_URL = '/models/vfx/production_fragments.glb';
const textures = new Map<BakedKind, THREE.Texture>();
const PRESSURE_URL = '/textures/vfx/production/warrior_pressure.webp';
const BLOOD_URL = '/textures/vfx/production/warrior_blood_blade.webp';
const STEEL_URL = '/textures/vfx/production/warrior_forged_steel.webp';
const ROCK_URL = '/textures/terrain/Rock051_Color.jpg';
let rockTexture: THREE.Texture | null = null;
export function warriorRockTexture(): THREE.Texture | null {
  return rockTexture;
}
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
const geometry = new Map<FragmentKind, THREE.BufferGeometry>();

// The kit's sheets are big (2048px and one 4096px) and decode to full RGBA
// bitmaps, so nothing here rides the deferred preload lane any more: the
// whole set is loaded ON DEMAND, once per page, when the active Warrior kit is
// requested (a local Warrior at entry, or the first remote Warrior the painter
// sees), and DECLINED outright on constrained-memory devices, where every
// getter stays null, the kit stays cold and the generic presentation runs.
// The image sheets decode off the main thread (loadBitmapTexture): through
// the image path each one decoded inside its paced upload unit, 45 to 103 ms
// of one frame per sheet on an Intel HD 530. A bitmap pins its decoded RGBA
// (about 96 MB for the set) until closed, so each sheet releases it once
// uploaded, and a renderer rebuilt later decodes the set again before its kit
// recipe uploads it (ensureWarriorKitAssets).
export type WarriorKitAssetsState = 'idle' | 'declined' | 'loading' | 'ready' | 'failed';
let assetsState: WarriorKitAssetsState = 'idle';
let assetsTask: Promise<boolean> | null = null;
export function warriorKitAssetsState(): WarriorKitAssetsState {
  return assetsState;
}

/** Start (or join) the one load of the Warrior kit's textures, fragments and
 *  contact sheets. Resolves true once every asset is resident, false when the
 *  device declined them. A failed load resets so a later request can retry.
 *  The cast gate latches a decline for good, which holds because its one
 *  caller passes GFX.constrainedMemory, a device answer no graphics switch
 *  changes (pinned in tests/gfx_profile.test.ts). */
export function ensureWarriorKitAssets(constrainedMemory: boolean): Promise<boolean> {
  if (assetsTask && assetsState === 'ready') return restoreImageSheets();
  if (assetsTask) return assetsTask;
  if (constrainedMemory) {
    assetsState = 'declined';
    return Promise.resolve(false);
  }
  assetsState = 'loading';
  assetsTask = loadWarriorKitAssets().then(
    () => {
      assetsState = 'ready';
      return true;
    },
    (error: unknown) => {
      assetsState = 'failed';
      assetsTask = null;
      throw error;
    },
  );
  return assetsTask;
}

const imageSheets: THREE.Texture[] = [];

async function imageSheet(url: string, srgb: boolean): Promise<THREE.Texture> {
  const texture = (await loadBitmapTexture(url, { srgb })).clone();
  armBitmapSheetRelease(texture, () => loadBitmapTexture(url, { srgb }));
  imageSheets.push(texture);
  return texture;
}

/** Decodes again every sheet an earlier renderer's upload released, so this
 *  renderer's kit recipe uploads real texels. */
async function restoreImageSheets(): Promise<boolean> {
  await Promise.all(imageSheets.map((texture) => restoreBitmapSheet(texture)));
  return true;
}

async function loadWarriorKitAssets(): Promise<void> {
  imageSheets.length = 0;
  await Promise.all([
    ensureContactSheets(),
    ...Object.entries(BAKED_URLS).map(async ([kind, url]) => {
      const compressed = url.endsWith('.ktx2');
      const texture = compressed
        ? (await loadKtx2Texture(url, { large: true })).clone()
        : await imageSheet(url, true);
      // The authored cells carry baked gutters, so a mip chain cannot bleed
      // between them, and it is what keeps a 2048px sheet cheap to sample once
      // the contact is a few yards away (no chain means every distant texel
      // walk misses the cache and shimmers). A KTX2 sheet ships whatever chain
      // its encoder wrote, so its filters stay as loaded.
      texture.generateMipmaps = !compressed;
      texture.minFilter = compressed ? THREE.LinearFilter : THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.needsUpdate = true;
      textures.set(kind as BakedKind, texture);
    }),
  ]);
  // Grain data map: sampled at a fixed screen scale, so no chain.
  pressureTexture = await imageSheet(PRESSURE_URL, false);
  pressureTexture.colorSpace = THREE.NoColorSpace;
  pressureTexture.generateMipmaps = false;
  pressureTexture.minFilter = pressureTexture.magFilter = THREE.LinearFilter;
  bloodTexture = await imageSheet(BLOOD_URL, true);
  bloodTexture.generateMipmaps = true;
  bloodTexture.minFilter = THREE.LinearMipmapLinearFilter;
  bloodTexture.magFilter = THREE.LinearFilter;
  steelTexture = await imageSheet(STEEL_URL, true);
  steelTexture.generateMipmaps = true;
  steelTexture.minFilter = THREE.LinearMipmapLinearFilter;
  steelTexture.magFilter = THREE.LinearFilter;
  rockTexture = await imageSheet(ROCK_URL, true);
  rockTexture.generateMipmaps = true;
  rockTexture.minFilter = THREE.LinearMipmapLinearFilter;
  rockTexture.magFilter = THREE.LinearFilter;
  const model = await loadGltf(FRAGMENT_URL);
  model.scene.updateMatrixWorld(true);
  for (const name of ['ice_shard', 'stone_chip', 'metal_splinter'] as const) {
    const mesh = model.scene.getObjectByName(name) as THREE.Mesh | undefined;
    if (!mesh?.isMesh) throw new Error(`Missing production fragment: ${name}`);
    // Shared preparation-owned source; per-renderer pools clone it and dispose their clone.
    geometry.set(name, mesh.geometry.clone().applyMatrix4(mesh.matrixWorld));
  }
  releaseGltf(FRAGMENT_URL);
}

export const productionAssetInternalsForTest = {
  urls: [...Object.values(BAKED_URLS), PRESSURE_URL, BLOOD_URL, STEEL_URL, ROCK_URL, FRAGMENT_URL],
  reset(): void {
    textures.clear();
    imageSheets.length = 0;
    geometry.clear();
    rockTexture = steelTexture = bloodTexture = pressureTexture = null;
    assetsState = 'idle';
    assetsTask = null;
  },
};
export function bakedTexture(kind: BakedKind): THREE.Texture | null {
  return textures.get(kind) ?? null;
}
export function fragmentGeometry(kind: FragmentKind): THREE.BufferGeometry | null {
  return geometry.get(kind) ?? null;
}
