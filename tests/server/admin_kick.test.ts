// Unit coverage for the admin-panel kick (server/admin.ts adminKickHandler) and its
// host-agnostic contract module (server/admin_kick_api.ts).
//
// The route is a REGISTRY-ONLY RouteDef (no legacy handleAdminApi twin), so it
// follows the new-endpoint recipe the Cheater mark pair set: a typed Infer schema
// decodes the body, and every refusal is a stable `kick.*` code raised as an
// HttpError, never English prose. This slice pins:
//  - the contract module: the reason normalizer, the schema's shape and ceiling,
//    and the disconnect line the kicked client is sent;
//  - the permission gate failing CLOSED: a viewer-role operator is refused with
//    the central gate's 403 before the handler runs, and an unauthenticated
//    caller with the uniform 401;
//  - the happy path, and that the audit row lands BEFORE the disconnect (the
//    in-game /kick ordering: a kick can never happen unaudited), with the actor
//    being the operator and the action 'kick';
//  - the stale-target path: a player who left between page load and click is a
//    409 with NO audit row and NO disconnect, so moderation history never claims
//    a disconnect that did not happen;
//  - the operator-target guard and the blank-reason refusal, both before any write.
//
// server/db.ts builds a pg Pool at module load and throws if DATABASE_URL is unset;
// admin.ts imports it, so set a dummy URL. The pool never connects: the db seam is
// faked via setAdminDbForTests and the game hooks via configureAdminRuntime.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_admin_kick';

import type * as http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type AdminRuntime,
  configureAdminRuntime,
  resetAdminDbForTests,
  resetAdminRuntimeForTests,
  routes,
  setAdminDbForTests,
} from '../../server/admin';
import {
  ADMIN_KICK_MESSAGE_PREFIX,
  ADMIN_KICK_REASON_MAX,
  adminKickBodySchema,
  adminKickMessage,
  normalizeAdminKickReason,
} from '../../server/admin_kick_api';
import { compose } from '../../server/http/compose';
import { withErrors } from '../../server/http/middleware/with_errors';
import type { Method, Middleware } from '../../server/http/types';
import { type FakeRes, fakeCtx } from './helpers';

const KICK_PATH = '/admin/api/moderation/accounts/:id/kick';

/** A well-formed bearer header (64 lowercase-hex, matching the gate's pattern). */
const BEARER = `Bearer ${'a'.repeat(64)}`;
/** The operator making the call; isAdminAccount is true for this id only. */
const ADMIN_ACCOUNT_ID = 7;
/** The account being kicked: an ordinary player with a live session. */
const TARGET_ACCOUNT_ID = 42;
const REASON = 'AFK at the Eastbrook fountain for two hours';

// Loose fake-db overrides: the real bundle's return types are strict db-row
// shapes, so tests supply minimal fakes and this single cast point loosens them
// (the tests/server/admin.test.ts idiom).
type DbOverrides = Record<string, unknown>;

/**
 * Install the admin db seam so requireAdmin resolves the bearer to an operator
 * carrying the given roles and the kick TARGET reads as an ordinary account.
 */
function authedAdminDb(roles: string[], overrides: DbOverrides = {}): void {
  setAdminDbForTests({
    accountAndScopeForToken: async () => ({ accountId: ADMIN_ACCOUNT_ID, scope: 'full' as const }),
    adminRolesForAccount: async (id: number) =>
      id === ADMIN_ACCOUNT_ID ? { username: 'op', roles } : null,
    isAdminAccount: async (id: number) => id === ADMIN_ACCOUNT_ID,
    ...overrides,
  } as Parameters<typeof setAdminDbForTests>[0]);
}

/**
 * A runtime whose live roster holds the given account ids, recording every
 * disconnect. The order log is shared with the audit fake so a test can assert
 * audit-then-disconnect, not merely both.
 */
function liveRuntime(
  online: number[],
  order: string[],
): { runtime: AdminRuntime; disconnectAccount: ReturnType<typeof vi.fn> } {
  const disconnectAccount = vi.fn((_accountId: number, _reason: string) => {
    order.push('disconnect');
  });
  const runtime = {
    liveAccountIds: () => new Set(online),
    disconnectAccount,
  } as unknown as AdminRuntime;
  configureAdminRuntime(runtime);
  return { runtime, disconnectAccount };
}

/** Read status + parsed body off the fakeCtx's FakeRes. */
function readRes(res: http.ServerResponse): { status: number; body: unknown } {
  const fake = res as unknown as FakeRes;
  return { status: fake.statusCode, body: fake.body ? JSON.parse(fake.body) : undefined };
}

function routeFor(path: string) {
  const route = routes.find((r) => r.method === 'POST' && r.path === path);
  if (!route) throw new Error(`no route POST ${path}`);
  return route;
}

/**
 * Drive the route's REAL middleware chain (requireAdmin, requireAdminTarget,
 * withBody) plus its handler under withErrors, exactly as the dispatcher onion
 * does, so the coded HttpErrors serialize through the admin envelope.
 */
async function runKick(
  opts: { body?: unknown; accountId?: number; bearer?: string } = {},
): Promise<{ status: number; body: unknown; reached: boolean }> {
  const route = routeFor(KICK_PATH);
  const id = String(opts.accountId ?? TARGET_ACCOUNT_ID);
  let reached = false;
  const terminal: Middleware = async (c) => {
    reached = true;
    await route.handler(c);
  };
  const ctx = fakeCtx({
    method: route.method as Method,
    url: KICK_PATH.replace(':id', id),
    headers: { authorization: opts.bearer ?? BEARER },
    params: { id },
    body: opts.body,
  });
  await compose([
    withErrors({ surface: route.meta?.envelope }),
    ...(route.middleware ?? []),
    terminal,
  ])(ctx);
  return { ...readRes(ctx.res), reached };
}

/** The admin envelope a coded refusal serializes to. */
const adminError = (code: string) => ({ success: false, data: null, error: code });

afterEach(() => {
  resetAdminDbForTests();
  resetAdminRuntimeForTests();
  vi.restoreAllMocks();
});

describe('admin kick contract (server/admin_kick_api.ts)', () => {
  it('normalizes the reason: trimmed, and null when nothing is left', () => {
    expect(normalizeAdminKickReason('  AFK  ')).toBe('AFK');
    expect(normalizeAdminKickReason('')).toBeNull();
    expect(normalizeAdminKickReason('   \n\t ')).toBeNull();
  });

  it('decodes a well-formed body and refuses a wrong-typed, missing, or over-long reason', () => {
    expect(adminKickBodySchema.decode({ reason: REASON })).toEqual({
      ok: true,
      value: { reason: REASON },
    });
    expect(adminKickBodySchema.decode({ reason: 'x'.repeat(ADMIN_KICK_REASON_MAX) }).ok).toBe(true);
    // The ceiling mirrors moderation_db's ACTION_REASON_MAX: the wire refuses
    // what the audit write would otherwise silently truncate.
    expect(adminKickBodySchema.decode({ reason: 'x'.repeat(ADMIN_KICK_REASON_MAX + 1) }).ok).toBe(
      false,
    );
    expect(adminKickBodySchema.decode({}).ok).toBe(false);
    expect(adminKickBodySchema.decode({ reason: 5 }).ok).toBe(false);
  });

  it('builds the disconnect line as the wire prefix plus the reason, verbatim', () => {
    // The prefix is a byte-exact contract with src/ui/api_error_i18n.ts (pinned
    // equal in tests/main_api_error.test.ts); the reason rides untouched after it.
    expect(adminKickMessage(REASON)).toBe(`${ADMIN_KICK_MESSAGE_PREFIX}${REASON}`);
    expect(adminKickMessage(REASON).startsWith(ADMIN_KICK_MESSAGE_PREFIX)).toBe(true);
  });
});

describe('POST /admin/api/moderation/accounts/:id/kick', () => {
  it('fails closed for a viewer-role operator: 403 before the handler runs', async () => {
    // viewer holds moderation.read but not moderation.act (server/admin_permissions.ts),
    // the same permission the in-game /kick requires (requiredCommandPermission).
    const order: string[] = [];
    const recordInGameAction = vi.fn(async () => {
      order.push('audit');
    });
    authedAdminDb(['viewer'], { recordInGameAction });
    const { disconnectAccount } = liveRuntime([TARGET_ACCOUNT_ID], order);

    const res = await runKick({ body: { reason: REASON } });

    expect(res.status).toBe(403);
    expect(res.reached).toBe(false);
    expect(recordInGameAction).not.toHaveBeenCalled();
    expect(disconnectAccount).not.toHaveBeenCalled();
  });

  it('fails closed for an unauthenticated caller: the uniform admin 401', async () => {
    authedAdminDb(['moderator']);
    const { disconnectAccount } = liveRuntime([TARGET_ACCOUNT_ID], []);

    const res = await runKick({ body: { reason: REASON }, bearer: '' });

    expect(res.status).toBe(401);
    expect(res.reached).toBe(false);
    expect(disconnectAccount).not.toHaveBeenCalled();
  });

  it('audits the kick under the operator, THEN disconnects with the reason line', async () => {
    const order: string[] = [];
    const recordInGameAction = vi.fn(async () => {
      order.push('audit');
    });
    authedAdminDb(['moderator'], { recordInGameAction });
    const { disconnectAccount } = liveRuntime([TARGET_ACCOUNT_ID, 99], order);

    const res = await runKick({ body: { reason: `  ${REASON}  ` } });

    expect(res).toMatchObject({ status: 200, body: { success: true, data: { ok: true } } });
    // The SAME row the in-game /kick writes: action 'kick', actor = the operator,
    // the trimmed reason. ModerationHistoryPage cannot tell the two apart.
    expect(recordInGameAction).toHaveBeenCalledWith({
      action: 'kick',
      accountId: TARGET_ACCOUNT_ID,
      adminAccountId: ADMIN_ACCOUNT_ID,
      reason: REASON,
    });
    expect(disconnectAccount).toHaveBeenCalledWith(TARGET_ACCOUNT_ID, adminKickMessage(REASON));
    // Audit before the live effect, never the reverse: a kick cannot happen unaudited.
    expect(order).toEqual(['audit', 'disconnect']);
  });

  it('answers 409 kick.target_offline for a player who already left, writing NOTHING', async () => {
    // The roster the operator clicked in is a snapshot; the account is gone from
    // the live set by the time the click lands. No audit row may claim a
    // disconnect that did not happen, and no disconnect is attempted.
    const recordInGameAction = vi.fn(async () => {});
    authedAdminDb(['moderator'], { recordInGameAction });
    const { disconnectAccount } = liveRuntime([99], []);

    const res = await runKick({ body: { reason: REASON } });

    expect(res.status).toBe(409);
    expect(res.body).toEqual(adminError('kick.target_offline'));
    expect(res.reached).toBe(true);
    expect(recordInGameAction).not.toHaveBeenCalled();
    expect(disconnectAccount).not.toHaveBeenCalled();
  });

  it('refuses an operator target with 400 kick.admin_target before any write', async () => {
    const recordInGameAction = vi.fn(async () => {});
    authedAdminDb(['superadmin'], { recordInGameAction });
    const { disconnectAccount } = liveRuntime([ADMIN_ACCOUNT_ID], []);

    const res = await runKick({ body: { reason: REASON }, accountId: ADMIN_ACCOUNT_ID });

    expect(res.status).toBe(400);
    expect(res.body).toEqual(adminError('kick.admin_target'));
    expect(recordInGameAction).not.toHaveBeenCalled();
    expect(disconnectAccount).not.toHaveBeenCalled();
  });

  it('refuses a blank reason with 400 kick.reason_required before any write', async () => {
    const recordInGameAction = vi.fn(async () => {});
    authedAdminDb(['moderator'], { recordInGameAction });
    const { disconnectAccount } = liveRuntime([TARGET_ACCOUNT_ID], []);

    const res = await runKick({ body: { reason: '   ' } });

    expect(res.status).toBe(400);
    expect(res.body).toEqual(adminError('kick.reason_required'));
    expect(recordInGameAction).not.toHaveBeenCalled();
    expect(disconnectAccount).not.toHaveBeenCalled();
  });

  it('answers the pipeline 422 for a body with no reason, or one past the ceiling', async () => {
    const recordInGameAction = vi.fn(async () => {});
    authedAdminDb(['moderator'], { recordInGameAction });
    const { disconnectAccount } = liveRuntime([TARGET_ACCOUNT_ID], []);

    expect((await runKick({ body: {} })).status).toBe(422);
    // The length ceiling is a SHAPE refusal at the boundary (422), distinct from
    // the blank-reason 400 above, so an over-long note is never silently cut.
    const overLong = 'x'.repeat(ADMIN_KICK_REASON_MAX + 1);
    expect((await runKick({ body: { reason: overLong } })).status).toBe(422);
    expect(recordInGameAction).not.toHaveBeenCalled();
    expect(disconnectAccount).not.toHaveBeenCalled();
  });
});
