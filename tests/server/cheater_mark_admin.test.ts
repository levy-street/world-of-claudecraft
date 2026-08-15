// Unit coverage for the Cheater mark's admin API pair (server/admin.ts
// cheaterMarkHandler / liftCheaterMarkHandler) and its host-agnostic contract
// module (server/cheater_mark_api.ts).
//
// Both routes are REGISTRY-ONLY RouteDefs (no legacy handleAdminApi twin), so they
// follow the new-endpoint recipe rather than the chat-mute arm they sit beside:
// a typed Infer schema decodes the body, and every refusal is a stable
// `cheater_mark.*` code raised as an HttpError, never English prose. This slice
// pins:
//  - the contract module: what each refusal maps to, and that a NON-refusal
//    (a driver error) passes through untouched so it still becomes a 500;
//  - the happy paths, including that the live push carries the budget the WRITE
//    ITSELF returned (moderation_db clamps it) rather than the number the
//    operator typed or a follow-up read a save-path burn could overtake;
//  - the operator-target guard on BOTH arms;
//  - the 422 shape gate, and the two real moderation_db refusals (a blank reason,
//    a non-positive budget) reaching the wire as their codes;
//  - that a refused lift does NOT push, so a failed call cannot clear a live tag;
//  - the COSMETIC-ONLY property: applying or lifting the mark touches no chat,
//    session-restriction, or command-gating path (src/sim/moderation/CLAUDE.md,
//    "a sanction here is VISIBILITY, never POWER").
//
// server/db.ts builds a pg Pool at module load and throws if DATABASE_URL is unset;
// admin.ts imports it, so set a dummy URL. The pool never connects: the db seam is
// faked via setAdminDbForTests, the game hooks via configureAdminRuntime, and the
// two real moderation_db guards exercised below both refuse BEFORE pool.connect().
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_cheater_mark_admin';

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
  CHEATER_MARK_REFUSALS,
  CheaterMarkRefused,
  cheaterMarkBodySchema,
  liftCheaterMarkBodySchema,
  rethrowCheaterMarkRefusal,
} from '../../server/cheater_mark_api';
import { compose } from '../../server/http/compose';
import { HttpError } from '../../server/http/errors';
import { withErrors } from '../../server/http/middleware/with_errors';
import type { Method, Middleware } from '../../server/http/types';
import { CHEATER_MARK_MAX_SECONDS } from '../../src/sim/moderation';
import { type FakeRes, fakeCtx } from './helpers';

const MARK_PATH = '/admin/api/moderation/accounts/:id/cheater-mark';
const LIFT_PATH = '/admin/api/moderation/accounts/:id/lift-cheater-mark';

/** A well-formed bearer header (64 lowercase-hex, matching the gate's pattern). */
const BEARER = `Bearer ${'a'.repeat(64)}`;
/** The operator making the call; isAdminAccount is true for this id only. */
const ADMIN_ACCOUNT_ID = 7;
/** The account being marked: an ordinary player. */
const TARGET_ACCOUNT_ID = 42;
const REASON = 'confirmed speed hacking in Thornhollow Fields';

// Loose fake-db overrides: the real bundle's return types are strict db-row
// shapes, so tests supply minimal fakes and this single cast point loosens them
// (the tests/server/admin.test.ts idiom).
type DbOverrides = Record<string, unknown>;

/**
 * Install the admin db seam so requireAdmin resolves the bearer to a superadmin
 * operator and the moderation TARGET reads as an ordinary account. Members not
 * named here keep the REAL implementation, which is deliberate: the refusal tests
 * below drive the genuine moderation_db guards.
 */
function authedAdminDb(overrides: DbOverrides = {}): void {
  setAdminDbForTests({
    accountAndScopeForToken: async () => ({ accountId: ADMIN_ACCOUNT_ID, scope: 'full' as const }),
    adminRolesForAccount: async (id: number) =>
      id === ADMIN_ACCOUNT_ID ? { username: 'op', roles: ['superadmin'] } : null,
    isAdminAccount: async (id: number) => id === ADMIN_ACCOUNT_ID,
    ...overrides,
  } as Parameters<typeof setAdminDbForTests>[0]);
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
 * Drive a route's REAL middleware chain (requireAdmin, requireAdminTarget,
 * withBody) plus its handler under withErrors, exactly as the dispatcher onion
 * does, so the coded HttpErrors serialize through the admin envelope.
 */
async function runRoute(
  path: string,
  opts: { body?: unknown; accountId?: number } = {},
): Promise<{ status: number; body: unknown; reached: boolean }> {
  const route = routeFor(path);
  const id = String(opts.accountId ?? TARGET_ACCOUNT_ID);
  let reached = false;
  const terminal: Middleware = async (c) => {
    reached = true;
    await route.handler(c);
  };
  const ctx = fakeCtx({
    method: route.method as Method,
    url: path.replace(':id', id),
    headers: { authorization: BEARER },
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

describe('cheater mark contract (server/cheater_mark_api.ts)', () => {
  it('maps every refusal token to a distinct stable code, and none to prose', () => {
    // Sweeps the whole vocabulary rather than spot-checking one: a token added
    // without a code (or with a copy-pasted duplicate) fails here.
    const mapped = CHEATER_MARK_REFUSALS.map((refusal) => {
      try {
        rethrowCheaterMarkRefusal(new CheaterMarkRefused(refusal));
      } catch (err) {
        return err as HttpError;
      }
      throw new Error(`rethrowCheaterMarkRefusal did not throw for ${refusal}`);
    });
    expect(mapped.map((e) => e.code)).toEqual([
      'cheater_mark.reason_required',
      'cheater_mark.invalid_duration',
      'cheater_mark.not_marked',
      // Deliberately the shared account code, not a cheater_mark twin: the fact
      // reported is the one every other account route already reports.
      'account.not_found',
    ]);
    expect(mapped.map((e) => e.status)).toEqual([400, 400, 409, 404]);
    expect(new Set(mapped.map((e) => e.code)).size).toBe(CHEATER_MARK_REFUSALS.length);
  });

  it('passes a non-refusal through unchanged, so a driver error still becomes a 500', () => {
    // Load-bearing: relabelling a Postgres failure as a client mistake would tell
    // an operator their input was wrong when the database was down.
    const driverError = Object.assign(new Error('connection terminated'), { code: '57P01' });
    expect(() => rethrowCheaterMarkRefusal(driverError)).toThrow(driverError);
    try {
      rethrowCheaterMarkRefusal(driverError);
    } catch (err) {
      expect(err).not.toBeInstanceOf(HttpError);
    }
  });

  it('decodes a well-formed mark body and rejects a malformed one', () => {
    const good = cheaterMarkBodySchema.decode({ reason: REASON, seconds: 600 });
    expect(good).toEqual({ ok: true, value: { reason: REASON, seconds: 600 } });
    // Shape only: range lives in moderation_db so the ceiling holds for every
    // caller, so an over-ceiling number is a valid SHAPE here.
    expect(cheaterMarkBodySchema.decode({ reason: REASON, seconds: 1e12 }).ok).toBe(true);
    expect(cheaterMarkBodySchema.decode({ reason: REASON }).ok).toBe(false);
    expect(cheaterMarkBodySchema.decode({ seconds: 600 }).ok).toBe(false);
    expect(cheaterMarkBodySchema.decode({ reason: 5, seconds: 600 }).ok).toBe(false);
    expect(liftCheaterMarkBodySchema.decode({}).ok).toBe(false);
    expect(liftCheaterMarkBodySchema.decode({ reason: REASON }).ok).toBe(true);
  });
});

describe('POST /admin/api/moderation/accounts/:id/cheater-mark', () => {
  it('marks the account and pushes the STORED budget, not the requested one', async () => {
    // moderation_db clamps to the ceiling, so what the write RETURNS is what the
    // account owes; echoing the request would count a live session down from a
    // number the row never held.
    const setAccountCheaterMark = vi.fn(async () => CHEATER_MARK_MAX_SECONDS);
    const applyCheaterMarkLive = vi.fn();
    authedAdminDb({ setAccountCheaterMark });
    configureAdminRuntime({ applyCheaterMarkLive } as unknown as AdminRuntime);

    const res = await runRoute(MARK_PATH, {
      body: { reason: REASON, seconds: CHEATER_MARK_MAX_SECONDS + 10_000 },
    });

    expect(res).toMatchObject({ status: 200, body: { success: true, data: { ok: true } } });
    expect(setAccountCheaterMark).toHaveBeenCalledWith({
      accountId: TARGET_ACCOUNT_ID,
      adminAccountId: ADMIN_ACCOUNT_ID,
      reason: REASON,
      seconds: CHEATER_MARK_MAX_SECONDS + 10_000,
    });
    expect(applyCheaterMarkLive).toHaveBeenCalledWith(TARGET_ACCOUNT_ID, CHEATER_MARK_MAX_SECONDS);
  });

  it('pushes the value the WRITE returned, never a second read that a burn could overtake', async () => {
    // Re-lengthening a live mark: the transaction stores 10800, but the account
    // is online and burning down, so a follow-up SELECT can be overtaken by the
    // save-path burn (guarded only by `cheater_mark_seconds > 0`) and answer
    // with the OLD remaining. The operator's correction would then vanish while
    // the API reported ok.
    //
    // The stale read is wired in as a NEGATIVE CONTROL: it is not a member of
    // the real db bundle any more, and a handler that reaches for one again both
    // calls it and pushes 42 instead of 10800, failing on two counts.
    const RELENGTHENED = 10_800;
    const staleReadAfterBurn = vi.fn(async () => 42);
    const setAccountCheaterMark = vi.fn(async () => RELENGTHENED);
    const applyCheaterMarkLive = vi.fn();
    authedAdminDb({ setAccountCheaterMark, accountCheaterMarkSeconds: staleReadAfterBurn });
    configureAdminRuntime({ applyCheaterMarkLive } as unknown as AdminRuntime);

    const res = await runRoute(MARK_PATH, { body: { reason: REASON, seconds: RELENGTHENED } });

    expect(res.status).toBe(200);
    expect(applyCheaterMarkLive).toHaveBeenCalledWith(TARGET_ACCOUNT_ID, RELENGTHENED);
    expect(staleReadAfterBurn).not.toHaveBeenCalled();
  });

  it('refuses an operator target with cheater_mark.admin_target and never writes', async () => {
    const setAccountCheaterMark = vi.fn(async () => 600);
    authedAdminDb({ setAccountCheaterMark });
    configureAdminRuntime({ applyCheaterMarkLive: vi.fn() } as unknown as AdminRuntime);

    const res = await runRoute(MARK_PATH, {
      accountId: ADMIN_ACCOUNT_ID,
      body: { reason: REASON, seconds: 600 },
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual(adminError('cheater_mark.admin_target'));
    expect(setAccountCheaterMark).not.toHaveBeenCalled();
  });

  it('422s a body missing the played-second budget before any write', async () => {
    const setAccountCheaterMark = vi.fn(async () => 600);
    authedAdminDb({ setAccountCheaterMark });
    configureAdminRuntime({ applyCheaterMarkLive: vi.fn() } as unknown as AdminRuntime);

    const res = await runRoute(MARK_PATH, { body: { reason: REASON } });

    expect(res.status).toBe(422);
    expect(res.body).toEqual(adminError('validation.failed'));
    expect(setAccountCheaterMark).not.toHaveBeenCalled();
  });

  it('surfaces the real blank-reason refusal as cheater_mark.reason_required', async () => {
    // setAccountCheaterMark is NOT faked here: the genuine moderation_db guard
    // runs (it refuses before pool.connect()), so this pins the write layer and
    // the route's code mapping together rather than a stubbed approximation.
    authedAdminDb();
    configureAdminRuntime({ applyCheaterMarkLive: vi.fn() } as unknown as AdminRuntime);

    const res = await runRoute(MARK_PATH, { body: { reason: '   ', seconds: 600 } });

    expect(res.status).toBe(400);
    expect(res.body).toEqual(adminError('cheater_mark.reason_required'));
  });

  it('surfaces the real non-positive-budget refusal as cheater_mark.invalid_duration', async () => {
    authedAdminDb();
    configureAdminRuntime({ applyCheaterMarkLive: vi.fn() } as unknown as AdminRuntime);

    const res = await runRoute(MARK_PATH, { body: { reason: REASON, seconds: 0 } });

    expect(res.status).toBe(400);
    expect(res.body).toEqual(adminError('cheater_mark.invalid_duration'));
  });

  it('404s a mistyped account id and does NOT push, since the route can reach one', async () => {
    // requireAdminTarget only decodes the :id into a positive integer, and the
    // operator-target guard's isAdminAccount answers false for an id with no
    // row, so a typo lands in the write. The write refuses, the operator gets a
    // fact they can act on, and nothing is pushed onto a live session.
    const applyCheaterMarkLive = vi.fn();
    authedAdminDb({
      setAccountCheaterMark: async () => {
        throw new CheaterMarkRefused('no_account');
      },
    });
    configureAdminRuntime({ applyCheaterMarkLive } as unknown as AdminRuntime);

    const res = await runRoute(MARK_PATH, { body: { reason: REASON, seconds: 600 } });

    expect(res.status).toBe(404);
    expect(res.body).toEqual(adminError('account.not_found'));
    expect(applyCheaterMarkLive).not.toHaveBeenCalled();
  });

  it('surfaces an unexpected write failure as the coded 500, leaking no prose', async () => {
    authedAdminDb({
      setAccountCheaterMark: async () => {
        throw new Error('relation "accounts" does not exist');
      },
    });
    configureAdminRuntime({ applyCheaterMarkLive: vi.fn() } as unknown as AdminRuntime);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await runRoute(MARK_PATH, { body: { reason: REASON, seconds: 600 } });

    expect(res.status).toBe(500);
    expect(res.body).toEqual(adminError('internal.error'));
    expect(JSON.stringify(res.body)).not.toContain('relation');
  });
});

describe('POST /admin/api/moderation/accounts/:id/lift-cheater-mark', () => {
  it('lifts the mark and pushes a zero budget', async () => {
    const liftAccountCheaterMark = vi.fn(async () => {});
    const applyCheaterMarkLive = vi.fn();
    authedAdminDb({ liftAccountCheaterMark });
    configureAdminRuntime({ applyCheaterMarkLive } as unknown as AdminRuntime);

    const res = await runRoute(LIFT_PATH, { body: { reason: 'appeal upheld' } });

    expect(res).toMatchObject({ status: 200, body: { success: true, data: { ok: true } } });
    expect(liftAccountCheaterMark).toHaveBeenCalledWith({
      accountId: TARGET_ACCOUNT_ID,
      adminAccountId: ADMIN_ACCOUNT_ID,
      reason: 'appeal upheld',
    });
    expect(applyCheaterMarkLive).toHaveBeenCalledWith(TARGET_ACCOUNT_ID, 0);
  });

  it('409s an unmarked account and does NOT push, so a live tag survives a failed lift', async () => {
    const applyCheaterMarkLive = vi.fn();
    authedAdminDb({
      liftAccountCheaterMark: async () => {
        throw new CheaterMarkRefused('not_marked');
      },
    });
    configureAdminRuntime({ applyCheaterMarkLive } as unknown as AdminRuntime);

    const res = await runRoute(LIFT_PATH, { body: { reason: 'appeal upheld' } });

    expect(res.status).toBe(409);
    expect(res.body).toEqual(adminError('cheater_mark.not_marked'));
    expect(applyCheaterMarkLive).not.toHaveBeenCalled();
  });

  it('refuses an operator target on the lift arm too', async () => {
    const liftAccountCheaterMark = vi.fn(async () => {});
    authedAdminDb({ liftAccountCheaterMark });
    configureAdminRuntime({ applyCheaterMarkLive: vi.fn() } as unknown as AdminRuntime);

    const res = await runRoute(LIFT_PATH, {
      accountId: ADMIN_ACCOUNT_ID,
      body: { reason: 'appeal upheld' },
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual(adminError('cheater_mark.admin_target'));
    expect(liftAccountCheaterMark).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The COSMETIC-ONLY guard.
//
// src/sim/moderation/CLAUDE.md holds the power-neutrality line inside the sim
// (tests/cheater_mark.test.ts pins the aura's zero value, its inert kind, and the
// absent stat-fold arm). This is the SERVER half of the same rule: the sanction
// is a visible tag, so applying or lifting it must reach no chat mute, no session
// teardown or token revocation, and no command or reward gate.
//
// It is behavioral, not a restatement of a constant: it runs both real routes and
// asserts on what they actually called. Wiring `rt.disconnectAccount(...)` or
// `adminDb().muteAccountChat(...)` into either handler turns it red.
// ---------------------------------------------------------------------------

/**
 * A runtime whose EVERY member records its own name when called, built with a
 * Proxy rather than a hand-listed fake so a FUTURE AdminRuntime member (a new
 * kick, mute, or disconnect hook) is covered the day it is added. A hand-listed
 * recorder would silently stop guarding the members it had never heard of.
 */
function recordingRuntime(): { calls: string[]; runtime: Record<string, () => void> } {
  const calls: string[] = [];
  const runtime = new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop === 'symbol') return undefined;
        return (..._args: unknown[]): undefined => {
          calls.push(prop);
          return undefined;
        };
      },
    },
  ) as Record<string, () => void>;
  configureAdminRuntime(runtime as unknown as AdminRuntime);
  return { calls, runtime };
}

describe('the Cheater mark is cosmetic only (server side)', () => {
  it('applying and lifting it touch no chat, session, or command-gating path', async () => {
    const { calls } = recordingRuntime();
    // Every db member that mutes chat, ends a session, revokes credentials, or
    // gates participation. Each is a spy rather than a thrower so a regression
    // reports as a named assertion instead of an opaque 500.
    const restrictions = {
      muteAccountChat: vi.fn(async () => {}),
      liftAccountChatMute: vi.fn(async () => {}),
      resetChatStrikesAudited: vi.fn(async () => {}),
      moderateAccount: vi.fn(async () => {}),
      reactivateAccountAudited: vi.fn(async () => {}),
      revokeTokensExcept: vi.fn(async () => {}),
      setDailyRewardsBan: vi.fn(async () => {}),
      setDailyRewardsIpBan: vi.fn(async () => {}),
      forceCharacterRename: vi.fn(async () => {}),
      addBlockedIp: vi.fn(async () => {}),
      accountMailTarget: vi.fn(async () => null),
      emailSecurityIncident: vi.fn(async () => {}),
    };
    authedAdminDb({
      setAccountCheaterMark: async () => 600,
      liftAccountCheaterMark: async () => {},
      ...restrictions,
    });

    const marked = await runRoute(MARK_PATH, { body: { reason: REASON, seconds: 600 } });
    const lifted = await runRoute(LIFT_PATH, { body: { reason: 'appeal upheld' } });
    expect(marked.status).toBe(200);
    expect(lifted.status).toBe(200);

    // The ONLY live side effect either arm is allowed is the cosmetic tag push.
    expect(calls).toEqual(['applyCheaterMarkLive', 'applyCheaterMarkLive']);
    for (const [name, spy] of Object.entries(restrictions)) {
      expect(spy, `${name} must never run for a Cheater mark`).not.toHaveBeenCalled();
    }
  });

  it('the negative control: the guard detects a restriction wired into the chain', async () => {
    // Proves the sweep above is not vacuous. A synthetic middleware stands in for
    // a future edit that reaches for a restriction from inside the mark's chain,
    // and BOTH halves of the guard (the runtime recorder and the db spies) catch
    // it: without this control, an assertion that nothing was called could pass
    // simply because the recorders were never wired to anything.
    const { calls, runtime } = recordingRuntime();
    const muteAccountChat = vi.fn(async () => {});
    authedAdminDb({
      setAccountCheaterMark: async () => 600,
      muteAccountChat,
    });
    const route = routeFor(MARK_PATH);
    const restricting: Middleware = async (_ctx, next) => {
      await muteAccountChat();
      runtime.disconnectAccount();
      await next();
    };
    const ctx = fakeCtx({
      method: 'POST',
      url: MARK_PATH.replace(':id', String(TARGET_ACCOUNT_ID)),
      headers: { authorization: BEARER },
      params: { id: String(TARGET_ACCOUNT_ID) },
      body: { reason: REASON, seconds: 600 },
    });
    await compose([
      withErrors({ surface: route.meta?.envelope }),
      ...(route.middleware ?? []),
      restricting,
      async (c) => {
        await route.handler(c);
      },
    ])(ctx);

    expect(readRes(ctx.res).status).toBe(200);
    expect(muteAccountChat).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['disconnectAccount', 'applyCheaterMarkLive']);
  });
});
