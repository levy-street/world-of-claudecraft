// Imported ground-paint textures: IndexedDB persistence (content-addressed by
// sha256, like the editor's imported models) plus a THREE texture cache. The
// EDITOR stores images here when a texture swatch is imported; the terrain
// splat material (editor AND playtest, same origin) resolves a swatch's
// textureSha back to a tiling texture. Never-throws: a blocked IDB or missing
// entry resolves null and the swatch falls back to its flat color.
//
// Built-in library swatches carry the pseudo hash `builtin:<Key>` instead of
// a sha256 (see terrain_texture_sets.ts): those resolve straight from the app
// bundle (public/textures/terrain/), never from IndexedDB, so the default
// texture set is available on every machine a map opens on.

import { registerPageTeardown } from '../context_release';
import { builtinKeyOf, terrainTexturePath } from '../terrain_texture_sets';
import { assetUrl } from './media';

const DB_NAME = 'woc_editor_ground_textures';
const STORE = 'textures';
const DB_VERSION = 1;

export interface StoredGroundTexture {
  sha256: string;
  name: string;
  mime: string;
  bytes: ArrayBuffer;
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE, { keyPath: 'sha256' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Persist an imported ground texture (silent failure = session-only). */
export async function storeGroundTexture(entry: StoredGroundTexture): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
  db.close();
}

export async function loadGroundTextureBytes(sha256: string): Promise<StoredGroundTexture | null> {
  // Builtin sets ship with the app: serve their Color map from the bundle so
  // export flows (map bundles) can embed the image like any imported texture.
  const builtinKey = builtinKeyOf(sha256);
  if (builtinKey) {
    const path = terrainTexturePath(builtinKey, 'color');
    if (!path) return null;
    try {
      const resp = await fetch(assetUrl(path));
      if (!resp.ok) return null;
      return {
        sha256,
        name: `${builtinKey}_Color.jpg`,
        mime: 'image/jpeg',
        bytes: await resp.arrayBuffer(),
      };
    } catch {
      return null;
    }
  }
  const db = await openDb();
  if (!db) return null;
  const out = await new Promise<StoredGroundTexture | null>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(sha256);
      req.onsuccess = () => resolve((req.result as StoredGroundTexture) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  db.close();
  return out;
}

// ---- image cache --------------------------------------------------------------
//
// The terrain material packs all custom ground textures into ONE atlas
// sampler (the splat shader already sits near MAX_TEXTURE_IMAGE_UNITS), so
// consumers get decoded ImageBitmaps to draw into the atlas canvas rather
// than standalone THREE textures.

const imageCache = new Map<string, Promise<ImageBitmap | null>>();
const urlCache = new Map<string, string>();

/** Object URL for a stored texture once it has been resolved (sync; the paint
 *  palette uses it for swatch thumbnails). Builtin shas resolve immediately to
 *  their bundled asset URL. */
export function groundTextureUrl(sha256: string): string | null {
  const builtinKey = builtinKeyOf(sha256);
  if (builtinKey) {
    const path = terrainTexturePath(builtinKey, 'color');
    return path ? assetUrl(path) : null;
  }
  return urlCache.get(sha256) ?? null;
}

/** Resolve a swatch's textureSha to a decoded image, cached per sha for the
 *  session. Null when the bytes are not in this browser. */
export function groundImageFor(sha256: string): Promise<ImageBitmap | null> {
  let p = imageCache.get(sha256);
  if (!p) {
    p = loadGroundTextureBytes(sha256).then(async (stored) => {
      if (!stored) return null;
      try {
        const blob = new Blob([stored.bytes], { type: stored.mime });
        if (!builtinKeyOf(sha256)) urlCache.set(sha256, URL.createObjectURL(blob));
        return await createImageBitmap(blob);
      } catch {
        return null;
      }
    });
    imageCache.set(sha256, p);
  }
  return p;
}

/** Close decoded bitmap surfaces and revoke imported-texture Blob URLs. */
export function disposeGroundImageCache(): void {
  const pending = [...imageCache.entries()];
  imageCache.clear();
  for (const url of urlCache.values()) URL.revokeObjectURL(url);
  urlCache.clear();
  for (const [sha256, image] of pending) {
    void image
      .then((bitmap) => {
        bitmap?.close();
        const lateUrl = urlCache.get(sha256);
        if (lateUrl) {
          URL.revokeObjectURL(lateUrl);
          urlCache.delete(sha256);
        }
      })
      .catch(() => {});
  }
}

if (typeof window !== 'undefined') registerPageTeardown(disposeGroundImageCache);
