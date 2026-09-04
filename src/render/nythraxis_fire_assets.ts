// The Nythraxis mechanic props from the Tripo asset pipeline: the three fire
// clusters (Grave Flame, Soulfire, the Gravefire tongue) and the Binding
// Sigil's bone cage. This module owns loading and preparing them, and the
// instanced fire helper the patch and line painters draw with.
//
// Loading: deferred preloads (world-entry lane, never the launcher), the same
// contract the streetlamp fixtures use. Preparation normalizes every mesh into
// one space (foot at y 0, centred on XZ, scaled to the authored target height)
// and converts the exported PBR materials: fire becomes unlit additive glow
// (fire lights the crypt, the crypt never lights fire), the cage stays a lit
// surface. Geometry is shared and never disposed per visual; each visual gets
// its own material clones so it can pulse opacity on its own.
//
// Until a model has loaded (or when it fails to), every painter falls back to
// the procedural crossed-quad tongue, so a Node test host, a slow connection,
// and a missing file all still draw the actionable fire.

import * as THREE from 'three';
import { loadGltf, releaseGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { GFX } from './gfx';
import { NYTHRAXIS_FLAME_TONGUE_GEOMETRY } from './nythraxis_flame_tongue';

export type NythraxisFireKind = 'grave' | 'soul' | 'gravefire';
export type NythraxisPropKind = NythraxisFireKind | 'cage';

export interface NythraxisPropAssetDef {
  url: string;
  /**
   * World units the prepared model stands at instance scale 1, foot at y 0.
   * The fire painters scale each plume by its pose height (roughly 0.25 to
   * 0.8, flickering), so a fire's unit height is set well above the flame
   * height wanted on the floor: a typical plume lands near half of it.
   */
  targetHeight: number;
  /** Fire is unlit and never lit by the crypt; the cage is a lit prop. */
  surface: 'fire' | 'prop';
}

export const NYTHRAXIS_PROP_ASSET_DEFS: Readonly<Record<NythraxisPropKind, NythraxisPropAssetDef>> =
  {
    grave: { url: '/models/props/nythraxis_grave_flame.glb', targetHeight: 4.4, surface: 'fire' },
    soul: { url: '/models/props/nythraxis_soulfire.glb', targetHeight: 4.8, surface: 'fire' },
    gravefire: { url: '/models/props/nythraxis_gravefire.glb', targetHeight: 3.4, surface: 'fire' },
    cage: { url: '/models/props/nythraxis_binding_cage.glb', targetHeight: 6, surface: 'prop' },
  };

/** Multiplier on a fire model's albedo colour: unlit and untonemapped, above 1 glows. */
export const NYTHRAXIS_FIRE_BRIGHTNESS = 1.35;

export interface NythraxisPropPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

export interface NythraxisPropAsset {
  kind: NythraxisPropKind;
  parts: readonly NythraxisPropPart[];
  width: number;
  height: number;
  depth: number;
}

const loadedSources = new Map<NythraxisPropKind, THREE.Object3D>();
const preparedAssets = new Map<NythraxisPropKind, NythraxisPropAsset>();
const failedKinds = new Set<NythraxisPropKind>();

if (typeof window !== 'undefined') {
  for (const [kind, def] of Object.entries(NYTHRAXIS_PROP_ASSET_DEFS) as [
    NythraxisPropKind,
    NythraxisPropAssetDef,
  ][]) {
    registerDeferredPreload(() =>
      loadGltf(def.url)
        .then((gltf) => {
          loadedSources.set(kind, gltf.scene);
        })
        .catch(() => {
          // A missing or broken model is not a broken fight: the painters keep
          // their procedural fire. The preload lane records the rejection.
          failedKinds.add(kind);
        }),
    );
  }
}

// Meshopt-quantized GLBs arrive as normalized integer attributes; Three's
// geometry transforms clamp writes back into that range. Expand first.
function attributeToFloat(geometry: THREE.BufferGeometry, name: string): void {
  const attribute = geometry.getAttribute(name);
  if (!attribute || (attribute.array instanceof Float32Array && !attribute.normalized)) return;
  const values = new Float32Array(attribute.count * attribute.itemSize);
  for (let index = 0; index < attribute.count; index++) {
    for (let component = 0; component < attribute.itemSize; component++) {
      values[index * attribute.itemSize + component] = attribute.getComponent(index, component);
    }
  }
  geometry.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize));
}

/**
 * Fire: the authored colour map, unlit and untonemapped so it burns at full
 * saturation in the dark crypt. Normal blending on purpose: additive fire
 * summed over the bright telegraph strips washed out to white, while a solid
 * painted plume keeps its yellow core and coloured tips (cartoon fire, the
 * same read as the rest of the low-poly world).
 */
function fireMaterial(source: THREE.Material): THREE.Material {
  const standard = source as THREE.MeshStandardMaterial;
  const color = standard.color?.clone() ?? new THREE.Color(0xffffff);
  // The generated albedo is painted for a lit scene and reads dull unlit;
  // over-driving the colour (untonemapped) brings the cores back to a glow.
  color.multiplyScalar(NYTHRAXIS_FIRE_BRIGHTNESS);
  return new THREE.MeshBasicMaterial({
    name: `nythraxis-fire:${source.name}`,
    map: standard.map ?? null,
    color,
    vertexColors: standard.vertexColors === true,
    transparent: true,
    opacity: 1,
    blending: THREE.NormalBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

/** The cage: a lit surface, every authored flag carried across. */
function propMaterial(source: THREE.Material): THREE.Material {
  const standard = source as THREE.MeshStandardMaterial;
  const common = {
    name: `nythraxis-prop:${source.name}`,
    color: standard.color?.clone() ?? new THREE.Color(0xffffff),
    map: standard.map ?? null,
    vertexColors: standard.vertexColors === true,
    side: standard.side,
    emissive: standard.emissive?.clone() ?? new THREE.Color(0x000000),
    emissiveMap: standard.emissiveMap ?? null,
    emissiveIntensity: standard.emissiveIntensity ?? 1,
    transparent: standard.transparent === true,
    opacity: standard.opacity ?? 1,
    alphaTest: standard.alphaTest ?? 0,
    depthWrite: standard.depthWrite !== false,
  };
  return GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({
        ...common,
        normalMap: standard.normalMap ?? null,
        roughnessMap: standard.roughnessMap ?? null,
        metalnessMap: standard.metalnessMap ?? null,
        roughness: standard.roughness ?? 0.8,
        metalness: standard.metalness ?? 0,
      })
    : new THREE.MeshLambertMaterial(common);
}

/** Normalize a loaded model into the painters' space (pure geometry work, no scene). */
export function prepareNythraxisPropAsset(
  kind: NythraxisPropKind,
  source: THREE.Object3D,
): NythraxisPropAsset {
  const def = NYTHRAXIS_PROP_ASSET_DEFS[kind];
  const instance = source.clone(true);
  instance.updateMatrixWorld(true);
  const converted = new Map<THREE.Material, THREE.Material>();
  const parts: NythraxisPropPart[] = [];
  const bounds = new THREE.Box3();
  instance.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry.clone();
    attributeToFloat(geometry, 'position');
    attributeToFloat(geometry, 'normal');
    geometry.applyMatrix4(mesh.matrixWorld);
    geometry.computeBoundingBox();
    if (geometry.boundingBox) bounds.union(geometry.boundingBox);
    const sourceMaterial = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    let material = converted.get(sourceMaterial);
    if (!material) {
      material =
        def.surface === 'fire' ? fireMaterial(sourceMaterial) : propMaterial(sourceMaterial);
      converted.set(sourceMaterial, material);
    }
    parts.push({ geometry, material });
  });
  if (parts.length === 0 || bounds.isEmpty()) {
    throw new Error(`Nythraxis prop has no mesh geometry: ${kind}`);
  }
  const nativeHeight = bounds.max.y - bounds.min.y;
  if (!Number.isFinite(nativeHeight) || nativeHeight <= 1e-4) {
    throw new Error(`Nythraxis prop has invalid height: ${kind}`);
  }
  const scale = def.targetHeight / nativeHeight;
  const centerX = (bounds.min.x + bounds.max.x) * 0.5;
  const centerZ = (bounds.min.z + bounds.max.z) * 0.5;
  const finalBounds = new THREE.Box3();
  for (const part of parts) {
    part.geometry.scale(scale, scale, scale);
    part.geometry.translate(-centerX * scale, -bounds.min.y * scale, -centerZ * scale);
    part.geometry.computeBoundingBox();
    part.geometry.computeBoundingSphere();
    if (part.geometry.boundingBox) finalBounds.union(part.geometry.boundingBox);
  }
  return {
    kind,
    parts,
    width: finalBounds.max.x - finalBounds.min.x,
    height: finalBounds.max.y - finalBounds.min.y,
    depth: finalBounds.max.z - finalBounds.min.z,
  };
}

/** The prepared model, or null until it has loaded (or when it failed). */
export function nythraxisPropAsset(kind: NythraxisPropKind): NythraxisPropAsset | null {
  const cached = preparedAssets.get(kind);
  if (cached) return cached;
  const source = loadedSources.get(kind);
  if (!source) return null;
  const prepared = prepareNythraxisPropAsset(kind, source);
  preparedAssets.set(kind, prepared);
  loadedSources.delete(kind);
  releaseGltf(NYTHRAXIS_PROP_ASSET_DEFS[kind].url);
  return prepared;
}

/**
 * Instanced fire for one visual: one InstancedMesh per prepared part when the
 * model is ready, else one on the procedural tongue. Every mesh takes the same
 * instance matrices, so the painters' pose math does not know which it drew.
 */
export class NythraxisFireInstances {
  readonly meshes: THREE.InstancedMesh[] = [];
  readonly materials: THREE.Material[] = [];
  readonly usesAsset: boolean;
  /** Height of the unit model this draws, in world units, for bounding spheres. */
  readonly unitHeight: number;

  constructor(
    kind: NythraxisFireKind,
    readonly count: number,
    fallback: { color: number; opacity: number; unitHeight: number },
    name: string,
    renderOrder: number,
  ) {
    const asset = nythraxisPropAsset(kind);
    this.usesAsset = asset !== null;
    if (asset) {
      this.unitHeight = asset.height;
      for (const part of asset.parts) {
        const material = part.material.clone();
        material.transparent = true;
        material.opacity = fallback.opacity;
        this.materials.push(material);
        this.meshes.push(new THREE.InstancedMesh(part.geometry, material, count));
      }
    } else {
      this.unitHeight = fallback.unitHeight;
      const material = new THREE.MeshBasicMaterial({
        color: fallback.color,
        transparent: true,
        opacity: fallback.opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      this.materials.push(material);
      this.meshes.push(new THREE.InstancedMesh(NYTHRAXIS_FLAME_TONGUE_GEOMETRY, material, count));
    }
    for (const [index, mesh] of this.meshes.entries()) {
      mesh.name = index === 0 ? name : `${name}-${index}`;
      mesh.renderOrder = renderOrder;
      mesh.userData.renderCategory = 'ui3d';
      mesh.userData.nythraxisFire = kind;
    }
  }

  setMatrixAt(index: number, matrix: THREE.Matrix4): void {
    for (const mesh of this.meshes) mesh.setMatrixAt(index, matrix);
  }

  commit(): void {
    for (const mesh of this.meshes) mesh.instanceMatrix.needsUpdate = true;
  }

  setOpacity(opacity: number): void {
    for (const material of this.materials) material.opacity = opacity;
  }

  setBoundingSphere(center: THREE.Vector3, radius: number): void {
    for (const mesh of this.meshes) {
      if (!mesh.boundingSphere) mesh.boundingSphere = new THREE.Sphere();
      mesh.boundingSphere.center.copy(center);
      mesh.boundingSphere.radius = radius;
    }
  }

  addTo(parent: THREE.Object3D): void {
    for (const mesh of this.meshes) parent.add(mesh);
  }

  /** Instance buffers and this visual's material clones go; shared geometry stays. */
  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.dispose();
      mesh.removeFromParent();
    }
    for (const material of this.materials) material.dispose();
  }
}

export const nythraxisFireAssetInternalsForTest = {
  installSource(kind: NythraxisPropKind, source: THREE.Object3D): void {
    loadedSources.set(kind, source);
    preparedAssets.delete(kind);
    failedKinds.delete(kind);
  },
  reset(): void {
    loadedSources.clear();
    preparedAssets.clear();
    failedKinds.clear();
  },
  failed(kind: NythraxisPropKind): boolean {
    return failedKinds.has(kind);
  },
};
