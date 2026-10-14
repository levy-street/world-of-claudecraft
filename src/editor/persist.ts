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

import {
  decodeBiomePaintIdsRle,
  encodeBiomePaintIdsRle,
  sanitizeMapDoc,
  serializeMapDoc,
} from '../sim/map_doc';
import { type CustomMap, type CustomMapMeta, toMapDoc } from './custom_map';
import { mapStoreDb } from './map_store_db';

/** Pretty-printed serialization, for the human-readable file export ONLY. */
export function serializeMap(map: CustomMap): string {
  return serializeMapDoc(toMapDoc(map));
}

// ---- biome-paint ids RLE (localStorage layer ONLY) --------------------------
//
// A fine paint grid holds up to ~4.2M cells; as a plain JSON array that is
// many MB ? past the localStorage quota. The grids are extremely run-heavy
// (mostly 255 with painted runs), so the STORE swaps `ids` for a run-length
// string (shared codec in sim/map_doc, also used by the playtest handoff).
// This never leaks into the document format: file export, bundles and the
// server all see the plain array; only serializeMapCompact/parseMap (the
// store + autosave seam) speak RLE, and parseMap expands it before the shared
// sanitizer runs.

const IDS_RLE_MIN = 4096; // below this a plain array is small enough

/**
 * Compact serialization for localStorage (store + autosave draft): the pretty
 * form is 3-5x larger and the multi-MB stringify/parse is synchronous. Large
 * biome-paint grids store their ids run-length-encoded (see above).
 */
export function serializeMapCompact(map: CustomMap): string {
  const bp = (map as { biomePaint?: { ids?: number[] } }).biomePaint;
  if (bp && Array.isArray(bp.ids) && bp.ids.length >= IDS_RLE_MIN) {
    const { ids, ...rest } = bp;
    return JSON.stringify({
      ...map,
      biomePaint: { ...rest, idsRle: encodeBiomePaintIdsRle(ids) },
    });
  }
  return JSON.stringify(map);
}

// Parse anything into a CustomMap, or null if it cannot be salvaged (no usable
// zones). Accepts a JSON string or an already-parsed object; expands the
// store's RLE ids (if present) before the shared sanitizer runs.
export function parseMap(raw: unknown): CustomMap | null {
  let doc = raw;
  if (typeof doc === 'string') {
    try {
      doc = JSON.parse(doc);
    } catch {
      return null;
    }
  }
  if (doc && typeof doc === 'object') {
    const bp = (doc as { biomePaint?: { ids?: unknown; idsRle?: unknown } }).biomePaint;
    if (bp && typeof bp === 'object' && typeof bp.idsRle === 'string' && !Array.isArray(bp.ids)) {
      const ids = decodeBiomePaintIdsRle(bp.idsRle);
      if (ids) {
        const { idsRle, ...rest } = bp as Record<string, unknown>;
        doc = { ...doc, biomePaint: { ...rest, ids } };
      }
    }
  }
  return sanitizeMapDoc(doc) as CustomMap | null;
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

// Draft key constants mirrored from map_io.ts (the draft OWNER): hydrate()
// migrates those localStorage slots into IndexedDB alongside the map saves.
const LS_DRAFT_LEGACY = 'woc_editor_draft';
const LS_DRAFT_PREFIX = 'woc_editor_draft:';
const LS_DRAFT_INDEX = 'woc_editor_drafts_index';

export class MapStore {
  private migrated = false;
  /**
   * The write-through RAM cache (compact JSON + meta per map id). After
   * ready() resolves with IndexedDB available, this cache is the synchronous
   * source of truth and every mutation also writes through to IDB, which has
   * gigabytes of origin quota, unlike localStorage's ~5MB ("blocked storage"
   * once a serious map or two filled it). Without IDB (old browser, private
   * mode, plain-Node tests) every method falls back to the legacy synchronous
   * localStorage paths below, byte-for-byte as before.
   */
  private readonly ram = new Map<string, { json: string; meta: CustomMapMeta }>();
  private readonly drafts = new Map<string, { json: string; updatedAt: number }>();
  private mode: 'pending' | 'ls' | 'idb' = 'pending';
  private readyPromise: Promise<void> | null = null;

  constructor(private readonly storage: KeyValueStore | null = safeLocalStorage()) {}

  /** True once ready() picked the IndexedDB backend. */
  get idbActive(): boolean {
    return this.mode === 'idb';
  }

  /** Hydrate the cache (IndexedDB preferred) and migrate every localStorage
   *  save/draft into IDB, DELETING the localStorage copies afterwards ,
   *  freeing the quota is the whole point. Await once at boot; all the
   *  synchronous methods below serve from the cache from then on. */
  ready(): Promise<void> {
    if (!this.readyPromise) this.readyPromise = this.hydrate();
    return this.readyPromise;
  }

  private async hydrate(): Promise<void> {
    const records = await mapStoreDb.allMaps();
    if (records === null) {
      this.mode = 'ls'; // no IDB: legacy localStorage behavior, unchanged
      return;
    }
    this.mode = 'idb';
    for (const r of records) {
      if (typeof r?.id === 'string' && typeof r.json === 'string' && isMetaRecord(r.meta)) {
        this.ram.set(r.id, { json: r.json, meta: r.meta });
      }
    }
    const draftRecords = (await mapStoreDb.allDrafts()) ?? [];
    for (const d of draftRecords) {
      if (typeof d?.id === 'string' && typeof d.json === 'string') {
        this.drafts.set(d.id, { json: d.json, updatedAt: d.updatedAt ?? 0 });
      }
    }
    await this.migrateLocalStorage();
  }

  /** Move localStorage saves + drafts into IDB (newest wins), then remove the
   *  localStorage keys whose content made it across. Anything unparseable is
   *  left in place untouched. */
  private async migrateLocalStorage(): Promise<void> {
    const storage = this.storage;
    if (!storage) return;
    try {
      // Saves: the per-map keys (via the index + a raw key scan) + legacy blob.
      const ids = new Set<string>(Object.keys(this.readIndex()));
      const legacy = this.readLegacyBlob();
      for (const id of Object.keys(legacy)) ids.add(id);
      // Raw scan catches saves a broken index forgot about.
      const ls = storage as Partial<Storage>;
      if (typeof ls.length === 'number' && typeof ls.key === 'function') {
        for (let i = 0; i < ls.length; i++) {
          const k = ls.key(i);
          if (k?.startsWith(MAP_KEY_PREFIX)) ids.add(k.slice(MAP_KEY_PREFIX.length));
        }
      }
      const movedKeys: string[] = [];
      for (const id of ids) {
        const raw = storage.getItem(mapKey(id)) || legacy[id];
        if (!raw) continue;
        const parsed = parseMap(raw);
        if (!parsed) continue;
        const current = this.ram.get(id);
        if (!current || current.meta.updatedAt < parsed.meta.updatedAt) {
          const json = typeof raw === 'string' ? raw : serializeMapCompact(parsed);
          const meta = metaOf(parsed);
          const ok = await mapStoreDb.putMap({ id, json, meta, updatedAt: meta.updatedAt });
          if (!ok) continue; // keep the localStorage copy if IDB rejected it
          this.ram.set(id, { json, meta });
        }
        if (storage.getItem(mapKey(id))) movedKeys.push(mapKey(id));
      }
      for (const k of movedKeys) removeKey(storage, k);
      removeKey(storage, INDEX_KEY);
      removeKey(storage, LEGACY_STORE_KEY);
      // Drafts: same dance over the draft slots.
      const draftIds = new Set<string>();
      try {
        const rawIndex = storage.getItem(LS_DRAFT_INDEX);
        const obj = rawIndex ? JSON.parse(rawIndex) : {};
        if (obj && typeof obj === 'object') for (const id of Object.keys(obj)) draftIds.add(id);
      } catch {
        // Unreadable index: the raw scan below still finds the slots.
      }
      if (typeof ls.length === 'number' && typeof ls.key === 'function') {
        for (let i = 0; i < ls.length; i++) {
          const k = ls.key(i);
          if (k?.startsWith(LS_DRAFT_PREFIX)) draftIds.add(k.slice(LS_DRAFT_PREFIX.length));
        }
      }
      for (const id of draftIds) {
        const raw = storage.getItem(LS_DRAFT_PREFIX + id);
        if (!raw) continue;
        const parsed = parseMap(raw);
        if (!parsed) continue;
        const current = this.drafts.get(id);
        if (!current || current.updatedAt < parsed.meta.updatedAt) {
          const ok = await mapStoreDb.putDraft({ id, json: raw, updatedAt: parsed.meta.updatedAt });
          if (!ok) continue;
          this.drafts.set(id, { json: raw, updatedAt: parsed.meta.updatedAt });
        }
        removeKey(storage, LS_DRAFT_PREFIX + id);
      }
      const legacyDraft = storage.getItem(LS_DRAFT_LEGACY);
      if (legacyDraft) {
        const parsed = parseMap(legacyDraft);
        if (parsed) {
          const id = parsed.meta.id;
          const current = this.drafts.get(id);
          if (!current || current.updatedAt < parsed.meta.updatedAt) {
            if (
              await mapStoreDb.putDraft({ id, json: legacyDraft, updatedAt: parsed.meta.updatedAt })
            ) {
              this.drafts.set(id, { json: legacyDraft, updatedAt: parsed.meta.updatedAt });
            }
          }
        }
        removeKey(storage, LS_DRAFT_LEGACY);
      }
      removeKey(storage, LS_DRAFT_INDEX);
    } catch {
      // Migration is best-effort: anything left behind keeps working through
      // the legacy read fallbacks and is retried on the next boot.
    }
  }

  // ---- draft slots (IDB mode; map_io.ts routes here when idbActive) ---------

  draftPut(id: string, json: string, updatedAt: number): boolean {
    this.drafts.set(id, { json, updatedAt });
    void mapStoreDb.putDraft({ id, json, updatedAt });
    return true;
  }

  draftGet(id: string): string | null {
    return this.drafts.get(id)?.json ?? null;
  }

  draftNewest(): string | null {
    let best: { json: string; updatedAt: number } | null = null;
    for (const d of this.drafts.values()) {
      if (!best || d.updatedAt > best.updatedAt) best = d;
    }
    return best?.json ?? null;
  }

  draftDelete(id: string): void {
    this.drafts.delete(id);
    void mapStoreDb.deleteDraft(id);
  }

  draftHasAny(): boolean {
    return this.drafts.size > 0;
  }

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
    if (this.mode === 'idb') {
      return [...this.ram.values()]
        .map((r) => ({ ...r.meta }))
        .sort((a, b) => b.updatedAt - a.updatedAt);
    }
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
    if (this.mode === 'idb') {
      const json = serializeMapCompact(map);
      const meta = metaOf(map);
      this.ram.set(map.meta.id, { json, meta });
      void mapStoreDb.putMap({ id: map.meta.id, json, meta, updatedAt: meta.updatedAt });
      return true;
    }
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
    if (this.mode === 'idb') {
      const record = this.ram.get(id);
      return record ? parseMap(record.json) : null;
    }
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
    if (this.mode === 'idb') {
      const had = this.ram.delete(id);
      void mapStoreDb.deleteMap(id);
      return had;
    }
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
