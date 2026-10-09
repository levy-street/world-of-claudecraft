// Unit coverage for the world quest block's admin API pair (server/admin.ts
// worldQuestBlockHandler) and its host-agnostic contract module
// (server/world_quest_block_api.ts). Registry-only RouteDefs like the Cheater
// mark pair: a typed schema decodes the body, and every refusal is a stable
// `world_quest_block.*` code. Pins the refusal mapping, both happy paths and their
// live push, the operator-target guard on both arms, the 422 shape gate, the real
// blank-reason refusal, and that a refused write never pushes onto a session.
//
// server/db.ts builds a pg Pool at module load and throws if DATABASE_URL is
// unset; admin.ts imports it, so set a dummy URL. The pool never connects.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_world_quest_block_admin';

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
import { compose } from '../../server/http/compose';
import { HttpError } from '../../server/http/errors';
import { withErrors } from '../../server/http/middleware/with_errors';
import type { Method, Middleware } from '../../server/http/types';
import {
  rethrowWorldQuestBlockRefusal,
  WORLD_QUEST_BLOCK_REFUSALS,
  WorldQuestBlockRefused,
  worldQuestBlockBodySchema,
} from '../../server/world_quest_block_api';
import { type FakeRes, fakeCtx } from './helpers';

const BLOCK_PATH = '/admin/api/moderation/accounts/:id/world-quests-block';
const UNBLOCK_PATH = '/admin/api/moderation/accounts/:id/world-quests-unblock';

const BEARER = `Bearer ${'a'.repeat(64)}`;
const ADMIN_ACCOUNT_ID = 7;
const TARGET_ACCOUNT_ID = 42;
const REASON = 'world quest bot: 24h circuits from one proxy';

type DbOverrides = Record<string, unknown>;

function authedAdminDb(overrides: DbOverrides = {}): void {
  setAdminDbForTests({
    accountAndScopeForToken: async () => ({ accountId: ADMIN_ACCOUNT_ID, scope: 'full' as const }),
    adminRolesForAccount: async (id: number) =>
      id === ADMIN_ACCOUNT_ID ? { username: 'op', roles: ['superadmin'] } : null,
    isAdminAccount: async (id: number) => id === ADMIN_ACCOUNT_ID,
    ...overrides,
  } as Parameters<typeof setAdminDbForTests>[0]);
}

function readRes(res: http.ServerResponse): { status: number; body: unknown } {
  const fake = res as unknown as FakeRes;
  return { status: fake.statusCode, body: fake.body ? JSON.parse(fake.body) : undefined };
}

function routeFor(path: string) {
  const route = routes.find((r) => r.method === 'POST' && r.path === path);
  if (!route) throw new Error(`no route POST ${path}`);
  return route;
}

/** Drive the route's REAL middleware chain plus its handler under withErrors. */
async function runRoute(
  path: string,
  opts: { body?: unknown; accountId?: number } = {},
): Promise<{ status: number; body: unknown }> {
  const route = routeFor(path);
  const id = String(opts.accountId ?? TARGET_ACCOUNT_ID);
  const terminal: Middleware = async (c) => {
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
  return readRes(ctx.res);
}

const adminError = (code: string) => ({ success: false, data: null, error: code });

function liveRuntime() {
  const applyWorldQuestBlockLive = vi.fn();
  configureAdminRuntime({ applyWorldQuestBlockLive } as unknown as AdminRuntime);
  return applyWorldQuestBlockLive;
}

afterEach(() => {
  resetAdminDbForTests();
  resetAdminRuntimeForTests();
  vi.restoreAllMocks();
});

describe('world quest block contract (server/world_quest_block_api.ts)', () => {
  it('maps every refusal token to a distinct stable code and status', () => {
    const mapped = WORLD_QUEST_BLOCK_REFUSALS.map((refusal) => {
      try {
        rethrowWorldQuestBlockRefusal(new WorldQuestBlockRefused(refusal));
      } catch (err) {
        return err as HttpError;
      }
      throw new Error(`rethrowWorldQuestBlockRefusal did not throw for ${refusal}`);
    });
    expect(mapped.map((e) => e.code)).toEqual([
      'world_quest_block.reason_required',
      'world_quest_block.already_blocked',
      'world_quest_block.not_blocked',
      'account.not_found',
    ]);
    expect(mapped.map((e) => e.status)).toEqual([400, 409, 409, 404]);
  });

  it('passes a non-refusal through unchanged, so a driver error still becomes a 500', () => {
    const driverError = new Error('connection terminated');
    expect(() => rethrowWorldQuestBlockRefusal(driverError)).toThrow(driverError);
    try {
      rethrowWorldQuestBlockRefusal(driverError);
    } catch (err) {
      expect(err).not.toBeInstanceOf(HttpError);
    }
  });

  it('decodes a reason and rejects a missing or wrong-typed one', () => {
    expect(worldQuestBlockBodySchema.decode({ reason: REASON })).toEqual({
      ok: true,
      value: { reason: REASON },
    });
    expect(worldQuestBlockBodySchema.decode({}).ok).toBe(false);
    expect(worldQuestBlockBodySchema.decode({ reason: 5 }).ok).toBe(false);
  });
});

describe('POST /admin/api/moderation/accounts/:id/world-quests-block', () => {
  it('blocks the account through the audited write, then pushes the block live', async () => {
    const setAccountWorldQuestBlock = vi.fn(async () => {});
    const liftAccountWorldQuestBlock = vi.fn(async () => {});
    authedAdminDb({ setAccountWorldQuestBlock, liftAccountWorldQuestBlock });
    const applyLive = liveRuntime();

    const res = await runRoute(BLOCK_PATH, { body: { reason: REASON } });

    expect(res).toMatchObject({ status: 200, body: { success: true, data: { ok: true } } });
    expect(setAccountWorldQuestBlock).toHaveBeenCalledWith({
      accountId: TARGET_ACCOUNT_ID,
      adminAccountId: ADMIN_ACCOUNT_ID,
      reason: REASON,
    });
    expect(liftAccountWorldQuestBlock).not.toHaveBeenCalled();
    expect(applyLive).toHaveBeenCalledWith(TARGET_ACCOUNT_ID, true);
  });

  it('refuses an operator target with world_quest_block.admin_target and never writes', async () => {
    const setAccountWorldQuestBlock = vi.fn(async () => {});
    authedAdminDb({ setAccountWorldQuestBlock });
    const applyLive = liveRuntime();

    const res = await runRoute(BLOCK_PATH, {
      accountId: ADMIN_ACCOUNT_ID,
      body: { reason: REASON },
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual(adminError('world_quest_block.admin_target'));
    expect(setAccountWorldQuestBlock).not.toHaveBeenCalled();
    expect(applyLive).not.toHaveBeenCalled();
  });

  it('422s a body with no reason before any write', async () => {
    const setAccountWorldQuestBlock = vi.fn(async () => {});
    authedAdminDb({ setAccountWorldQuestBlock });
    liveRuntime();

    const res = await runRoute(BLOCK_PATH, { body: {} });

    expect(res.status).toBe(422);
    expect(res.body).toEqual(adminError('validation.failed'));
    expect(setAccountWorldQuestBlock).not.toHaveBeenCalled();
  });

  it('surfaces the real blank-reason refusal as world_quest_block.reason_required', async () => {
    // setAccountWorldQuestBlock is NOT faked: the genuine guard refuses before
    // pool.connect(), so this pins the write layer and the code mapping together.
    authedAdminDb();
    const applyLive = liveRuntime();

    const res = await runRoute(BLOCK_PATH, { body: { reason: '   ' } });

    expect(res.status).toBe(400);
    expect(res.body).toEqual(adminError('world_quest_block.reason_required'));
    expect(applyLive).not.toHaveBeenCalled();
  });

  it('409s an account already blocked and does not push', async () => {
    authedAdminDb({
      setAccountWorldQuestBlock: async () => {
        throw new WorldQuestBlockRefused('already_blocked');
      },
    });
    const applyLive = liveRuntime();

    const res = await runRoute(BLOCK_PATH, { body: { reason: REASON } });

    expect(res.status).toBe(409);
    expect(res.body).toEqual(adminError('world_quest_block.already_blocked'));
    expect(applyLive).not.toHaveBeenCalled();
  });

  it('404s a mistyped account id and does not push', async () => {
    authedAdminDb({
      setAccountWorldQuestBlock: async () => {
        throw new WorldQuestBlockRefused('no_account');
      },
    });
    const applyLive = liveRuntime();

    const res = await runRoute(BLOCK_PATH, { body: { reason: REASON } });

    expect(res.status).toBe(404);
    expect(res.body).toEqual(adminError('account.not_found'));
    expect(applyLive).not.toHaveBeenCalled();
  });

  it('surfaces an unexpected write failure as the coded 500, leaking no prose', async () => {
    authedAdminDb({
      setAccountWorldQuestBlock: async () => {
        throw new Error('relation "accounts" does not exist');
      },
    });
    const applyLive = liveRuntime();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await runRoute(BLOCK_PATH, { body: { reason: REASON } });

    expect(res.status).toBe(500);
    expect(res.body).toEqual(adminError('internal.error'));
    expect(JSON.stringify(res.body)).not.toContain('relation');
    expect(applyLive).not.toHaveBeenCalled();
  });
});

describe('POST /admin/api/moderation/accounts/:id/world-quests-unblock', () => {
  it('lifts the block through the audited write, then pushes the lift live', async () => {
    const setAccountWorldQuestBlock = vi.fn(async () => {});
    const liftAccountWorldQuestBlock = vi.fn(async () => {});
    authedAdminDb({ setAccountWorldQuestBlock, liftAccountWorldQuestBlock });
    const applyLive = liveRuntime();

    const res = await runRoute(UNBLOCK_PATH, { body: { reason: 'appeal upheld' } });

    expect(res).toMatchObject({ status: 200, body: { success: true, data: { ok: true } } });
    expect(liftAccountWorldQuestBlock).toHaveBeenCalledWith({
      accountId: TARGET_ACCOUNT_ID,
      adminAccountId: ADMIN_ACCOUNT_ID,
      reason: 'appeal upheld',
    });
    expect(setAccountWorldQuestBlock).not.toHaveBeenCalled();
    expect(applyLive).toHaveBeenCalledWith(TARGET_ACCOUNT_ID, false);
  });

  it('409s an account that is not blocked and does not push', async () => {
    authedAdminDb({
      liftAccountWorldQuestBlock: async () => {
        throw new WorldQuestBlockRefused('not_blocked');
      },
    });
    const applyLive = liveRuntime();

    const res = await runRoute(UNBLOCK_PATH, { body: { reason: 'appeal upheld' } });

    expect(res.status).toBe(409);
    expect(res.body).toEqual(adminError('world_quest_block.not_blocked'));
    expect(applyLive).not.toHaveBeenCalled();
  });

  it('applies the operator-target guard to the lift arm too', async () => {
    const liftAccountWorldQuestBlock = vi.fn(async () => {});
    authedAdminDb({ liftAccountWorldQuestBlock });
    liveRuntime();

    const res = await runRoute(UNBLOCK_PATH, {
      accountId: ADMIN_ACCOUNT_ID,
      body: { reason: 'appeal upheld' },
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual(adminError('world_quest_block.admin_target'));
    expect(liftAccountWorldQuestBlock).not.toHaveBeenCalled();
  });
});
