import * as THREE from 'three';
import type { FeatureFootprint } from './zone_feature_visibility_core';

type RenderDiagnosticsCategory = string;

export type RenderableDiagnosticObject = THREE.Object3D & {
  isMesh?: boolean;
  isInstancedMesh?: boolean;
  isSkinnedMesh?: boolean;
  isPoints?: boolean;
  isSprite?: boolean;
  isLine?: boolean;
  isLineSegments?: boolean;
  geometry?: THREE.BufferGeometry;
  material?: THREE.Material | THREE.Material[];
  count?: number;
};

export type TextureBackedMaterial = THREE.Material & {
  map?: THREE.Texture | null;
  alphaMap?: THREE.Texture | null;
  aoMap?: THREE.Texture | null;
  bumpMap?: THREE.Texture | null;
  displacementMap?: THREE.Texture | null;
  emissiveMap?: THREE.Texture | null;
  envMap?: THREE.Texture | null;
  lightMap?: THREE.Texture | null;
  metalnessMap?: THREE.Texture | null;
  normalMap?: THREE.Texture | null;
  roughnessMap?: THREE.Texture | null;
  specularMap?: THREE.Texture | null;
  gradientMap?: THREE.Texture | null;
};

export interface RenderDiagnosticsCategoryStats {
  objects: number;
  draws: number;
  triangles: number;
  points: number;
  materials: number;
  materialSamples: string[];
}

export interface RenderDiagnosticsSnapshot {
  enabled: boolean;
  totalObjects: number;
  estimatedDraws: number;
  estimatedTriangles: number;
  estimatedPoints: number;
  programs: number;
  programDelta: number;
  textures: number;
  textureDelta: number;
  newMaterials: string[];
  firstVisibleObjects: string[];
  categories: Record<RenderDiagnosticsCategory, RenderDiagnosticsCategoryStats>;
}

export interface RenderDiagnosticsState {
  lastPrograms: number;
  lastTextures: number;
  knownMaterials: Set<string>;
  knownVisibleObjects: Set<string>;
}

interface CollectedRenderDiagnostics {
  snapshot: RenderDiagnosticsSnapshot;
  lastPrograms: number;
  lastTextures: number;
}

type MutableCategoryStats = RenderDiagnosticsCategoryStats & {
  materialKeys: Set<string>;
};

export type TextureMaterialKey = keyof Omit<TextureBackedMaterial, keyof THREE.Material>;

export function emptyRenderDiagnosticsSnapshot(): RenderDiagnosticsSnapshot {
  return {
    enabled: false,
    totalObjects: 0,
    estimatedDraws: 0,
    estimatedTriangles: 0,
    estimatedPoints: 0,
    programs: 0,
    programDelta: 0,
    textures: 0,
    textureDelta: 0,
    newMaterials: [],
    firstVisibleObjects: [],
    categories: {},
  };
}

function loopbackHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]'
  );
}

export function localRenderDiagnosticsEnabled(): boolean {
  if (!import.meta.env.DEV) return false;
  if (typeof location === 'undefined') return false;
  if (!loopbackHostname(location.hostname)) return false;
  const params = new URLSearchParams(location.search);
  return (
    params.get('perfTrace') === '1' ||
    params.get('perf_trace') === '1' ||
    params.get('renderTrace') === '1'
  );
}

/**
 * The world-space XZ footprint of a static feature group, for the per-frame
 * distance cull (see zone_feature_visibility_core.ts). Measured once, right
 * after the group is frozen: these groups never move again, so re-deriving
 * bounds every frame would be pure waste. Null when the group has no
 * measurable geometry, which the caller treats as "always visible".
 */
export function measureFeatureFootprint(root: THREE.Object3D): FeatureFootprint | null {
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return null;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  return { centerX: center.x, centerZ: center.z, halfX: size.x / 2, halfZ: size.z / 2 };
}

// Diagnostics-only label (the census buckets and the renderTrace walker read
// it); NEVER a behavior or visibility gate, so tagging an actionable object
// (team rings, corpse beacon) can never become a graphics-fairness break.
export function setRenderCategory(obj: THREE.Object3D, category: RenderDiagnosticsCategory): void {
  obj.userData.renderCategory = category;
}

function materialLabels(material: THREE.Material | THREE.Material[] | undefined): string[] {
  const mats = Array.isArray(material) ? material : material ? [material] : [];
  return mats.map((mat) => `${mat.name || mat.type}:${mat.uuid.slice(0, 8)}`);
}

function drawCountFor(
  material: THREE.Material | THREE.Material[] | undefined,
  geometry?: THREE.BufferGeometry,
): number {
  if (!material) return 1;
  if (Array.isArray(material)) return Math.max(1, geometry?.groups.length || material.length);
  return Math.max(
    1,
    geometry?.groups.length && geometry.groups.length > 0 ? geometry.groups.length : 1,
  );
}

function triangleCountFor(geometry?: THREE.BufferGeometry): number {
  if (!geometry) return 0;
  const drawCount = geometry.index?.count ?? geometry.getAttribute('position')?.count ?? 0;
  return Math.max(0, Math.floor(drawCount / 3));
}

function objectDiagnosticLabel(obj: THREE.Object3D, category: string, labels: string[]): string {
  const name = obj.name || obj.type;
  const material = labels[0] ?? 'no-material';
  return `${category}:${name}:${material}`.slice(0, 140);
}

function categoryStats(
  categories: Record<string, MutableCategoryStats>,
  category: string,
): MutableCategoryStats {
  categories[category] ??= {
    objects: 0,
    draws: 0,
    triangles: 0,
    points: 0,
    materials: 0,
    materialSamples: [],
    materialKeys: new Set<string>(),
  };
  return categories[category];
}

export function collectRenderDiagnostics(
  scene: THREE.Scene,
  info: THREE.WebGLInfo,
  state: RenderDiagnosticsState,
): CollectedRenderDiagnostics {
  const programs = info.programs?.length ?? 0;
  const textures = info.memory.textures;
  const categories: Record<string, MutableCategoryStats> = {};
  const totals = { objects: 0, draws: 0, triangles: 0, points: 0 };
  const newMaterials: string[] = [];
  const firstVisibleObjects: string[] = [];

  const visit = (
    obj: THREE.Object3D,
    inheritedCategory: string,
    inheritedVisible: boolean,
  ): void => {
    const visible = inheritedVisible && obj.visible;
    const category =
      typeof obj.userData.renderCategory === 'string'
        ? (obj.userData.renderCategory as string)
        : inheritedCategory;
    if (visible) {
      const renderable = obj as RenderableDiagnosticObject;
      const hasMesh = Boolean(
        renderable.isMesh || renderable.isInstancedMesh || renderable.isSkinnedMesh,
      );
      const hasPoints = Boolean(renderable.isPoints);
      const hasSprite = Boolean(renderable.isSprite);
      const hasLine = Boolean(renderable.isLine || renderable.isLineSegments);
      if (hasMesh || hasPoints || hasSprite || hasLine) {
        const geometry = renderable.geometry;
        const material = renderable.material;
        const stat = categoryStats(categories, category);
        const labels = materialLabels(material);
        const draws = drawCountFor(material, geometry);
        let triangles = 0;
        let pointCount = 0;
        if (hasMesh) {
          const instanceCount = renderable.isInstancedMesh ? Math.max(0, renderable.count ?? 0) : 1;
          triangles = triangleCountFor(geometry) * instanceCount;
        } else if (hasSprite) {
          triangles = 2;
        } else if (hasPoints) {
          pointCount = geometry?.getAttribute('position')?.count ?? 0;
        }
        stat.objects++;
        stat.draws += draws;
        stat.triangles += triangles;
        stat.points += pointCount;
        totals.objects++;
        totals.draws += draws;
        totals.triangles += triangles;
        totals.points += pointCount;
        for (const label of labels) {
          if (!stat.materialKeys.has(label)) {
            stat.materialKeys.add(label);
            if (stat.materialSamples.length < 8) stat.materialSamples.push(label);
          }
          if (!state.knownMaterials.has(label)) {
            state.knownMaterials.add(label);
            if (newMaterials.length < 16) newMaterials.push(label);
          }
        }
        const visibleKey = `${category}|${obj.uuid}|${geometry?.uuid ?? ''}|${labels.join('|')}`;
        if (!state.knownVisibleObjects.has(visibleKey)) {
          state.knownVisibleObjects.add(visibleKey);
          if (firstVisibleObjects.length < 16)
            firstVisibleObjects.push(objectDiagnosticLabel(obj, category, labels));
        }
      }
    }
    for (const child of obj.children) visit(child, category, visible);
  };
  visit(scene, 'unknown', true);

  const outCategories: Record<string, RenderDiagnosticsCategoryStats> = {};
  for (const [category, stat] of Object.entries(categories)) {
    outCategories[category] = {
      objects: stat.objects,
      draws: stat.draws,
      triangles: stat.triangles,
      points: stat.points,
      materials: stat.materialKeys.size,
      materialSamples: stat.materialSamples,
    };
  }
  return {
    snapshot: {
      enabled: true,
      totalObjects: totals.objects,
      estimatedDraws: totals.draws,
      estimatedTriangles: totals.triangles,
      estimatedPoints: totals.points,
      programs,
      programDelta: programs - state.lastPrograms,
      textures,
      textureDelta: textures - state.lastTextures,
      newMaterials,
      firstVisibleObjects,
      categories: outCategories,
    },
    lastPrograms: programs,
    lastTextures: textures,
  };
}
