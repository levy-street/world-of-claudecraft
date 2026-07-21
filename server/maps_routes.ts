// Custom-map route layer for the map editor surface, ported onto RouteDefs in the
// v0.20.0 release-merge reconciliation. The business rules
// stay in server/maps.ts (MapsService, zero HTTP); this module owns:
//
//  - The shared per-lane CORES (post-auth, limiter-free (req, res, ...) functions
//    that end the response). BOTH dispatch arms call them: the legacy handleApi
//    lanes in server/main.ts keep their own precheck/auth/limiter lines and then
//    call the core, and the RouteDefs below mount the equivalent guards and call
//    the same core, so the success/error bodies cannot drift between the arms
//    (the wallet *Core template, server/wallet.ts).
//  - The RouteDefs the registry spreads. Guards mirror the legacy arm order
//    exactly: Content-Length precheck BEFORE auth on the save lanes (the
//    /api/card 413 + Connection: close treatment), then the bearer guard, then
//    the fused ip+account limiter, then (on owner-only :id routes) the BOLA
//    owner loader.
//  - The MapsService singleton wired to Postgres, with a test seam.
//
// Known old-vs-new divergences carried by these routes (all recorded in
// tests/server/http/known_deviations.ts): the coded rate_limit.exceeded 429 vs
// the legacy prose { error: 'rate_limited' }; the 422 validation problem on a
// non-numeric :id where the legacy regex fell through to the ladder's 404; and
// the router's 405 + Allow where the legacy ladder answered 404 for a wrong
// method on an owned path.

import type * as http from 'node:http';
import { parsePageParams } from './admin';
import { accountAndScopeForToken, accountForToken, moderationStatusForAccount, pool } from './db';
import { ctxAccountId } from './http/context';
import { createActiveGuard, createReadGuard } from './http/middleware/bearer_active_guard';
import { MAP_MUTATION_POLICY, PUBLIC_READ_POLICY, rateLimit } from './http/middleware/rate_limit';
import { requireOwned } from './http/middleware/require_owned';
import type { Ctx, Middleware, RouteDef } from './http/types';
import { contentLengthExceeds, json, readBody } from './http_util';
import {
  MAX_MAP_SAVE_BYTES,
  type MapRecord,
  MapsService,
  mapFullJson,
  mapSummaryJson,
  mapsErrorStatus,
} from './maps';
import { PgMapsDb } from './maps_db';
import { publicReadRateLimited } from './ratelimit';

// ---------------------------------------------------------------------------
// The service singleton. Construction is pure (PgMapsDb stores the pool
// reference; no query runs until a request), so module-scope wiring is safe for
// every harness that imports main.ts without a database. The setter lets a unit
// test drive the cores and loaders with an in-memory fake.
// ---------------------------------------------------------------------------

const REAL_MAPS_SERVICE = new MapsService(new PgMapsDb(pool));
let mapsService: MapsService = REAL_MAPS_SERVICE;

/** Override the maps service with a fake (test-only). */
export function setMapsServiceForTests(service: MapsService): void {
  mapsService = service;
}

/** Restore the real Postgres-backed maps service (test-only). */
export function resetMapsServiceForTests(): void {
  mapsService = REAL_MAPS_SERVICE;
}

/** The live maps service (read at call time so the test seam applies). */
export function liveMapsService(): MapsService {
  return mapsService;
}

// ---------------------------------------------------------------------------
// Legacy wire bodies shared by both arms. Stable snake_case codes the editor
// client maps to its own t() keys (see server/maps.ts), so no server_i18n
// matcher entries; named here so the arms cannot drift.
// ---------------------------------------------------------------------------

const MAP_TOO_LARGE = { error: 'map_too_large' } as const;
const BAD_JSON = { error: 'bad_json' } as const;
const MAP_NOT_FOUND = { error: 'map_not_found' } as const;
const RATE_LIMITED = { error: 'rate_limited' } as const;
/** The handleApi ladder's terminal 404, reproduced where the router owns a
 * shape the legacy regexes rejected (a non-numeric :id on the publicRead GET). */
const UNKNOWN_ENDPOINT = { error: 'unknown endpoint' } as const;

// ---------------------------------------------------------------------------
// Shared cores. Each is the exact former main.ts lane body: post-auth,
// limiter-free, ends the response. `body: any` mirrors the legacy readBody
// call sites (the service validates every field).
// ---------------------------------------------------------------------------

/** GET /api/maps: the caller's own saved maps (summaries). */
export async function mapsListMineCore(res: http.ServerResponse, accountId: number): Promise<void> {
  const mine = await mapsService.listMine(accountId);
  return json(res, 200, { maps: mine.map(mapSummaryJson) });
}

/** Read a JSON save body with the map-save cap; answers 413/400 itself and
 * returns null when the response has been written. */
async function readMapSaveBody(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<any | null> {
  try {
    return await readBody(req, MAX_MAP_SAVE_BYTES);
  } catch (err) {
    const tooLarge = err instanceof Error && err.message === 'body too large';
    if (tooLarge) {
      res.shouldKeepAlive = false;
      res.setHeader('Connection', 'close');
    }
    json(res, tooLarge ? 413 : 400, tooLarge ? MAP_TOO_LARGE : BAD_JSON);
    return null;
  }
}

/** POST /api/maps: create a new private map from a sanitized document. */
export async function mapsCreateCore(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  const body = await readMapSaveBody(req, res);
  if (body === null) return;
  const result = await mapsService.createMap(accountId, body.name, body.doc);
  if (!result.ok) return json(res, mapsErrorStatus(result.error), { error: result.error });
  return json(res, 200, { map: mapSummaryJson(result.map) });
}

/** GET /api/maps/public: the paginated public browse list. */
export async function mapsPublicListCore(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const { page, limit } = parsePageParams(new URL(req.url ?? '/', 'http://localhost').searchParams);
  const { rows, total } = await mapsService.listPublic(page, limit);
  return json(res, 200, { rows: rows.map(mapSummaryJson), total, page, limit });
}

/** GET /api/maps/:id: the full document, owner always, anyone else when public. */
export async function mapGetCore(
  res: http.ServerResponse,
  viewerAccountId: number | null,
  mapId: number,
): Promise<void> {
  const map = await mapsService.getMapForViewer(viewerAccountId, mapId);
  if (!map) return json(res, 404, MAP_NOT_FOUND);
  return json(res, 200, { map: mapFullJson(map) });
}

/** PUT /api/maps/:id: optimistic-version save. */
export async function mapSaveCore(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
  mapId: number,
): Promise<void> {
  const body = await readMapSaveBody(req, res);
  if (body === null) return;
  const result = await mapsService.saveMap(accountId, mapId, body.doc, body.version, body.name);
  if (!result.ok) {
    return json(res, mapsErrorStatus(result.error), {
      error: result.error,
      ...(result.currentVersion !== undefined ? { version: result.currentVersion } : {}),
    });
  }
  return json(res, 200, { map: mapSummaryJson(result.map) });
}

/** DELETE /api/maps/:id: owner-only delete. */
export async function mapDeleteCore(
  res: http.ServerResponse,
  accountId: number,
  mapId: number,
): Promise<void> {
  const deleted = await mapsService.deleteMap(accountId, mapId);
  return json(res, deleted ? 200 : 404, deleted ? { ok: true } : MAP_NOT_FOUND);
}

/** POST /api/maps/:id/fork: copy a public-or-owned map with lineage. */
export async function mapForkCore(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
  mapId: number,
): Promise<void> {
  let body: any;
  try {
    body = await readBody(req);
  } catch {
    return json(res, 400, BAD_JSON);
  }
  const result = await mapsService.forkMap(accountId, mapId, body.name);
  if (!result.ok) return json(res, mapsErrorStatus(result.error), { error: result.error });
  // The fork response carries the full document so the editor can open the
  // copy without a second round trip.
  return json(res, 200, { map: mapFullJson(result.map) });
}

/** POST /api/maps/:id/(publish|unpublish): owner-only visibility flip. */
export async function mapSetPublishedCore(
  res: http.ServerResponse,
  accountId: number,
  mapId: number,
  publish: boolean,
): Promise<void> {
  const done = await mapsService.setPublished(accountId, mapId, publish);
  return json(res, done ? 200 : 404, done ? { ok: true } : MAP_NOT_FOUND);
}

// ---------------------------------------------------------------------------
// Guards. The bearer guards come from the shared factories (LAZY db reads, the
// lazy-db-bundle insurance against partial db mocks). The Content-Length precheck
// mirrors the legacy lane: BEFORE auth, 413 + Connection: close, no body read.
// ---------------------------------------------------------------------------

const REAL_GUARD_DB = { accountAndScopeForToken, accountForToken, moderationStatusForAccount };
let guardDbBundle = REAL_GUARD_DB;

/** Override the bearer-guard db reads with fakes (test-only). */
export function setMapsGuardDbForTests(overrides: Partial<typeof REAL_GUARD_DB>): void {
  guardDbBundle = { ...REAL_GUARD_DB, ...overrides };
}

/** Restore the real bearer-guard db reads (test-only). */
export function resetMapsGuardDbForTests(): void {
  guardDbBundle = REAL_GUARD_DB;
}

const activeGuard = createActiveGuard(() => guardDbBundle);
const readGuard = createReadGuard(() => guardDbBundle);

const mapSaveContentLengthGuard: Middleware = async (ctx, next) => {
  if (contentLengthExceeds(ctx.req, MAX_MAP_SAVE_BYTES)) {
    ctx.res.shouldKeepAlive = false;
    ctx.res.setHeader('Connection', 'close');
    json(ctx.res, 413, MAP_TOO_LARGE);
    return;
  }
  await next();
};

/**
 * GET /api/maps/:id optional-auth viewer: resolves the bearer to an account when
 * one is presented (any scope; mirrors the legacy bearerAccount, which applies no
 * scope or moderation gate to a read of a public document) and stashes it; an
 * ANONYMOUS reader pays the public read throttle, exactly like the legacy arm
 * (the throttle is conditional, so this stays a bespoke middleware rather than a
 * rateLimit(PUBLIC_READ_POLICY) mount; the prose 429 body is the legacy one).
 */
const VIEWER_ACCOUNT = 'maps_viewer_account';
const BEARER_PATTERN = /^Bearer ([a-f0-9]{64})$/;
const optionalViewerGuard: Middleware = async (ctx, next) => {
  const m = BEARER_PATTERN.exec(ctx.req.headers.authorization ?? '');
  const accountId = m ? await guardDbBundle.accountForToken(m[1]) : null;
  if (accountId === null && !publicReadRateLimited(ctx.req).allowed) {
    json(ctx.res, 429, RATE_LIMITED);
    return;
  }
  ctx.state.set(VIEWER_ACCOUNT, accountId);
  await next();
};

/** The BOLA owner loader for the owner-only :id routes. Account-scoped: a map
 * that is missing, or owned by someone else (public or not), loads null and
 * denies with the legacy 404 body. The service's SQL re-scopes every write by
 * account_id, so this loader is the deny-by-default gate, not the only check. */
const requireOwnedMap = requireOwned<MapRecord>({
  resource: 'map',
  param: 'id',
  load: async (accountId, id) => {
    const map = await mapsService.getMapForViewer(accountId, id);
    return map !== null && map.accountId === accountId ? map : null;
  },
  notFoundBody: MAP_NOT_FOUND,
});

/** The owned map row the requireOwnedMap loader stashed. */
function ownedMap(ctx: Ctx): MapRecord {
  return ctx.state.get('map') as MapRecord;
}

/** The decoded :id for the non-owned (publicRead) :id routes. Mirrors the legacy
 * regex: a non-digit id answers the ladder's terminal 404 body. */
function publicMapId(ctx: Ctx): number | null {
  const raw = ctx.params.id ?? '';
  return /^\d+$/.test(raw) ? Number(raw) : null;
}

// ---------------------------------------------------------------------------
// Thin Ctx handlers.
// ---------------------------------------------------------------------------

async function listMineHandler(ctx: Ctx): Promise<void> {
  return mapsListMineCore(ctx.res, ctxAccountId(ctx));
}

async function createHandler(ctx: Ctx): Promise<void> {
  return mapsCreateCore(ctx.req, ctx.res, ctxAccountId(ctx));
}

async function publicListHandler(ctx: Ctx): Promise<void> {
  return mapsPublicListCore(ctx.req, ctx.res);
}

async function getMapHandler(ctx: Ctx): Promise<void> {
  const mapId = publicMapId(ctx);
  if (mapId === null) return json(ctx.res, 404, UNKNOWN_ENDPOINT);
  const viewer = ctx.state.get(VIEWER_ACCOUNT) as number | null;
  return mapGetCore(ctx.res, viewer, mapId);
}

async function saveHandler(ctx: Ctx): Promise<void> {
  return mapSaveCore(ctx.req, ctx.res, ctxAccountId(ctx), ownedMap(ctx).id);
}

async function deleteHandler(ctx: Ctx): Promise<void> {
  return mapDeleteCore(ctx.res, ctxAccountId(ctx), ownedMap(ctx).id);
}

async function forkHandler(ctx: Ctx): Promise<void> {
  const mapId = publicMapId(ctx);
  if (mapId === null) return json(ctx.res, 404, UNKNOWN_ENDPOINT);
  return mapForkCore(ctx.req, ctx.res, ctxAccountId(ctx), mapId);
}

async function publishHandler(ctx: Ctx): Promise<void> {
  return mapSetPublishedCore(ctx.res, ctxAccountId(ctx), ownedMap(ctx).id, true);
}

async function unpublishHandler(ctx: Ctx): Promise<void> {
  return mapSetPublishedCore(ctx.res, ctxAccountId(ctx), ownedMap(ctx).id, false);
}

// ---------------------------------------------------------------------------
// The route table. registry.ts spreads this into apiRoutes. Guard order mirrors
// the legacy lanes: Content-Length precheck BEFORE auth on the save lanes, the
// limiter AFTER auth (the fused ip+account bucket needs ctx.account), the owner
// loader last. GET /api/maps/:id and the fork source read are public-or-owner
// resources whose access rule lives in the service (getMapForViewer / forkMap),
// so they carry meta.publicRead instead of an owner loader.
// ---------------------------------------------------------------------------

export const routes: RouteDef[] = [
  {
    method: 'GET',
    path: '/api/maps',
    surface: 'api',
    middleware: [readGuard],
    handler: listMineHandler,
  },
  {
    method: 'POST',
    path: '/api/maps',
    surface: 'api',
    middleware: [mapSaveContentLengthGuard, activeGuard, rateLimit(MAP_MUTATION_POLICY)],
    handler: createHandler,
  },
  {
    method: 'GET',
    path: '/api/maps/public',
    surface: 'api',
    middleware: [rateLimit(PUBLIC_READ_POLICY)],
    handler: publicListHandler,
  },
  {
    method: 'GET',
    path: '/api/maps/:id',
    surface: 'api',
    middleware: [optionalViewerGuard],
    meta: { publicRead: true },
    handler: getMapHandler,
  },
  {
    method: 'PUT',
    path: '/api/maps/:id',
    surface: 'api',
    middleware: [
      mapSaveContentLengthGuard,
      activeGuard,
      rateLimit(MAP_MUTATION_POLICY),
      requireOwnedMap,
    ],
    meta: { requireOwned: { kind: 'map', ownerScope: 'account' } },
    handler: saveHandler,
  },
  {
    method: 'DELETE',
    path: '/api/maps/:id',
    surface: 'api',
    middleware: [activeGuard, rateLimit(MAP_MUTATION_POLICY), requireOwnedMap],
    meta: { requireOwned: { kind: 'map', ownerScope: 'account' } },
    handler: deleteHandler,
  },
  {
    method: 'POST',
    path: '/api/maps/:id/fork',
    surface: 'api',
    middleware: [activeGuard, rateLimit(MAP_MUTATION_POLICY)],
    meta: { publicRead: true },
    handler: forkHandler,
  },
  {
    method: 'POST',
    path: '/api/maps/:id/publish',
    surface: 'api',
    middleware: [activeGuard, rateLimit(MAP_MUTATION_POLICY), requireOwnedMap],
    meta: { requireOwned: { kind: 'map', ownerScope: 'account' } },
    handler: publishHandler,
  },
  {
    method: 'POST',
    path: '/api/maps/:id/unpublish',
    surface: 'api',
    middleware: [activeGuard, rateLimit(MAP_MUTATION_POLICY), requireOwnedMap],
    meta: { requireOwned: { kind: 'map', ownerScope: 'account' } },
    handler: unpublishHandler,
  },
];
