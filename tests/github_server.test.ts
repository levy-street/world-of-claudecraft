import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Repo DB-test pattern (mirrors tests/discord_server.test.ts): stub DATABASE_URL
// + mock pg so db.ts loads and pool.query is a spy we control. This drives the
// REAL GitHub link handlers (start/callback/status/unlink) through their
// branches with no live DB.
const dbMock = vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgres://test/test';
  const query = vi.fn();
  const client = { query, release: vi.fn() };
  return { query, connect: vi.fn(() => Promise.resolve(client)) };
});
vi.mock('pg', () => ({
  Pool: vi.fn(function Pool() {
    return { query: dbMock.query, connect: dbMock.connect };
  }),
}));

import {
  githubConfig,
  githubEnabled,
  handleGitHubCallback,
  handleGitHubStart,
  handleGitHubStatus,
  handleGitHubUnlink,
} from '../server/github';
import { resetContributorsCache } from '../server/github_contributors';
import { providerUsageSnapshot, resetProviderUsageForTests } from '../server/provider_usage';
import { GITHUB_MAX_PER_MINUTE, resetGithubRateLimits } from '../server/ratelimit';

function makeReq(opts: { url?: string } = {}): any {
  const req: any = new Readable({
    read() {
      this.push(null);
    },
  });
  req.url = opts.url ?? '/';
  req.headers = { host: 'worldofclaudecraft.com' };
  req.socket = { remoteAddress: '127.0.0.1' };
  return req;
}
function makeRes(): any {
  return {
    statusCode: 0,
    headers: {} as Record<string, unknown>,
    body: '',
    writeHead(status: number, headers?: Record<string, unknown>) {
      this.statusCode = status;
      if (headers) this.headers = headers;
      return this;
    },
    end(data: string) {
      this.body = data ?? '';
      return this;
    },
  };
}

// Route mocked DB results by normalized SQL. Tests set these per case.
let linkRow: any[] = [];
let ownerRows: any[] = [];
let stateRows: any[] = [];

function defaultRouter(sql: string) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  if (s.includes('INSERT INTO github_oauth_states')) return { rows: [], rowCount: 0 };
  if (s.includes('DELETE FROM github_oauth_states'))
    return { rows: stateRows, rowCount: stateRows.length };
  if (s.includes('SELECT account_id FROM github_links WHERE github_user_id'))
    return { rows: ownerRows, rowCount: ownerRows.length };
  if (s.includes('FROM github_links WHERE account_id'))
    return { rows: linkRow, rowCount: linkRow.length };
  if (s.includes('INSERT INTO github_links')) return { rows: [], rowCount: 1 };
  if (s.includes('DELETE FROM github_links WHERE account_id')) return { rows: [], rowCount: 0 };
  return { rows: [], rowCount: 0 };
}

// Routes the three external GitHub endpoints the callback + status path touch:
// the OAuth token exchange, the authenticated /user identity read, and the
// public /pulls merged-PR stats (which githubStatusPayload pulls in via
// mergedPrsForLogin -> getContributors()).
function mockGithubFetch(opts: { login?: string; id?: number; mergedPrs?: number } = {}) {
  const login = opts.login ?? 'FernandoX7';
  const id = opts.id ?? 16779411;
  const mergedPrs = opts.mergedPrs ?? 70;
  return vi.spyOn(globalThis, 'fetch' as any).mockImplementation((url: any) => {
    const u = String(url);
    if (u.includes('/login/oauth/access_token')) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({ access_token: 'tok', token_type: 'bearer', scope: 'read:user' }),
      } as any);
    }
    if (u.includes('/pulls')) {
      const prs = Array.from({ length: mergedPrs }, () => ({
        number: 1,
        user: { login, type: 'User' },
        merged_at: '2024-01-01T00:00:00Z',
      }));
      return Promise.resolve({
        ok: true,
        headers: { get: () => null },
        json: () => Promise.resolve(prs),
      } as any);
    }
    if (u.endsWith('/user')) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            id,
            login,
            avatar_url: `https://avatars.githubusercontent.com/u/${id}`,
            html_url: `https://github.com/${login}`,
          }),
      } as any);
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as any);
  });
}

beforeEach(() => {
  process.env.GITHUB_OAUTH_CLIENT_ID = 'client123';
  process.env.GITHUB_OAUTH_CLIENT_SECRET = 'secret456';
  linkRow = [];
  ownerRows = [];
  stateRows = [];
  resetGithubRateLimits();
  resetContributorsCache();
  resetProviderUsageForTests();
  dbMock.query.mockReset();
  dbMock.query.mockImplementation((sql: string) => Promise.resolve(defaultRouter(sql)));
});
afterEach(() => {
  delete process.env.GITHUB_OAUTH_CLIENT_ID;
  delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
  vi.restoreAllMocks();
});

function parse(res: any) {
  return { status: res.statusCode, data: res.body ? JSON.parse(res.body) : {} };
}

function metricCount(key: string): number {
  const metric = providerUsageSnapshot().metrics.find((m) => m.key === key);
  return metric ? metric.counts.h24 : -1;
}

describe('githubConfig / githubEnabled', () => {
  it('is enabled only when both client id and secret are set', () => {
    expect(githubEnabled()).toBe(true);
    expect(githubConfig()).toEqual({ clientId: 'client123', clientSecret: 'secret456' });
    delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
    expect(githubEnabled()).toBe(false);
    expect(githubConfig()).toBeNull();
  });
});

describe('POST /api/auth/github/start', () => {
  it('returns a github.com authorize URL and persists the state row', async () => {
    const res = makeRes();
    await handleGitHubStart(makeReq({ url: '/api/auth/github/start' }), res, { accountId: 1 });
    const { status, data } = parse(res);
    expect(status).toBe(200);
    const url = new URL(data.url);
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('client123');
    expect(url.searchParams.get('redirect_uri')).toContain('/api/auth/github/callback');
    expect(url.searchParams.get('scope')).toBe('read:user');
    const insert = dbMock.query.mock.calls.find((c) =>
      String(c[0]).includes('INSERT INTO github_oauth_states'),
    );
    expect(insert).toBeTruthy();
    // The state row is bound to the already-authenticated account (link-only:
    // unlike Discord there is no anonymous login mode) with the documented TTL.
    const params = insert?.[1] as unknown[];
    expect(typeof params[0]).toBe('string');
    expect((params[0] as string).length).toBeGreaterThan(0);
    expect(params[1]).toBe(1);
    expect(params[2]).toBe('10');
  });

  it('503s when GitHub is not configured', async () => {
    delete process.env.GITHUB_OAUTH_CLIENT_ID;
    const res = makeRes();
    await handleGitHubStart(makeReq(), res, { accountId: 1 });
    expect(parse(res).status).toBe(503);
  });
});

describe('GET /api/github (status)', () => {
  it('reports unlinked with no merged PRs and tier 0', async () => {
    const res = makeRes();
    await handleGitHubStatus(makeReq(), res, 1);
    const { status, data } = parse(res);
    expect(status).toBe(200);
    expect(data.enabled).toBe(true);
    expect(data.linked).toBe(false);
    expect(data.login).toBeNull();
    expect(data.mergedPrs).toBe(0);
    expect(data.devTier).toBe(0);
  });

  it('reports the linked login, its merged-PR count, and the resulting tier', async () => {
    linkRow = [
      { account_id: 1, github_user_id: '16779411', github_login: 'FernandoX7', linked_at: 'now' },
    ];
    mockGithubFetch({ login: 'FernandoX7', mergedPrs: 70 });
    const res = makeRes();
    await handleGitHubStatus(makeReq(), res, 1);
    const { data } = parse(res);
    expect(data.linked).toBe(true);
    expect(data.login).toBe('FernandoX7');
    expect(data.profileUrl).toBe('https://github.com/FernandoX7');
    expect(data.mergedPrs).toBe(70);
    expect(data.devTier).toBe(5); // 70 merged PRs -> Worldwright (rung 5)
  });

  it('reports enabled=false when GitHub OAuth is not configured', async () => {
    delete process.env.GITHUB_OAUTH_CLIENT_ID;
    const res = makeRes();
    await handleGitHubStatus(makeReq(), res, 1);
    expect(parse(res).data.enabled).toBe(false);
  });
});

describe('DELETE /api/github (unlink)', () => {
  it('removes the link for the account, no password-keep dance (unlike Discord)', async () => {
    const res = makeRes();
    await handleGitHubUnlink(makeReq(), res, 1);
    expect(parse(res)).toEqual({ status: 200, data: { unlinked: true } });
    expect(
      dbMock.query.mock.calls.some((c) => String(c[0]).includes('DELETE FROM github_links')),
    ).toBe(true);
  });
});

describe('GET /api/auth/github/callback', () => {
  it('renders a cancelled bounce page when the user declines on GitHub', async () => {
    const res = makeRes();
    await handleGitHubCallback(
      makeReq({ url: '/api/auth/github/callback?error=access_denied' }),
      res,
    );
    expect(res.headers['Content-Type']).toContain('text/html');
    expect(res.body).toContain('woc-github');
    expect(res.body).toContain('cancelled');
    // A deliberate cancel is not a failure: it must not pollute the failure metric.
    expect(metricCount('github.link.failure')).toBe(0);
  });

  it('429s without calling GitHub once the per-IP bucket is exhausted', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as any);
    for (let i = 0; i < GITHUB_MAX_PER_MINUTE; i++) {
      const warm = makeRes();
      await handleGitHubCallback(makeReq({ url: '/api/auth/github/callback?state=s' }), warm);
      expect(warm.statusCode).toBe(400); // missing code: cheap, exercises the bucket
    }
    const res = makeRes();
    await handleGitHubCallback(makeReq({ url: '/api/auth/github/callback?code=abc&state=s' }), res);
    expect(res.statusCode).toBe(429);
    expect(res.body).toContain('rate_limited');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(metricCount('github.link.rate_limited')).toBe(1);
  });

  it('400s a missing code or state without calling GitHub', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as any);
    const res = makeRes();
    await handleGitHubCallback(makeReq({ url: '/api/auth/github/callback?state=s' }), res);
    expect(res.body).toContain('bad_request');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(metricCount('github.link.failure')).toBe(1);
  });

  it('rejects an expired/forged state without calling GitHub', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as any);
    stateRows = []; // consume returns nothing
    const res = makeRes();
    await handleGitHubCallback(
      makeReq({ url: '/api/auth/github/callback?code=abc&state=forged' }),
      res,
    );
    expect(res.body).toContain('expired');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(metricCount('github.link.failure')).toBe(1);
  });

  it('502s when the GitHub token/user exchange fails', async () => {
    stateRows = [{ state: 's', account_id: 1 }];
    vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    } as any);
    const res = makeRes();
    await handleGitHubCallback(makeReq({ url: '/api/auth/github/callback?code=abc&state=s' }), res);
    expect(res.body).toContain('github_error');
    expect(metricCount('github.link.failure')).toBe(1);
  });

  it('409s when the GitHub identity already belongs to another account', async () => {
    stateRows = [{ state: 's', account_id: 1 }];
    ownerRows = [{ account_id: 2 }]; // owned by someone else
    mockGithubFetch();
    const res = makeRes();
    await handleGitHubCallback(makeReq({ url: '/api/auth/github/callback?code=abc&state=s' }), res);
    expect(res.body).toContain('already_linked');
    expect(metricCount('github.link.failure')).toBe(1);
  });

  it('links the verified identity to the account that started the flow (not a client-supplied id)', async () => {
    stateRows = [{ state: 's', account_id: 1 }];
    ownerRows = []; // free to claim
    mockGithubFetch({ login: 'jgyy', id: 5 });
    const res = makeRes();
    await handleGitHubCallback(makeReq({ url: '/api/auth/github/callback?code=abc&state=s' }), res);
    expect(res.body).toContain('"ok":true');
    expect(res.body).toContain('jgyy');
    const insert = dbMock.query.mock.calls.find((c) =>
      String(c[0]).includes('INSERT INTO github_links'),
    );
    expect(insert).toBeTruthy();
    // The account id bound to the state row, not anything an attacker could pass
    // in the callback's query string.
    expect(insert?.[1]).toEqual([1, '5', 'jgyy']);
    expect(metricCount('github.link.failure')).toBe(0);
  });

  it('500s without leaking internals when the DB upsert throws a non-conflict error', async () => {
    stateRows = [{ state: 's', account_id: 1 }];
    ownerRows = [];
    mockGithubFetch();
    dbMock.query.mockImplementation((sql: string) => {
      const s = String(sql).replace(/\s+/g, ' ').trim();
      if (s.includes('INSERT INTO github_links')) return Promise.reject(new Error('db is down'));
      return Promise.resolve(defaultRouter(s));
    });
    const res = makeRes();
    await handleGitHubCallback(makeReq({ url: '/api/auth/github/callback?code=abc&state=s' }), res);
    expect(res.body).toContain('server_error');
    expect(res.body).not.toContain('db is down');
    expect(metricCount('github.link.failure')).toBe(1);
  });
});
