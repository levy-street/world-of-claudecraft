import * as THREE from 'three';
import { loadTexture } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { GFX, surfaceMat } from './gfx';

export const EASTBROOK_SURFACE_ATLAS_URL = '/textures/eastbrook_surface_atlas.webp';
export const EASTBROOK_SURFACE_ATLAS_SIZE = 512;
export const EASTBROOK_SURFACE_ATLAS_COLUMNS = 4;
export const EASTBROOK_SURFACE_ATLAS_ROWS = 4;

export const EASTBROOK_SURFACE_CELLS = Object.freeze({
  darkStoneBlocks: 0,
  lightStoneBlocks: 1,
  warmPlaster: 2,
  verticalDarkTimber: 3,
  cobaltRoofShingles: 4,
  darkForgedMetal: 5,
  warmGoldMetal: 6,
  horizontalWarmTimber: 7,
  blueCreamCanvas: 8,
  redCreamCanvas: 9,
  darkBrownLeather: 10,
  irregularDarkStone: 11,
  cyanCrystal: 12,
  cobaltPaintedPlanks: 13,
  lightGrayStone: 14,
  mediumGrayStone: 15,
});

export type EastbrookSurfaceSemantic = keyof typeof EASTBROOK_SURFACE_CELLS;
type SemanticAtVertex = EastbrookSurfaceSemantic | ((index: number) => EastbrookSurfaceSemantic);

const CELL_PADDING_PIXELS = 4;
const CELL_SIZE_UV = 1 / EASTBROOK_SURFACE_ATLAS_COLUMNS;
const CELL_PADDING_UV = CELL_PADDING_PIXELS / EASTBROOK_SURFACE_ATLAS_SIZE;

let loadedAtlas: THREE.Texture | null = null;

if (typeof window !== 'undefined') {
  registerDeferredPreload(() =>
    loadTexture(EASTBROOK_SURFACE_ATLAS_URL).then((texture) => {
      // Loader-cache results are immutable shared resources. Eastbrook identity
      // metadata stays module/root-side; consumers bind this exact texture.
      loadedAtlas = texture;
    }),
  );
}

export function eastbrookSurfaceAtlasTexture(): THREE.Texture | undefined {
  return loadedAtlas ?? undefined;
}

export interface EastbrookSurfaceAtlasMetadata {
  url: string;
  textureUuid: string | null;
  materialBindings: number;
}

export function eastbrookSurfaceAtlasMetadata(
  root: THREE.Object3D,
  atlas: THREE.Texture | undefined,
): EastbrookSurfaceAtlasMetadata {
  let materialBindings = 0;
  if (atlas) {
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if ((material as THREE.MeshStandardMaterial | THREE.MeshLambertMaterial).map === atlas) {
          materialBindings++;
        }
      }
    });
  }
  return {
    url: EASTBROOK_SURFACE_ATLAS_URL,
    textureUuid: atlas?.uuid ?? null,
    materialBindings,
  };
}

function normalized(value: number, minimum: number, maximum: number): number {
  const span = maximum - minimum;
  return span > 1e-8 ? THREE.MathUtils.clamp((value - minimum) / span, 0, 1) : 0.5;
}

function cellUv(
  semantic: EastbrookSurfaceSemantic,
  localU: number,
  localV: number,
): readonly [number, number] {
  const cell = EASTBROOK_SURFACE_CELLS[semantic];
  const column = cell % EASTBROOK_SURFACE_ATLAS_COLUMNS;
  const rowFromTop = Math.floor(cell / EASTBROOK_SURFACE_ATLAS_COLUMNS);
  const usable = CELL_SIZE_UV - CELL_PADDING_UV * 2;
  return [
    column * CELL_SIZE_UV + CELL_PADDING_UV + localU * usable,
    1 - (rowFromTop + 1) * CELL_SIZE_UV + CELL_PADDING_UV + localV * usable,
  ];
}

/** Clone loader-owned geometry and synthesize TEXCOORD_0 into one atlas cell per vertex. */
export function eastbrookSurfaceGeometry(
  source: THREE.BufferGeometry,
  semanticAtVertex: SemanticAtVertex,
): THREE.BufferGeometry {
  const geometry = source.clone();
  const position = geometry.getAttribute('position');
  if (!position) throw new Error('Eastbrook surface geometry requires positions');
  let normal = geometry.getAttribute('normal');
  if (!normal) {
    geometry.computeVertexNormals();
    normal = geometry.getAttribute('normal');
  }
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox as THREE.Box3;
  const uv = new Float32Array(position.count * 2);

  for (let index = 0; index < position.count; index++) {
    let localU: number;
    let localV: number;
    const nx = Math.abs(normal.getX(index));
    const ny = Math.abs(normal.getY(index));
    const nz = Math.abs(normal.getZ(index));
    if (nx >= ny && nx >= nz) {
      localU = normalized(position.getZ(index), bounds.min.z, bounds.max.z);
      localV = normalized(position.getY(index), bounds.min.y, bounds.max.y);
    } else if (ny >= nz) {
      localU = normalized(position.getX(index), bounds.min.x, bounds.max.x);
      localV = normalized(position.getZ(index), bounds.min.z, bounds.max.z);
    } else {
      localU = normalized(position.getX(index), bounds.min.x, bounds.max.x);
      localV = normalized(position.getY(index), bounds.min.y, bounds.max.y);
    }
    const semantic =
      typeof semanticAtVertex === 'function' ? semanticAtVertex(index) : semanticAtVertex;
    const [u, v] = cellUv(semantic, localU, localV);
    uv[index * 2] = u;
    uv[index * 2 + 1] = v;
  }

  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}

const townPaletteSemantics = [
  [0x30343a, 'darkStoneBlocks'],
  [0x555b61, 'mediumGrayStone'],
  [0x777d80, 'lightStoneBlocks'],
  [0x979b98, 'lightGrayStone'],
  [0x706b62, 'warmPlaster'],
  [0x999388, 'warmPlaster'],
  [0xb7b0a2, 'warmPlaster'],
  [0x211813, 'verticalDarkTimber'],
  [0x33251c, 'verticalDarkTimber'],
  [0x4c3829, 'horizontalWarmTimber'],
  [0x704e32, 'horizontalWarmTimber'],
  [0x0c2454, 'cobaltRoofShingles'],
  [0x153b88, 'cobaltRoofShingles'],
  [0x2658b1, 'cobaltRoofShingles'],
  [0x31363b, 'darkForgedMetal'],
  [0x596067, 'darkForgedMetal'],
  [0xa27320, 'warmGoldMetal'],
  [0xd4a23c, 'warmGoldMetal'],
  [0xffa127, 'mediumGrayStone'],
  [0xffdc77, 'mediumGrayStone'],
  [0x21c6e8, 'cyanCrystal'],
  [0x83efff, 'cyanCrystal'],
  [0x315b9d, 'blueCreamCanvas'],
  [0xd6c29d, 'blueCreamCanvas'],
  [0xaa4c39, 'redCreamCanvas'],
  [0x788f36, 'darkBrownLeather'],
  [0xd4a12e, 'darkBrownLeather'],
  [0xa95a45, 'darkBrownLeather'],
  [0x183e64, 'irregularDarkStone'],
  [0x181718, 'darkForgedMetal'],
] as const satisfies readonly (readonly [number, EastbrookSurfaceSemantic])[];

const townPalette = townPaletteSemantics.map(([hex, semantic]) => ({
  color: new THREE.Color(hex),
  semantic,
}));

/** Classify the final COLOR_0 value after source material tinting. */
export function eastbrookTownSemanticForColor(
  red: number,
  green: number,
  blue: number,
): EastbrookSurfaceSemantic {
  let best = townPalette[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of townPalette) {
    const dr = red - candidate.color.r;
    const dg = green - candidate.color.g;
    const db = blue - candidate.color.b;
    const distance = dr * dr + dg * dg + db * db;
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best.semantic;
}

export function eastbrookSemanticForMaterial(name: string): EastbrookSurfaceSemantic {
  const normalizedName = name.toLowerCase();
  if (normalizedName.includes('arcane') || normalizedName.includes('crystal')) return 'cyanCrystal';
  if (normalizedName.includes('bronze') || normalizedName.includes('gold')) return 'warmGoldMetal';
  if (normalizedName.includes('iron') || normalizedName.includes('metal')) return 'darkForgedMetal';
  if (normalizedName.includes('cobalt') || normalizedName.includes('painted'))
    return 'cobaltPaintedPlanks';
  if (normalizedName.includes('walnut')) return 'horizontalWarmTimber';
  if (normalizedName.includes('timber') || normalizedName.includes('wood'))
    return 'verticalDarkTimber';
  if (normalizedName.includes('leather')) return 'darkBrownLeather';
  if (normalizedName.includes('plaster')) return 'warmPlaster';
  if (normalizedName.includes('stone')) return 'lightStoneBlocks';
  return 'mediumGrayStone';
}

export function eastbrookMaterialUsesAtlas(
  source: THREE.Material,
  atlas: THREE.Texture | undefined = eastbrookSurfaceAtlasTexture(),
): boolean {
  const standard = source as THREE.MeshStandardMaterial;
  if (!atlas || !standard.isMeshStandardMaterial || standard.map) return false;
  const emissive =
    standard.emissive.getHex() !== 0 || source.name.toLowerCase().includes('emissive');
  const crystal = /arcane|crystal/i.test(source.name);
  return !emissive || crystal;
}

type MaterialCache = Map<string, THREE.Material>;
const convertedMaterials = new WeakMap<THREE.Material, MaterialCache>();

/** Preserve source maps/factors; texture-free Eastbrook materials share the one atlas map. */
export function eastbrookSurfaceMaterial(
  source: THREE.Material,
  atlas: THREE.Texture | undefined = eastbrookSurfaceAtlasTexture(),
): THREE.Material {
  const standard = source as THREE.MeshStandardMaterial;
  if (!standard.isMeshStandardMaterial) return source;
  const atlasMap = eastbrookMaterialUsesAtlas(source, atlas) ? atlas : undefined;
  const key = `${GFX.standardMaterials ? 'standard' : 'lambert'}|${atlasMap?.uuid ?? 'none'}`;
  let cache = convertedMaterials.get(source);
  if (!cache) {
    cache = new Map();
    convertedMaterials.set(source, cache);
  }
  const cached = cache.get(key);
  if (cached) return cached;

  const converted = surfaceMat({
    color: standard.color.getHex(),
    map: standard.map ?? atlasMap,
    vertexColors: standard.vertexColors,
    normalMap: standard.normalMap ?? undefined,
    roughnessMap: standard.roughnessMap ?? undefined,
    aoMap: standard.aoMap ?? undefined,
    roughness: standard.roughness,
    metalness: standard.metalness,
    flatShading: !GFX.standardMaterials || standard.flatShading,
    emissive: standard.emissive.getHex(),
    emissiveIntensity: standard.emissiveIntensity,
    side: standard.side,
  }).clone();
  converted.name = standard.name;
  converted.userData = { ...standard.userData };
  if (atlasMap) {
    converted.userData.eastbrookSurfaceAtlas = EASTBROOK_SURFACE_ATLAS_URL;
    converted.userData.eastbrookSurfaceSemantic = eastbrookSemanticForMaterial(standard.name);
  }
  cache.set(key, converted);
  return converted;
}

export const eastbrookSurfaceAtlasInternalsForTest = {
  cellUv,
};
