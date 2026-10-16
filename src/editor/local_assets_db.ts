// IndexedDB persistence for locally imported models (.glb/.gltf bytes), keyed
// by content sha256. Imports survive reloads: the app restores every stored
// entry into the session registry (local_assets.ts) at boot, so saved maps
// that reference 'local/<sha>' placements resolve again without re-importing.
// Editor-only, never-throws: a blocked/unavailable IDB degrades to the old
// session-only behavior.

const DB_NAME = 'woc_editor_local_assets';
const STORE = 'models';
const DB_VERSION = 1;

export interface StoredLocalAsset {
  sha256: string;
  name: string;
  mime: string;
  bytes: ArrayBuffer;
  byteSize: number;
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

/** Persist an imported model's bytes; failures are silent (session-only). */
export async function storeLocalAssetBytes(entry: StoredLocalAsset): Promise<void> {
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

/** Every stored imported model (boot-time registry restore). */
export async function loadStoredLocalAssets(): Promise<StoredLocalAsset[]> {
  const db = await openDb();
  if (!db) return [];
  const out = await new Promise<StoredLocalAsset[]>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result as StoredLocalAsset[]) ?? []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
  db.close();
  return out;
}

/** Drop a stored imported model (the Imported tab's delete). */
export async function deleteStoredLocalAsset(sha256: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(sha256);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
  db.close();
}
