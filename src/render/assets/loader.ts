// Runtime asset loading: glTF models (meshopt-compressed) + HDR environment
// maps, with a promise cache so every consumer shares one parse per URL.
// Render-layer only — the sim must never import this (it runs headless).
import * as THREE from 'three';
import { GLTFLoader, GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { assetUrl } from './media';
import { assetLoadStarted, recordAssetLoad } from './stats';

let gltfLoader: GLTFLoader | null = null;
const gltfCache = new Map<string, Promise<GLTF>>();
const hdrCache = new Map<string, Promise<THREE.DataTexture>>();
const texCache = new Map<string, Promise<THREE.Texture>>();

interface AssetQueue {
  active: number;
  limit: number;
  pending: (() => void)[];
}

function constrainedBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const narrow = typeof innerWidth === 'number' && Math.min(innerWidth, innerHeight) <= 700;
  return (coarse && narrow) || (nav.deviceMemory !== undefined && nav.deviceMemory <= 4);
}

const constrained = constrainedBrowser();
const gltfQueue: AssetQueue = { active: 0, limit: constrained ? 2 : 4, pending: [] };
const textureQueue: AssetQueue = { active: 0, limit: constrained ? 3 : 6, pending: [] };
const hdrQueue: AssetQueue = { active: 0, limit: 1, pending: [] };

function pumpQueue(q: AssetQueue): void {
  while (q.active < q.limit && q.pending.length > 0) {
    const start = q.pending.shift()!;
    q.active++;
    // Keep large loader callback chains from running in one import-time burst.
    globalThis.setTimeout(start, 0);
  }
}

function scheduleLoad<T>(q: AssetQueue, run: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    q.pending.push(() => {
      run().then(resolve, reject).finally(() => {
        q.active = Math.max(0, q.active - 1);
        pumpQueue(q);
      });
    });
    pumpQueue(q);
  });
}

function loader(): GLTFLoader {
  if (!gltfLoader) {
    gltfLoader = new GLTFLoader();
    gltfLoader.setMeshoptDecoder(MeshoptDecoder);
  }
  return gltfLoader;
}

/** Load + parse a .glb once; subsequent calls share the same parsed scene.
 *  Consumers must treat the result as immutable — clone before mutating. */
export function loadGltf(url: string): Promise<GLTF> {
  const resolved = assetUrl(url);
  let p = gltfCache.get(resolved);
  if (!p) {
    const startedAt = assetLoadStarted();
    p = scheduleLoad(gltfQueue, () => new Promise<GLTF>((resolve, reject) => {
      loader().load(resolved, (gltf) => {
        recordAssetLoad('gltf', resolved, startedAt);
        resolve(gltf);
      }, undefined, () => {
        recordAssetLoad('gltf', resolved, startedAt, true);
        reject(new Error(`asset load failed: ${url} (missing file or bad GLB)`));
      });
    }));
    gltfCache.set(resolved, p);
  }
  return p;
}

/** Drop a parsed glTF from the cache once its data has been extracted into
 *  module-owned structures — lets the parsed scene, original geometry and any
 *  duplicate decoded textures be garbage-collected. A later loadGltf for the
 *  same url would simply re-fetch. */
export function releaseGltf(url: string): void {
  gltfCache.delete(assetUrl(url));
}

/** Equirectangular Radiance .hdr for IBL / sky sampling (HalfFloat). */
export function loadHdr(url: string): Promise<THREE.DataTexture> {
  const resolved = assetUrl(url);
  let p = hdrCache.get(resolved);
  if (!p) {
    const startedAt = assetLoadStarted();
    p = scheduleLoad(hdrQueue, () => new Promise<THREE.DataTexture>((resolve, reject) => {
      new RGBELoader().load(resolved, (tex) => {
        tex.mapping = THREE.EquirectangularReflectionMapping;
        recordAssetLoad('hdr', resolved, startedAt);
        resolve(tex);
      }, undefined, () => {
        recordAssetLoad('hdr', resolved, startedAt, true);
        reject(new Error(`hdr load failed: ${url}`));
      });
    }));
    hdrCache.set(resolved, p);
  }
  return p;
}

/** Plain image texture (terrain splats, water normals, VFX sprites). */
export function loadTexture(url: string, opts: { srgb?: boolean; repeat?: boolean } = {}): Promise<THREE.Texture> {
  const resolved = assetUrl(url);
  const key = `${resolved}|${opts.srgb ? 's' : 'l'}|${opts.repeat ? 'r' : 'c'}`;
  let p = texCache.get(key);
  if (!p) {
    const startedAt = assetLoadStarted();
    p = scheduleLoad(textureQueue, () => new Promise<THREE.Texture>((resolve, reject) => {
      new THREE.TextureLoader().load(resolved, (tex) => {
        if (opts.srgb) tex.colorSpace = THREE.SRGBColorSpace;
        if (opts.repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        recordAssetLoad('texture', resolved, startedAt);
        resolve(tex);
      }, undefined, () => {
        recordAssetLoad('texture', resolved, startedAt, true);
        reject(new Error(`texture load failed: ${url}`));
      });
    }));
    texCache.set(key, p);
  }
  return p;
}
