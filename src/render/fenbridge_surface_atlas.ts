import * as THREE from 'three';
import { loadTexture } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { FENBRIDGE_SURFACE_ANISOTROPY } from './fenbridge_surface_mapping';
import { GFX } from './gfx';
import { applySurfaceDetail } from './worn_stone';

export {
  FENBRIDGE_EXPORTER_PALETTE_SEMANTICS,
  FENBRIDGE_SURFACE_ANISOTROPY,
  FENBRIDGE_SURFACE_ATLAS_SIZE,
  FENBRIDGE_SURFACE_CELLS,
  FENBRIDGE_SURFACE_NORMAL_SCALE,
  FENBRIDGE_SURFACE_RESPONSE_CHANNELS,
  FENBRIDGE_SURFACE_WORLD_SPAN,
  type FenbridgeSurfaceSemantic,
  fenbridgeSemanticForColor,
  fenbridgeSurfaceGeometry,
} from './fenbridge_surface_mapping';

export const FENBRIDGE_SURFACE_ATLAS_URL = '/textures/fenbridge_surface_atlas.webp';
export const FENBRIDGE_SURFACE_NORMAL_URL = '/textures/fenbridge_surface_normal.webp';
export const FENBRIDGE_SURFACE_ROUGHNESS_URL = '/textures/fenbridge_surface_roughness.webp';

let loadedAtlas: THREE.Texture | null = null;
let loadedNormal: THREE.Texture | null = null;
let loadedRoughness: THREE.Texture | null = null;

/** Keep padded atlas cells clamped while sharpening oblique town surfaces. */
export function configureFenbridgeSurfaceTexture(texture: THREE.Texture): THREE.Texture {
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = Math.max(texture.anisotropy, FENBRIDGE_SURFACE_ANISOTROPY);
  return texture;
}

if (typeof window !== 'undefined') {
  // Preload membership is deliberately tier-independent. Low binds the color
  // atlas only; Standard tiers also bind the two non-color companions.
  registerDeferredPreload(() =>
    loadTexture(FENBRIDGE_SURFACE_ATLAS_URL, { srgb: true }).then((texture) => {
      loadedAtlas = configureFenbridgeSurfaceTexture(texture);
    }),
  );
  registerDeferredPreload(() =>
    loadTexture(FENBRIDGE_SURFACE_NORMAL_URL).then((texture) => {
      loadedNormal = configureFenbridgeSurfaceTexture(texture);
    }),
  );
  registerDeferredPreload(() =>
    loadTexture(FENBRIDGE_SURFACE_ROUGHNESS_URL).then((texture) => {
      loadedRoughness = configureFenbridgeSurfaceTexture(texture);
    }),
  );
}

export function fenbridgeSurfaceAtlasTexture(): THREE.Texture | undefined {
  return loadedAtlas ?? undefined;
}

export function fenbridgeSurfaceNormalTexture(): THREE.Texture | undefined {
  return loadedNormal ?? undefined;
}

export function fenbridgeSurfaceRoughnessTexture(): THREE.Texture | undefined {
  return loadedRoughness ?? undefined;
}

const CELL_DETAIL_MASK = Object.freeze([
  1, // mossStone
  1, // cleanStone
  0.75, // darkTimber
  0.75, // warmTimber
  0.65, // tealShingles
  0.45, // forgedIron
  0.4, // agedBrass
  0.5, // rope
  0.4, // tealCanvas
  0.3, // parchment
  0.45, // curedHide
  0.9, // packedMud
  0, // tealFenlight
  0, // potionGlass
  0.75, // rawBoard
  0.2, // redWax
]);

/** High/Ultra's optional world-scale detail over the shared atlas. */
export function applyFenbridgeTownSurfaceDetail(material: THREE.Material): THREE.Material {
  const standard = material as THREE.MeshStandardMaterial;
  if (!GFX.surfaceDetail || !standard.isMeshStandardMaterial || !standard.map) return material;
  if (standard.emissive.getHex() !== 0) return material;
  applySurfaceDetail(standard, 'stone', { strength: 0.26, cellMask: CELL_DETAIL_MASK });
  return material;
}

export interface FenbridgeSurfaceAtlasMetadata {
  url: string;
  normalUrl: string;
  roughnessUrl: string;
  textureUuid: string | null;
  materialBindings: number;
  pbrBindings: number;
}

export function fenbridgeSurfaceAtlasMetadata(
  root: THREE.Object3D,
  atlas: THREE.Texture | undefined,
): FenbridgeSurfaceAtlasMetadata {
  let materialBindings = 0;
  let pbrBindings = 0;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      const surface = material as THREE.MeshStandardMaterial | THREE.MeshLambertMaterial;
      if (atlas && surface.map === atlas) materialBindings++;
      if (
        surface instanceof THREE.MeshStandardMaterial &&
        surface.normalMap !== null &&
        surface.roughnessMap !== null &&
        surface.metalnessMap === surface.roughnessMap
      ) {
        pbrBindings++;
      }
    }
  });
  return {
    url: FENBRIDGE_SURFACE_ATLAS_URL,
    normalUrl: FENBRIDGE_SURFACE_NORMAL_URL,
    roughnessUrl: FENBRIDGE_SURFACE_ROUGHNESS_URL,
    textureUuid: atlas?.uuid ?? null,
    materialBindings,
    pbrBindings,
  };
}
