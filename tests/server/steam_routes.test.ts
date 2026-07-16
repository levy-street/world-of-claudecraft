// The Steam link surface (server/steam/routes.ts): the env gate, the ticket
// flow arms, both 409 conflicts, the rate-limit policy, the steam_links DDL
// pins, and the forbidden-login rule (linking never mints credentials; login
// with Steam does not exist).
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_steam_units';

import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Isolate the route layer: SQL boundary, upstream verification, and the
// mirror are each mocked (the mirror has its own suite; the routes only owe
// it the reconcile-on-link and cache-invalidation calls).
vi.mock('../../server/steam/steam_db', () => ({
  steamLinkForAccount: vi.fn(async () => null),
  accountForSteamId: vi.fn(async () => null),
  insertSteamLink: vi.fn(async () => 'ok'),
  displaceSteamLink: vi.fn(async () => ({ result: 'ok', displacedAccountId: null })),
  deleteSteamLink: vi.fn(async () => {}),
}));
vi.mock('../../server/steam/web_api', () => ({
  verifyLinkTicket: vi.fn(async () => ({ kind: 'ok', steamId: '76561198000000001' })),
  pushAchievementUnlock: vi.fn(async () => true),
}));
vi.mock('../../server/steam/mirror', () => ({
  onDeedRecorded: vi.fn(),
  onLinkChanged: vi.fn(),
  reconcileLink: vi.fn(),
}));
// Partial db mock: keep SCHEMA (and everything else) real, stub only the two
// reads requireAccount resolves at call time, so the full-chain tests below can
// run the route's REAL middleware (gate -> auth -> limiter -> body) without a
// live database.
vi.mock('../../server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/db')>();
  return {
    ...actual,
    accountAndScopeForToken: vi.fn(async () => ({ accountId: 7, scope: 'full' as const })),
    moderationStatusForAccount: vi.fn(async () => ({
      locked: false,
      banned: false,
      suspendedUntil: null,
    })),
  };
});

import type * as http from 'node:http';
import { SCHEMA } from '../../server/db';
import { HttpError } from '../../server/http/errors';
import { rateLimit, STEAM_LINK_POLICY } from '../../server/http/middleware/rate_limit';
import type { Ctx, RouteDef } from '../../server/http/types';
import { resetSteamLinkRateLimits, STEAM_LINK_MAX_PER_MINUTE } from '../../server/ratelimit';
import { onLinkChanged, reconcileLink } from '../../server/steam/mirror';
import { routes } from '../../server/steam/routes';
import {
  accountForSteamId,
  deleteSteamLink,
  displaceSteamLink,
  insertSteamLink,
  steamLinkForAccount,
} from '../../server/steam/steam_db';
import {
  isTicketShape,
  MAX_TICKET_HEX_CHARS,
  MIN_TICKET_HEX_CHARS,
  parseAuthenticateUserTicketResponse,
  TICKET_IDENTITY,
} from '../../server/steam/ticket';
import { verifyLinkTicket } from '../../server/steam/web_api';
import { type FakeRes, fakeCtx } from './helpers';

const linkForAccountMock = vi.mocked(steamLinkForAccount);
const accountForSteamIdMock = vi.mocked(accountForSteamId);
const insertMock = vi.mocked(insertSteamLink);
const displaceMock = vi.mocked(displaceSteamLink);
const deleteMock = vi.mocked(deleteSteamLink);
const verifyMock = vi.mocked(verifyLinkTicket);
const reconcileMock = vi.mocked(reconcileLink);
const onLinkChangedMock = vi.mocked(onLinkChanged);

const ACCOUNT = { accountId: 7, scope: 'full' as const };
const STEAM_ID = '76561198000000001';
const GOOD_TICKET = 'a1b2c3d4'.repeat(16); // 128 hex chars, inside the clamp

/** Read a handler's response off the fakeCtx's FakeRes. */
function captured(res: http.ServerResponse): { status: number; body: unknown } {
  const fake = res as unknown as FakeRes;
  return { status: fake.statusCode, body: fake.body ? JSON.parse(fake.body) : undefined };
}

/** Grab a registered route by method + path. */
function routeFor(method: string, routePath: string): RouteDef {
  const route = routes.find((r) => r.method === method && r.path === routePath);
  if (!route) throw new Error(`no route registered for ${method} ${routePath}`);
  return route;
}

/** Run a route's full middleware chain then its handler, the onion order. */
async function runRoute(route: RouteDef, ctx: Ctx): Promise<void> {
  const chain = route.middleware ?? [];
  let i = -1;
  const next = async (): Promise<void> => {
    i++;
    if (i < chain.length) await chain[i](ctx, next);
    else await route.handler(ctx);
  };
  await next();
}

const savedEnv: Record<string, string | undefined> = {};
const STEAM_ENV_KEYS = ['STEAM_ENABLED', 'STEAM_APP_ID', 'STEAM_WEB_API_KEY'] as const;

function enableSteam(): void {
  process.env.STEAM_ENABLED = '1';
  process.env.STEAM_APP_ID = '480';
  process.env.STEAM_WEB_API_KEY = 'raw-test-publisher-value';
}

beforeEach(() => {
  for (const key of STEAM_ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of STEAM_ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  resetSteamLinkRateLimits();
  vi.clearAllMocks();
  linkForAccountMock.mockResolvedValue(null);
  accountForSteamIdMock.mockResolvedValue(null);
  insertMock.mockResolvedValue('ok');
  displaceMock.mockResolvedValue({ result: 'ok', displacedAccountId: null });
  verifyMock.mockResolvedValue({ kind: 'ok', steamId: STEAM_ID });
});

// ---------------------------------------------------------------------------
// DDL pins (the steam_links literals in db.ts SCHEMA).
// ---------------------------------------------------------------------------

describe('steam_links DDL', () => {
  it('is additive and idempotent with both uniqueness constraints and the cascade', () => {
    expect(SCHEMA).toContain('CREATE TABLE IF NOT EXISTS steam_links');
    expect(SCHEMA).toContain(
      'account_id INT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE',
    );
    expect(SCHEMA).toContain('steam_id TEXT NOT NULL UNIQUE');
  });
});

// ---------------------------------------------------------------------------
// The env gate: every route answers steam.disabled while dark, before auth.
// ---------------------------------------------------------------------------

describe('the STEAM_ENABLED gate', () => {
  it('answers 503 steam.disabled on EVERY route when the flag is off, even unauthenticated', async () => {
    for (const route of routes) {
      const ctx = fakeCtx({ method: route.method, url: route.path });
      await expect(runRoute(route, ctx)).rejects.toMatchObject({
        status: 503,
        code: 'steam.disabled',
      });
    }
    // The gate answered before any auth or db work.
    expect(linkForAccountMock).not.toHaveBeenCalled();
  });

  it('exposes exactly the three expected routes, gate first in every chain', () => {
    expect(routes.map((r) => `${r.method} ${r.path}`).sort()).toEqual([
      'DELETE /api/steam/link',
      'GET /api/steam/status',
      'POST /api/steam/link',
    ]);
    for (const route of routes) {
      expect(route.surface).toBe('api');
      expect(route.middleware?.length ?? 0).toBeGreaterThanOrEqual(2);
    }
  });

  it('with the flag ON, an unauthenticated call is rejected by the bearer gate (auth mounts behind the env gate)', async () => {
    enableSteam();
    const route = routeFor('GET', '/api/steam/status');
    const ctx = fakeCtx({ method: 'GET', url: route.path });
    await expect(runRoute(route, ctx)).rejects.toMatchObject({
      status: 401,
      code: 'auth.token_missing',
    });
  });
});

// ---------------------------------------------------------------------------
// POST /api/steam/link handler arms (middleware bypassed; ctx.account preset).
// ---------------------------------------------------------------------------

describe('POST /api/steam/link', () => {
  const handler = () => routeFor('POST', '/api/steam/link').handler;

  function linkCtx(body: unknown): Ctx {
    return fakeCtx({ method: 'POST', url: '/api/steam/link', account: ACCOUNT, body });
  }

  it('links: verifies the ticket, stores the verified steam id, fires reconcile, returns it', async () => {
    enableSteam();
    const ctx = linkCtx({ ticket: GOOD_TICKET });
    await handler()(ctx);
    expect(captured(ctx.res)).toEqual({
      status: 200,
      body: { linked: true, steamId: STEAM_ID },
    });
    expect(verifyMock).toHaveBeenCalledWith({
      key: 'raw-test-publisher-value',
      appId: 480,
      ticket: GOOD_TICKET,
    });
    expect(insertMock).toHaveBeenCalledWith(ACCOUNT.accountId, STEAM_ID);
    expect(reconcileMock).toHaveBeenCalledWith(ACCOUNT.accountId, STEAM_ID);
  });

  it('links with a max-size (5120 hex) ticket through the REAL chain: clamp and body cap both admit it', async () => {
    // Through runRoute (gate -> auth -> limiter -> body -> handler), not a
    // preset ctx.body: the body middleware's own size ceiling must admit a
    // max-size ticket's JSON envelope too, or the clamp headroom is theater.
    enableSteam();
    const maxTicket = 'b'.repeat(5120);
    const ctx = fakeCtx({
      method: 'POST',
      url: '/api/steam/link',
      headers: { authorization: `Bearer ${'a'.repeat(64)}` },
      body: { ticket: maxTicket },
    });
    await runRoute(routeFor('POST', '/api/steam/link'), ctx);
    expect(captured(ctx.res)).toEqual({
      status: 200,
      body: { linked: true, steamId: STEAM_ID },
    });
    expect(verifyMock).toHaveBeenCalledWith(expect.objectContaining({ ticket: maxTicket }));
  });

  it.each([
    ['missing', undefined],
    ['not a string', 42],
    ['non-hex', 'z'.repeat(80)],
    ['too short', 'a'.repeat(MIN_TICKET_HEX_CHARS - 2)],
    ['too long', 'a'.repeat(MAX_TICKET_HEX_CHARS + 2)],
  ])('rejects a %s ticket 400 steam.invalid_ticket without an upstream call', async (_name, ticket) => {
    enableSteam();
    await expect(handler()(linkCtx({ ticket }))).rejects.toMatchObject({
      status: 400,
      code: 'steam.invalid_ticket',
    });
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('answers 503 steam.upstream when enabled but unprovisioned (no app id / key), before any upstream call', async () => {
    process.env.STEAM_ENABLED = '1';
    await expect(handler()(linkCtx({ ticket: GOOD_TICKET }))).rejects.toMatchObject({
      status: 503,
      code: 'steam.upstream',
    });
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('409 steam.already_linked for a linked account BEFORE burning an upstream verification', async () => {
    enableSteam();
    linkForAccountMock.mockResolvedValue({
      accountId: ACCOUNT.accountId,
      steamId: STEAM_ID,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    await expect(handler()(linkCtx({ ticket: GOOD_TICKET }))).rejects.toMatchObject({
      status: 409,
      code: 'steam.already_linked',
    });
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid', { kind: 'invalid' as const }, 400, 'steam.invalid_ticket'],
    ['malformed', { kind: 'malformed' as const }, 400, 'steam.invalid_ticket'],
    ['banned', { kind: 'banned' as const }, 403, 'steam.banned'],
    ['upstream', { kind: 'upstream' as const }, 503, 'steam.upstream'],
  ])('maps a %s verification outcome to its stable code', async (_name, outcome, status, code) => {
    enableSteam();
    verifyMock.mockResolvedValue(outcome);
    await expect(handler()(linkCtx({ ticket: GOOD_TICKET }))).rejects.toMatchObject({
      status,
      code,
    });
    expect(insertMock).not.toHaveBeenCalled();
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it('reclaim-by-proof: a fresh valid ticket for a squatted steam id displaces the old owner and links the caller', async () => {
    // The behavior deliberately CHANGED: a verified steam id linked to another
    // account is no longer a 409 account_taken. A fresh valid ticket proves
    // CURRENT control of the Steam account, strictly stronger than the
    // squatter's stale (stolen) ticket, so the true owner reclaims it.
    enableSteam();
    const OLD_OWNER = 99;
    accountForSteamIdMock.mockResolvedValue(OLD_OWNER);
    displaceMock.mockResolvedValue({ result: 'ok', displacedAccountId: OLD_OWNER });
    const ctx = linkCtx({ ticket: GOOD_TICKET });
    await handler()(ctx);
    expect(captured(ctx.res)).toEqual({ status: 200, body: { linked: true, steamId: STEAM_ID } });
    // Displaced the squatter and linked the caller in one transaction; the plain
    // insert path was NOT taken.
    expect(displaceMock).toHaveBeenCalledWith(ACCOUNT.accountId, STEAM_ID);
    expect(insertMock).not.toHaveBeenCalled();
    // The displaced owner's cached mirror view is flipped in-request so its
    // in-flight pushes revalidate against an empty link and drop.
    expect(onLinkChangedMock).toHaveBeenCalledWith(OLD_OWNER, null);
    // The caller's already-earned deeds reconcile to the reclaimed id.
    expect(reconcileMock).toHaveBeenCalledWith(ACCOUNT.accountId, STEAM_ID);
  });

  it('same-account already-linked is still a 409 pre-check, never a reclaim (displace untouched)', async () => {
    enableSteam();
    linkForAccountMock.mockResolvedValue({
      accountId: ACCOUNT.accountId,
      steamId: STEAM_ID,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    await expect(handler()(linkCtx({ ticket: GOOD_TICKET }))).rejects.toMatchObject({
      status: 409,
      code: 'steam.already_linked',
    });
    // The pre-check answered before any upstream, insert, or reclaim work.
    expect(verifyMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(displaceMock).not.toHaveBeenCalled();
  });

  it.each([
    ['account_linked' as const, 'steam.already_linked'],
    ['steam_taken' as const, 'steam.account_taken'],
  ])('maps the insert race arm %s to its 409 (TOCTOU behind the pre-checks)', async (arm, code) => {
    enableSteam();
    insertMock.mockResolvedValue(arm);
    await expect(handler()(linkCtx({ ticket: GOOD_TICKET }))).rejects.toMatchObject({
      status: 409,
      code,
    });
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it.each([
    ['account_linked' as const, 'steam.already_linked'],
    ['steam_taken' as const, 'steam.account_taken'],
  ])('maps a displace race arm %s to its 409 (23505 re-classified behind the reclaim)', async (arm, code) => {
    enableSteam();
    accountForSteamIdMock.mockResolvedValue(99);
    displaceMock.mockResolvedValue({ result: arm, displacedAccountId: null });
    await expect(handler()(linkCtx({ ticket: GOOD_TICKET }))).rejects.toMatchObject({
      status: 409,
      code,
    });
    // A lost race wrote nothing, so no reconcile and no cache flip.
    expect(reconcileMock).not.toHaveBeenCalled();
    expect(onLinkChangedMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/steam/link + GET /api/steam/status.
// ---------------------------------------------------------------------------

describe('DELETE /api/steam/link', () => {
  it('deletes the link, invalidates the mirror cache, and is idempotent', async () => {
    enableSteam();
    const handler = routeFor('DELETE', '/api/steam/link').handler;
    for (let round = 0; round < 2; round++) {
      const ctx = fakeCtx({ method: 'DELETE', url: '/api/steam/link', account: ACCOUNT });
      await handler(ctx);
      expect(captured(ctx.res)).toEqual({ status: 200, body: { unlinked: true } });
    }
    expect(deleteMock).toHaveBeenCalledTimes(2);
    expect(deleteMock).toHaveBeenCalledWith(ACCOUNT.accountId);
    expect(onLinkChangedMock).toHaveBeenCalledWith(ACCOUNT.accountId, null);
  });
});

describe('GET /api/steam/status', () => {
  it('reports a linked caller with the steam id', async () => {
    enableSteam();
    linkForAccountMock.mockResolvedValue({
      accountId: ACCOUNT.accountId,
      steamId: STEAM_ID,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const ctx = fakeCtx({ method: 'GET', url: '/api/steam/status', account: ACCOUNT });
    await routeFor('GET', '/api/steam/status').handler(ctx);
    expect(captured(ctx.res)).toEqual({
      status: 200,
      body: { enabled: true, linked: true, steamId: STEAM_ID },
    });
  });

  it('reports an unlinked caller with NO steamId key', async () => {
    enableSteam();
    const ctx = fakeCtx({ method: 'GET', url: '/api/steam/status', account: ACCOUNT });
    await routeFor('GET', '/api/steam/status').handler(ctx);
    const { status, body } = captured(ctx.res);
    expect(status).toBe(200);
    expect(body).toEqual({ enabled: true, linked: false });
    expect('steamId' in (body as object)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The rate-limit policy (fused ip+account, tier-1 in-process).
// ---------------------------------------------------------------------------

describe('STEAM_LINK_POLICY', () => {
  it('is ip+account, derives from the limiter constant, and 429s past the cap', async () => {
    expect(STEAM_LINK_POLICY.name).toBe('steam_link');
    expect(STEAM_LINK_POLICY.keyClass).toBe('ip+account');
    expect(STEAM_LINK_POLICY.limit).toBe(STEAM_LINK_MAX_PER_MINUTE);
    expect(STEAM_LINK_POLICY.limit).toBe(5);
    const mw = rateLimit(STEAM_LINK_POLICY);
    const ctx = fakeCtx({ method: 'POST', url: '/api/steam/link', account: ACCOUNT });
    for (let i = 0; i < STEAM_LINK_MAX_PER_MINUTE; i++) {
      await expect(mw(ctx, async () => {})).resolves.toBeUndefined();
    }
    await expect(mw(ctx, async () => {})).rejects.toMatchObject({
      status: 429,
      code: 'rate_limit.exceeded',
    });
  });

  it('is MOUNTED on POST /api/steam/link: the request past the cap 429s through the real chain', async () => {
    // The standalone policy test above proves the limiter works; this one
    // proves the route actually carries it (dropping rateLimit(...) from the
    // middleware table must red this test), and that it sits behind auth (an
    // ip+account limiter 500s without ctx.account, so a flipped order cannot
    // produce the 429).
    enableSteam();
    const bearer = { authorization: `Bearer ${'a'.repeat(64)}` };
    const route = routeFor('POST', '/api/steam/link');
    for (let i = 0; i < STEAM_LINK_MAX_PER_MINUTE; i++) {
      const ctx = fakeCtx({
        method: 'POST',
        url: '/api/steam/link',
        headers: bearer,
        body: { ticket: GOOD_TICKET },
      });
      await runRoute(route, ctx);
      expect(captured(ctx.res).status).toBe(200);
    }
    const capped = fakeCtx({
      method: 'POST',
      url: '/api/steam/link',
      headers: bearer,
      body: { ticket: GOOD_TICKET },
    });
    await expect(runRoute(route, capped)).rejects.toMatchObject({
      status: 429,
      code: 'rate_limit.exceeded',
    });
    // The capped request never reached the handler.
    expect(insertMock).toHaveBeenCalledTimes(STEAM_LINK_MAX_PER_MINUTE);
  });
});

// ---------------------------------------------------------------------------
// Pure ticket helpers.
// ---------------------------------------------------------------------------

describe('ticket helpers (pure)', () => {
  it('pins the agreed identity string', () => {
    expect(TICKET_IDENTITY).toBe('wocc-link');
  });

  it('isTicketShape accepts hex inside the clamp and rejects everything else', () => {
    expect(isTicketShape(GOOD_TICKET)).toBe(true);
    expect(isTicketShape('A1B2C3D4'.repeat(16))).toBe(true);
    expect(isTicketShape('')).toBe(false);
    expect(isTicketShape(null)).toBe(false);
    expect(isTicketShape('g'.repeat(80))).toBe(false);
  });

  it('admits a max-size web-api ticket and pins the clamp to the literal', () => {
    // Steam's GetTicketForWebApiResponse_t caps a ticket at
    // k_nCubTicketMaxLength = 2560 bytes, 5120 hex chars once the shell
    // encodes it; the size varies with the account's license list, so real
    // tickets near the cap exist. Literals on purpose: an assertion written
    // against the exported constant would stay green if the clamp regressed
    // to the old 1024-byte GetAuthSessionTicket bound.
    expect(MAX_TICKET_HEX_CHARS).toBe(5120);
    expect(isTicketShape('a'.repeat(5120))).toBe(true);
    expect(isTicketShape('a'.repeat(5121))).toBe(false);
  });

  it('parses the OK arm and extracts the steam id', () => {
    expect(
      parseAuthenticateUserTicketResponse({
        response: {
          params: {
            result: 'OK',
            steamid: STEAM_ID,
            ownersteamid: STEAM_ID,
            vacbanned: false,
            publisherbanned: false,
          },
        },
      }),
    ).toEqual({ kind: 'ok', steamId: STEAM_ID });
  });

  it.each([
    ['vacbanned', { vacbanned: true, publisherbanned: false }],
    ['publisherbanned', { vacbanned: false, publisherbanned: true }],
  ])('rejects a %s account as banned', (_name, bans) => {
    expect(
      parseAuthenticateUserTicketResponse({
        response: { params: { result: 'OK', steamid: STEAM_ID, ...bans } },
      }),
    ).toEqual({ kind: 'banned' });
  });

  it('reads an upstream error body as invalid', () => {
    expect(
      parseAuthenticateUserTicketResponse({
        response: { error: { errorcode: 101, errordesc: 'Invalid ticket' } },
      }),
    ).toEqual({ kind: 'invalid' });
  });

  it.each([
    ['null', null],
    ['a string', 'nope'],
    ['an empty object', {}],
    ['a params-less response', { response: {} }],
    ['a result-less params', { response: { params: { steamid: STEAM_ID } } }],
    ['a non-numeric steamid', { response: { params: { result: 'OK', steamid: 'abc' } } }],
  ])('reads %s as malformed, never a throw', (_name, body) => {
    expect(parseAuthenticateUserTicketResponse(body)).toEqual({ kind: 'malformed' });
  });
});

// ---------------------------------------------------------------------------
// The forbidden-login rule: the steam domain can never mint credentials.
// ---------------------------------------------------------------------------

describe('login with Steam does not exist', () => {
  it('no file under server/steam/ references newToken or auth_tokens (source scan)', () => {
    const dir = path.resolve(process.cwd(), 'server/steam');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThanOrEqual(7);
    for (const file of files) {
      const source = fs.readFileSync(path.join(dir, file), 'utf8');
      // The strings appear here only inside this scan and the routes module's
      // rule comment; strip comments before asserting so documentation of the
      // rule cannot mask a violation.
      const code = source.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(code, `${file} must not mint tokens`).not.toContain('newToken');
      expect(code, `${file} must not touch auth_tokens`).not.toContain('auth_tokens');
    }
  });

  it('a successful link response carries no token-shaped field', async () => {
    enableSteam();
    const ctx = fakeCtx({
      method: 'POST',
      url: '/api/steam/link',
      account: ACCOUNT,
      body: { ticket: GOOD_TICKET },
    });
    await routeFor('POST', '/api/steam/link').handler(ctx);
    const { body } = captured(ctx.res);
    expect(Object.keys(body as object).sort()).toEqual(['linked', 'steamId']);
    // No cookie-delivered credential either: the body-shape pin alone would
    // miss a Set-Cookie side channel.
    expect(ctx.res.getHeader('set-cookie')).toBeUndefined();
  });

  it('the disabled surface makes the dark default safe: no env, no route runs a handler', async () => {
    // Belt and braces over the gate test: no STEAM_* env at all (the shipped
    // default), every route rejects with the stable code and zero db traffic.
    for (const route of routes) {
      const ctx = fakeCtx({ method: route.method, url: route.path, account: ACCOUNT });
      await expect(runRoute(route, ctx)).rejects.toSatisfy(
        (err: unknown) => err instanceof HttpError && err.code === 'steam.disabled',
      );
    }
    expect(linkForAccountMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });
});
