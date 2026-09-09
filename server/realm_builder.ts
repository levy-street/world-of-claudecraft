// The Realm Builder of the Month API (registry-only RouteDefs, the new-route
// rule: no legacy ladder arm, so the legacy rollback answers 404 for these by
// design). Four thin handlers over realm_builder_db.ts:
//
//   GET  /api/realm-builder                 the public roll (the game reads this)
//   GET  /admin/api/realm-builders          the roll, for the dashboard
//   POST /admin/api/realm-builders          name or re-name one month
//   POST /admin/api/realm-builders/delete   remove one month
//   (delete rides POST like the other admin delete arms, e.g.
//   /admin/api/ad-spend/delete)
//
// Permissions (admin_routes.ts): both arms carry content.moderate, the grant
// the other public-content surfaces (published maps, user assets) already use.
// This is the same job: deciding what the realm shows the world.
//
// EVERY WRITE RE-PUBLISHES. The sim emits the roll on the monument's inspect
// event, so the server's own copy has to move the moment an operator saves it,
// or the plaque keeps naming last month's builder until the next restart.
// `publishRealmBuilderRoll` is the one place that happens, and boot calls it too.
// It is also the bust point for the public read's cache below, so a client
// loading the world right after a save reads the new name, never a stale TTL.

import { setRealmBuilderRoll } from '../src/sim/content/realm_builders';
import { requireAdmin } from './admin';
import { createCachedRead } from './cached_read';
import { pool } from './db';
import { withBody } from './http/middleware/body';
import { ADMIN_META, adminIdentityOf } from './http/middleware/require_admin';
import type { Ctx, RouteDef } from './http/types';
import { json } from './http_util';
import { publicReadRateLimited } from './ratelimit';
import { REALM } from './realm';
import {
  deleteRealmBuilder,
  listRealmBuilders,
  type RealmBuilderRow,
  type UpsertRealmBuilderInput,
  upsertRealmBuilder,
} from './realm_builder_db';

// ---------------------------------------------------------------------------
// Db seam (the ad_spend.ts shape): the real bundle, swappable in tests.
// ---------------------------------------------------------------------------

const REAL_REALM_BUILDER_DB = {
  listRealmBuilders: (): Promise<RealmBuilderRow[]> => listRealmBuilders(pool, REALM),
  upsertRealmBuilder: (input: UpsertRealmBuilderInput): Promise<RealmBuilderRow> =>
    upsertRealmBuilder(pool, REALM, input),
  deleteRealmBuilder: (year: unknown, month: unknown): Promise<boolean> =>
    deleteRealmBuilder(pool, REALM, year, month),
};
let realmBuilderDb = REAL_REALM_BUILDER_DB;

/** Override the roll's db bundle with a fake (test-only; merges over the
 *  CURRENT bundle; resetRealmBuilderDbForTests restores the real bundle). */
export function setRealmBuilderDbForTests(overrides: Partial<typeof REAL_REALM_BUILDER_DB>): void {
  realmBuilderDb = { ...realmBuilderDb, ...overrides };
  publicRoll.bust();
}

/** Restore the real bundle after a setRealmBuilderDbForTests override. */
export function resetRealmBuilderDbForTests(): void {
  realmBuilderDb = REAL_REALM_BUILDER_DB;
  publicRoll.bust();
}

// ---------------------------------------------------------------------------
// The public roll: the projection the anonymous read answers with, and its
// cache.
// ---------------------------------------------------------------------------

/**
 * What the anonymous read exposes of a row: the calendar month and the name,
 * nothing else. `note` is an operator's own remark for the dashboard and
 * `updatedAt` is audit, so neither leaves the admin surface. The client keeps
 * exactly these three (src/net/realm_builder_roll.ts decode) and
 * tests/server/realm_builder.test.ts pins the wire shape with toEqual.
 */
export interface PublicRealmBuilderEntry {
  year: number;
  month: number;
  name: string;
}

function toPublicEntry({ year, month, name }: RealmBuilderRow): PublicRealmBuilderEntry {
  return { year, month, name };
}

/**
 * How long the public read serves one snapshot before asking Postgres again.
 * Every client asks once while the world loads and the answer is identical
 * for all of them, so a cold-start burst is one query rather than one per
 * player. Writes bust it (publishRealmBuilderRoll), so the TTL only bounds
 * how stale a read can be when a PEER process wrote the row.
 */
export const PUBLIC_ROLL_TTL_MS = 30_000;

const publicRoll = createCachedRead(
  async () => (await realmBuilderDb.listRealmBuilders()).map(toPublicEntry),
  // Read the clock through a closure so a test's fake timers reach it; the
  // default would capture the real Date.now at module load.
  { ttlMs: PUBLIC_ROLL_TTL_MS, now: () => Date.now() },
);

const ok = (ctx: Ctx, data: unknown): void =>
  json(ctx.res, 200, { success: true, data, error: null });
const failBody = (ctx: Ctx, status: number, error: string): void =>
  json(ctx.res, status, { success: false, data: null, error });

/**
 * Read the roll and hand it to the sim, so the monument's inspect event carries
 * it. Called at boot and after every write; safe to call when the table is
 * empty, which simply leaves the shipped placeholder showing.
 */
export async function publishRealmBuilderRoll(): Promise<RealmBuilderRow[]> {
  // Bust BEFORE the read so a public read racing this write cannot install a
  // pre-write snapshot after it (the lost-bust race cached_read closes).
  publicRoll.bust();
  const rows = await realmBuilderDb.listRealmBuilders();
  setRealmBuilderRoll(rows.map(toPublicEntry));
  return rows;
}

/**
 * GET /api/realm-builder: the public roll, newest first.
 *
 * Anonymous and db-backed, so it takes the same per-IP public-read budget the
 * sheet, the deed rarity aggregate and the guild roster use (in-handler,
 * keeping the 429 body shape those routes established). Every client asks for
 * this once while the world loads; nothing legitimate polls it.
 *
 * Served through a TTL cache (the ota_updates.ts shape) rather than a query
 * per request: the answer is viewer-identical, and the cache is busted on
 * every write, so this still re-syncs a client that connected before an
 * operator named somebody.
 */
async function publicRollHandler(ctx: Ctx): Promise<void> {
  if (!publicReadRateLimited(ctx.req).allowed) {
    json(ctx.res, 429, { error: 'rate limited' });
    return;
  }
  json(ctx.res, 200, { realm: REALM, entries: await publicRoll.read() });
}

/** GET /admin/api/realm-builders: the roll, for the dashboard. */
async function adminListHandler(ctx: Ctx): Promise<void> {
  ok(ctx, { rows: await realmBuilderDb.listRealmBuilders() });
}

/** POST /admin/api/realm-builders: name or re-name one month. */
async function adminUpsertHandler(ctx: Ctx): Promise<void> {
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  try {
    const row = await realmBuilderDb.upsertRealmBuilder({
      year: body.year as number,
      month: body.month as number,
      name: body.name as string,
      note: body.note as string | undefined,
      // Who named them, for the audit trail the row carries.
      updatedBy: adminIdentityOf(ctx).accountId,
    });
    ok(ctx, { row, rows: await publishRealmBuilderRoll() });
  } catch (err) {
    if (err instanceof TypeError) {
      failBody(ctx, 400, err.message);
      return;
    }
    throw err;
  }
}

/** POST /admin/api/realm-builders/delete: remove one month. */
async function adminDeleteHandler(ctx: Ctx): Promise<void> {
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  try {
    const deleted = await realmBuilderDb.deleteRealmBuilder(body.year, body.month);
    ok(ctx, { deleted, rows: await publishRealmBuilderRoll() });
  } catch (err) {
    if (err instanceof TypeError) {
      failBody(ctx, 400, err.message);
      return;
    }
    throw err;
  }
}

export const routes: RouteDef[] = [
  { method: 'GET', path: '/api/realm-builder', surface: 'api', handler: publicRollHandler },
  {
    method: 'GET',
    path: '/admin/api/realm-builders',
    surface: 'admin',
    middleware: [requireAdmin],
    meta: ADMIN_META,
    handler: adminListHandler,
  },
  // withBody() after the auth gate: readBody's own failures (bad json, body
  // too large) surface as coded 4xx through the onion instead of handler 500s.
  {
    method: 'POST',
    path: '/admin/api/realm-builders',
    surface: 'admin',
    middleware: [requireAdmin, withBody()],
    meta: ADMIN_META,
    handler: adminUpsertHandler,
  },
  {
    method: 'POST',
    path: '/admin/api/realm-builders/delete',
    surface: 'admin',
    middleware: [requireAdmin, withBody()],
    meta: ADMIN_META,
    handler: adminDeleteHandler,
  },
];
