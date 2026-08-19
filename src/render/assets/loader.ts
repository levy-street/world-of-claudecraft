// Runtime asset loading: glTF models (meshopt-compressed) + plain and KTX2
// textures, with a promise cache so every consumer shares one parse per URL.
// Render-layer only — the sim must never import this (it runs headless).
//
// There is deliberately no Radiance (.hdr) arm: the biome sky domes and their
// PMREM sources ship as KTX2 UASTC HDR and come through loadKtx2Texture, which
// uploads GPU-compressed blocks instead of the half-float RGBA DataTexture an
// RGBE decode produced (see src/render/sky.ts).
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { type GLTF, GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GFX } from '../gfx';
import { classifyGltfKtx2Textures, dismissKtx2Source } from './ktx2_mip_release';
import { ktx2Loader } from './ktx2_support';
import { MAX_LOAD_ATTEMPTS, retryDelayMs } from './load_retry';
import { assetUrl } from './media';
import { assetLoadStarted, recordAssetLoad } from './stats';

let gltfLoader: GLTFLoader | null = null;
const gltfCache = new Map<string, Promise<GLTF>>();
const texCache = new Map<string, Promise<THREE.Texture>>();
const ktx2TexCache = new Map<string, Promise<THREE.CompressedTexture>>();

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
// Single-slot lane for the few very large textures (the biome sky domes, about
// 1.6 MB compressed at 2k), inherited from the Radiance path this replaced.
// Their fetch lands on the hitch-sensitive biome-crossing path, and letting two
// of them race the model and atlas traffic on the shared texture queue is what
// that serialization was there to prevent.
const largeTextureQueue: AssetQueue = { active: 0, limit: 1, pending: [] };

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
// from error handlers). Gated like the residency table: dev browsers plus every
// iOS WebKit host under diagnosis (Safari and other iOS browsers included, not
// just the native shell: the WebContent kills this exists to trace hit them
// identically, and having zero console evidence from the plain-browser population
// is exactly what let a Safari-only regression of this kind go undiagnosed). The
// native Release shell suppresses the JS console anyway, so this costs it
// nothing; on iOS Safari the ~700 console lines per entry are the trade for
// finally having sequencing evidence when a player reports a crash there.
function loadDiagEnabled(): boolean {
  // Vitest sets DEV too, and every jsdom texture fetch FAILs, so a suite that
  // touches the loader emits hundreds of these lines; that console volume is
  // what keeps onUserConsoleLog rpcs in flight at worker teardown (the shard
  // flake on the release gate). Tests never read this diagnostic: keep it out
  // of the test env entirely.
  if (import.meta.env.TEST) return false;
  return import.meta.env.DEV || GFX.iosMemoryProfile;
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
        // Classify every KTX2 texture for post-upload mip release (world-only
        // categories) or source dismissal (everything a preview/portrait/armory
        // renderer can also upload). Runs here, in the parse's own resolve
        // chain, so classification always precedes the first GPU upload.
        classifyGltfKtx2Textures(gltf, resolved);
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
        // Same terminal-failure eviction as loadGltf and
        // loadKtx2Texture: a rejected promise left in the cache poisons every
        // later load of this url for the session. Identity-guarded so a newer
        // in-flight load is never evicted by an old failure settling.
        if (texCache.get(key) === p) texCache.delete(key);
        throw err;
      },
    );
    texCache.set(key, p);
  }
  return p;
}

/** One normalization for a KTX2 request's cache key, shared by
 *  loadKtx2Texture and releaseKtx2Texture so the pair can never disagree on
 *  which entry a release drops. */
function ktx2CacheKey(resolved: string, opts: { repeat?: boolean }): string {
  return `${resolved}|${opts.repeat ? 'r' : 'c'}`;
}

/** Standalone KTX2/Basis image (KHR_texture_basisu-style compressed atlas):
 *  stays GPU-compressed in memory instead of decoding to a full RGBA bitmap,
 *  the same win GLB-embedded textures already get. Shares the one ktx2Loader()
 *  transcoder singleton the GLB parse path attaches to GLTFLoader, so this pays
 *  no extra transcoder init. Colorspace, mip levels and the vertical flip are
 *  baked into the KTX2 container at compress time
 *  (scripts/assets/compress_standalone_textures.mjs for the LDR sets,
 *  compress_sky_hdr.mjs for the UASTC HDR sky domes), so unlike loadTexture
 *  there is no `srgb` option to pass and `flipY` is never honored here; only
 *  `repeat` remains a runtime choice, and it discriminates the cache key
 *  exactly as it does in loadTexture. `large` picks the single-slot fetch lane
 *  and is NOT part of the cache key: it is a scheduling choice about one
 *  request, not a property of the texture two callers would disagree on. */
export function loadKtx2Texture(
  url: string,
  opts: { repeat?: boolean; large?: boolean } = {},
): Promise<THREE.CompressedTexture> {
  const resolved = assetUrl(url);
  const cacheKey = ktx2CacheKey(resolved, opts);
  let p = ktx2TexCache.get(cacheKey);
  if (!p) {
    const startedAt = assetLoadStarted();
    p = scheduleLoad(opts.large ? largeTextureQueue : textureQueue, () => {
      const seq = diagStart('ktx2tex', resolved);
      return withRetry(
        () =>
          new Promise<THREE.CompressedTexture>((resolve, reject) => {
            ktx2Loader().load(resolved, resolve, undefined, () =>
              reject(new Error(`ktx2 texture load failed: ${url}`)),
            );
          }),
      ).then(
        (tex) => {
          diagSettle(seq, 'ktx2tex', resolved, true);
          return tex;
        },
        (err: unknown) => {
          diagSettle(seq, 'ktx2tex', resolved, false);
          throw err;
        },
      );
    }).then(
      (tex) => {
        if (opts.repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        // Standalone KTX2 atlases (character skins) draw in the character
        // preview, portrait and armory renderers too, so their CPU mip chains
        // must stay resident: dismiss the stashed restore source, never arm.
        // The terrain splat and surface-detail sets are world-only and could
        // ARM the release instead; that is a follow-up, not this change (it
        // needs the same category audit assets/ktx2_mip_release.ts documents).
        dismissKtx2Source(tex);
        recordAssetLoad('texture', resolved, startedAt);
        return tex;
      },
      (err: unknown) => {
        recordAssetLoad('texture', resolved, startedAt, true);
        // Same failure eviction as loadGltf (the black-void precedent): a
        // rejected promise left in the cache poisons every later load for the
        // session, so the second graphics-profile Apply that the terrain,
        // surface-detail and stone-normal owners retry through would replay the
        // old rejection instead of issuing a request, and the sky evict-and-
        // refetch lane could never recover from an outage that outlives the
        // bounded retry. Identity-guarded so a newer in-flight load is never
        // evicted by an old failure settling.
        if (ktx2TexCache.get(cacheKey) === p) ktx2TexCache.delete(cacheKey);
        throw err;
      },
    );
    ktx2TexCache.set(cacheKey, p);
  }
  return p;
}

/** The KTX2 twin of releaseGltf/releaseTexture: drop a loadKtx2Texture entry
 *  once its transcoded texture has been disposed by its owner, so a later
 *  loadKtx2Texture for the same url re-fetches instead of handing out a
 *  disposed texture. Pass the SAME `repeat` the load used, since it
 *  discriminates the cache key. The sky-residency lane pairs this with the
 *  dispose (src/render/sky.ts releaseSkyBiomeAssets): releasing the cache entry
 *  WITHOUT disposing merely costs a re-fetch, but disposing without releasing
 *  hands the next consumer a dead texture. */
export function releaseKtx2Texture(url: string, opts: { repeat?: boolean } = {}): void {
  ktx2TexCache.delete(ktx2CacheKey(assetUrl(url), opts));
}
