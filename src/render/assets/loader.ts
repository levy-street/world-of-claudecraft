// Runtime asset loading: glTF models (meshopt-compressed) + HDR environment
// maps, with a promise cache so every consumer shares one parse per URL.
// Render-layer only — the sim must never import this (it runs headless).
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { type GLTF, GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { GFX } from '../gfx';
import { resampleHdrRgba } from '../hdr_resample';
import { ktx2Loader } from './ktx2_support';
import { MAX_LOAD_ATTEMPTS, retryDelayMs } from './load_retry';
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
      run()
        .then(resolve, reject)
        .finally(() => {
          q.active = Math.max(0, q.active - 1);
          pumpQueue(q);
        });
    });
    pumpQueue(q);
  });
}

/** Retries a fetch-and-parse attempt on failure: a single transient network
 *  blip (common on mobile connections) must not permanently sink a boot-time
 *  asset load. Only the LAST attempt's error escapes; earlier ones are
 *  swallowed since the caller only cares whether it eventually succeeded. */
function withRetry<T>(attemptOnce: () => Promise<T>): Promise<T> {
  const attempt = (n: number): Promise<T> =>
    attemptOnce().catch((err: unknown) => {
      if (n >= MAX_LOAD_ATTEMPTS) throw err;
      return new Promise<T>((resolve, reject) => {
        globalThis.setTimeout(() => {
          attempt(n + 1).then(resolve, reject);
        }, retryDelayMs(n));
      });
    });
  return attempt(1);
}

function loader(): GLTFLoader {
  if (!gltfLoader) {
    // Assemble into a local and publish only on full success: caching a
    // half-wired loader after a throw here would fail every later KTX2 GLB
    // parse for the whole session with no recovery path.
    const assembled = new GLTFLoader();
    assembled.setMeshoptDecoder(MeshoptDecoder);
    // Model textures ship as KTX2 (KHR_texture_basisu): without the transcoder
    // attached, parsing any public/models GLB rejects outright.
    assembled.setKTX2Loader(ktx2Loader());
    gltfLoader = assembled;
  }
  return gltfLoader;
}

// Central GLB texture polish: 4-tap anisotropic filtering on every color and
// normal map sharpens ground-adjacent props and walls at oblique camera angles
// for free (mip selection alone smears them). Runs once per parsed GLB, right
// after parse and before first upload, so no texture ever needs a re-upload;
// three clamps the value to the device's max anisotropy at bind time. Terrain
// splats keep their own higher-tap setting (terrain.ts loads via loadTexture,
// not through here).
const GLB_TEXTURE_ANISOTROPY = 4;

function polishGltfTextures(gltf: GLTF): void {
  // Fail soft on partial GLTF shapes (test doubles, exotic parses): the polish
  // is cosmetic and must never sink an otherwise successful load.
  if (typeof gltf.scene?.traverse !== 'function') return;
  const seen = new Set<THREE.Texture>();
  const lift = (tex: THREE.Texture | null): void => {
    if (!tex || seen.has(tex)) return;
    seen.add(tex);
    tex.anisotropy = Math.max(tex.anisotropy, GLB_TEXTURE_ANISOTROPY);
  };
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const std = m as THREE.MeshStandardMaterial;
      lift(std.map ?? null);
      lift(std.normalMap ?? null);
    }
  });
}

// asset fetch start/settle so a device console shows exactly how far through the
// preload set a WebContent kill lands and which asset preceded it (the iPhone 17
// Pro entry-kill investigation: WebContent died at 1.54 GB resident mid-decode
// with no JS error, so sequencing evidence has to come from the console, not
// from error handlers). Gated like the residency table: dev browsers plus the
// native iOS profile under diagnosis. The production WEB population must not
// pay ~700 console lines per entry; the native Release shell suppresses the JS
// console anyway, and a Debug shell attached for diagnosis sees every line.
function loadDiagEnabled(): boolean {
  // Vitest sets DEV too, and every jsdom texture fetch FAILs, so a suite that
  // touches the loader emits hundreds of these lines; that console volume is
  // what keeps onUserConsoleLog rpcs in flight at worker teardown (the shard
  // flake on the release gate). Tests never read this diagnostic: keep it out
  // of the test env entirely.
  if (import.meta.env.TEST) return false;
  return import.meta.env.DEV || GFX.nativeIosMemoryProfile;
}
let loadDiagSeq = 0;
function diagStart(kind: string, resolved: string): number {
  if (!loadDiagEnabled()) return 0;
  const seq = ++loadDiagSeq;
  console.info(`[load-diag] ${seq} ${kind} start ${resolved}`);
  return seq;
}
function diagSettle(seq: number, kind: string, resolved: string, ok: boolean): void {
  if (!loadDiagEnabled()) return;
  console.info(`[load-diag] ${seq} ${kind} ${ok ? 'done' : 'FAIL'} ${resolved}`);
}

/** Load + parse a .glb once; subsequent calls share the same parsed scene.
 *  Consumers must treat the result as immutable — clone before mutating. */
export function loadGltf(url: string): Promise<GLTF> {
  const resolved = assetUrl(url);
  let p = gltfCache.get(resolved);
  if (!p) {
    const startedAt = assetLoadStarted();
    p = scheduleLoad(gltfQueue, () => {
      const seq = diagStart('gltf', resolved);
      return withRetry(
        () =>
          new Promise<GLTF>((resolve, reject) => {
            loader().load(resolved, resolve, undefined, () =>
              reject(new Error(`asset load failed: ${url} (missing file or bad GLB)`)),
            );
          }),
      ).then(
        (gltf) => {
          diagSettle(seq, 'gltf', resolved, true);
          return gltf;
        },
        (err: unknown) => {
          diagSettle(seq, 'gltf', resolved, false);
          throw err;
        },
      );
    }).then(
      (gltf) => {
        polishGltfTextures(gltf);
        recordAssetLoad('gltf', resolved, startedAt);
        return gltf;
      },
      (err: unknown) => {
        recordAssetLoad('gltf', resolved, startedAt, true);
        // Evict the rejected promise so the next call re-fetches rather than
        // permanently caching a failure (black void bug: rejected promise poisons
        // ensureDungeonAssets for the whole session).
        gltfCache.delete(resolved);
        throw err;
      },
    );
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

/** The texture twin of releaseGltf: drop a loadTexture entry once its pixels
 *  have been copied into a consumer-owned surface (e.g. the VFX sprite atlas),
 *  so the decoded source image can be garbage-collected. Pass the SAME opts the
 *  load used - they are part of the cache key. A later loadTexture re-fetches. */
export function releaseTexture(url: string, opts: { srgb?: boolean; repeat?: boolean } = {}): void {
  const resolved = assetUrl(url);
  texCache.delete(`${resolved}|${opts.srgb ? 's' : 'l'}|${opts.repeat ? 'r' : 'c'}`);
}

// One shared decode worker (created lazily): fetch + RGBE parse of an 8MB 2k
// HDRI is over a second of pure CPU, a measured full-frame stall every time
// zone streaming brought in a new biome's sky. Requests are matched by id;
// the pixel buffer transfers back zero-copy.
let hdrWorker: Worker | null = null;
let hdrWorkerSeq = 0;
const hdrWorkerPending = new Map<
  number,
  (r: import('./hdr_decode_worker').HdrDecodeResponse) => void
>();
function hdrDecodeInWorker(
  url: string,
  maxWidth?: number,
): Promise<import('./hdr_decode_worker').HdrDecodeResponse> {
  if (!hdrWorker) {
    try {
      hdrWorker = new Worker(new URL('./hdr_decode_worker.ts', import.meta.url), {
        type: 'module',
      });
    } catch {
      return Promise.resolve({ id: 0, ok: false, error: 'worker unavailable' });
    }
    hdrWorker.onmessage = (e: MessageEvent<import('./hdr_decode_worker').HdrDecodeResponse>) => {
      const pending = hdrWorkerPending.get(e.data.id);
      if (pending) {
        hdrWorkerPending.delete(e.data.id);
        pending(e.data);
      }
    };
    // A worker-level failure (script load, uncaught throw) must never strand
    // the callers: fail every pending decode so loadHdr's fallback path runs.
    hdrWorker.onerror = () => {
      for (const [id, resolve] of hdrWorkerPending) {
        hdrWorkerPending.delete(id);
        resolve({ id, ok: false, error: 'hdr decode worker error' });
      }
    };
  }
  const id = ++hdrWorkerSeq;
  return new Promise((resolve) => {
    hdrWorkerPending.set(id, resolve);
    hdrWorker?.postMessage({
      id,
      url,
      maxWidth,
    } satisfies import('./hdr_decode_worker').HdrDecodeRequest);
  });
}

// The exact texture configuration RGBELoader.load applies for the HalfFloat/
// Float types it produces (three/examples RGBELoader onLoadCallback), plus the
// equirect mapping loadHdr always set. Keep in lockstep with the fallback path
// below, which still routes through RGBELoader.load itself.
function finishHdrTexture(tex: THREE.DataTexture): THREE.DataTexture {
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.flipY = true;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.needsUpdate = true;
  return tex;
}

interface HdrTextureImage {
  data: Uint16Array<ArrayBuffer> | Float32Array<ArrayBuffer>;
  width: number;
  height: number;
}

function decodedHdrImage(image: unknown): HdrTextureImage | null {
  if (typeof image !== 'object' || image === null) return null;
  const data = Reflect.get(image, 'data');
  const width = Reflect.get(image, 'width');
  const height = Reflect.get(image, 'height');
  if (
    (!(data instanceof Uint16Array) && !(data instanceof Float32Array)) ||
    typeof width !== 'number' ||
    !Number.isInteger(width) ||
    width <= 0 ||
    typeof height !== 'number' ||
    !Number.isInteger(height) ||
    height <= 0
  ) {
    return null;
  }
  if (!(data.buffer instanceof ArrayBuffer)) return null;
  const pixels =
    data instanceof Uint16Array
      ? new Uint16Array(data.buffer, data.byteOffset, data.length)
      : new Float32Array(data.buffer, data.byteOffset, data.length);
  return { data: pixels, width, height };
}

export interface HdrLoadOptions {
  /** Resize decoded pixels in the worker before transfer (used by PMREM). */
  maxWidth?: number;
}

/** Equirectangular Radiance .hdr for IBL / sky sampling (HalfFloat). */
export function loadHdr(url: string, options: HdrLoadOptions = {}): Promise<THREE.DataTexture> {
  const resolved = assetUrl(url);
  const maxWidth = options.maxWidth ? Math.max(1, Math.floor(options.maxWidth)) : undefined;
  const cacheKey = maxWidth ? `${resolved}#max-width=${maxWidth}` : resolved;
  let p = hdrCache.get(cacheKey);
  if (!p) {
    const startedAt = assetLoadStarted();
    p = scheduleLoad(hdrQueue, () =>
      withRetry(async () => {
        if (typeof Worker !== 'undefined') {
          const decoded = await hdrDecodeInWorker(resolved, maxWidth);
          if (decoded.ok && decoded.data && decoded.width && decoded.height) {
            const pixels = decoded.data as unknown as Uint16Array<ArrayBuffer>;
            const tex = new THREE.DataTexture(pixels, decoded.width, decoded.height);
            tex.type = decoded.type as THREE.TextureDataType;
            return finishHdrTexture(tex);
          }
        }
        return new Promise<THREE.DataTexture>((resolve, reject) => {
          new RGBELoader().load(
            resolved,
            (loaded) => {
              let tex = loaded;
              const image = decodedHdrImage(loaded.image);
              if (maxWidth && !image) {
                reject(new Error(`hdr load failed: ${url} (invalid decoded pixels)`));
                return;
              }
              if (maxWidth && image && image.width > maxWidth) {
                const resized = resampleHdrRgba(image.data, image.width, image.height, maxWidth);
                tex = new THREE.DataTexture(resized.data, resized.width, resized.height);
                tex.type = loaded.type;
                finishHdrTexture(tex);
                loaded.dispose();
              } else {
                tex.mapping = THREE.EquirectangularReflectionMapping;
              }
              resolve(tex);
            },
            undefined,
            () => reject(new Error(`hdr load failed: ${url}`)),
          );
        });
      }),
    ).then(
      (tex) => {
        recordAssetLoad('hdr', resolved, startedAt);
        return tex;
      },
      (err: unknown) => {
        recordAssetLoad('hdr', resolved, startedAt, true);
        throw err;
      },
    );
    hdrCache.set(cacheKey, p);
  }
  return p;
}

/** Plain image texture (terrain splats, water normals, VFX sprites). */
export function loadTexture(
  url: string,
  opts: { srgb?: boolean; repeat?: boolean } = {},
): Promise<THREE.Texture> {
  const resolved = assetUrl(url);
  const key = `${resolved}|${opts.srgb ? 's' : 'l'}|${opts.repeat ? 'r' : 'c'}`;
  let p = texCache.get(key);
  if (!p) {
    const startedAt = assetLoadStarted();
    p = scheduleLoad(textureQueue, () => {
      const seq = diagStart('tex', resolved);
      return withRetry(
        () =>
          new Promise<THREE.Texture>((resolve, reject) => {
            new THREE.TextureLoader().load(
              resolved,
              (tex) => {
                if (opts.srgb) tex.colorSpace = THREE.SRGBColorSpace;
                if (opts.repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
                resolve(tex);
              },
              undefined,
              () => reject(new Error(`texture load failed: ${url}`)),
            );
          }),
      ).then(
        (tex) => {
          diagSettle(seq, 'tex', resolved, true);
          return tex;
        },
        (err: unknown) => {
          diagSettle(seq, 'tex', resolved, false);
          throw err;
        },
      );
    }).then(
      (tex) => {
        recordAssetLoad('texture', resolved, startedAt);
        return tex;
      },
      (err: unknown) => {
        recordAssetLoad('texture', resolved, startedAt, true);
        throw err;
      },
    );
    texCache.set(key, p);
  }
  return p;
}
