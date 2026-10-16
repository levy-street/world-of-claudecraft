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
import { applyTextureAnisotropy } from '../texture_anisotropy';
import { applyVertexColourScale } from '../vertex_colour_glb_parts';
import { applyFoliageEdgeFade } from './foliage_edge_fade';
import { classifyGltfKtx2Textures, dismissKtx2Source } from './ktx2_mip_release';
import { ktx2Loader } from './ktx2_support';
import { type AssetLoadPriority, minimumLoadPriority } from './load_priority_core';
import { type LoadPriority, LoadQueue } from './load_queue_core';
import { MAX_LOAD_ATTEMPTS, retryDelayMs } from './load_retry';
import { assetUrl } from './media';
import { shareKitTextures } from './shared_kit_textures';
import { assetLoadStarted, recordAssetLoad } from './stats';
import { applyTownSmartToScene } from './town_smart_material';
import { neutralizeGltfTransmission } from './transmission_neutralize';
import { wocLodPlugin } from './woc_lod_plugin';

let gltfLoader: GLTFLoader | null = null;
const gltfCache = new Map<string, Promise<GLTF>>();
// A shared file may serve several placements or fragments. The nearest caller
// wins until its fetch starts; then its priority callbacks are released.
const gltfPendingPriorities = new Map<string, Set<AssetLoadPriority>>();
const DEFAULT_LOAD_PRIORITY: AssetLoadPriority = () => 0;
const texCache = new Map<string, Promise<THREE.Texture>>();
// Reference-counted holds layered over texCache (see acquireTexture). A plain
// loadTexture caller pins its key for the session, that is the shipped game's
// behaviour and the base splat depends on it, so an evictable hold may only
// dispose a texture nobody pinned.
const texPinned = new Set<string>();
const texRefs = new Map<string, number>();
const ktx2TexCache = new Map<string, Promise<THREE.CompressedTexture>>();

function constrainedBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const narrow = typeof innerWidth === 'number' && Math.min(innerWidth, innerHeight) <= 700;
  return (coarse && narrow) || (nav.deviceMemory !== undefined && nav.deviceMemory <= 4);
}

// Keep large loader callback chains from running in one import-time burst.
const launchLoad = (start: () => void): void => {
  globalThis.setTimeout(start, 0);
};

const constrained = constrainedBrowser();
// Which waiting load starts next is load_queue_core.ts: a file somebody needs now ahead of
// the bulk stream. The GLB queue carries background loads (the post-entry creature stream,
// the crowd prefetch), and so does the texture queue for a KTX2 atlas fetched ahead of need.
const gltfQueue = new LoadQueue(constrained ? 2 : 4, launchLoad);
const textureQueue = new LoadQueue(constrained ? 3 : 6, launchLoad);
// Single-slot lane for the few very large textures (the biome sky domes, about
// 1.6 MB compressed at 2k), inherited from the Radiance path this replaced.
// Their fetch lands on the hitch-sensitive biome-crossing path, and letting two
// of them race the model and atlas traffic on the shared texture queue is what
// that serialization was there to prevent.
const largeTextureQueue = new LoadQueue(1, launchLoad);

function scheduleLoad<T>(
  q: LoadQueue,
  run: () => Promise<T>,
  priority?: LoadPriority,
  key?: string,
  rank?: AssetLoadPriority,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    q.push(
      (background) => {
        run()
          .then(resolve, reject)
          .finally(() => q.release(background));
      },
      priority,
      key,
      rank,
    );
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
    // The WOC character files' coarser levels of detail (woc_lod_plugin.ts).
    assembled.register(wocLodPlugin);
    gltfLoader = assembled;
  }
  return gltfLoader;
}

// Central GLB texture polish: anisotropic filtering on every color and normal
// map sharpens ground-adjacent props and walls at oblique camera angles (mip
// selection alone smears them). The tap count is the tier budget, not a
// constant: it is bandwidth on the integrated GPUs that carry the low tiers.
// Runs once per parsed GLB, right after parse and before first upload, so no
// texture ever needs a re-upload. This lane can run BEFORE initGfxTier resolves
// the tier, which is why the stamp goes through texture_anisotropy.ts (it
// re-applies the resolved budget before the world renderer's first upload).
function polishGltfTextures(gltf: GLTF): void {
  // Fail soft on partial GLTF shapes (test doubles, exotic parses): the polish
  // is cosmetic and must never sink an otherwise successful load.
  if (typeof gltf.scene?.traverse !== 'function') return;
  const seen = new Set<THREE.Texture>();
  const lift = (tex: THREE.Texture | null, map: 'colour' | 'normal'): void => {
    if (!tex || seen.has(tex)) return;
    seen.add(tex);
    applyTextureAnisotropy(tex, map);
  };
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const std = m as THREE.MeshStandardMaterial;
      lift(std.map ?? null, 'colour');
      lift(std.normalMap ?? null, 'normal');
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

/** How one GLB request is scheduled. Never part of the cache key: a url is one parse
 *  however it was asked for. */
export interface GltfLoadOptions {
  /** `background`: speculative bulk (the post-entry creature stream, a prefetch), which
   *  starts only while no file somebody needs now is waiting (load_queue_core.ts).
   *  Omitted: `demand`. */
  priority?: LoadPriority;
  /** Rank INSIDE that class, sampled when a slot frees (load_priority_core.ts): lower
   *  starts first, equal ranks stay first come first served. The Studio placed-asset
   *  stream passes its nearest waiting placement's distance, so a moving camera promotes
   *  the models it is about to reach. Omitted: 0, which is plain arrival order. */
  rank?: AssetLoadPriority;
}

/** Load + parse a .glb once; subsequent calls share the same parsed scene.
 *  Consumers must treat the result as immutable: clone before mutating.
 *  A demand for a file whose load still waits as background work promotes it: the
 *  same promise comes back, and its start joins the demand line. `opts` may also be
 *  a bare rank callback (the Studio placed-asset stream's form), read as `{ rank }`. */
export function loadGltf(
  url: string,
  opts: GltfLoadOptions | AssetLoadPriority = {},
): Promise<GLTF> {
  const { priority, rank } =
    typeof opts === 'function' ? { priority: undefined, rank: opts } : opts;
  // "<file>.glb#node:<name>" / "<file>.glb#group:<prefix>" addresses part of a
  // GLB (a Blender-built building's parts twin, see data/prefab_pieces): the
  // base file parses once, and the fragment is carved out of it as its own
  // scene, cached under the full url like any other model.
  const hash = url.indexOf('#');
  if (hash > 0) {
    return loadGltfFragment(url.slice(0, hash), url.slice(hash + 1), url, { priority, rank });
  }
  const resolved = assetUrl(url);
  let p = gltfCache.get(resolved);
  gltfPendingPriorities.get(resolved)?.add(rank ?? DEFAULT_LOAD_PRIORITY);
  if (!p) {
    const priorities = new Set([rank ?? DEFAULT_LOAD_PRIORITY]);
    gltfPendingPriorities.set(resolved, priorities);
    const startedAt = assetLoadStarted();
    p = scheduleLoad(
      gltfQueue,
      () => {
        if (gltfPendingPriorities.get(resolved) === priorities)
          gltfPendingPriorities.delete(resolved);
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
      },
      priority,
      resolved,
      () => minimumLoadPriority(priorities),
    ).then(
      (gltf) => {
        // The Tidehold kit's GLBs share one set of tiling maps: keep one copy
        // of each on the GPU (shared_kit_textures.ts). Before classification, so
        // the mip-release registry only ever sees the survivors.
        shareKitTextures(gltf.scene, resolved);
        polishGltfTextures(gltf);
        // A painted, vertex-coloured model's colours back above the headroom they are
        // stored under (vertex_colour_glb_parts.ts), before anything clones its materials.
        applyVertexColourScale(gltf.scene);
        // The Tidehold town kit's per-building weathering masks (town_smart_material.ts).
        applyTownSmartToScene(gltf.scene);
        // Transmissive materials become translucent (transmission_neutralize.ts).
        neutralizeGltfTransmission(gltf);
        // Kit foliage cards fade out as they turn edge-on (foliage_edge_fade.ts).
        applyFoliageEdgeFade(gltf.scene);
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
  } else if (priority !== 'background') {
    gltfQueue.promote(resolved);
  }
  return p;
}

/** Drop a parsed glTF from the cache once its data has been extracted into
 *  module-owned structures — lets the parsed scene, original geometry and any
 *  duplicate decoded textures be garbage-collected. A later loadGltf for the
 *  same url would simply re-fetch. */

const fragmentCache = new Map<string, Promise<GLTF>>();

/** Carve one node (or every mesh node with a name prefix) out of a parsed GLB.
 *  `node:` drops the node's own placement so the piece sits in its local
 *  frame (the prefab-pieces manifest carries where it goes); `group:` keeps
 *  each matching node's composed transform (the joined shell stays put).
 *  Geometry and materials are shared with the base parse. */
function loadGltfFragment(
  base: string,
  fragment: string,
  fullUrl: string,
  opts: GltfLoadOptions,
): Promise<GLTF> {
  const resolvedBase = assetUrl(base);
  const key = `${resolvedBase}#${fragment}`;
  let p = fragmentCache.get(key);
  gltfPendingPriorities.get(resolvedBase)?.add(opts.rank ?? DEFAULT_LOAD_PRIORITY);
  if (!p) {
    p = loadGltf(base, opts).then((gltf) => {
      const scene = new THREE.Group();
      scene.name = fragment;
      const colon = fragment.indexOf(':');
      const kind = colon > 0 ? fragment.slice(0, colon) : 'node';
      const name = colon > 0 ? fragment.slice(colon + 1) : fragment;
      gltf.scene.updateMatrixWorld(true);
      if (kind === 'group') {
        gltf.scene.traverse((o) => {
          if (!(o as THREE.Mesh).isMesh || !o.name.startsWith(name)) return;
          const copy = o.clone(true);
          copy.matrixAutoUpdate = true;
          copy.position.set(0, 0, 0);
          copy.quaternion.identity();
          copy.scale.set(1, 1, 1);
          copy.applyMatrix4(o.matrixWorld);
          scene.add(copy);
        });
      } else {
        const found = gltf.scene.getObjectByName(name);
        if (found) {
          const copy = found.clone(true);
          copy.position.set(0, 0, 0);
          copy.quaternion.identity();
          copy.scale.set(1, 1, 1);
          copy.updateMatrix();
          scene.add(copy);
        }
      }
      if (scene.children.length === 0) {
        throw new Error(`asset fragment not found: ${fullUrl}`);
      }
      return { ...gltf, scene, scenes: [scene] } as GLTF;
    });
    p.catch(() => fragmentCache.delete(key));
    fragmentCache.set(key, p);
  } else if (opts.priority !== 'background') {
    // a demand for a piece is a demand for its file, as loadGltf promotes a whole one
    gltfQueue.promote(resolvedBase);
  }
  return p;
}

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
  texPinned.add(key);
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

/**
 * A REFERENCE-COUNTED texture hold for callers that manage lifetime (rock/cave
 * ground-texture sets, authored decals). The texture disposes (freeing its
 * VRAM) once every acquire is released AND nothing pinned it via loadTexture.
 * `release` is idempotent.
 */
export function acquireTexture(
  url: string,
  opts: { srgb?: boolean; repeat?: boolean } = {},
): { texture: Promise<THREE.Texture>; release: () => void } {
  const resolved = assetUrl(url);
  const key = `${resolved}|${opts.srgb ? 's' : 'l'}|${opts.repeat ? 'r' : 'c'}`;
  // Route the fetch through the shared cache without pinning it: acquire and
  // release are the only lifetime owners of a texture nobody else loaded.
  const wasPinned = texPinned.has(key);
  const texture = loadTexture(url, opts);
  if (!wasPinned) texPinned.delete(key);
  texRefs.set(key, (texRefs.get(key) ?? 0) + 1);
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    const next = Math.max(0, (texRefs.get(key) ?? 0) - 1);
    texRefs.set(key, next);
    if (next > 0 || texPinned.has(key)) return;
    const cached = texCache.get(key);
    texRefs.delete(key);
    texCache.delete(key);
    void cached?.then((tex) => tex.dispose()).catch(() => {});
  };
  return { texture, release };
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
 *  request, not a property of the texture two callers would disagree on.
 *  `priority` is a scheduling choice too (load_queue_core.ts): `background` is
 *  a fetch ahead of need, which starts only while no texture somebody needs now
 *  is waiting, and a later demand for the same texture promotes it, as loadGltf
 *  does for a model. */
export function loadKtx2Texture(
  url: string,
  opts: { repeat?: boolean; large?: boolean; priority?: LoadPriority } = {},
): Promise<THREE.CompressedTexture> {
  const resolved = assetUrl(url);
  const cacheKey = ktx2CacheKey(resolved, opts);
  const queue = opts.large ? largeTextureQueue : textureQueue;
  let p = ktx2TexCache.get(cacheKey);
  if (!p) {
    const startedAt = assetLoadStarted();
    p = scheduleLoad(
      queue,
      () => {
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
      },
      opts.priority,
      cacheKey,
    ).then(
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
  } else if (opts.priority !== 'background') {
    // wherever it waits: the lane is the first asker's, and this one may name the other
    textureQueue.promote(cacheKey);
    largeTextureQueue.promote(cacheKey);
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
