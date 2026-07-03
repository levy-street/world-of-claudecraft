// Save/load for CustomMap documents. Split, like src/ui/theme.ts, into a pure
// never-throws (de)serializer and a thin localStorage store. A map is a plain
// JSON artifact, so it round-trips to a file and back. Parsing/validation is
// the SHARED sanitizer in src/sim/map_doc.ts (the server applies the same one
// to stored documents); this module re-exports it under the editor's historical
// names and keeps the local map store.
//
// Storage layout: ONE localStorage key per map (woc_editor_map:<id>) plus a
// small meta index (woc_editor_maps_index), so saving map B never rewrites map
// A's bytes, a quota failure is scoped to one document, and list() reads only
// the tiny index instead of sanitizing every stored map. The legacy single-blob
// key (woc_editor_maps) migrates lazily on first access.

import { sanitizeMapDoc, serializeMapDoc } from '../sim/map_doc';
import type { CustomMap, CustomMapMeta } from './custom_map';

/** Pretty-printed serialization, for the human-readable file export ONLY. */
export function serializeMap(map: CustomMap): string {
  return serializeMapDoc(map as unknown as Parameters<typeof serializeMapDoc>[0]);
}

/**
 * Compact serialization for localStorage (store + autosave draft): the pretty
 * form is 3-5x larger and the multi-MB stringify/parse is synchronous.
 */
export function serializeMapCompact(map: CustomMap): string {
  return JSON.stringify(map);
}

// Parse anything into a CustomMap, or null if it cannot be salvaged (no usable
// zones). Accepts a JSON string or an already-parsed object.
export function parseMap(raw: unknown): CustomMap | null {
  return sanitizeMapDoc(raw) as CustomMap | null;
}

// ---- localStorage store ----------------------------------------------------

const LEGACY_STORE_KEY = 'woc_editor_maps';
const MAP_KEY_PREFIX = 'woc_editor_map:';
const INDEX_KEY = 'woc_editor_maps_index';

interface StoredMaps {
  [id: string]: CustomMap;
}

type MetaIndex = Record<string, CustomMapMeta>;

// Minimal Storage surface so the store is testable with an in-memory mock.
// removeItem is optional for back-compat with older mocks; absent, deletion
// falls back to writing an empty value (which every read path treats as gone).
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

function removeKey(storage: KeyValueStore, key: string): void {
  if (storage.removeItem) storage.removeItem(key);
  else storage.setItem(key, '');
}

function mapKey(id: string): string {
  return MAP_KEY_PREFIX + id;
}

function metaOf(map: CustomMap): CustomMapMeta {
  return { ...map.meta };
}

function isMetaRecord(v: unknown): v is CustomMapMeta {
  if (!v || typeof v !== 'object') return false;
  const m = v as CustomMapMeta;
  return typeof m.id === 'string' && typeof m.name === 'string' && typeof m.updatedAt === 'number';
}

export class MapStore {
  private migrated = false;

  constructor(private readonly storage: KeyValueStore | null = safeLocalStorage()) {}

  private readIndex(): MetaIndex {
    if (!this.storage) return {};
    try {
      const raw = this.storage.getItem(INDEX_KEY);
      if (!raw) return {};
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object') return {};
      const index: MetaIndex = {};
      for (const [id, meta] of Object.entries(obj)) {
        if (isMetaRecord(meta)) index[id] = meta;
      }
      return index;
    } catch {
      return {};
    }
  }

  private writeIndex(index: MetaIndex): void {
    this.storage?.setItem(INDEX_KEY, JSON.stringify(index));
  }

  private readLegacyBlob(): StoredMaps {
    if (!this.storage) return {};
    try {
      const raw = this.storage.getItem(LEGACY_STORE_KEY);
      if (!raw) return {};
      const obj = JSON.parse(raw);
      return obj && typeof obj === 'object' ? (obj as StoredMaps) : {};
    } catch {
      return {};
    }
  }

  /**
   * One-time move of the legacy single-blob store into per-map keys + index.
   * Best effort: on a partial failure (quota) the legacy blob stays put and
   * every read path still falls back to it, so nothing is lost.
   */
  private ensureMigrated(): void {
    if (this.migrated || !this.storage) return;
    this.migrated = true;
    const legacy = this.readLegacyBlob();
    const ids = Object.keys(legacy);
    if (ids.length === 0) return;
    try {
      const index = this.readIndex();
      for (const id of ids) {
        const parsed = parseMap(legacy[id]);
        if (!parsed) continue;
        // A newer per-map save wins over the stale legacy copy.
        if (index[id] && index[id].updatedAt >= parsed.meta.updatedAt) continue;
        this.storage.setItem(mapKey(id), serializeMapCompact(parsed));
        index[id] = metaOf(parsed);
      }
      this.writeIndex(index);
      removeKey(this.storage, LEGACY_STORE_KEY);
    } catch {
      this.migrated = false; // retry next call; reads fall back to the blob
    }
  }

  list(): CustomMapMeta[] {
    this.ensureMigrated();
    const index = this.readIndex();
    // Legacy fallback for maps a failed migration left in the blob.
    for (const [id, m] of Object.entries(this.readLegacyBlob())) {
      if (index[id]) continue;
      const parsed = parseMap(m);
      if (parsed) index[id] = metaOf(parsed);
    }
    return Object.values(index).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  save(map: CustomMap): boolean {
    if (!this.storage) return false;
    this.ensureMigrated();
    try {
      this.storage.setItem(mapKey(map.meta.id), serializeMapCompact(map));
      const index = this.readIndex();
      index[map.meta.id] = metaOf(map);
      this.writeIndex(index);
      return true;
    } catch {
      return false;
    }
  }

  load(id: string): CustomMap | null {
    if (!this.storage) return null;
    this.ensureMigrated();
    try {
      const raw = this.storage.getItem(mapKey(id));
      if (raw) return parseMap(raw);
      const legacy = this.readLegacyBlob()[id];
      return legacy ? parseMap(legacy) : null;
    } catch {
      return null;
    }
  }

  remove(id: string): boolean {
    if (!this.storage) return false;
    this.ensureMigrated();
    try {
      const index = this.readIndex();
      const hadKey =
        this.storage.getItem(mapKey(id)) !== null && this.storage.getItem(mapKey(id)) !== '';
      const hadIndex = id in index;
      removeKey(this.storage, mapKey(id));
      if (hadIndex) {
        delete index[id];
        this.writeIndex(index);
      }
      // A failed migration may still hold this map in the legacy blob.
      const legacy = this.readLegacyBlob();
      let hadLegacy = false;
      if (id in legacy) {
        hadLegacy = true;
        delete legacy[id];
        this.storage.setItem(LEGACY_STORE_KEY, JSON.stringify(legacy));
      }
      return hadKey || hadIndex || hadLegacy;
    } catch {
      return false;
    }
  }
}

export function safeLocalStorage(): KeyValueStore | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}
