// Editor skyboxes: the bundled CC0 equirect skies under /skybox/ plus
// user-uploaded ones persisted in IndexedDB (content-addressed by sha256,
// exactly the ground-texture pattern). The editor's Lighting tab picks one and
// the renderer draws it as scene.background. Never-throws: a blocked IDB or a
// missing entry resolves null and the procedural HDRI dome stays up.

import { registerPageTeardown } from '../context_release';

const DB_NAME = 'woc_editor_skyboxes';
const STORE = 'skyboxes';
const DB_VERSION = 1;

/** Bundled skies (equirect, 4096x2048). toon_day is the project's stylized
 *  flat-color sky (converted from the author's cubemap cross). */
export const BUILTIN_SKYBOXES: readonly { id: string; path: string }[] = [
  { id: 'toon_day', path: '/skybox/toon_day.png' },
  { id: 'vale_day', path: '/env/vale_day_1k.hdr' },
  { id: 'marsh_overcast', path: '/env/marsh_overcast_1k.hdr' },
  { id: 'peaks_dawn', path: '/env/peaks_dawn_1k.hdr' },
  { id: 'hollow_dusk', path: '/env/hollow_dusk_1k.hdr' },
  { id: 'amber_sunset', path: '/env/amber_sunset_1k.hdr' },
  { id: 'ember_storm', path: '/env/ember_storm_1k.hdr' },
  { id: 'frost_twilight', path: '/env/frost_twilight_1k.hdr' },
  { id: 'fen_day', path: '/env/fen_day_1k.hdr' },
  { id: 'night', path: '/env/night_1k.hdr' },
  { id: 'nightbloom_dream', path: '/env/nightbloom_dream_1k.hdr' },
  { id: 'wraithwood_gloom', path: '/env/wraithwood_gloom_1k.hdr' },
  { id: 'vale_backdrop', path: '/env/vale_backdrop.webp' },
  { id: 'marsh_backdrop', path: '/env/marsh_backdrop.webp' },
  { id: 'peaks_backdrop', path: '/env/peaks_backdrop.webp' },
  { id: 'space_galaxy', path: '/env/space_galaxy.jpg' },
];

/** Resolve a skybox token ('builtin:<id>' | 'custom:<sha256>') to a URL the
 *  renderer can load: sync for builtins, IndexedDB lookup for uploads. The
 *  SAME resolution serves the editor preview and the playtest boot. */
export async function resolveSkyboxUrl(token: string | undefined | null): Promise<string | null> {
  if (!token) return null;
  if (token.startsWith('builtin:')) {
    const id = token.slice('builtin:'.length);
    return BUILTIN_SKYBOXES.find((s) => s.id === id)?.path ?? null;
  }
  if (token.startsWith('custom:')) return skyboxUrlFor(token.slice('custom:'.length));
  return null;
}

export interface StoredSkybox {
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

/** Persist an uploaded skybox (silent failure = session-only). */
export async function storeSkybox(entry: StoredSkybox): Promise<void> {
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

/** Raw stored bytes for a skybox sha (bundle export), or null. */
export async function loadSkyboxBytes(sha256: string): Promise<StoredSkybox | null> {
  const db = await openDb();
  if (!db) return null;
  const out = await new Promise<StoredSkybox | null>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(sha256);
      req.onsuccess = () => resolve((req.result as StoredSkybox) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  db.close();
  return out;
}

const urlCache = new Map<string, Promise<string | null>>();

/** Object URL for a stored skybox's image, cached per sha for the session.
 *  Null when the bytes are not in this browser. */
export function skyboxUrlFor(sha256: string): Promise<string | null> {
  let p = urlCache.get(sha256);
  if (!p) {
    p = (async () => {
      const db = await openDb();
      if (!db) return null;
      const stored = await new Promise<StoredSkybox | null>((resolve) => {
        try {
          const tx = db.transaction(STORE, 'readonly');
          const req = tx.objectStore(STORE).get(sha256);
          req.onsuccess = () => resolve((req.result as StoredSkybox) ?? null);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
      db.close();
      if (!stored) return null;
      try {
        return URL.createObjectURL(new Blob([stored.bytes], { type: stored.mime }));
      } catch {
        return null;
      }
    })();
    urlCache.set(sha256, p);
  }
  return p;
}

/** Revoke every custom skybox Blob URL owned by this document. */
export function disposeSkyboxUrlCache(): void {
  const pending = [...urlCache.values()];
  urlCache.clear();
  for (const url of pending) {
    void url
      .then((value) => {
        if (value) URL.revokeObjectURL(value);
      })
      .catch(() => {});
  }
}

if (typeof window !== 'undefined') registerPageTeardown(disposeSkyboxUrlCache);
