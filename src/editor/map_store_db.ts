// IndexedDB persistence for map saves + autosave drafts. localStorage's ~5MB
// quota is a hard ceiling a single serious map can approach (multi-MB compact
// docs), and once full EVERY save silently fails ("blocked storage"). IDB has
// origin quota in the gigabytes, so the MapStore keeps its synchronous facade
// over an in-RAM cache and writes through to these stores. Editor-only,
// never-throws: a blocked/unavailable IDB resolves null/[] and the store
// falls back to the legacy localStorage backend.

const DB_NAME = 'woc_editor_map_store';
const MAPS = 'maps';
const DRAFTS = 'drafts';
const DB_VERSION = 1;

export interface StoredMapRecord {
  id: string;
  /** serializeMapCompact output (RLE paint), parsed lazily on load(). */
  json: string;
  /** CustomMapMeta snapshot for list() without parsing the whole doc. */
  meta: unknown;
  updatedAt: number;
}

export interface StoredDraftRecord {
  id: string;
  json: string;
  updatedAt: number;
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(MAPS)) {
          req.result.createObjectStore(MAPS, { keyPath: 'id' });
        }
        if (!req.result.objectStoreNames.contains(DRAFTS)) {
          req.result.createObjectStore(DRAFTS, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** One long-lived connection: the store's write-through traffic is frequent
 *  (autosave ticks), so open/close per call would thrash. */
let dbPromise: Promise<IDBDatabase | null> | null = null;
function db(): Promise<IDBDatabase | null> {
  if (!dbPromise) dbPromise = openDb();
  return dbPromise;
}

async function getAll<T>(store: string): Promise<T[] | null> {
  const d = await db();
  if (!d) return null;
  return new Promise((resolve) => {
    try {
      const req = d.transaction(store, 'readonly').objectStore(store).getAll();
      req.onsuccess = () => resolve((req.result as T[]) ?? []);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function put(store: string, record: unknown): Promise<boolean> {
  const d = await db();
  if (!d) return false;
  return new Promise((resolve) => {
    try {
      const tx = d.transaction(store, 'readwrite');
      tx.objectStore(store).put(record as never);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

async function del(store: string, id: string): Promise<boolean> {
  const d = await db();
  if (!d) return false;
  return new Promise((resolve) => {
    try {
      const tx = d.transaction(store, 'readwrite');
      tx.objectStore(store).delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export const mapStoreDb = {
  available: async (): Promise<boolean> => (await db()) !== null,
  allMaps: (): Promise<StoredMapRecord[] | null> => getAll<StoredMapRecord>(MAPS),
  putMap: (record: StoredMapRecord): Promise<boolean> => put(MAPS, record),
  deleteMap: (id: string): Promise<boolean> => del(MAPS, id),
  allDrafts: (): Promise<StoredDraftRecord[] | null> => getAll<StoredDraftRecord>(DRAFTS),
  putDraft: (record: StoredDraftRecord): Promise<boolean> => put(DRAFTS, record),
  deleteDraft: (id: string): Promise<boolean> => del(DRAFTS, id),
};
