import * as THREE from 'three';
import { terrainHeight } from '../sim/world';
import { loadGltf, releaseGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { attachBiomeHaze } from './biome_haze_field';
import { planFrostIceSpireSites } from './frost_ice_fields_core';
import { GFX } from './gfx';

const FROST_ICE_SPIRE_URL = '/models/props/frostveil_ice_spire.glb';
const FROST_ICE_SPIRE_HEIGHT = 3.2;

interface FrostIcePart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
}

let loadedSource: THREE.Group | null = null;
let preparedParts: readonly FrostIcePart[] | null = null;

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

if (typeof window !== 'undefined') {
  registerDeferredPreload(() =>
    loadGltf(FROST_ICE_SPIRE_URL).then((gltf) => {
      loadedSource = gltf.scene;
    }),
  );
}

function iceMaterial(source: THREE.Material): THREE.Material {
  const material = source as THREE.MeshStandardMaterial;
  const common = {
    color: material.color?.clone() ?? new THREE.Color(0xcfeaff),
    map: material.map ?? null,
    vertexColors: material.vertexColors === true,
    side: material.side,
    flatShading: material.flatShading === true,
    emissive: new THREE.Color(0x17384d),
    emissiveIntensity: 0.22,
  };
  const converted = GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({
        ...common,
        normalMap: material.normalMap ?? null,
        roughnessMap: material.roughnessMap ?? null,
        metalnessMap: material.metalnessMap ?? null,
        aoMap: material.aoMap ?? null,
        roughness: Math.min(material.roughness ?? 0.32, 0.42),
        metalness: Math.min(material.metalness ?? 0.05, 0.15),
      })
    : new THREE.MeshLambertMaterial(common);
  attachBiomeHaze(converted);
  return converted;
}

export function prepareFrostIceParts(source: THREE.Object3D): readonly FrostIcePart[] {
  const instance = source.clone(true);
  instance.updateMatrixWorld(true);
  const bounds = new THREE.Box3();
  const converted = new Map<THREE.Material, THREE.Material>();
  const parts: FrostIcePart[] = [];
  instance.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry.clone();
    attributeToFloat(geometry, 'position');
    attributeToFloat(geometry, 'normal');
    attributeToFloat(geometry, 'tangent');
    geometry.applyMatrix4(mesh.matrixWorld);
    geometry.computeBoundingBox();
    if (geometry.boundingBox) bounds.union(geometry.boundingBox);
    const convert = (material: THREE.Material): THREE.Material => {
      const cached = converted.get(material);
      if (cached) return cached;
      const next = iceMaterial(material);
      converted.set(material, next);
      return next;
    };
    parts.push({
      geometry,
      material: Array.isArray(mesh.material) ? mesh.material.map(convert) : convert(mesh.material),
    });
  });
  if (parts.length === 0 || bounds.isEmpty()) throw new Error('frost ice spire has no geometry');
  const height = bounds.max.y - bounds.min.y;
  if (height <= 1e-4) throw new Error('frost ice spire has invalid height');
  const scale = FROST_ICE_SPIRE_HEIGHT / height;
  const centerX = (bounds.min.x + bounds.max.x) * 0.5;
  const centerZ = (bounds.min.z + bounds.max.z) * 0.5;
  for (const part of parts) {
    part.geometry.scale(scale, scale, scale);
    part.geometry.translate(-centerX * scale, -bounds.min.y * scale, -centerZ * scale);
    part.geometry.computeBoundingBox();
    part.geometry.computeBoundingSphere();
  }
  return parts;
}

function frostIceParts(): readonly FrostIcePart[] | null {
  if (preparedParts) return preparedParts;
  if (!loadedSource) return null;
  preparedParts = prepareFrostIceParts(loadedSource);
  loadedSource = null;
  releaseGltf(FROST_ICE_SPIRE_URL);
  return preparedParts;
}

export function buildFrostIceFields(seed = 0): THREE.Group {
  const group = new THREE.Group();
  group.name = 'frost-modeled-ice-fields';
  const sites = planFrostIceSpireSites((x, z) => terrainHeight(x, z, seed));
  const parts = frostIceParts();
  if (!parts || sites.length === 0) return group;

  const matrix = new THREE.Matrix4();
  const yaw = new THREE.Quaternion();
  const tilt = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const axis = new THREE.Vector3();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();

  for (const part of parts) {
    const mesh = new THREE.InstancedMesh(part.geometry, part.material, sites.length);
    mesh.userData.frostIceSpire = true;
    for (let i = 0; i < sites.length; i++) {
      const site = sites[i];
      yaw.setFromAxisAngle(up, site.yaw);
      axis.set(Math.sin(site.tiltAxisYaw), 0, Math.cos(site.tiltAxisYaw));
      tilt.setFromAxisAngle(axis, site.tilt);
      yaw.premultiply(tilt);
      position.set(site.x, site.y, site.z);
      const variantX = site.variant === 1 ? 0.78 : site.variant === 2 ? 1.08 : 1;
      const variantY = site.variant === 1 ? 1.12 : site.variant === 2 ? 0.86 : 1;
      const variantZ = site.variant === 1 ? 0.86 : site.variant === 2 ? 0.72 : 1;
      scale.set(site.scale * variantX, site.scale * variantY, site.scale * variantZ);
      mesh.setMatrixAt(i, matrix.compose(position, yaw, scale));
      mesh.setColorAt(i, new THREE.Color(site.tint));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return group;
}

export const frostIcePreloadInternalsForTest = {
  assetUrl: FROST_ICE_SPIRE_URL,
  targetHeight: FROST_ICE_SPIRE_HEIGHT,
  installSource(source: THREE.Group): void {
    loadedSource = source;
    preparedParts = null;
  },
  reset(): void {
    loadedSource = null;
    preparedParts = null;
  },
};
