// Legacy-arm coverage for the flag status transition failures: the flag-off
// rollback path (API_DISPATCH=legacy) serves POST /admin/api/flags/:id/status
// from the inline handleAdminApi ladder in server/admin.ts, not the RouteDef
// table tests/server/admin_oversight.test.ts drives. Both arms route the store's
// refusal through one shared mapper, and this pins the legacy arm's call to it:
// 400 for a refused transition, 409 for an active-sibling collision, 404 for a
// missing flag. Harness: the tests/server/admin_overview_cache_arms.test.ts idiom.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_flag_transition_legacy';

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
vi.mock('../../server/suspicion_flags_db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/suspicion_flags_db')>();
  return { ...actual, transitionSuspicionFlag: vi.fn() };
});

import { handleAdminApi } from '../../server/admin';
import { accountAndScopeForToken } from '../../server/db';
import {
  resetAdminOversightRateLimits,
  resetRateLimitClock,
  resetRateLimits,
  setRateLimitClock,
} from '../../server/ratelimit';
import { adminRolesForAccount } from '../../server/staff_db';
import { transitionSuspicionFlag } from '../../server/suspicion_flags_db';

const VALID_TOKEN = 'a'.repeat(64);

function fakeReq(body: unknown): http.IncomingMessage {
  const req = new EventEmitter() as EventEmitter & {
    method: string;
    url: string;
    headers: { authorization?: string };
    socket: { remoteAddress: string };
  };
  req.method = 'POST';
  req.url = '/admin/api/flags/11/status';
  req.headers = { authorization: `Bearer ${VALID_TOKEN}` };
  req.socket = { remoteAddress: '10.0.0.1' };
  setImmediate(() => {
    req.emit('data', JSON.stringify(body));
    req.emit('end');
  });
  return req as unknown as http.IncomingMessage;
}

interface LegacyRes {
  statusCode: number;
  body: unknown;
  writeHead(status: number): void;
  end(data?: string): void;
}

function legacyRes(): LegacyRes & http.ServerResponse {
  const res: LegacyRes = {
    statusCode: 0,
    body: undefined,
    writeHead(status: number) {
      this.statusCode = status;
    },
    end(data?: string) {
      this.body = data ? JSON.parse(data) : null;
    },
  };
  return res as LegacyRes & http.ServerResponse;
}

// The route never touches the game server; a stub that throws on any member
// access pins that.
const fakeGame = new Proxy(
  {},
  {
    get(_target, prop) {
      throw new Error(`flag transition touched game.${String(prop)}`);
    },
  },
) as Parameters<typeof handleAdminApi>[2];

async function transition(status: string) {
  const res = legacyRes();
  await handleAdminApi(fakeReq({ status, note: 'looking' }), res, fakeGame);
  return { status: res.statusCode, body: res.body };
}

beforeEach(() => {
  setRateLimitClock(() => 1_700_000_000_000);
  resetRateLimits();
  resetAdminOversightRateLimits();
  vi.mocked(accountAndScopeForToken).mockResolvedValue({ accountId: 7, scope: 'full' });
  vi.mocked(adminRolesForAccount).mockResolvedValue({ username: 'op', roles: ['superadmin'] });
});

afterEach(() => {
  resetRateLimits();
  resetAdminOversightRateLimits();
  resetRateLimitClock();
  vi.clearAllMocks();
});

describe('legacy handleAdminApi arm: flag transition refusals', () => {
  it('maps the three store refusals to 400, 409, and 404 with the catalog prose', async () => {
    const cases = [
      { error: 'invalid_transition', status: 400, prose: 'that status change is not allowed' },
      {
        error: 'active_flag_exists',
        status: 409,
        prose: 'this account already has an open flag of that kind',
      },
      { error: 'not_found', status: 404, prose: 'flag not found' },
    ] as const;
    for (const c of cases) {
      vi.mocked(transitionSuspicionFlag).mockResolvedValueOnce({ ok: false, error: c.error });
      const r = await transition('under_review');
      expect(r.status, c.error).toBe(c.status);
      expect(r.body, c.error).toEqual({ success: false, data: null, error: c.prose });
    }
    expect(transitionSuspicionFlag).toHaveBeenCalledTimes(3);
    expect(transitionSuspicionFlag).toHaveBeenLastCalledWith({
      flagId: 11,
      adminAccountId: 7,
      to: 'under_review',
      note: 'looking',
    });
  });
});
