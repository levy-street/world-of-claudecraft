// Shared castle-kit extraction helpers for the walk-in castle assemblies
// (castle_features, dawnhold_features, bulwark_features). Third copy earned
// the module (rule of three): geometry extraction with the quantized-attribute
// guard, the placement shape the assemblies instance from, and the banner
// cloth rule. Render-only leaf: no IWorld, no sim imports.
import * as THREE from 'three';

export interface KitPlacement {
  x: number;
  y: number;
  z: number;
  rot: number;
  /** uniform scale (each assembly supplies its wall-module default) */
  s?: number;
}

// Meshopt-quantized attributes are normalized ints; bake them to plain floats
// BEFORE applying a world matrix, or setXYZ clamps every vertex back into the
// normalized [-1, 1] domain and the wall modules collapse into 2-unit blobs
// (the "invisible walls" report; same guard as lastkeep_dressing.ts).
function attributeToFloat(geo: THREE.BufferGeometry, name: string): void {
  const attr = geo.getAttribute(name);
  if (!attr || (attr.array instanceof Float32Array && !attr.normalized)) return;
  const out = new Float32Array(attr.count * attr.itemSize);
  for (let i = 0; i < attr.count; i++) {
    for (let c = 0; c < attr.itemSize; c++) out[i * attr.itemSize + c] = attr.getComponent(i, c);
  }
  geo.setAttribute(name, new THREE.BufferAttribute(out, attr.itemSize));
}

/** Bake a loaded kit scene into parts, xz-centered with min-y at 0. */
export function extractKitParts(
  scene: THREE.Group,
  skip?: RegExp,
  mapMaterial?: (mat: THREE.Material) => THREE.Material,
): { geo: THREE.BufferGeometry; mat: THREE.Material }[] {
  scene.updateMatrixWorld(true);
  const parts: { geo: THREE.BufferGeometry; mat: THREE.Material }[] = [];
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (skip && (skip.test(mesh.name) || (mesh.parent && skip.test(mesh.parent.name)))) return;
    const geo = mesh.geometry.clone();
    attributeToFloat(geo, 'position');
    attributeToFloat(geo, 'normal');
    geo.applyMatrix4(mesh.matrixWorld);
    const src = mesh.material as THREE.Material;
    parts.push({ geo, mat: mapMaterial ? mapMaterial(src) : src });
  });
  const box = new THREE.Box3();
  for (const p of parts) {
    p.geo.computeBoundingBox();
    box.union(p.geo.boundingBox as THREE.Box3);
  }
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  for (const p of parts) {
    p.geo.translate(-cx, -box.min.y, -cz);
    p.geo.computeBoundingBox();
    p.geo.computeBoundingSphere();
  }
  return parts;
}

// The kit's banner cloth is a one-sided sheet: hung on a parapet or an inner
// wall face it reads fine from inside the bailey, and vanishes entirely from
// outside because the viewer faces its back (player report, both castles).
// Every banner part therefore renders double-sided, via a per-source clone so
// the shared cache instances other consumers read stay untouched.
const bannerMats = new Map<THREE.Material, THREE.Material>();

export function bannerClothMaterial(src: THREE.Material): THREE.Material {
  let mat = bannerMats.get(src);
  if (!mat) {
    mat = src.clone();
    mat.side = THREE.DoubleSide;
    bannerMats.set(src, mat);
  }
  return mat;
}

/** True for the kit keys whose parts carry banner cloth. */
export function isBannerKey(key: string): boolean {
  return key.startsWith('kcasBanner');
}
