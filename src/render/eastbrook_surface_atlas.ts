import * as THREE from 'three';
import { loadTexture } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { GFX, surfaceMat } from './gfx';
import { renderLayerDisabled } from './render_dev_flags';
import { applySurfaceDetail, type SurfaceFamily } from './worn_stone';

export const EASTBROOK_SURFACE_ATLAS_URL = '/textures/eastbrook_surface_atlas.webp';
// Baked PBR companions to the color atlas (scripts/assets/eastbrook_town/
// build_surface_pbr.mjs): same 4x4 cell layout, so the synthesized cell UVs
// address all three textures at once. Both are non-color data.
export const EASTBROOK_SURFACE_NORMAL_URL = '/textures/eastbrook_surface_normal.webp';
export const EASTBROOK_SURFACE_ROUGH_URL = '/textures/eastbrook_surface_rough.webp';
// Subtle relief for the cozy low-poly art style, not photoreal depth.
export const EASTBROOK_SURFACE_NORMAL_SCALE = 0.6;
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
let loadedNormal: THREE.Texture | null = null;
let loadedRough: THREE.Texture | null = null;

if (typeof window !== 'undefined') {
  registerDeferredPreload(() =>
    loadTexture(EASTBROOK_SURFACE_ATLAS_URL).then((texture) => {
      // Loader-cache results are immutable shared resources. Eastbrook identity
      // metadata stays module/root-side; consumers bind this exact texture.
      loadedAtlas = texture;
    }),
  );
  // Non-srgb loads keep loadTexture's default NoColorSpace, which is what
  // normal/roughness data needs. Preload sets stay tier-independent (the
  // import-time tier is only a guess); Lambert tiers simply never bind these.
  registerDeferredPreload(() =>
    loadTexture(EASTBROOK_SURFACE_NORMAL_URL).then((texture) => {
      loadedNormal = texture;
    }),
  );
  registerDeferredPreload(() =>
    loadTexture(EASTBROOK_SURFACE_ROUGH_URL).then((texture) => {
      loadedRough = texture;
    }),
  );
}

export function eastbrookSurfaceAtlasTexture(): THREE.Texture | undefined {
  return loadedAtlas ?? undefined;
}

export function eastbrookSurfaceNormalTexture(): THREE.Texture | undefined {
  return loadedNormal ?? undefined;
}

export function eastbrookSurfaceRoughnessTexture(): THREE.Texture | undefined {
  return loadedRough ?? undefined;
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

// ---------------------------------------------------------------------------
// Triplanar surface detail OVER the baked atlas. The baked PBR companions
// stretch one 124px cell across an entire building face (cell UVs come from
// bounding-box normalization), so their relief is far too low-frequency to
// read on a keep wall: the town judged FLAT with them alone. The world-space
// triplanar layer tiles at real-world scale on top, kept conservative
// (~0.3) so the two never fight; per-cell strengths taper it on canvas,
// metal, and crystal so one merged vertex-colored batch still reads right.
// ---------------------------------------------------------------------------

/** Conservative triplanar strength over the baked atlas. */
export const EASTBROOK_TRIPLANAR_STRENGTH = 0.3;

/** Per-semantic triplanar family for materials with ONE semantic (the Grand
 *  Armoury's named materials). null = keep clean (crystal glow). */
const TRIPLANAR_BY_SEMANTIC: Record<
  EastbrookSurfaceSemantic,
  { family: SurfaceFamily; strength: number } | null
> = {
  darkStoneBlocks: { family: 'stone', strength: 0.3 },
  lightStoneBlocks: { family: 'stone', strength: 0.3 },
  warmPlaster: { family: 'plaster', strength: 0.3 },
  verticalDarkTimber: { family: 'wood', strength: 0.3 },
  cobaltRoofShingles: { family: 'wood', strength: 0.28 },
  darkForgedMetal: { family: 'metal', strength: 0.3 },
  warmGoldMetal: { family: 'metal', strength: 0.25 },
  horizontalWarmTimber: { family: 'wood', strength: 0.3 },
  blueCreamCanvas: { family: 'fabric', strength: 0.25 },
  redCreamCanvas: { family: 'fabric', strength: 0.25 },
  darkBrownLeather: { family: 'fabric', strength: 0.25 },
  irregularDarkStone: { family: 'stone', strength: 0.3 },
  cyanCrystal: null,
  cobaltPaintedPlanks: { family: 'wood', strength: 0.28 },
  lightGrayStone: { family: 'stone', strength: 0.3 },
  mediumGrayStone: { family: 'stone', strength: 0.3 },
};

/** Per-cell strength mask (16 entries, cell order) for MERGED town batches
 *  that mix semantics in one material: full weight on stone cells, tapered on
 *  wood/metal/canvas, zero on crystal. Applied to the stone family, so the
 *  taper keeps masonry texture off painted canvas. */
const TOWN_CELL_MASK: readonly number[] = Object.freeze(
  Object.keys(EASTBROOK_SURFACE_CELLS).map((semantic) => {
    switch (semantic as EastbrookSurfaceSemantic) {
      case 'darkStoneBlocks':
      case 'lightStoneBlocks':
      case 'irregularDarkStone':
      case 'lightGrayStone':
      case 'mediumGrayStone':
        return 1;
      case 'warmPlaster':
        return 0.85;
      case 'cobaltRoofShingles':
        return 0.75;
      case 'verticalDarkTimber':
      case 'horizontalWarmTimber':
      case 'cobaltPaintedPlanks':
        return 0.7;
      case 'darkForgedMetal':
        return 0.6;
      case 'warmGoldMetal':
      case 'darkBrownLeather':
        return 0.5;
      case 'blueCreamCanvas':
      case 'redCreamCanvas':
        return 0.45;
      case 'cyanCrystal':
        return 0;
      default:
        return 0.5;
    }
  }),
);

/**
 * Attach the conservative triplanar layer to a MERGED multi-semantic town
 * material (the vertex-colored building/micro/wall batches): the stone family
 * with the per-cell mask, which reads the material's own atlas UV per
 * fragment. No-op on Lambert tiers, emissive/atlas-less materials, and
 * repeated calls (the worn layer's identity guard).
 */
export function applyEastbrookTownSurfaceDetail(material: THREE.Material): THREE.Material {
  const standard = material as THREE.MeshStandardMaterial;
  if (!GFX.standardMaterials || !standard.isMeshStandardMaterial) return material;
  // Dev-only perf-attribution kill switch (?ebdetail=off): isolates the
  // Eastbrook triplanar-over-atlas cost from the rest of the worn layer.
  if (renderLayerDisabled('ebdetail')) return material;
  if (standard.emissive.getHex() !== 0 || !standard.map) return material;
  applySurfaceDetail(standard, 'stone', {
    strength: EASTBROOK_TRIPLANAR_STRENGTH,
    cellMask: TOWN_CELL_MASK,
  });
  return material;
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
let convertedMaterials = new WeakMap<THREE.Material, MaterialCache>();

export function resetEastbrookSurfaceProfileCaches(): void {
  convertedMaterials = new WeakMap<THREE.Material, MaterialCache>();
}

/** Preserve source maps/factors; texture-free Eastbrook materials share the one atlas map. */
export function eastbrookSurfaceMaterial(
  source: THREE.Material,
  atlas: THREE.Texture | undefined = eastbrookSurfaceAtlasTexture(),
): THREE.Material {
  const standard = source as THREE.MeshStandardMaterial;
  if (!standard.isMeshStandardMaterial) return source;
  const atlasMap = eastbrookMaterialUsesAtlas(source, atlas) ? atlas : undefined;
  // The baked PBR companions share the color atlas's cell layout, so they are
  // only valid on atlas-bound materials (whose UVs were synthesized into
  // cells). Lambert tiers skip them outright; surfaceMat would drop them.
  const atlasNormal =
    atlasMap && GFX.standardMaterials ? eastbrookSurfaceNormalTexture() : undefined;
  const atlasRough =
    atlasMap && GFX.standardMaterials ? eastbrookSurfaceRoughnessTexture() : undefined;
  const key = `${GFX.standardMaterials ? 'standard' : 'lambert'}|${atlasMap?.uuid ?? 'none'}`;
  let cache = convertedMaterials.get(source);
  if (!cache) {
    cache = new Map();
    convertedMaterials.set(source, cache);
  }
  const cached = cache.get(key);
  if (cached) return cached;

  const injectedRough = !standard.roughnessMap && atlasRough !== undefined;
  const converted = surfaceMat({
    color: standard.color.getHex(),
    map: standard.map ?? atlasMap,
    vertexColors: standard.vertexColors,
    normalMap: standard.normalMap ?? atlasNormal,
    roughnessMap: standard.roughnessMap ?? atlasRough,
    aoMap: standard.aoMap ?? undefined,
    // The rough atlas bakes per-cell base roughness, so it becomes the
    // authority when injected; source-authored factors keep their meaning
    // whenever the source ships its own roughness data.
    roughness: injectedRough ? 1 : standard.roughness,
    metalness: standard.metalness,
    flatShading: !GFX.standardMaterials || standard.flatShading,
    emissive: standard.emissive.getHex(),
    emissiveIntensity: standard.emissiveIntensity,
    side: standard.side,
  }).clone();
  converted.name = standard.name;
  converted.userData = { ...standard.userData };
  if (atlasNormal && !standard.normalMap && converted instanceof THREE.MeshStandardMaterial) {
    converted.normalScale.setScalar(EASTBROOK_SURFACE_NORMAL_SCALE);
  }
  if (atlasMap) {
    const semantic = eastbrookSemanticForMaterial(standard.name);
    converted.userData.eastbrookSurfaceAtlas = EASTBROOK_SURFACE_ATLAS_URL;
    converted.userData.eastbrookSurfaceSemantic = semantic;
    // Single-semantic materials (the Grand Armoury kit) take the properly
    // routed triplanar family over the baked atlas; crystal stays clean.
    const triplanar = TRIPLANAR_BY_SEMANTIC[semantic];
    if (
      triplanar &&
      GFX.standardMaterials &&
      !renderLayerDisabled('ebdetail') &&
      converted instanceof THREE.MeshStandardMaterial
    ) {
      applySurfaceDetail(converted, triplanar.family, { strength: triplanar.strength });
    }
  }
  cache.set(key, converted);
  return converted;
}

export const eastbrookSurfaceAtlasInternalsForTest = {
  cellUv,
};
