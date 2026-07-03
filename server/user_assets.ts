// Player-uploaded GLB assets for the map editor: validation (parseGlbInfo),
// content-addressed sha256 dedupe, per-account count/byte caps, listing and
// deletion, and the moderation block flag. Same split as maps.ts: business
// rules against a narrow UserAssetsDb interface (Postgres in
// user_assets_db.ts; tests use an in-memory fake), zero SQL, zero HTTP.

import { createHash } from 'node:crypto';
import { isUniqueViolation, parseGlbInfo } from './http_util';

// Per-file cap (also prechecked against Content-Length before auth) and the
// per-account totals enforced inside the insert transaction.
export const MAX_ASSET_BYTES = 8 * 1024 * 1024;
export const MAX_ASSETS_PER_ACCOUNT = 20;
export const MAX_ASSET_TOTAL_BYTES = 24 * 1024 * 1024;
export const MAX_ASSET_NAME_LENGTH = 80;

// The optional display label, allowlisted like normalizeMapName (maps.ts) but
// widened with underscore and dot so filenames ("well.glb") survive. Anything
// outside the allowlist is stripped, not rejected: the name is a convenience
// label, never an identity, and a fully-stripped name falls back to null (the
// client shows a hash prefix).
const ASSET_NAME_ALLOWED_RE = /[^A-Za-z0-9' ._-]+/g;

export function normalizeAssetName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(ASSET_NAME_ALLOWED_RE, '').replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, MAX_ASSET_NAME_LENGTH) : null;
}

export type AssetStatus = 'active' | 'blocked';

export interface UserAssetRecord {
  id: number;
  accountId: number;
  sha256: string;
  byteSize: number;
  name: string | null;
  status: AssetStatus;
  createdAt: string;
}

export type UserAssetsErrorCode =
  | 'invalid_glb'
  | 'asset_blocked'
  | 'asset_limit_reached'
  | 'asset_storage_limit_reached';

export type UserAssetUploadResult =
  | { ok: true; asset: UserAssetRecord; existing: boolean }
  | { ok: false; error: UserAssetsErrorCode };

export function userAssetsErrorStatus(code: UserAssetsErrorCode): number {
  return code === 'asset_blocked' ? 403 : 400;
}

/** The public, content-addressed URL an asset's bytes are served from. */
export function userAssetUrl(sha256: string): string {
  return `/api/assets/${sha256}.glb`;
}

export function userAssetJson(asset: UserAssetRecord): Record<string, unknown> {
  return {
    id: asset.id,
    sha256: asset.sha256,
    byteSize: asset.byteSize,
    name: asset.name,
    status: asset.status,
    createdAt: asset.createdAt,
    url: userAssetUrl(asset.sha256),
  };
}

// Storage abstraction; the Postgres implementation enforces the caps inside a
// FOR UPDATE + count/sum transaction and relies on the UNIQUE sha256 index (a
// violation is caught here as a concurrent duplicate upload).
export interface UserAssetsDb {
  findBySha(sha256: string): Promise<UserAssetRecord | null>;
  insertAssetCapped(
    input: { accountId: number; sha256: string; bytes: Buffer; name: string | null },
    maxCount: number,
    maxTotalBytes: number,
  ): Promise<UserAssetRecord | 'cap_count' | 'cap_bytes'>;
  /** Bytes for a stored asset, or null when missing or blocked. */
  getActiveBytes(sha256: string): Promise<Buffer | null>;
  listForAccount(accountId: number): Promise<UserAssetRecord[]>;
  deleteAsset(id: number, accountId: number): Promise<boolean>;
}

// Hot-path byte cache for the public GET: content-addressed bytes never
// change, so a small in-process TTL+LRU absorbs cold-load bursts (a popular
// public map's assets fetched by many viewers at once) without those reads
// holding pg pool connections the game loop's autosaves share. The TTL, not
// exact invalidation, is what keeps admin blocks and owner deletes effective
// within minutes on EVERY realm process (eviction cannot cross processes).
const BYTE_CACHE_MAX_BYTES = 32 * 1024 * 1024;
const BYTE_CACHE_TTL_MS = 5 * 60_000;

interface CachedBytes {
  bytes: Buffer;
  at: number;
}

export class UserAssetsService {
  // Map iteration order doubles as the LRU order (entries re-set on hit).
  private readonly byteCache = new Map<string, CachedBytes>();
  private byteCacheTotal = 0;

  constructor(
    private readonly db: UserAssetsDb,
    private readonly nowMs: () => number = Date.now,
  ) {}

  async upload(accountId: number, bytes: Buffer, rawName: unknown): Promise<UserAssetUploadResult> {
    if (bytes.length === 0 || bytes.length > MAX_ASSET_BYTES) {
      return { ok: false, error: 'invalid_glb' };
    }
    if (!parseGlbInfo(bytes)) return { ok: false, error: 'invalid_glb' };
    const name = normalizeAssetName(rawName);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    // Content-addressed dedupe: the same bytes are one row, whoever uploads
    // them; a blocked hash stays blocked no matter who re-uploads it.
    const existing = await this.db.findBySha(sha256);
    if (existing) {
      if (existing.status === 'blocked') return { ok: false, error: 'asset_blocked' };
      return { ok: true, asset: existing, existing: true };
    }
    try {
      const inserted = await this.db.insertAssetCapped(
        { accountId, sha256, bytes, name },
        MAX_ASSETS_PER_ACCOUNT,
        MAX_ASSET_TOTAL_BYTES,
      );
      if (inserted === 'cap_count') return { ok: false, error: 'asset_limit_reached' };
      if (inserted === 'cap_bytes') return { ok: false, error: 'asset_storage_limit_reached' };
      return { ok: true, asset: inserted, existing: false };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // A concurrent upload of the same bytes won the insert; serve its row.
      const raced = await this.db.findBySha(sha256);
      if (!raced) throw err;
      if (raced.status === 'blocked') return { ok: false, error: 'asset_blocked' };
      return { ok: true, asset: raced, existing: true };
    }
  }

  /** Bytes for the public GET; null covers both missing and blocked (a 404).
   *  Served through the TTL+LRU cache; misses (including blocked) are never
   *  cached, so a fresh upload is visible immediately. */
  async bytesForSha(sha256: string): Promise<Buffer | null> {
    const now = this.nowMs();
    const hit = this.byteCache.get(sha256);
    if (hit) {
      if (now - hit.at <= BYTE_CACHE_TTL_MS) {
        // Refresh the LRU position.
        this.byteCache.delete(sha256);
        this.byteCache.set(sha256, hit);
        return hit.bytes;
      }
      this.byteCache.delete(sha256);
      this.byteCacheTotal -= hit.bytes.length;
    }
    const bytes = await this.db.getActiveBytes(sha256);
    if (bytes) {
      this.byteCache.set(sha256, { bytes, at: now });
      this.byteCacheTotal += bytes.length;
      for (const [key, entry] of this.byteCache) {
        if (this.byteCacheTotal <= BYTE_CACHE_MAX_BYTES) break;
        this.byteCache.delete(key);
        this.byteCacheTotal -= entry.bytes.length;
      }
    }
    return bytes;
  }

  listMine(accountId: number): Promise<UserAssetRecord[]> {
    return this.db.listForAccount(accountId);
  }

  deleteAsset(accountId: number, assetId: number): Promise<boolean> {
    return this.db.deleteAsset(assetId, accountId);
  }
}
