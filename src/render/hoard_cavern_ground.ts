import * as THREE from 'three';
import { buildHoardCavernGroundPlan, hoardCavernGrain } from './hoard_cavern_ground_core';
import type { HoardValleyLayoutInput, HoardValleyZoneProfile } from './hoard_valley_core';
import { cloneMaterialWithHooks } from './material_clone_hooks';

interface GroundResources {
  material: THREE.MeshBasicMaterial;
  texture: THREE.DataTexture;
  shadowMaterial?: THREE.ShadowMaterial;
  refs: number;
}
const resources = new WeakMap<THREE.MeshBasicMaterial, GroundResources>();

/** Constructed off-scene; the owning valley compiles this group before its reveal. */
export function buildHoardCavernGround(
  layout: HoardValleyLayoutInput,
  zone: HoardValleyZoneProfile,
  seed: number,
  source: THREE.MeshBasicMaterial,
  shadows: boolean,
): { group: THREE.Group; dispose: () => void } {
  let shared = resources.get(source);
  if (!shared) {
    const texture = new THREE.DataTexture(hoardCavernGrain(), 128, 128);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    const material = cloneMaterialWithHooks(source);
    material.color = source.color;
    material.map = texture;
    material.vertexColors = true;
    shared = { texture, material, refs: 0 };
    resources.set(source, shared);
  }
  shared.refs++;
  const plan = buildHoardCavernGroundPlan(layout, zone, seed);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(plan.positions, 3));
  const colors = new Float32Array(plan.colors.length);
  const color = new THREE.Color();
  for (let i = 0; i < plan.colors.length; i += 3) {
    color.setRGB(plan.colors[i], plan.colors[i + 1], plan.colors[i + 2], THREE.SRGBColorSpace);
    color.toArray(colors, i);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(plan.uvs, 2));
  geometry.setIndex(plan.indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const group = new THREE.Group();
  group.name = 'HoardValleyGroundLayer';
  const mesh = new THREE.Mesh(geometry, shared.material);
  mesh.name = 'HoardValleyGround';
  group.add(mesh);
  if (shadows) {
    shared.shadowMaterial ??= new THREE.ShadowMaterial({
      color: 0x13202a,
      opacity: 0.2,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const catcher = new THREE.Mesh(geometry, shared.shadowMaterial);
    catcher.name = 'HoardValleyGroundShadows';
    catcher.receiveShadow = true;
    catcher.renderOrder = 1;
    group.add(catcher);
  }
  let disposed = false;
  return {
    group,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      group.clear();
      geometry.dispose();
      if (--shared.refs === 0) {
        shared.shadowMaterial?.dispose();
        shared.material.dispose();
        shared.texture.dispose();
        resources.delete(source);
      }
    },
  };
}
