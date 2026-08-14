// The ad-spend ledger admin endpoints (server/ad_spend.ts): the shared admin
// auth gate (driven through admin.ts's setAdminDbForTests seam, the same one
// the ownership scope sweep uses), the upsert/list/delete handlers through
// the routes table with the data seam faked (no Postgres), and the
// validation surface of ad_spend_db's input checks. Real modules, no db
// module mock: nothing here is allowed to reach the pg pool (the
// ownership_coverage idiom).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetAdSpendDbForTests, routes, setAdSpendDbForTests } from '../../server/ad_spend';
import type { AdSpendRow } from '../../server/ad_spend_db';
import { upsertAdSpend } from '../../server/ad_spend_db';
import { resetAdminDbForTests, setAdminDbForTests } from '../../server/admin';
import { fakeCtx } from './helpers';

const ADMIN_TOKEN = 'a'.repeat(64);

function handlerFor(method: string, path: string) {
  const route = routes.find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`route not found: ${method} ${path}`);
  return route;
}

/** Run a route's middleware chain + handler (requireAdmin then handler). */
async function runRoute(
  method: 'GET' | 'POST',
  path: string,
  opts: { body?: unknown; url?: string; token?: string } = {},
): Promise<{ status: number; body: unknown }> {
  const route = handlerFor(method, path);
  const ctx = fakeCtx({
    method,
    url: opts.url ?? path,
    body: opts.body,
    headers: {
      authorization: `Bearer ${opts.token ?? ADMIN_TOKEN}`,
      'content-type': 'application/json',
    },
  });
  // Compose the route-local middleware by hand (requireAdmin, then handler).
  const chain = [...(route.middleware ?? [])];
  let i = 0;
  const next = async (): Promise<void> => {
    const mw = chain[i++];
    if (mw) await mw(ctx, next);
    else await route.handler(ctx);
  };
  await next();
  const res = ctx.res as unknown as {
    statusCode: number;
    body?: unknown;
    payload?: unknown;
    written?: string;
  };
  const raw =
    (res as { written?: string }).written ??
    (res as { payload?: unknown }).payload ??
    (res as { body?: unknown }).body;
  const body = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return { status: res.statusCode, body };
}

const sampleRow: AdSpendRow = {
  day: '2026-08-10',
  campaign: 'meta_aug_l5',
  spendCents: 25000,
  impressions: 100000,
  clicks: 1200,
  currency: 'USD',
  updatedAt: '2026-08-14T00:00:00.000Z',
};

beforeEach(() => {
  setAdminDbForTests({
    accountAndScopeForToken: async (token: string) =>
      token === ADMIN_TOKEN ? { accountId: 1, scope: 'full' as const } : null,
    adminRolesForAccount: async () => ({ username: 'ops', roles: ['admin'] }),
  });
  setAdSpendDbForTests({
    listAdSpend: async () => [sampleRow],
    upsertAdSpend: async (input) => ({ ...sampleRow, ...input }) as AdSpendRow,
    deleteAdSpend: async () => true,
  });
});

afterEach(() => {
  resetAdSpendDbForTests();
  resetAdminDbForTests();
});

describe('auth gate', () => {
  it('rejects a missing or unknown bearer with the admin 401 envelope', async () => {
    const out = await runRoute('GET', '/admin/api/ad-spend', { token: 'f'.repeat(64) });
    expect(out.status).toBe(401);
    expect(out.body).toMatchObject({ success: false, error: 'admin authentication required' });
  });

  it('rejects a staff account without the write permission on POST', async () => {
    // setAdminDbForTests overlays the REAL bundle, not the previous override,
    // so the token fake must ride along with the viewer-role fake.
    setAdminDbForTests({
      accountAndScopeForToken: async (token: string) =>
        token === ADMIN_TOKEN ? { accountId: 1, scope: 'full' as const } : null,
      adminRolesForAccount: async () => ({ username: 'viewer', roles: ['viewer'] }),
    });
    const read = await runRoute('GET', '/admin/api/ad-spend');
    expect(read.status).toBe(200);
    const write = await runRoute('POST', '/admin/api/ad-spend', {
      body: { day: '2026-08-10', campaign: 'x', spendCents: 1 },
    });
    expect(write.status).toBe(403);
  });
});

describe('handlers', () => {
  it('lists the trailing window', async () => {
    const out = await runRoute('GET', '/admin/api/ad-spend', {
      url: '/admin/api/ad-spend?days=30',
    });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ success: true, data: { rows: [sampleRow] } });
  });

  it('upserts a row and echoes it back', async () => {
    const out = await runRoute('POST', '/admin/api/ad-spend', {
      body: { day: '2026-08-11', campaign: 'meta_aug_l5', spendCents: 31000, clicks: 900 },
    });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({
      success: true,
      data: { row: { day: '2026-08-11', spendCents: 31000 } },
    });
  });

  it('maps a validation TypeError to a 400 admin envelope', async () => {
    setAdSpendDbForTests({
      upsertAdSpend: async () => {
        throw new TypeError('day must be YYYY-MM-DD');
      },
    });
    const out = await runRoute('POST', '/admin/api/ad-spend', {
      body: { day: 'garbage', campaign: 'x', spendCents: 1 },
    });
    expect(out.status).toBe(400);
    expect(out.body).toMatchObject({ success: false, error: 'day must be YYYY-MM-DD' });
  });

  it('deletes a row via the POST delete arm', async () => {
    const out = await runRoute('POST', '/admin/api/ad-spend/delete', {
      body: { day: '2026-08-10', campaign: 'meta_aug_l5' },
    });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ success: true, data: { deleted: true } });
  });
});

describe('ad_spend_db input validation', () => {
  it('rejects malformed day, campaign, and negative numbers before SQL', async () => {
    const db = { query: vi.fn() };
    await expect(
      upsertAdSpend(db as never, { day: 'nope', campaign: 'x', spendCents: 1 }),
    ).rejects.toThrow(/day/);
    await expect(
      upsertAdSpend(db as never, { day: '2026-08-10', campaign: '  ', spendCents: 1 }),
    ).rejects.toThrow(/campaign/);
    await expect(
      upsertAdSpend(db as never, { day: '2026-08-10', campaign: 'x', spendCents: -5 }),
    ).rejects.toThrow(/spendCents/);
    expect(db.query).not.toHaveBeenCalled();
  });
});
