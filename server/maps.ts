// Custom-map persistence rules for the map editor: create/save (optimistic
// version check), fork lineage, publish/unpublish, ownership, the per-account
// cap, and slug allocation. Mirrors the SocialService/SocialDb split: this
// module holds the business rules against a narrow MapsDb interface (Postgres
// implementation in maps_db.ts; tests use an in-memory fake) and carries zero
// SQL and zero HTTP. Every stored document goes through sanitizeMapDoc from
// src/sim/map_doc.ts, the ONE shared validator the editor's import path also
// uses; the server never stores a byte the sanitizer did not produce.

import { randomBytes, randomUUID } from 'node:crypto';
import { MAX_NAME_LENGTH, type MapDoc, sanitizeMapDoc } from '../src/sim/map_doc';
import { offensiveName } from './auth';
import { isUniqueViolation } from './http_util';

export const MAX_MAPS_PER_ACCOUNT = 24;
// Map save bodies ({ name, doc, version }) are JSON; the sanitizer caps the
// document's contents, this caps the raw bytes a client may stream at us.
export const MAX_MAP_SAVE_BYTES = 2 * 1024 * 1024;
const MAX_SLUG_ATTEMPTS = 25;
const MAX_SLUG_LENGTH = 64;

export type MapStatus = 'private' | 'public';

export interface MapRecord {
  id: number;
  accountId: number;
  name: string;
  slug: string;
  doc: MapDoc;
  version: number;
  parentMapId: number | null;
  forkedFromVersion: number | null;
  status: MapStatus;
  createdAt: string;
  updatedAt: string;
}

export type MapSummary = Omit<MapRecord, 'doc'>;

// Machine-readable error codes (the wire error envelope is { error: <code> };
// the client maps codes to its own t() keys, so no server_i18n matcher entry).
export type MapsErrorCode =
  | 'invalid_map_name'
  | 'map_name_not_allowed'
  | 'invalid_map_doc'
  | 'invalid_version'
  | 'map_limit_reached'
  | 'map_not_found'
  | 'version_conflict'
  | 'slug_unavailable';

export type MapsResult =
  | { ok: true; map: MapRecord }
  | { ok: false; error: MapsErrorCode; currentVersion?: number };

export function mapsErrorStatus(code: MapsErrorCode): number {
  switch (code) {
    case 'map_not_found':
      return 404;
    case 'version_conflict':
    case 'slug_unavailable':
      return 409;
    default:
      return 400;
  }
}

// Storage abstraction. The Postgres implementation (maps_db.ts) enforces the
// per-account cap inside a FOR UPDATE + count transaction and relies on the
// UNIQUE slug index (a violation is thrown and retried here); the in-memory
// test fake mirrors those semantics.
export interface MapsDb {
  /** Insert a new private map; null when the per-account cap is hit. Throws a unique violation on a slug clash. */
  insertMapCapped(
    input: { accountId: number; name: string; slug: string; doc: MapDoc },
    cap: number,
  ): Promise<MapRecord | null>;
  /**
   * Copy a source map (must still be public or owned by accountId at insert
   * time) into a new private map with parent/version lineage, atomically.
   * The copied doc's meta.id is rewritten to newDocId so the fork never
   * shares the source document's identity. Throws a unique violation on a
   * slug clash.
   */
  insertForkCapped(
    input: { sourceId: number; accountId: number; name: string; slug: string; newDocId: string },
    cap: number,
  ): Promise<MapRecord | 'cap_reached' | 'source_unavailable'>;
  getMap(id: number): Promise<MapRecord | null>;
  listForAccount(accountId: number): Promise<MapSummary[]>;
  listPublic(limit: number, offset: number): Promise<{ rows: MapSummary[]; total: number }>;
  /** Optimistic-concurrency save: null when no row matched (missing, unowned, or stale version). */
  updateMapIfVersion(
    id: number,
    accountId: number,
    expectedVersion: number,
    doc: MapDoc,
    name: string | null,
  ): Promise<MapRecord | null>;
  /** accountId null = unscoped (admin) update. */
  setStatus(id: number, accountId: number | null, status: MapStatus): Promise<boolean>;
  deleteMap(id: number, accountId: number): Promise<boolean>;
}

// Map names use the character-name posture from auth.ts (shape check plus the
// obscenity screen) widened to the map-doc length cap: letters/digits first,
// then letters, digits, spaces, apostrophes, and hyphens.
const MAP_NAME_RE = new RegExp(`^[A-Za-z0-9][A-Za-z0-9' -]{1,${MAX_NAME_LENGTH - 1}}$`);

export function normalizeMapName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().replace(/\s+/g, ' ');
  return MAP_NAME_RE.test(cleaned) ? cleaned : null;
}

// URL-safe slug base from a map name; mirrors player_card.ts slugify. May
// never be empty: an all-symbol name falls back to 'map'.
export function mapSlugBase(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return base || 'map';
}

// Wire shapes. Account ids are internal: the owner knows their own maps and
// the public browse must not leak who made what, so neither shape carries one.
export function mapSummaryJson(map: MapSummary | MapRecord): Record<string, unknown> {
  return {
    id: map.id,
    name: map.name,
    slug: map.slug,
    version: map.version,
    status: map.status,
    parentMapId: map.parentMapId,
    forkedFromVersion: map.forkedFromVersion,
    createdAt: map.createdAt,
    updatedAt: map.updatedAt,
  };
}

export function mapFullJson(map: MapRecord): Record<string, unknown> {
  return { ...mapSummaryJson(map), doc: map.doc };
}

export class MapsService {
  // The suffix source is injectable so tests can drive the retry loop
  // deterministically; production uses random hex like the token minting.
  constructor(
    private readonly db: MapsDb,
    private readonly slugSuffix: () => string = () => randomBytes(3).toString('hex'),
  ) {}

  private slugCandidate(base: string, attempt: number): string {
    if (attempt === 0) return base.slice(0, MAX_SLUG_LENGTH);
    return `${base}-${this.slugSuffix()}`.slice(0, MAX_SLUG_LENGTH);
  }

  private resolveName(
    rawName: unknown,
    fallback: string,
  ): { name: string } | { error: 'invalid_map_name' | 'map_name_not_allowed' } {
    const name = normalizeMapName(rawName === undefined || rawName === null ? fallback : rawName);
    if (!name) return { error: 'invalid_map_name' };
    if (offensiveName(name)) return { error: 'map_name_not_allowed' };
    return { name };
  }

  async createMap(accountId: number, rawName: unknown, rawDoc: unknown): Promise<MapsResult> {
    const doc = sanitizeMapDoc(rawDoc);
    if (!doc) return { ok: false, error: 'invalid_map_doc' };
    const resolved = this.resolveName(rawName, doc.meta.name);
    if ('error' in resolved) return { ok: false, error: resolved.error };
    doc.meta.name = resolved.name;
    doc.meta.parentId = ''; // an original work; lineage is only ever set by fork
    const base = mapSlugBase(resolved.name);
    for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
      const slug = this.slugCandidate(base, attempt);
      try {
        const map = await this.db.insertMapCapped(
          { accountId, name: resolved.name, slug, doc },
          MAX_MAPS_PER_ACCOUNT,
        );
        if (!map) return { ok: false, error: 'map_limit_reached' };
        return { ok: true, map };
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }
    return { ok: false, error: 'slug_unavailable' };
  }

  async saveMap(
    accountId: number,
    mapId: number,
    rawDoc: unknown,
    expectedVersion: unknown,
    rawName?: unknown,
  ): Promise<MapsResult> {
    if (!Number.isInteger(expectedVersion) || (expectedVersion as number) < 1) {
      return { ok: false, error: 'invalid_version' };
    }
    const doc = sanitizeMapDoc(rawDoc);
    if (!doc) return { ok: false, error: 'invalid_map_doc' };
    let name: string | null = null;
    if (rawName !== undefined && rawName !== null) {
      const resolved = this.resolveName(rawName, '');
      if ('error' in resolved) return { ok: false, error: resolved.error };
      name = resolved.name;
      doc.meta.name = name;
    }
    const map = await this.db.updateMapIfVersion(
      mapId,
      accountId,
      expectedVersion as number,
      doc,
      name,
    );
    if (map) return { ok: true, map };
    // The conditional UPDATE missed: tell a stale save (409, retry with the
    // current version) apart from a map that does not exist for this owner
    // (404, which also covers someone else's map so nothing leaks).
    const existing = await this.db.getMap(mapId);
    if (!existing || existing.accountId !== accountId) {
      return { ok: false, error: 'map_not_found' };
    }
    return { ok: false, error: 'version_conflict', currentVersion: existing.version };
  }

  async forkMap(accountId: number, sourceId: number, rawName?: unknown): Promise<MapsResult> {
    const source = await this.db.getMap(sourceId);
    if (!source || (source.accountId !== accountId && source.status !== 'public')) {
      return { ok: false, error: 'map_not_found' };
    }
    const resolved = this.resolveName(rawName, source.name);
    if ('error' in resolved) return { ok: false, error: resolved.error };
    const base = mapSlugBase(resolved.name);
    // A fork is a NEW document: mint a fresh identity so the copy never keeps
    // the source's meta.id (the editor client keys server-links by meta.id).
    const newDocId = randomUUID();
    for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
      const slug = this.slugCandidate(base, attempt);
      try {
        const forked = await this.db.insertForkCapped(
          { sourceId, accountId, name: resolved.name, slug, newDocId },
          MAX_MAPS_PER_ACCOUNT,
        );
        if (forked === 'cap_reached') return { ok: false, error: 'map_limit_reached' };
        // Unpublished (or deleted) between the access check and the insert.
        if (forked === 'source_unavailable') return { ok: false, error: 'map_not_found' };
        return { ok: true, map: forked };
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }
    return { ok: false, error: 'slug_unavailable' };
  }

  /** Owner-only publish/unpublish; false = missing or not owned. */
  setPublished(accountId: number, mapId: number, published: boolean): Promise<boolean> {
    return this.db.setStatus(mapId, accountId, published ? 'public' : 'private');
  }

  /** Moderation: force any map back to private regardless of owner. */
  adminUnpublish(mapId: number): Promise<boolean> {
    return this.db.setStatus(mapId, null, 'private');
  }

  deleteMap(accountId: number, mapId: number): Promise<boolean> {
    return this.db.deleteMap(mapId, accountId);
  }

  /** Full document read: the owner always, anyone else only when public. */
  async getMapForViewer(viewerAccountId: number | null, mapId: number): Promise<MapRecord | null> {
    const map = await this.db.getMap(mapId);
    if (!map) return null;
    if (map.status === 'public' || map.accountId === viewerAccountId) return map;
    return null;
  }

  listMine(accountId: number): Promise<MapSummary[]> {
    return this.db.listForAccount(accountId);
  }

  listPublic(page: number, limit: number): Promise<{ rows: MapSummary[]; total: number }> {
    return this.db.listPublic(limit, (page - 1) * limit);
  }
}
