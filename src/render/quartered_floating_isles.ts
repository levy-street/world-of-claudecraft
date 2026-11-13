// The Quartered Isle's floating isles, render side: the six generated island
// models instanced where quartered_floating_debris_core.ts hangs them, the
// iron chains trailing under some of them, and the soft cloud bank they float
// over. quartered_landmark_dressing.ts owns the view and its cull clusters;
// this module loads the island models and fills its near, mid and far
// clusters. Cosmetic: no colliders, nothing the sim reads.
//
// Contract (the dressing's own): the island models ride the Drakelands kit's
// boot lane (deferred, skipped on the iOS memory profile, where the zone
// prepare fetches them through floatingIsleLoads instead), and the build
// refuses to run before they are resident. Every material here (the chain
// iron and the cloud card) is built inside the dressing's build, so its
// programs link behind attachZoneFeature's world compile gate and idle
// prewarm with the rest of the view, never in a live frame. The isles are
// static: no per-frame hook.
import * as THREE from 'three';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { attachBiomeHaze } from './biome_haze_field';
import { dequantizeAttribute } from './characters/dequantize_attribute';
import { drakelandsKitBootThunk } from './drakelands_kit_lane_core';
import { GFX } from './gfx';
import {
  CLOUD_TEXTURE_SIZE,
  type CloudPuff,
  chainLinkY,
  cloudPuffTexels,
  type DebrisCluster,
  type FloatingIsle,
  type FloatingIslesPlan,
  ISLE_MODEL_KEYS,
  ISLE_MODELS,
  type IsleChain,
  type IsleModel,
} from './quartered_floating_debris_core';

const ISLE_URLS = {
  pines: '/models/props/sky_isle_pines.glb',
  twin: '/models/props/sky_isle_twin.glb',
  slab: '/models/props/sky_isle_slab.glb',
  spire: '/models/props/sky_isle_spire.glb',
  terraced: '/models/props/sky_isle_terraced.glb',
  crag: '/models/props/sky_isle_crag.glb',
} as const satisfies Record<IsleModel, string>;

// The loaded scenes (loadGltf caches by url). Never mutated: the bake clones
// geometry before transforming it.
const sources: Partial<Record<IsleModel, THREE.Group>> = {};

function loadSource(model: IsleModel): Promise<void> {
  return loadGltf(ISLE_URLS[model]).then((gltf) => {
    sources[model] = gltf.scene;
  });
}

for (const model of ISLE_MODEL_KEYS) {
  registerDeferredPreload(
    drakelandsKitBootThunk(
      () => loadSource(model),
      () => GFX,
    ),
  );
}

/** Every island model the build reads is resident. */
export function floatingIslesResident(): boolean {
  return ISLE_MODEL_KEYS.every((model) => sources[model] !== undefined);
}

/** The loads still missing (for the dressing's zone-prepare load). */
export function floatingIsleLoads(): Promise<void>[] {
  return ISLE_MODEL_KEYS.filter((model) => !sources[model]).map(loadSource);
}

interface BakedIsle {
  parts: { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[] }[];
  /** the model's longest horizontal extent, which an islet's width scales to */
  foot: number;
}

// Bake a scene into model-space parts, xz-centred with its tip (the box's
// lowest point) at y 0, the origin the core plans every islet about.
// Quantized attributes expand to floats before the matrix applies (the
// pipeline's GLBs are meshopt + quantized).
function bakeIsle(scene: THREE.Group): BakedIsle {
  scene.updateMatrixWorld(true);
  const parts: BakedIsle['parts'] = [];
  const box = new THREE.Box3();
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry.clone();
    for (const name of ['position', 'normal']) {
      const attribute = geometry.getAttribute(name) as THREE.BufferAttribute | undefined;
      if (attribute && (!(attribute.array instanceof Float32Array) || attribute.normalized)) {
        geometry.setAttribute(name, dequantizeAttribute(attribute));
      }
    }
    geometry.applyMatrix4(mesh.matrixWorld);
    geometry.computeBoundingBox();
    if (geometry.boundingBox) box.union(geometry.boundingBox);
    parts.push({ geometry, material: mesh.material });
  });
  if (parts.length === 0 || box.isEmpty()) throw new Error('floating isle model has no geometry');
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  for (const part of parts) {
    part.geometry.translate(-cx, -box.min.y, -cz);
    part.geometry.computeBoundingBox();
    part.geometry.computeBoundingSphere();
  }
  return { parts, foot: Math.max(box.max.x - box.min.x, box.max.z - box.min.z) };
}

/** The islet's rotation: base correction, then yaw, then lean, the order
 *  quartered_floating_debris_core.ts isleWorldPoint applies. */
function isleQuaternion(isle: FloatingIsle, out: THREE.Quaternion): THREE.Quaternion {
  const spec = ISLE_MODELS[isle.model];
  const step = new THREE.Quaternion();
  out.identity();
  if (spec.base) {
    const axis = new THREE.Vector3(spec.base.ax, 0, spec.base.az).normalize();
    out.setFromAxisAngle(axis, spec.base.angle);
  }
  out.premultiply(step.setFromAxisAngle(new THREE.Vector3(0, 1, 0), isle.yaw));
  const lean = new THREE.Vector3(Math.sin(isle.tiltAxisYaw), 0, Math.cos(isle.tiltAxisYaw));
  out.premultiply(step.setFromAxisAngle(lean, isle.tilt));
  return out;
}

function instanceIsles(
  baked: BakedIsle,
  model: IsleModel,
  isles: readonly FloatingIsle[],
  group: THREE.Group,
): void {
  if (isles.length === 0) return;
  const spec = ISLE_MODELS[model];
  const matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  for (const part of baked.parts) {
    const mesh = new THREE.InstancedMesh(part.geometry, part.material, isles.length);
    mesh.name = `quartered-floating-isle-${model}`;
    mesh.userData.quarteredIsle = model;
    isles.forEach((isle, i) => {
      // the plan scales the model's native size; the baked model is that size
      const s = (isle.scale * Math.max(spec.w, spec.d)) / baked.foot;
      position.set(isle.x, isle.y, isle.z);
      scale.set(s, s, s);
      mesh.setMatrixAt(i, matrix.compose(position, isleQuaternion(isle, q), scale));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
}

// A chain link: a coarse torus stretched tall, a link pitch long so
// neighbours overlap a little. Shared by every chain.
function chainLinkGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.TorusGeometry(0.5, 0.16, 4, 8);
  geometry.scale(0.62, 1.3, 1);
  return geometry;
}

function chainMaterial(): THREE.Material {
  const common = { color: 0x2b2a2c };
  const material = GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({ ...common, metalness: 0.55, roughness: 0.55 })
    : new THREE.MeshLambertMaterial(common);
  material.name = 'quartered-isle-chain';
  attachBiomeHaze(material);
  return material;
}

function instanceChains(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  chains: readonly IsleChain[],
  group: THREE.Group,
): void {
  const total = chains.reduce((n, c) => n + c.links, 0);
  if (total === 0) return;
  const mesh = new THREE.InstancedMesh(geometry, material, total);
  mesh.name = 'quartered-isle-chains';
  mesh.userData.quarteredIsleChain = true;
  const matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  let i = 0;
  for (const chain of chains) {
    for (let k = 0; k < chain.links; k++) {
      // links alternate a quarter turn, so the chain reads as linked rings
      q.setFromAxisAngle(up, chain.yaw + (k % 2) * (Math.PI / 2));
      position.set(chain.x, chainLinkY(chain, k), chain.z);
      scale.setScalar(chain.pitch);
      mesh.setMatrixAt(i++, matrix.compose(position, q, scale));
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  group.add(mesh);
}

function cloudMaterial(): THREE.Material {
  const size = CLOUD_TEXTURE_SIZE;
  const texture = new THREE.DataTexture(cloudPuffTexels(size), size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    color: 0xdde2e8,
    vertexColors: true,
    transparent: true,
    // soft cards: never write depth (no hard edge where two cross), draw both
    // faces so the bank reads from above and below
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  });
  material.name = 'quartered-isle-cloud';
  attachBiomeHaze(material);
  return material;
}

/** One cluster's cloud bank as one mesh: an upright card per puff, turned
 *  toward the isle (south), and a level card under it. */
function cloudMesh(puffs: readonly CloudPuff[], material: THREE.Material): THREE.Mesh | null {
  if (puffs.length === 0) return null;
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const quad = (corners: number[][], alpha: number) => {
    const base = positions.length / 3;
    const uv = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    corners.forEach((c, k) => {
      positions.push(c[0], c[1], c[2]);
      uvs.push(uv[k][0], uv[k][1]);
      colors.push(1, 1, 1, alpha);
    });
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (const p of puffs) {
    const hx = (Math.cos(p.yaw) * p.w) / 2;
    const hz = (Math.sin(p.yaw) * p.w) / 2;
    const hy = p.h / 2;
    quad(
      [
        [p.x - hx, p.y - hy, p.z - hz],
        [p.x + hx, p.y - hy, p.z + hz],
        [p.x + hx, p.y + hy, p.z + hz],
        [p.x - hx, p.y + hy, p.z - hz],
      ],
      p.alpha,
    );
    const lw = p.w * 0.5;
    const ld = p.w * 0.35;
    quad(
      [
        [p.x - lw, p.y - hy * 0.3, p.z - ld],
        [p.x + lw, p.y - hy * 0.3, p.z - ld],
        [p.x + lw, p.y - hy * 0.3, p.z + ld],
        [p.x - lw, p.y - hy * 0.3, p.z + ld],
      ],
      p.alpha * 0.45,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  geometry.setAttribute(
    'normal',
    new THREE.Float32BufferAttribute(
      positions.map((_, i) => (i % 3 === 1 ? 1 : 0)),
      3,
    ),
  );
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'quartered-isle-clouds';
  mesh.userData.quarteredIsleCloud = true;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  // the bank draws after the isles it sits under
  mesh.renderOrder = 1;
  return mesh;
}

/** Fill the near, mid and far clusters with the plan's islands, chains and
 *  cloud bank (one instanced mesh per model per cluster, one chain mesh and
 *  one cloud mesh per cluster). Throws when a model is not resident. */
export function buildFloatingIsles(
  plan: FloatingIslesPlan,
  clusters: Record<DebrisCluster, THREE.Group>,
): void {
  if (!floatingIslesResident()) {
    throw new Error('buildFloatingIsles: the island models are not resident');
  }
  const keys: DebrisCluster[] = ['near', 'mid', 'far'];
  for (const model of ISLE_MODEL_KEYS) {
    const source = sources[model];
    if (!source) continue;
    const mine = plan.isles.filter((isle) => isle.model === model);
    if (mine.length === 0) continue;
    const baked = bakeIsle(source);
    for (const key of keys) {
      instanceIsles(
        baked,
        model,
        mine.filter((isle) => isle.cluster === key),
        clusters[key],
      );
    }
  }
  const linkGeometry = chainLinkGeometry();
  const iron = chainMaterial();
  const cloud = cloudMaterial();
  for (const key of keys) {
    instanceChains(
      linkGeometry,
      iron,
      plan.chains.filter((c) => c.cluster === key),
      clusters[key],
    );
    const bank = cloudMesh(
      plan.clouds.filter((c) => c.cluster === key),
      cloud,
    );
    if (bank) clusters[key].add(bank);
  }
}

export const floatingIslesInternalsForTest = {
  urls: ISLE_URLS,
  installSources(next: Partial<Record<IsleModel, THREE.Group>>): void {
    Object.assign(sources, next);
  },
  reset(): void {
    for (const model of ISLE_MODEL_KEYS) delete sources[model];
  },
};
