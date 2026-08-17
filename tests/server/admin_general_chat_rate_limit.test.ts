process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_general_chat_admin';

import { EventEmitter } from 'node:events';
import type * as http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/db')>();
  return { ...actual, accountAndScopeForToken: vi.fn() };
});
vi.mock('../../server/staff_db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/staff_db')>();
  return { ...actual, adminRolesForAccount: vi.fn() };
});
vi.mock('../../server/admin_db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/admin_db')>();
  return { ...actual, accountDetail: vi.fn() };
});

import {
  type AdminRuntime,
  configureAdminRuntime,
  handleAdminApi,
  resetAdminDbForTests,
  resetAdminGeneralChatRateLimitDepsForTests,
  resetAdminRuntimeForTests,
  routes,
  setAdminGeneralChatRateLimitDepsForTests,
} from '../../server/admin';
import { accountDetail } from '../../server/admin_db';
import {
  type AdminGeneralChatRateLimitDeps,
  createAdminGeneralChatRateLimitService,
  GENERAL_CHAT_RATE_LIMIT_ADMIN_TARGET,
  GENERAL_CHAT_RATE_LIMIT_MESSAGES_INVALID,
  GENERAL_CHAT_RATE_LIMIT_REASON_REQUIRED,
  GENERAL_CHAT_RATE_LIMIT_REQUIRED,
  GENERAL_CHAT_RATE_LIMIT_WINDOW_INVALID,
} from '../../server/admin_general_chat_rate_limit';
import { accountAndScopeForToken } from '../../server/db';
import {
  GeneralChatQuotaAccountNotFoundError,
  GeneralChatQuotaValidationError,
} from '../../server/general_chat_quota_db';
import { compose } from '../../server/http/compose';
import { withErrors } from '../../server/http/middleware/with_errors';
import type { Method, Middleware } from '../../server/http/types';
import { adminRolesForAccount } from '../../server/staff_db';
import { type FakeRes, fakeCtx } from './helpers';

function makeService({ adminTarget = false } = {}) {
  const set = vi.fn(async (input) => ({
    before: null,
    after: input.rateLimit,
    changed: true,
  }));
  const isAdminAccount = vi.fn(async () => adminTarget);
  return {
    set,
    isAdminAccount,
    service: createAdminGeneralChatRateLimitService({ set, isAdminAccount }),
  };
}

describe('admin General chat rate limit service', () => {
  it('passes the trimmed, bounded policy and acting operator to the atomic audited setter', async () => {
    const { service, set } = makeService();
    const result = await service.update({
      accountId: 42,
      adminAccountId: 7,
      body: {
        rateLimit: { messages: 1000, windowMinutes: 1440 },
        reason: '  repeated realm spam  ',
      },
    });

    expect(result).toEqual({
      ok: true,
      value: {
        before: null,
        after: { messages: 1000, windowMinutes: 1440 },
        changed: true,
      },
    });
    expect(set).toHaveBeenCalledOnce();
    expect(set).toHaveBeenCalledWith({
      accountId: 42,
      adminAccountId: 7,
      rateLimit: { messages: 1000, windowMinutes: 1440 },
      reason: 'repeated realm spam',
    });
  });

  it('accepts an explicit null removal and preserves an unchanged idempotent result', async () => {
    const { service, set } = makeService();
    set.mockResolvedValueOnce({ before: null, after: null, changed: false });

    await expect(
      service.update({
        accountId: 42,
        adminAccountId: 7,
        body: { rateLimit: null, reason: 'restriction already removed' },
      }),
    ).resolves.toEqual({
      ok: true,
      value: { before: null, after: null, changed: false },
    });
    expect(set).toHaveBeenCalledOnce();
  });

  it('accepts the exact lower policy bounds and 500-character reason bound', async () => {
    const { service, set } = makeService();
    const reason = 'x'.repeat(500);

    await expect(
      service.update({
        accountId: 42,
        adminAccountId: 7,
        body: { rateLimit: { messages: 1, windowMinutes: 1 }, reason },
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(set).toHaveBeenCalledWith({
      accountId: 42,
      adminAccountId: 7,
      rateLimit: { messages: 1, windowMinutes: 1 },
      reason,
    });
  });

  it.each([
    [{}, GENERAL_CHAT_RATE_LIMIT_REQUIRED],
    [{ rateLimit: undefined, reason: 'reviewed' }, GENERAL_CHAT_RATE_LIMIT_REQUIRED],
    [{ rateLimit: [], reason: 'reviewed' }, GENERAL_CHAT_RATE_LIMIT_REQUIRED],
    [
      { rateLimit: { messages: 0, windowMinutes: 1 }, reason: 'reviewed' },
      GENERAL_CHAT_RATE_LIMIT_MESSAGES_INVALID,
    ],
    [
      { rateLimit: { messages: 1001, windowMinutes: 1 }, reason: 'reviewed' },
      GENERAL_CHAT_RATE_LIMIT_MESSAGES_INVALID,
    ],
    [
      { rateLimit: { messages: 1.5, windowMinutes: 1 }, reason: 'reviewed' },
      GENERAL_CHAT_RATE_LIMIT_MESSAGES_INVALID,
    ],
    [
      { rateLimit: { messages: '1', windowMinutes: 1 }, reason: 'reviewed' },
      GENERAL_CHAT_RATE_LIMIT_MESSAGES_INVALID,
    ],
    [
      { rateLimit: { messages: 1, windowMinutes: 0 }, reason: 'reviewed' },
      GENERAL_CHAT_RATE_LIMIT_WINDOW_INVALID,
    ],
    [
      { rateLimit: { messages: 1, windowMinutes: 1441 }, reason: 'reviewed' },
      GENERAL_CHAT_RATE_LIMIT_WINDOW_INVALID,
    ],
    [
      { rateLimit: { messages: 1, windowMinutes: 1.5 }, reason: 'reviewed' },
      GENERAL_CHAT_RATE_LIMIT_WINDOW_INVALID,
    ],
    [
      { rateLimit: { messages: 1, windowMinutes: '1' }, reason: 'reviewed' },
      GENERAL_CHAT_RATE_LIMIT_WINDOW_INVALID,
    ],
    [
      { rateLimit: { messages: 1, windowMinutes: 1 }, reason: '   ' },
      GENERAL_CHAT_RATE_LIMIT_REASON_REQUIRED,
    ],
    [
      { rateLimit: { messages: 1, windowMinutes: 1 }, reason: 'x'.repeat(501) },
      GENERAL_CHAT_RATE_LIMIT_REASON_REQUIRED,
    ],
  ])('rejects invalid input before any database call', async (body, error) => {
    const { service, set } = makeService();

    await expect(service.update({ accountId: 42, adminAccountId: 7, body })).resolves.toEqual({
      ok: false,
      status: 400,
      error,
    });
    expect(set).not.toHaveBeenCalled();
  });

  it('refuses configuring a quota on an admin target, matching the chat-mute staff shield', async () => {
    const { service, set, isAdminAccount } = makeService({ adminTarget: true });

    await expect(
      service.update({
        accountId: 42,
        adminAccountId: 7,
        body: { rateLimit: { messages: 3, windowMinutes: 5 }, reason: 'reviewed' },
      }),
    ).resolves.toEqual({
      ok: false,
      status: 400,
      error: GENERAL_CHAT_RATE_LIMIT_ADMIN_TARGET,
    });
    expect(isAdminAccount).toHaveBeenCalledWith(42);
    expect(set).not.toHaveBeenCalled();
  });

  it('still clears a quota from an admin target, so a pre-promotion policy can be lifted', async () => {
    const { service, set } = makeService({ adminTarget: true });

    await expect(
      service.update({
        accountId: 42,
        adminAccountId: 7,
        body: { rateLimit: null, reason: 'promoted to staff' },
      }),
    ).resolves.toEqual({
      ok: true,
      value: { before: null, after: null, changed: true },
    });
    expect(set).toHaveBeenCalledOnce();
  });

  it('maps an unrepresentable account id to the same 404 as a missing account', async () => {
    const { service, set, isAdminAccount } = makeService();

    await expect(
      service.update({
        accountId: Number.MAX_SAFE_INTEGER + 1,
        adminAccountId: 7,
        body: { rateLimit: { messages: 3, windowMinutes: 5 }, reason: 'reviewed' },
      }),
    ).resolves.toEqual({ ok: false, status: 404, error: 'account not found' });
    expect(isAdminAccount).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it('maps defensive domain errors but lets an unexpected DB failure reach the 500 boundary', async () => {
    const { service, set } = makeService();
    const input = {
      accountId: 42,
      adminAccountId: 7,
      body: {
        rateLimit: { messages: 3, windowMinutes: 5 },
        reason: 'slow mode',
      },
    };

    set.mockRejectedValueOnce(new GeneralChatQuotaValidationError('invalid policy'));
    await expect(service.update(input)).resolves.toEqual({
      ok: false,
      status: 400,
      error: 'invalid policy',
    });

    set.mockRejectedValueOnce(new GeneralChatQuotaAccountNotFoundError());
    await expect(service.update(input)).resolves.toEqual({
      ok: false,
      status: 404,
      error: 'account not found',
    });

    set.mockRejectedValueOnce(new Error('connection terminated'));
    await expect(service.update(input)).rejects.toThrow('connection terminated');
    expect(set).toHaveBeenCalledTimes(3);
  });
});

const BEARER_TOKEN = 'a'.repeat(64);
const ADMIN_ACCOUNT_ID = 7;
const ACCOUNT_ID = 42;
const PATH = `/admin/api/accounts/${ACCOUNT_ID}/general-chat-rate-limit`;
const TEMPLATE = '/admin/api/accounts/:id/general-chat-rate-limit';

function legacyReq(options: { method?: string; url?: string; body?: unknown } = {}) {
  const req = new EventEmitter() as EventEmitter & {
    method: string;
    url: string;
    headers: { authorization: string };
    socket: { remoteAddress: string };
  };
  req.method = options.method ?? 'POST';
  req.url = options.url ?? PATH;
  req.headers = { authorization: `Bearer ${BEARER_TOKEN}` };
  req.socket = { remoteAddress: '127.0.0.1' };
  if (req.method === 'POST') {
    setImmediate(() => {
      if (options.body !== undefined) req.emit('data', JSON.stringify(options.body));
      req.emit('end');
    });
  }
  return req as unknown as http.IncomingMessage;
}

function legacyRes(): http.ServerResponse & { statusCode: number; body: unknown } {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    writeHead(status: number) {
      this.statusCode = status;
    },
    end(data?: string) {
      this.body = data ? JSON.parse(data) : null;
    },
  };
  return res as unknown as http.ServerResponse & { statusCode: number; body: unknown };
}

const applyGeneralChatRateLimitLiveLegacy = vi.fn();
const game = {
  liveAccountIds: () => new Set([ACCOUNT_ID]),
  applyGeneralChatRateLimitLive: applyGeneralChatRateLimitLiveLegacy,
} as unknown as Parameters<typeof handleAdminApi>[2];

function routeFor(method: Method, path: string) {
  const route = routes.find((entry) => entry.method === method && entry.path === path);
  if (!route) throw new Error(`no route ${method} ${path}`);
  return route;
}

async function runRoute(options: { method?: Method; url?: string; body?: unknown } = {}) {
  const method = options.method ?? 'POST';
  const path = method === 'POST' ? TEMPLATE : '/admin/api/accounts/:id';
  const route = routeFor(method, path);
  const ctx = fakeCtx({
    method,
    url: options.url ?? (method === 'POST' ? PATH : `/admin/api/accounts/${ACCOUNT_ID}`),
    headers: { authorization: `Bearer ${BEARER_TOKEN}` },
    body: options.body,
    params: { id: String(ACCOUNT_ID) },
  });
  const terminal: Middleware = async (current) => {
    await route.handler(current);
  };
  await compose([
    withErrors({ surface: route.meta?.envelope }),
    ...(route.middleware ?? []),
    terminal,
  ])(ctx);
  const res = ctx.res as unknown as FakeRes;
  return { status: res.statusCode, body: JSON.parse(res.body) as unknown };
}

async function runLegacy(options: { method?: string; url?: string; body?: unknown } = {}) {
  const res = legacyRes();
  await handleAdminApi(legacyReq(options), res, game);
  return { status: res.statusCode, body: res.body };
}

let setPolicy: ReturnType<typeof vi.fn<AdminGeneralChatRateLimitDeps['set']>>;
let isAdminTarget: ReturnType<typeof vi.fn<AdminGeneralChatRateLimitDeps['isAdminAccount']>>;
let applyGeneralChatRateLimitLive: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.mocked(accountAndScopeForToken).mockResolvedValue({
    accountId: ADMIN_ACCOUNT_ID,
    scope: 'full',
  });
  vi.mocked(adminRolesForAccount).mockResolvedValue({
    username: 'operator',
    roles: ['moderator'],
  });
  setPolicy = vi.fn<AdminGeneralChatRateLimitDeps['set']>(async (input) => ({
    before: null,
    after: input.rateLimit,
    changed: true,
  }));
  isAdminTarget = vi.fn<AdminGeneralChatRateLimitDeps['isAdminAccount']>(async () => false);
  setAdminGeneralChatRateLimitDepsForTests({ set: setPolicy, isAdminAccount: isAdminTarget });
  applyGeneralChatRateLimitLive = vi.fn();
  configureAdminRuntime({
    liveAccountIds: vi.fn(() => new Set([ACCOUNT_ID])),
    applyGeneralChatRateLimitLive,
  } as unknown as AdminRuntime);
});

afterEach(() => {
  resetAdminDbForTests();
  resetAdminGeneralChatRateLimitDepsForTests();
  resetAdminRuntimeForTests();
  vi.clearAllMocks();
});

describe('General chat rate limit admin endpoint integration', () => {
  it('serves the same audited, idempotent success through both dispatch arms', async () => {
    setPolicy
      .mockResolvedValueOnce({
        before: null,
        after: { messages: 3, windowMinutes: 5 },
        changed: true,
      })
      .mockResolvedValueOnce({
        before: { messages: 3, windowMinutes: 5 },
        after: { messages: 3, windowMinutes: 5 },
        changed: false,
      });
    const body = {
      rateLimit: { messages: 3, windowMinutes: 5 },
      reason: '  repeated spam  ',
    };

    const legacy = await runLegacy({ body });
    const routed = await runRoute({ body });

    const success = { success: true, data: { ok: true }, error: null };
    expect(legacy).toEqual({ status: 200, body: success });
    expect(routed).toEqual({ status: 200, body: success });
    expect(setPolicy).toHaveBeenCalledTimes(2);
    expect(setPolicy).toHaveBeenNthCalledWith(1, {
      accountId: ACCOUNT_ID,
      adminAccountId: ADMIN_ACCOUNT_ID,
      rateLimit: { messages: 3, windowMinutes: 5 },
      reason: 'repeated spam',
    });
    expect(setPolicy).toHaveBeenNthCalledWith(2, {
      accountId: ACCOUNT_ID,
      adminAccountId: ADMIN_ACCOUNT_ID,
      rateLimit: { messages: 3, windowMinutes: 5 },
      reason: 'repeated spam',
    });
    expect(applyGeneralChatRateLimitLiveLegacy).toHaveBeenCalledWith(ACCOUNT_ID, {
      messages: 3,
      windowMinutes: 5,
    });
    expect(applyGeneralChatRateLimitLive).toHaveBeenCalledWith(ACCOUNT_ID, {
      messages: 3,
      windowMinutes: 5,
    });
    expect(setPolicy.mock.invocationCallOrder[0]).toBeLessThan(
      applyGeneralChatRateLimitLiveLegacy.mock.invocationCallOrder[0],
    );
    expect(setPolicy.mock.invocationCallOrder[1]).toBeLessThan(
      applyGeneralChatRateLimitLive.mock.invocationCallOrder[0],
    );
  });

  it('refuses configuring a quota on an admin target through both arms', async () => {
    isAdminTarget.mockResolvedValue(true);
    const body = {
      rateLimit: { messages: 3, windowMinutes: 5 },
      reason: 'reviewed',
    };

    const legacy = await runLegacy({ body });
    const routed = await runRoute({ body });

    const refused = {
      success: false,
      data: null,
      error: GENERAL_CHAT_RATE_LIMIT_ADMIN_TARGET,
    };
    expect(legacy).toEqual({ status: 400, body: refused });
    expect(routed).toEqual({ status: 400, body: refused });
    expect(setPolicy).not.toHaveBeenCalled();
    expect(applyGeneralChatRateLimitLiveLegacy).not.toHaveBeenCalled();
    expect(applyGeneralChatRateLimitLive).not.toHaveBeenCalled();
  });

  it('maps an unrepresentable legacy-arm account id to 404, matching a missing account', async () => {
    const legacy = await runLegacy({
      url: '/admin/api/accounts/9007199254740993/general-chat-rate-limit',
      body: { rateLimit: { messages: 3, windowMinutes: 5 }, reason: 'reviewed' },
    });

    expect(legacy).toEqual({
      status: 404,
      body: { success: false, data: null, error: 'account not found' },
    });
    expect(setPolicy).not.toHaveBeenCalled();
    expect(applyGeneralChatRateLimitLiveLegacy).not.toHaveBeenCalled();
  });

  it('enforces moderation.act through both central permission gates', async () => {
    vi.mocked(adminRolesForAccount).mockResolvedValue({
      username: 'viewer',
      roles: ['viewer'],
    });

    const legacy = await runLegacy({ body: { rateLimit: null, reason: 'reviewed' } });
    const routed = await runRoute({ body: { rateLimit: null, reason: 'reviewed' } });

    const denied = {
      success: false,
      data: null,
      error: 'you do not have permission to do this',
    };
    expect(legacy).toEqual({ status: 403, body: denied });
    expect(routed).toEqual({ status: 403, body: denied });
    expect(setPolicy).not.toHaveBeenCalled();
  });

  it('rejects invalid bounds before persistence through both arms', async () => {
    const body = {
      rateLimit: { messages: 1001, windowMinutes: 1 },
      reason: 'reviewed',
    };

    const legacy = await runLegacy({ body });
    const routed = await runRoute({ body });

    const invalid = {
      success: false,
      data: null,
      error: GENERAL_CHAT_RATE_LIMIT_MESSAGES_INVALID,
    };
    expect(legacy).toEqual({ status: 400, body: invalid });
    expect(routed).toEqual({ status: 400, body: invalid });
    expect(setPolicy).not.toHaveBeenCalled();
  });

  it('stops at the failed durable setter and reaches each arm 500 boundary', async () => {
    setPolicy.mockRejectedValue(new Error('database unavailable'));
    const body = { rateLimit: null, reason: 'restriction expired' };

    const legacy = await runLegacy({ body });
    const routed = await runRoute({ body });

    expect(legacy).toEqual({
      status: 500,
      body: { success: false, data: null, error: 'internal error' },
    });
    expect(routed).toEqual({
      status: 500,
      body: { success: false, data: null, error: 'internal.error' },
    });
    expect(setPolicy).toHaveBeenCalledTimes(2);
    expect(applyGeneralChatRateLimitLiveLegacy).not.toHaveBeenCalled();
    expect(applyGeneralChatRateLimitLive).not.toHaveBeenCalled();
  });

  it('maps the current policy into both account-detail arms', async () => {
    vi.mocked(accountDetail).mockResolvedValue({
      id: ACCOUNT_ID,
      username: 'target',
      generalChatRateLimit: { messages: 5, windowMinutes: 2 },
    } as never);

    const legacy = await runLegacy({
      method: 'GET',
      url: `/admin/api/accounts/${ACCOUNT_ID}`,
    });
    const routed = await runRoute({
      method: 'GET',
      url: `/admin/api/accounts/${ACCOUNT_ID}`,
    });

    const data = {
      id: ACCOUNT_ID,
      username: 'target',
      generalChatRateLimit: { messages: 5, windowMinutes: 2 },
      online: true,
    };
    expect(legacy).toEqual({ status: 200, body: { success: true, data, error: null } });
    expect(routed).toEqual({ status: 200, body: { success: true, data, error: null } });
    expect(accountDetail).toHaveBeenCalledTimes(2);
  });
});
