// Map save/load orchestration: the local MapStore (explicit saves), the
// autosave draft slots (one per map id), and the client-side link between a
// local document (meta.id) and its server row (id + optimistic version). The
// app composes this with net.ts; no DOM here beyond localStorage.
//
// Drafts are keyed per map (woc_editor_draft:<id>) plus a tiny recency index,
// so saving map B can never destroy map A's only autosave; the legacy single
// slot (woc_editor_draft) migrates lazily. The server-link version is held IN
// MEMORY per tab (LinkMemory) and only seeded from localStorage on first
// resolve: a stale tab keeps its own optimistic version and gets the server
// 409 instead of silently overwriting another tab's save.

import type { MapDoc } from '../sim/map_doc';
import type { CustomMap } from './custom_map';
import * as net from './net';
import {
  type KeyValueStore,
  MapStore,
  parseMap,
  safeLocalStorage,
  serializeMapCompact,
} from './persist';
import { LinkMemory } from './server_link_core';

const LINKS_KEY = 'woc_editor_server_links';
const LEGACY_DRAFT_KEY = 'woc_editor_draft';
const DRAFT_KEY_PREFIX = 'woc_editor_draft:';
const DRAFT_INDEX_KEY = 'woc_editor_drafts_index';

export interface ServerLink {
  serverId: number;
  version: number;
}

type DraftIndex = Record<string, number>; // map id -> meta.updatedAt

function removeKey(storage: KeyValueStore, key: string): void {
  if (storage.removeItem) storage.removeItem(key);
  else storage.setItem(key, '');
}

export class MapIO {
  readonly store: MapStore;
  private readonly links = new LinkMemory<ServerLink>();
  private draftMigrated = false;

  constructor(private readonly storage: KeyValueStore | null = safeLocalStorage()) {
    this.store = new MapStore(storage);
  }

  // ---- local <-> server linkage --------------------------------------------

  private readStoredLinks(): Record<string, ServerLink> {
    if (!this.storage) return {};
    try {
      const raw = this.storage.getItem(LINKS_KEY);
      const obj = raw ? JSON.parse(raw) : {};
      return obj && typeof obj === 'object' ? (obj as Record<string, ServerLink>) : {};
    } catch {
      return {};
    }
  }

  private writeLinks(links: Record<string, ServerLink>): void {
    try {
      this.storage?.setItem(LINKS_KEY, JSON.stringify(links));
    } catch {
      // Storage blocked: links stay session-only (LinkMemory still holds them).
    }
  }

  private readStoredLink(metaId: string): ServerLink | null {
    const link = this.readStoredLinks()[metaId];
    return link && typeof link.serverId === 'number' && typeof link.version === 'number'
      ? link
      : null;
  }

  /**
   * The link this tab knows for a map: memory first (captured at load/save
   * time), localStorage only as the seed for a freshly opened map. See the
   * module comment for why saves must NOT re-read the shared storage key.
   */
  linkFor(metaId: string): ServerLink | null {
    return this.links.resolve(metaId, () => this.readStoredLink(metaId));
  }

  setLink(metaId: string, link: ServerLink | null): void {
    this.links.set(metaId, link);
    const links = this.readStoredLinks();
    if (link) links[metaId] = link;
    else delete links[metaId];
    this.writeLinks(links);
  }

  // ---- saves ----------------------------------------------------------------

  saveLocal(map: CustomMap): boolean {
    return this.store.save(map);
  }

  /**
   * Save to the server: create when unlinked, else optimistic-version update.
   * Returns the refreshed link. Throws EditorApiError (including the 409
   * version_conflict the app resolves via Save As Copy).
   */
  async saveServer(map: CustomMap): Promise<ServerLink> {
    const doc = map as unknown as MapDoc;
    const link = this.linkFor(map.meta.id);
    if (!link) {
      const created = await net.createMap(map.meta.name, doc);
      const next = { serverId: created.id, version: created.version };
      this.setLink(map.meta.id, next);
      return next;
    }
    const updated = await net.updateMap(link.serverId, doc, link.version, map.meta.name);
    const next = { serverId: updated.id, version: updated.version };
    this.setLink(map.meta.id, next);
    return next;
  }

  /** Create a NEW server map from this document (Save As Copy after a 409). */
  async saveServerAsCopy(map: CustomMap): Promise<ServerLink> {
    const created = await net.createMap(map.meta.name, map as unknown as MapDoc);
    const next = { serverId: created.id, version: created.version };
    this.setLink(map.meta.id, next);
    return next;
  }

  // ---- autosave drafts (one slot per map id) ---------------------------------

  private readDraftIndex(): DraftIndex {
    if (!this.storage) return {};
    try {
      const raw = this.storage.getItem(DRAFT_INDEX_KEY);
      const obj = raw ? JSON.parse(raw) : {};
      if (!obj || typeof obj !== 'object') return {};
      const index: DraftIndex = {};
      for (const [id, at] of Object.entries(obj)) {
        if (typeof at === 'number' && Number.isFinite(at)) index[id] = at;
      }
      return index;
    } catch {
      return {};
    }
  }

  /** Move the legacy single-slot draft into its own per-map slot, once. */
  private migrateLegacyDraft(): void {
    if (this.draftMigrated || !this.storage) return;
    this.draftMigrated = true;
    try {
      const raw = this.storage.getItem(LEGACY_DRAFT_KEY);
      if (!raw) return;
      const map = parseMap(raw);
      if (map) {
        this.storage.setItem(DRAFT_KEY_PREFIX + map.meta.id, serializeMapCompact(map));
        const index = this.readDraftIndex();
        index[map.meta.id] = map.meta.updatedAt;
        this.storage.setItem(DRAFT_INDEX_KEY, JSON.stringify(index));
      }
      removeKey(this.storage, LEGACY_DRAFT_KEY);
    } catch {
      this.draftMigrated = false; // retry on the next call
    }
  }

  draftSave(map: CustomMap): boolean {
    if (!this.storage) return false;
    this.migrateLegacyDraft();
    try {
      this.storage.setItem(DRAFT_KEY_PREFIX + map.meta.id, serializeMapCompact(map));
      const index = this.readDraftIndex();
      index[map.meta.id] = map.meta.updatedAt;
      this.storage.setItem(DRAFT_INDEX_KEY, JSON.stringify(index));
      return true;
    } catch {
      return false;
    }
  }

  /** The most recently autosaved draft across every map, or null. */
  draftLoad(): CustomMap | null {
    if (!this.storage) return null;
    this.migrateLegacyDraft();
    try {
      const index = this.readDraftIndex();
      const ids = Object.keys(index).sort((a, b) => index[b] - index[a]);
      for (const id of ids) {
        const raw = this.storage.getItem(DRAFT_KEY_PREFIX + id);
        const map = raw ? parseMap(raw) : null;
        if (map) return map;
      }
      // Legacy slot fallback (migration blocked by quota).
      const legacy = this.storage.getItem(LEGACY_DRAFT_KEY);
      return legacy ? parseMap(legacy) : null;
    } catch {
      return null;
    }
  }

  /** Clear ONLY this map's draft slot; other maps keep their autosaves. */
  draftClear(mapId: string): void {
    if (!this.storage) return;
    this.migrateLegacyDraft();
    try {
      removeKey(this.storage, DRAFT_KEY_PREFIX + mapId);
      const index = this.readDraftIndex();
      if (mapId in index) {
        delete index[mapId];
        this.storage.setItem(DRAFT_INDEX_KEY, JSON.stringify(index));
      }
      // If migration is still blocked, the legacy slot may hold this map.
      const legacy = this.storage.getItem(LEGACY_DRAFT_KEY);
      if (legacy) {
        const map = parseMap(legacy);
        if (map && map.meta.id === mapId) removeKey(this.storage, LEGACY_DRAFT_KEY);
      }
    } catch {
      // ignore: a blocked clear only leaves a stale draft behind
    }
  }
}
