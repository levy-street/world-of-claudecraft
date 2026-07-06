// Uploaded-GLB route layer for the map editor surface, ported onto RouteDefs in
// the v0.20.0 release-merge reconciliation. Same shape as
// server/maps_routes.ts: the business rules stay in server/user_assets.ts
// (UserAssetsService, zero HTTP); this module owns the shared per-lane cores
// BOTH dispatch arms call, the RouteDefs the registry spreads, and the service
// singleton with a test seam.
//
// The upload copies the /api/card binary lane end to end: Content-Length
// precheck BEFORE auth (413 + Connection: close), the fused ip+account limiter
// after the auth guard, a self-read binary body (meta.requestBody 'binary' for
// the Content-Type gate's classifier), format validation before storage. The byte GET is
// public and content-addressed: its bytes are immutable, cached like the hashed
// build assets, and it is the one registered /api route with a binary RESPONSE.

import type * as http from 'node:http';
import { accountAndScopeForToken, moderationStatusForAccount, pool } from './db';
import { ctxAccountId } from './http/context';
import { createActiveGuard, createReadGuard } from './http/middleware/bearer_active_guard';
import { ASSET_UPLOAD_POLICY, PUBLIC_READ_POLICY, rateLimit } from './http/middleware/rate_limit';
import { requireOwned } from './http/middleware/require_owned';
import type { Ctx, Middleware, RouteDef } from './http/types';
import { contentLengthExceeds, json, readBinaryBody } from './http_util';
import {
  MAX_ASSET_BYTES,
  type UserAssetRecord,
  UserAssetsService,
  userAssetJson,
  userAssetsErrorStatus,
} from './user_assets';
import { PgUserAssetsDb } from './user_assets_db';

// ---------------------------------------------------------------------------
// The service singleton (pure construction; no query until a request) + seam.
// ---------------------------------------------------------------------------

const REAL_USER_ASSETS_SERVICE = new UserAssetsService(new PgUserAssetsDb(pool));
let userAssetsService: UserAssetsService = REAL_USER_ASSETS_SERVICE;

/** Override the user-assets service with a fake (test-only). */
export function setUserAssetsServiceForTests(service: UserAssetsService): void {
  userAssetsService = service;
}

/** Restore the real Postgres-backed user-assets service (test-only). */
export function resetUserAssetsServiceForTests(): void {
  userAssetsService = REAL_USER_ASSETS_SERVICE;
}

/** The live user-assets service (read at call time so the test seam applies). */
export function liveUserAssetsService(): UserAssetsService {
  return userAssetsService;
}

// ---------------------------------------------------------------------------
// Legacy wire bodies shared by both arms (stable snake_case codes; see maps.ts).
// ---------------------------------------------------------------------------

const ASSET_TOO_LARGE = { error: 'asset_too_large' } as const;
const BAD_REQUEST = { error: 'bad_request' } as const;
const ASSET_NOT_FOUND = { error: 'asset_not_found' } as const;
/** The handleApi ladder's terminal 404, reproduced where the router owns a
 * shape the legacy regexes rejected (a :file that is not `<sha256>.glb`). */
const UNKNOWN_ENDPOINT = { error: 'unknown endpoint' } as const;

/** The legacy assetGlbMatch shape: a 64-hex sha followed by the .glb suffix. */
const GLB_FILE_PATTERN = /^([a-f0-9]{64})\.glb$/;

// ---------------------------------------------------------------------------
// Shared cores (the exact former main.ts lane bodies).
// ---------------------------------------------------------------------------

/** POST /api/assets: upload a GLB (binary body, content-addressed dedupe). */
export async function assetUploadCore(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  let bytes: Buffer;
  try {
    bytes = await readBinaryBody(req, MAX_ASSET_BYTES);
  } catch (err) {
    const tooLarge = err instanceof Error && err.message === 'body too large';
    if (tooLarge) {
      res.shouldKeepAlive = false;
      res.setHeader('Connection', 'close');
    }
    return json(res, tooLarge ? 413 : 400, tooLarge ? ASSET_TOO_LARGE : BAD_REQUEST);
  }
  const name = new URL(req.url ?? '/', 'http://localhost').searchParams.get('name');
  const result = await userAssetsService.upload(accountId, bytes, name);
  if (!result.ok) {
    return json(res, userAssetsErrorStatus(result.error), { error: result.error });
  }
  return json(res, 200, { asset: userAssetJson(result.asset), existing: result.existing });
}

/** GET /api/assets/mine: the caller's own uploads. */
export async function assetsListMineCore(
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  const assets = await userAssetsService.listMine(accountId);
  return json(res, 200, { assets: assets.map(userAssetJson) });
}

/** GET /api/assets/<sha256>.glb: the public content-addressed byte read. */
export async function assetBytesCore(res: http.ServerResponse, sha256: string): Promise<void> {
  const bytes = await userAssetsService.bytesForSha(sha256);
  // Missing and moderation-blocked are the same 404 to the public.
  if (!bytes) return json(res, 404, ASSET_NOT_FOUND);
  res.writeHead(200, {
    'Content-Type': 'model/gltf-binary',
    'Content-Length': bytes.length,
    // Content-addressed by sha256: the bytes behind a given URL can never
    // change, so cache like the hashed build assets (static_cache.ts).
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(bytes);
}

/** DELETE /api/assets/:id: owner-only delete. */
export async function assetDeleteCore(
  res: http.ServerResponse,
  accountId: number,
  assetId: number,
): Promise<void> {
  const deleted = await userAssetsService.deleteAsset(accountId, assetId);
  return json(res, deleted ? 200 : 404, deleted ? { ok: true } : ASSET_NOT_FOUND);
}

// ---------------------------------------------------------------------------
// Guards.
// ---------------------------------------------------------------------------

const REAL_GUARD_DB = { accountAndScopeForToken, moderationStatusForAccount };
let guardDbBundle = REAL_GUARD_DB;

/** Override the bearer-guard db reads with fakes (test-only). */
export function setUserAssetsGuardDbForTests(overrides: Partial<typeof REAL_GUARD_DB>): void {
  guardDbBundle = { ...REAL_GUARD_DB, ...overrides };
}

/** Restore the real bearer-guard db reads (test-only). */
export function resetUserAssetsGuardDbForTests(): void {
  guardDbBundle = REAL_GUARD_DB;
}

const activeGuard = createActiveGuard(() => guardDbBundle);
const readGuard = createReadGuard(() => guardDbBundle);

const assetContentLengthGuard: Middleware = async (ctx, next) => {
  if (contentLengthExceeds(ctx.req, MAX_ASSET_BYTES)) {
    ctx.res.shouldKeepAlive = false;
    ctx.res.setHeader('Connection', 'close');
    json(ctx.res, 413, ASSET_TOO_LARGE);
    return;
  }
  await next();
};

/** The BOLA owner loader for DELETE /api/assets/:id. The db seam has no per-id
 * read, so the loader resolves through the caller's own bounded list (at most
 * MAX_ASSETS_PER_ACCOUNT rows); the service's delete re-scopes by account_id in
 * SQL, so this loader is the deny-by-default gate, not the only check. */
const requireOwnedAsset = requireOwned<UserAssetRecord>({
  resource: 'user_asset',
  param: 'id',
  load: async (accountId, id) => {
    const mine = await userAssetsService.listMine(accountId);
    return mine.find((asset) => asset.id === id) ?? null;
  },
  notFoundBody: ASSET_NOT_FOUND,
});

/** The owned asset row the requireOwnedAsset loader stashed. */
function ownedAsset(ctx: Ctx): UserAssetRecord {
  return ctx.state.get('user_asset') as UserAssetRecord;
}

// ---------------------------------------------------------------------------
// Thin Ctx handlers.
// ---------------------------------------------------------------------------

async function uploadHandler(ctx: Ctx): Promise<void> {
  return assetUploadCore(ctx.req, ctx.res, ctxAccountId(ctx));
}

async function listMineHandler(ctx: Ctx): Promise<void> {
  return assetsListMineCore(ctx.res, ctxAccountId(ctx));
}

async function bytesHandler(ctx: Ctx): Promise<void> {
  // The :file param captures the whole segment; the legacy regex only matched
  // `<64-hex>.glb`, so any other shape answers the ladder's terminal 404.
  const m = GLB_FILE_PATTERN.exec(ctx.params.file ?? '');
  if (!m) return json(ctx.res, 404, UNKNOWN_ENDPOINT);
  return assetBytesCore(ctx.res, m[1]);
}

async function deleteHandler(ctx: Ctx): Promise<void> {
  return assetDeleteCore(ctx.res, ctxAccountId(ctx), ownedAsset(ctx).id);
}

// ---------------------------------------------------------------------------
// The route table. registry.ts spreads this into apiRoutes. /api/assets/mine is
// static, so the router prefers it over the dynamic :file byte read. The legacy
// DELETE arm mounts no limiter (matching legacy exactly); the byte GET carries
// the public-read policy like its legacy arm's publicReadRateLimited check (the
// coded-vs-prose 429 deviation, recorded).
// ---------------------------------------------------------------------------

export const routes: RouteDef[] = [
  {
    method: 'POST',
    path: '/api/assets',
    surface: 'api',
    middleware: [assetContentLengthGuard, activeGuard, rateLimit(ASSET_UPLOAD_POLICY)],
    meta: { requestBody: 'binary' },
    handler: uploadHandler,
  },
  {
    method: 'GET',
    path: '/api/assets/mine',
    surface: 'api',
    middleware: [readGuard],
    handler: listMineHandler,
  },
  {
    method: 'GET',
    path: '/api/assets/:file',
    surface: 'api',
    middleware: [rateLimit(PUBLIC_READ_POLICY)],
    // The SUCCESS body is binary (the handler writes model/gltf-binary itself);
    // thrown errors keep the surface-default problem+json envelope, mirroring
    // the POST /api/card precedent, so the coded 429 matches the
    // mapsAssetsRateLimitedBodyToCode ledger entry.
    meta: { publicRead: true },
    handler: bytesHandler,
  },
  {
    method: 'DELETE',
    path: '/api/assets/:id',
    surface: 'api',
    middleware: [activeGuard, requireOwnedAsset],
    meta: { requireOwned: { kind: 'user_asset', ownerScope: 'account' } },
    handler: deleteHandler,
  },
];
