// Real 3D preview thumbnails for the asset browser: one shared offscreen
// WebGLRenderer (lazy-created on first use, so a headless import never touches
// GL) renders each GLB once into a small canvas snapshot. Loads are lazy and
// off the interaction path: grid cells paint the procedural placeholder
// instantly, ids queue here, and a capped number of snapshots run per idle
// slice; a finished snapshot swaps into the cell only if it still shows that
// asset. A GLB that fails to load, an empty scene, or a lost GL context falls
// back to the placeholder permanently (no retry storm). Pure math and the
// cache/queue state machine live in asset_thumbs_core.ts.

import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { loadGltf, releaseGltf } from '../render/assets/loader';
import { assetById } from './asset_catalog.generated';
import { hashHue, ThumbBook, thumbPose } from './asset_thumbs_core';
import { userAssetPath } from './user_assets';

// 2x the cell's 72x54 CSS size for crisp thumbnails on HiDPI screens.
const RENDER_W = 144;
const RENDER_H = 108;
const CSS_W = 72;
const CSS_H = 54;
const FOV_DEG = 35;
// Matches the asset browser's placeholder-cache cap: a long session browsing
// the whole catalogue cannot pin unbounded canvas memory.
const CACHE_CAP = 600;
// Snapshots in flight at once; the GLB loader has its own network queue, this
// caps the clone/render work so typing in search stays smooth.
const CONCURRENCY = 2;

interface ThumbCallback {
  isWanted: () => boolean;
  onReady: (thumb: HTMLCanvasElement) => void;
}

interface GlHost {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
}

const book = new ThumbBook<HTMLCanvasElement>(CACHE_CAP, CONCURRENCY);
// Latest requester per id; an older cell for the same id is detached anyway.
const callbacks = new Map<string, ThumbCallback>();
let gl: GlHost | null = null;
let glFailed = false;
let pumpScheduled = false;

/** Resolve an asset id to its GLB URL the same way placement rendering does. */
function assetGlbPath(assetId: string): string | null {
  return userAssetPath(assetId) ?? assetById(assetId)?.path ?? null;
}

function ensureGl(): GlHost | null {
  if (glFailed) return null;
  if (gl) return gl;
  try {
    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: 'low-power',
    });
    renderer.setSize(RENDER_W, RENDER_H, false);
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.addEventListener('webglcontextlost', (ev) => {
      ev.preventDefault();
      failGl();
    });
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(2.5, 4, 2);
    scene.add(sun);
    const camera = new THREE.PerspectiveCamera(FOV_DEG, RENDER_W / RENDER_H, 0.01, 500);
    gl = { renderer, scene, camera };
  } catch {
    failGl();
  }
  return gl;
}

/** GL is gone for good this session: drop queued work, keep placeholders. */
function failGl(): void {
  glFailed = true;
  book.clearPending();
  callbacks.clear();
  if (gl) {
    gl.renderer.dispose();
    gl = null;
  }
}

function idle(run: () => void): void {
  const ric = (
    globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }
  ).requestIdleCallback;
  if (typeof ric === 'function') ric(run, { timeout: 250 });
  else setTimeout(run, 16);
}

function schedulePump(): void {
  if (pumpScheduled || glFailed) return;
  pumpScheduled = true;
  idle(() => {
    pumpScheduled = false;
    pump();
  });
}

function pump(): void {
  if (glFailed) return;
  while (book.canStart()) {
    const id = book.takeNext((i) => {
      if (callbacks.get(i)?.isWanted()) return true;
      callbacks.delete(i); // stale entry: the grid moved on, drop the requester
      return false;
    });
    if (!id) break;
    void snapshot(id).finally(() => {
      book.settle(id);
      if (book.pendingCount > 0) schedulePump();
    });
  }
}

/** Snapshot canvases share the loader-cached template via a clone; the clone's
 *  geometry/material/texture refs are disposed after the one render so the
 *  offscreen context does not accumulate GPU buffers for every browsed asset
 *  (three re-uploads on demand if a placement still uses the same GLB). */
function disposeSnapshotClone(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (!mat) continue;
      for (const value of Object.values(mat)) {
        if ((value as THREE.Texture | null)?.isTexture) (value as THREE.Texture).dispose();
      }
      mat.dispose();
    }
  });
}

/** Same deterministic hue gradient as the procedural placeholder, so the
 *  swap reads as the tile coming into focus rather than changing identity. */
function paintBackdrop(ctx: CanvasRenderingContext2D, assetId: string): void {
  const hue = hashHue(assetId);
  const grad = ctx.createLinearGradient(0, 0, 0, RENDER_H);
  grad.addColorStop(0, `hsl(${hue}, 32%, 24%)`);
  grad.addColorStop(1, `hsl(${hue}, 40%, 12%)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, RENDER_W, RENDER_H);
}

async function snapshot(assetId: string): Promise<void> {
  const path = assetGlbPath(assetId);
  if (!path) {
    book.markFailed(assetId);
    callbacks.delete(assetId);
    return;
  }
  let gltf: GLTF;
  try {
    gltf = await loadGltf(path);
  } catch {
    book.markFailed(assetId);
    callbacks.delete(assetId);
    return;
  }
  const host = ensureGl();
  if (!host) return; // GL failed: queue already cleared, placeholders stay
  // Cache results are immutable: clone before adding to the offscreen scene
  // (SkeletonUtils so skinned character/creature GLBs keep a valid bind).
  const model = cloneSkinned(gltf.scene);
  // Thumbnails are one-shot: drop the parse cache entry so browsing hundreds
  // of assets does not pin every parsed scene (a later placement re-fetches).
  releaseGltf(path);
  try {
    host.scene.add(model);
    const box = new THREE.Box3().setFromObject(model);
    if (box.isEmpty()) {
      book.markFailed(assetId);
      callbacks.delete(assetId);
      return;
    }
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const pose = thumbPose(sphere.center, sphere.radius, FOV_DEG, RENDER_W / RENDER_H);
    host.camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    host.camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
    host.renderer.render(host.scene, host.camera);
    const out = document.createElement('canvas');
    out.width = RENDER_W;
    out.height = RENDER_H;
    out.style.width = `${CSS_W}px`;
    out.style.height = `${CSS_H}px`;
    const ctx = out.getContext('2d');
    if (!ctx) {
      book.markFailed(assetId);
      callbacks.delete(assetId);
      return;
    }
    paintBackdrop(ctx, assetId);
    ctx.drawImage(host.renderer.domElement, 0, 0);
    book.put(assetId, out);
    const cb = callbacks.get(assetId);
    callbacks.delete(assetId);
    if (cb?.isWanted()) cb.onReady(out);
  } catch {
    book.markFailed(assetId);
    callbacks.delete(assetId);
  } finally {
    host.scene.remove(model);
    disposeSnapshotClone(model);
  }
}

/** The finished snapshot for an asset id, if one is cached. */
export function cachedAssetThumb(assetId: string): HTMLCanvasElement | null {
  return book.get(assetId) ?? null;
}

/**
 * Queue a real 3D thumbnail for an asset id. `isWanted` must stay cheap: it
 * gates both queue processing and the final swap, so a grid that re-rendered
 * (search, tab change) silently drops stale work. `onReady` fires at most
 * once, only while the id is still wanted. Failed ids and a dead GL context
 * are permanent no-ops: the caller's placeholder simply stays.
 */
export function requestAssetThumb(
  assetId: string,
  isWanted: () => boolean,
  onReady: (thumb: HTMLCanvasElement) => void,
): void {
  if (glFailed || book.isFailed(assetId)) return;
  const cached = book.get(assetId);
  if (cached) {
    onReady(cached);
    return;
  }
  callbacks.set(assetId, { isWanted, onReady });
  book.enqueue(assetId);
  schedulePump();
}
