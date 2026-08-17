// Economy Watch, phase 3: the OPERATOR SURFACE for the gold conservation queue
// (registry-only RouteDefs, the ad_spend.ts shape and the new-route rule: no
// legacy ladder arm, so the legacy rollback answers 404 for these by design).
//
//   GET  /admin/api/economy/alerts?limit=N            the open queue
//   GET  /admin/api/economy/characters/:id/alerts     one character's history
//   GET  /admin/api/economy/characters/:id/ledger     the movements behind it
//   POST /admin/api/economy/alerts/:id/ack            mark one handled
//
// THE ACK ARM IS WHY THIS EXISTS. Before it, `acknowledged_at` had no writer at
// all: the queue could only grow, the retention sweep (which prunes ONLY
// acknowledged rows) pruned nothing forever, and the dedupe that keeps one
// incident to one row could never be re-armed. A finding queue nobody can close
// stops being a work list within a week.
//
// Permissions (admin_routes.ts): reads carry the new `economy.read`, the ack
// carries `economy.act`. Deliberately NOT analytics.read, for the reason
// botdetector.read has its own grant: an open finding names a character and
// says the ledger cannot explain their coin, which is an anti-abuse internal
// rather than a dashboard number. Bodies use the legacy admin envelope
// ({ success, data, error }) like every /admin/api route.

import { requireAdmin } from './admin';
import {
  acknowledgeEconomyAlert,
  type EconomyAlertRow,
  economyAlertsForCharacter,
  openEconomyAlerts,
} from './economy_alerts_db';
import { goldLedgerForCharacter } from './gold_ledger_db';
import type { GoldLedgerRow } from './gold_ledger_types';
import {
  ADMIN_META,
  adminTargetId,
  adminTargetMeta,
  requireAdminTarget,
} from './http/middleware/require_admin';
import type { Ctx, RouteDef } from './http/types';
import { json } from './http_util';
import { REALM } from './realm';

// ---------------------------------------------------------------------------
// Db seam (the ad_spend.ts shape): the real bundle, swappable in tests. Auth is
// NOT part of this seam: the routes mount admin.ts's shared requireAdmin gate,
// so the admin scope sweep stays authoritative for these routes too.
// ---------------------------------------------------------------------------

const REAL_ECONOMY_ADMIN_DB = {
  openEconomyAlerts: (limit: number): Promise<EconomyAlertRow[]> => openEconomyAlerts(REALM, limit),
  economyAlertsForCharacter: (characterId: number, limit: number): Promise<EconomyAlertRow[]> =>
    economyAlertsForCharacter(REALM, characterId, limit),
  acknowledgeEconomyAlert: (id: number, accountId: number): Promise<boolean> =>
    acknowledgeEconomyAlert(REALM, id, accountId),
  goldLedgerForCharacter: (characterId: number, limit: number): Promise<GoldLedgerRow[]> =>
    goldLedgerForCharacter(characterId, { limit }),
};
let economyAdminDb = REAL_ECONOMY_ADMIN_DB;

/** Override the bundle with a fake (test-only; merges over the CURRENT bundle). */
export function setEconomyAdminDbForTests(overrides: Partial<typeof REAL_ECONOMY_ADMIN_DB>): void {
  economyAdminDb = { ...economyAdminDb, ...overrides };
}

/** Restore the real bundle after an override (test-only). */
export function resetEconomyAdminDbForTests(): void {
  economyAdminDb = REAL_ECONOMY_ADMIN_DB;
}

const ok = (ctx: Ctx, data: unknown): void =>
  json(ctx.res, 200, { success: true, data, error: null });
const failBody = (ctx: Ctx, status: number, error: string): void =>
  json(ctx.res, status, { success: false, data: null, error });

/** A query-string integer within bounds, falling back rather than erroring. */
function limitParam(ctx: Ctx, fallback: number, max: number): number {
  const raw = ctx.url.searchParams.get('limit');
  if (raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(1, Math.floor(n)), max);
}

/** GET /admin/api/economy/alerts: the open queue, newest first. */
async function openQueueHandler(ctx: Ctx): Promise<void> {
  const rows = await economyAdminDb.openEconomyAlerts(limitParam(ctx, 100, 500));
  // `criticals` is served alongside rather than left to the caller to count:
  // this is the number an operator triages on, and a dashboard that derived it
  // from a truncated page would under-report exactly when the queue is deepest.
  ok(ctx, { rows, criticals: rows.filter((r) => r.severity === 'critical').length });
}

/**
 * GET /admin/api/economy/characters/:id/alerts: one character's findings.
 *
 * The :id is decoded by `requireAdminTarget` rather than here, so a
 * non-numeric or non-positive id is a 422 raised BEFORE any database call and
 * every admin :param route rejects a bad id the same way.
 */
async function characterAlertsHandler(ctx: Ctx): Promise<void> {
  const rows = await economyAdminDb.economyAlertsForCharacter(
    adminTargetId(ctx),
    limitParam(ctx, 50, 200),
  );
  ok(ctx, { rows });
}

/**
 * GET /admin/api/economy/characters/:id/ledger: the movements behind a finding.
 *
 * The alert says a character's coin does not add up; this is the trail that
 * says why, and without it an operator has a claim with no evidence and no way
 * to reach the evidence short of a psql prompt.
 */
async function ledgerHandler(ctx: Ctx): Promise<void> {
  const rows = await economyAdminDb.goldLedgerForCharacter(
    adminTargetId(ctx),
    limitParam(ctx, 200, 500),
  );
  ok(ctx, { rows });
}

/**
 * POST /admin/api/economy/alerts/:id/ack: mark one finding handled.
 *
 * Answers `{ acknowledged: false }` rather than a 404 when the row was already
 * acknowledged or does not exist. The distinction a caller acts on is "is it
 * still in my queue", and both of those answer no; a 404 would also leak
 * whether an id exists on another realm.
 */
async function ackHandler(ctx: Ctx): Promise<void> {
  const accountId = ctx.account?.accountId;
  if (typeof accountId !== 'number') {
    // Unreachable behind requireAdmin, and still refused rather than written as
    // NULL: an acknowledgement whose author is unknown is worse than none,
    // because the queue would show the finding handled by nobody.
    failBody(ctx, 401, 'not authenticated');
    return;
  }
  ok(ctx, {
    acknowledged: await economyAdminDb.acknowledgeEconomyAlert(adminTargetId(ctx), accountId),
  });
}

export const routes: RouteDef[] = [
  {
    method: 'GET',
    path: '/admin/api/economy/alerts',
    surface: 'admin',
    middleware: [requireAdmin],
    meta: ADMIN_META,
    handler: openQueueHandler,
  },
  {
    method: 'GET',
    path: '/admin/api/economy/characters/:id/alerts',
    surface: 'admin',
    middleware: [requireAdmin, requireAdminTarget('character')],
    meta: adminTargetMeta('character'),
    handler: characterAlertsHandler,
  },
  {
    method: 'GET',
    path: '/admin/api/economy/characters/:id/ledger',
    surface: 'admin',
    middleware: [requireAdmin, requireAdminTarget('character')],
    meta: adminTargetMeta('character'),
    handler: ledgerHandler,
  },
  // No withBody(): the id rides the path and there is nothing else to say, so
  // the arm accepts no body at all rather than inventing fields a caller could
  // get wrong.
  {
    method: 'POST',
    path: '/admin/api/economy/alerts/:id/ack',
    surface: 'admin',
    middleware: [requireAdmin, requireAdminTarget('economyAlert')],
    meta: adminTargetMeta('economyAlert'),
    handler: ackHandler,
  },
];
