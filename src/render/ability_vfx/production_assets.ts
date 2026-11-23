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
//
// The load is cut into PIECES (WarriorKitPiece), each loaded at most once per
// page: the Warrior kit asks for every piece, the Paladin kit only for the few
// its landings borrow (PALADIN_BORROWED_PIECES), so a Paladin with no Warrior
// in sight never fetches the rest, and whichever kit comes second pays nothing
// for a piece the first already loaded. The decline is the same for both.
export type WarriorKitAssetsState = 'idle' | 'declined' | 'loading' | 'ready' | 'failed';
let assetsState: WarriorKitAssetsState = 'idle';
let assetsTask: Promise<boolean> | null = null;
/** The state of the WHOLE kit's load; a load of some pieces alone (the
 *  Paladin's, below) leaves it as it was. */
export function warriorKitAssetsState(): WarriorKitAssetsState {
  return assetsState;
}

/** One separately loadable piece of the kit: a baked sheet, a material map,
 *  the fragment model (every fragment kind is one file) or the contact sheets.
 *  Each loads at most once per page, whoever asks first, so a piece one kit
 *  already loaded is never fetched or decoded again for the other. */
export type WarriorKitPiece =
  | BakedKind
  | 'pressure'
  | 'blood'
  | 'steel'
  | 'rock'
  | 'fragments'
  | 'contacts';
const WHOLE_KIT: readonly WarriorKitPiece[] = [
  'contacts',
  ...(Object.keys(BAKED_URLS) as BakedKind[]),
  'pressure',
  'blood',
  'steel',
  'rock',
  'fragments',
];
/** What the Paladin landings borrow (fx.ts paladinBakedAt, paladinFragmentsAt,
 *  paladinCrestAt): the shout dust and smoke layers, the stone chips (the
 *  fragment model) and the leap_rupture slabs, whose fragment arm reads only
 *  the rock map (uKind 23 in signature_crests.ts: its steel sample is
 *  overwritten by the rock branch, and no pressure, blood or storm arm runs
 *  for it). About 1.9 MB of files: smoke.webp 165,534 bytes, shout_dust.webp
 *  156,584, Rock051_Color.jpg 1,584,524 and production_fragments.glb 15,268;
 *  the three sheets are 1024 by 1024 each. */
export const PALADIN_BORROWED_PIECES: readonly WarriorKitPiece[] = [
  'shout_dust',
  'smoke',
  'fragments',
  'rock',
];

/** Start (or join) the load of the Warrior kit's textures, fragments and
 *  contact sheets: the whole kit, or with `pieces` only those (the Paladin
 *  recipe's borrowed set). Resolves true once every asked piece is resident,
 *  false when the device declined them. A failed piece resets so a later
 *  request retries it alone. The cast gate latches a decline for good, which
 *  holds because its one caller passes GFX.constrainedMemory, a device answer
 *  no graphics switch changes (pinned in tests/gfx_profile.test.ts). */
export function ensureWarriorKitAssets(
  constrainedMemory: boolean,
  pieces?: readonly WarriorKitPiece[],
): Promise<boolean> {
  if (pieces) {
    if (constrainedMemory) return Promise.resolve(false);
    return loadPieces(pieces).then(() => restorePieces(pieces));
  }
  if (assetsTask && assetsState === 'ready') return restorePieces(WHOLE_KIT);
  if (assetsTask) return assetsTask;
  if (constrainedMemory) {
    assetsState = 'declined';
    return Promise.resolve(false);
  }
  assetsState = 'loading';
  assetsTask = loadPieces(WHOLE_KIT).then(
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

/** Each piece's image sheets, kept so a later request decodes the released
 *  ones again for a rebuilt renderer. */
const pieceSheets = new Map<WarriorKitPiece, THREE.Texture>();
const pieceTasks = new Map<WarriorKitPiece, Promise<void>>();

async function imageSheet(
  piece: WarriorKitPiece,
  url: string,
  srgb: boolean,
): Promise<THREE.Texture> {
  const texture = (await loadBitmapTexture(url, { srgb })).clone();
  armBitmapSheetRelease(texture, () => loadBitmapTexture(url, { srgb }));
  pieceSheets.set(piece, texture);
  return texture;
}

/** Decodes again every sheet of `pieces` an earlier renderer's upload
 *  released, so this renderer's kit recipe uploads real texels. */
async function restorePieces(pieces: readonly WarriorKitPiece[]): Promise<boolean> {
  await Promise.all(
    pieces.map((piece) => {
      const sheet = pieceSheets.get(piece);
      return sheet ? restoreBitmapSheet(sheet) : undefined;
    }),
  );
  return true;
}

function loadPieces(pieces: readonly WarriorKitPiece[]): Promise<void> {
  return Promise.all(pieces.map(loadPiece)).then(() => undefined);
}

function loadPiece(piece: WarriorKitPiece): Promise<void> {
  // The contact sheets keep their own one-load-per-page record.
  if (piece === 'contacts') return ensureContactSheets();
  let task = pieceTasks.get(piece);
  if (!task) {
    task = PIECE_LOADERS[piece]().catch((error: unknown) => {
      pieceTasks.delete(piece);
      throw error;
    });
    pieceTasks.set(piece, task);
  }
  return task;
}

async function loadBaked(kind: BakedKind): Promise<void> {
  const url = BAKED_URLS[kind];
  const compressed = url.endsWith('.ktx2');
  const texture = compressed
    ? (await loadKtx2Texture(url, { large: true })).clone()
    : await imageSheet(kind, url, true);
  // The authored cells carry baked gutters, so a mip chain cannot bleed
  // between them, and it is what keeps a 2048px sheet cheap to sample once
  // the contact is a few yards away (no chain means every distant texel
  // walk misses the cache and shimmers). A KTX2 sheet ships whatever chain
  // its encoder wrote, so its filters stay as loaded.
  texture.generateMipmaps = !compressed;
  texture.minFilter = compressed ? THREE.LinearFilter : THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  textures.set(kind, texture);
}

async function mipmappedMap(piece: WarriorKitPiece, url: string): Promise<THREE.Texture> {
  const texture = await imageSheet(piece, url, true);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

async function loadFragments(): Promise<void> {
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

const PIECE_LOADERS: Record<Exclude<WarriorKitPiece, 'contacts'>, () => Promise<void>> = {
  smoke: () => loadBaked('smoke'),
  shout_dust: () => loadBaked('shout_dust'),
  warrior_power: () => loadBaked('warrior_power'),
  warrior_fervor: () => loadBaked('warrior_fervor'),
  harvest_impact: () => loadBaked('harvest_impact'),
  warrior_bite: () => loadBaked('warrior_bite'),
  warrior_shear: () => loadBaked('warrior_shear'),
  warrior_crush: () => loadBaked('warrior_crush'),
  // Grain data map: sampled at a fixed screen scale, so no chain.
  pressure: async () => {
    const texture = await imageSheet('pressure', PRESSURE_URL, false);
    texture.colorSpace = THREE.NoColorSpace;
    texture.generateMipmaps = false;
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    pressureTexture = texture;
  },
  blood: async () => {
    bloodTexture = await mipmappedMap('blood', BLOOD_URL);
  },
  steel: async () => {
    steelTexture = await mipmappedMap('steel', STEEL_URL);
  },
  rock: async () => {
    rockTexture = await mipmappedMap('rock', ROCK_URL);
  },
  fragments: loadFragments,
};

export const productionAssetInternalsForTest = {
  urls: [...Object.values(BAKED_URLS), PRESSURE_URL, BLOOD_URL, STEEL_URL, ROCK_URL, FRAGMENT_URL],
  reset(): void {
    textures.clear();
    pieceSheets.clear();
    pieceTasks.clear();
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
