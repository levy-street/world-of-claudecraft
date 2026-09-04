// The Nythraxis mechanic props from the Tripo asset pipeline: today only the
// Binding Sigil's bone cage. This module owns loading and preparing them.
//
// Loading: a deferred preload (world-entry lane, never the launcher), the same
// contract the streetlamp fixtures use. Preparation normalizes every mesh into
// one space (foot at y 0, centred on XZ, scaled to the authored target height)
// and converts the exported PBR materials to the game's lit material tier.
// Geometry is shared and never disposed per visual; each visual gets its own
// material clones.
//
// Until a model has loaded (or when it fails to), the painter falls back to a
// procedural stand-in, so a Node test host, a slow connection, and a missing
// file all still draw the mechanic.

import * as THREE from 'three';
import { loadGltf, releaseGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { GFX } from './gfx';

export type NythraxisPropKind = 'cage';

export interface NythraxisPropAssetDef {
  url: string;
  /** World units the prepared model stands at instance scale 1, foot at y 0. */
  targetHeight: number;
}

export const NYTHRAXIS_PROP_ASSET_DEFS: Readonly<Record<NythraxisPropKind, NythraxisPropAssetDef>> =
  {
    cage: { url: '/models/props/nythraxis_binding_cage.glb', targetHeight: 6 },
  };

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
          // A missing or broken model is not a broken fight: the painter keeps
          // its procedural stand-in. The preload lane records the rejection.
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

/** A lit surface on the game's material tier, every authored flag carried across. */
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
      material = propMaterial(sourceMaterial);
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

export const nythraxisPropAssetInternalsForTest = {
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
