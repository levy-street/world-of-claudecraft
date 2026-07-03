// Request wiring for the housekeeping admin endpoints (/admin/api/housekeeping/*).
// Admin auth (bearer token + is_admin) is enforced by the caller, handleAdminApi
// in admin.ts, BEFORE this module runs; here we only route, load/save the
// per-realm override document, and shape the {success,data,error} envelope.
// Logic + catalogs live in housekeeping.ts (DB-free); SQL in housekeeping_db.ts.

import type * as http from 'node:http';
import type { GameServer } from './game';
import {
  calendarCatalog,
  clearOverrides,
  housekeepingOverview,
  housekeepingStatus,
  itemsCatalog,
  mergeOverridePatch,
  mobsCatalog,
  npcsCatalog,
  questsCatalog,
  ratesCatalog,
  spawnsCatalog,
  worldCatalog,
} from './housekeeping';
import { loadGameConfigOverrides, saveGameConfigOverrides } from './housekeeping_db';
import { json, readBody } from './http_util';
import { REALM } from './realm';

function ok(res: http.ServerResponse, data: unknown): void {
  json(res, 200, { success: true, data, error: null });
}

function fail(res: http.ServerResponse, status: number, error: string): void {
  json(res, status, { success: false, data: null, error });
}

async function handleSave(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  adminAccountId: number,
  merge: (savedRaw: unknown, body: unknown) => ReturnType<typeof mergeOverridePatch>,
): Promise<void> {
  const body = await readBody(req);
  const stored = await loadGameConfigOverrides();
  const result = merge(stored.data, body);
  if (!result.next || result.errors.length > 0) {
    return fail(res, 400, result.errors[0] ?? 'invalid override');
  }
  await saveGameConfigOverrides(result.next, adminAccountId);
  ok(res, {
    saved: result.next,
    warnings: result.warnings,
    status: housekeepingStatus(result.next, new Date().toISOString()),
  });
}

/**
 * Handle a /admin/api/housekeeping/* request. Returns false when the path is
 * not a housekeeping route so handleAdminApi can fall through to its 404.
 */
export async function handleHousekeepingApi(
  path: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  game: GameServer,
  adminAccountId: number,
): Promise<boolean> {
  if (!path.startsWith('/admin/api/housekeeping/')) return false;
  const route = path.slice('/admin/api/housekeeping/'.length);

  if (req.method === 'POST') {
    if (route === 'overrides') {
      await handleSave(req, res, adminAccountId, mergeOverridePatch);
      return true;
    }
    if (route === 'overrides/clear') {
      await handleSave(req, res, adminAccountId, clearOverrides);
      return true;
    }
    fail(res, 404, 'unknown admin endpoint');
    return true;
  }
  if (req.method !== 'GET') {
    fail(res, 405, 'method not allowed');
    return true;
  }

  const stored = await loadGameConfigOverrides();
  switch (route) {
    case 'overview': {
      const summary = game.housekeepingSummary();
      ok(
        res,
        housekeepingOverview({
          realm: REALM,
          worldSeed: summary.worldSeed,
          devCommands: summary.devCommands,
          savedRaw: stored.data,
          savedUpdatedAt: stored.updatedAt,
        }),
      );
      return true;
    }
    case 'rates':
      ok(res, ratesCatalog(stored.data, stored.updatedAt));
      return true;
    case 'calendar':
      ok(res, calendarCatalog(stored.data, stored.updatedAt));
      return true;
    case 'mobs':
      ok(res, mobsCatalog(stored.data, stored.updatedAt));
      return true;
    case 'quests':
      ok(res, questsCatalog(stored.data, stored.updatedAt));
      return true;
    case 'items':
      ok(res, itemsCatalog(stored.data, stored.updatedAt));
      return true;
    case 'npcs':
      ok(res, npcsCatalog(stored.data, stored.updatedAt));
      return true;
    case 'spawns':
      ok(res, spawnsCatalog(stored.data, stored.updatedAt));
      return true;
    case 'world':
      ok(res, worldCatalog(stored.data, stored.updatedAt));
      return true;
    default:
      fail(res, 404, 'unknown admin endpoint');
      return true;
  }
}
