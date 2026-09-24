// Real rock shapes for the Buried Hoard boundary wall (TRIAL).
//
// The wall is an InstancedMesh of one shared rock (hoard_cavern_shell.ts). That
// rock used to be a seven-sided cylinder bent by one sine wave, so a wall read
// as a row of identical columns. This module bakes the kit boulder GLBs the
// open world already ships (the same three cliff_scree.ts scatters) into
// drop-in replacements: same unit footprint as the cylinder, so the placement
// plan in hoard_valley_core.ts does not change, and the same hand-painted
// vertex-colour light, so they wear the ONE shared unlit valley material and
// add no shader program.
//
// Cost: one draw per variant instead of one in total, and the boulders'
// triangles. Nothing per frame. The low tier keeps the cylinder.
//
// Loading: the fetch rides the deferred preload lane, shared with cliff_scree
// through the loader's promise cache. A room built before the models resolve
// simply keeps the cylinder; nothing waits on them.

import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { markSharedGeometry } from './shared_resource';

const MODEL_URLS = [1, 2, 3].map((index) => `models/foliage/rock_${index}.glb`);

let variants: THREE.BufferGeometry[] | null = null;
let loading: Promise<void> | null = null;

/** Light painted into the vertices, the look every valley mesh shares: faces
 *  turned up catch the sky, the base sinks into shadow where it meets the
 *  floor, and a touch of grain keeps big flat facets from reading as plastic. */
export function hoardRockShade(
  normalX: number,
  normalY: number,
  height01: number,
  grain: number,
): number {
  const sky = 0.56 + Math.max(0, normalY) * 0.3 + normalX * 0.07;
  const under = normalY < 0 ? normalY * 0.12 : 0;
  const contact = 0.62 + 0.38 * Math.min(1, Math.max(0, height01) / 0.4);
  const shade = (sky + under) * contact + (grain - 0.5) * 0.08;
  return Math.max(0.3, Math.min(1, shade));
}

function grainAt(x: number, y: number, z: number): number {
  const n = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return n - Math.floor(n);
}

function bake(gltf: GLTF): THREE.BufferGeometry | null {
  gltf.scene.updateMatrixWorld(true);
  let source: THREE.Mesh | null = null;
  gltf.scene.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.isMesh && !source) source = mesh;
  });
  const mesh = source as THREE.Mesh | null;
  if (!mesh) return null;
  // The shipped GLBs are meshopt-quantized: read the positions out as floats.
  const from = mesh.geometry.getAttribute('position');
  const positions = new Float32Array(from.count * 3);
  for (let i = 0; i < from.count; i++) {
    positions[i * 3] = from.getX(i);
    positions[i * 3 + 1] = from.getY(i);
    positions[i * 3 + 2] = from.getZ(i);
  }
  let geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (mesh.geometry.index) geometry.setIndex(mesh.geometry.index.clone());
  geometry.applyMatrix4(mesh.matrixWorld);

  // Same unit footprint as the cylinder it replaces: radius 1, y from -1 to 1.
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return null;
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  geometry.translate(-centre.x, -centre.y, -centre.z);
  geometry.scale(
    2 / Math.max(0.001, size.x),
    2 / Math.max(0.001, size.y),
    2 / Math.max(0.001, size.z),
  );

  // Faceted, like everything else in the valley.
  const indexed = geometry;
  geometry = indexed.toNonIndexed();
  indexed.dispose();
  geometry.computeVertexNormals();
  const vertices = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const colors = new Float32Array(vertices.count * 3);
  for (let i = 0; i < vertices.count; i++) {
    const shade = hoardRockShade(
      normals.getX(i),
      normals.getY(i),
      (vertices.getY(i) + 1) / 2,
      grainAt(vertices.getX(i), vertices.getY(i), vertices.getZ(i)),
    );
    colors[i * 3] = shade;
    colors[i * 3 + 1] = shade;
    colors[i * 3 + 2] = shade;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return markSharedGeometry(geometry);
}

export function prepareHoardValleyRocks(): Promise<void> {
  if (variants) return Promise.resolve();
  loading ??= Promise.all(MODEL_URLS.map((url) => loadGltf(url)))
    .then((models) => {
      const baked = models.map(bake).filter((g): g is THREE.BufferGeometry => g !== null);
      if (baked.length === MODEL_URLS.length) variants = baked;
      loading = null;
    })
    .catch(() => {
      loading = null;
    });
  return loading;
}

/** The baked boulders, or null while they are not loaded (keep the cylinder). */
export function hoardValleyRockVariants(): readonly THREE.BufferGeometry[] | null {
  if (!variants) void prepareHoardValleyRocks();
  return variants;
}

registerDeferredPreload(() => prepareHoardValleyRocks());
