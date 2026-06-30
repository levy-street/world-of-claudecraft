import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Repo DB-test pattern: stub DATABASE_URL + mock pg so db.ts loads and pool.query
// / pool.connect are spies we control. This drives the REAL Discord handlers
// (start/status/unlink/swag/callback) through their branches with no live DB.
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
  handleDiscordCallback,
  handleDiscordStart,
  handleDiscordStatus,
  handleDiscordUnlink,
  handleSwagClaim,
} from '../server/discord';
import { resetDiscordRateLimits } from '../server/ratelimit';

function makeReq(opts: { url?: string; body?: unknown } = {}): any {
  const req: any =
    opts.body !== undefined
      ? Readable.from([Buffer.from(JSON.stringify(opts.body))])
      : new Readable({
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
let rewardRows: any[] = [];
let swagClaimRows: any[] = [];
let stateRows: any[] = [];

function defaultRouter(sql: string) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  if (s.includes('INSERT INTO discord_oauth_states')) return { rows: [], rowCount: 0 };
  if (s.includes('DELETE FROM discord_oauth_states'))
    return { rows: stateRows, rowCount: stateRows.length };
  if (s.includes('SELECT account_id FROM discord_links WHERE discord_user_id'))
    return { rows: ownerRows, rowCount: ownerRows.length };
  if (s.includes('FROM discord_links WHERE account_id'))
    return { rows: linkRow, rowCount: linkRow.length };
  if (s.includes('INSERT INTO discord_links')) return { rows: [], rowCount: 1 };
  if (s.includes('DELETE FROM discord_links WHERE account_id')) return { rows: [], rowCount: 0 };
  if (s.includes('SELECT points, lifetime_points FROM reward_points'))
    return { rows: rewardRows, rowCount: rewardRows.length };
  if (s.includes('INSERT INTO reward_ledger')) return { rows: [{ id: 1 }], rowCount: 1 };
  if (s.includes('INSERT INTO reward_points'))
    return { rows: [{ points: '250', lifetime_points: '250' }], rowCount: 1 };
  if (s.includes('SELECT swag_id FROM swag_claims'))
    return { rows: swagClaimRows, rowCount: swagClaimRows.length };
  return { rows: [], rowCount: 0 };
}

beforeEach(() => {
  process.env.DISCORD_CLIENT_ID = 'client123';
  process.env.DISCORD_CLIENT_SECRET = 'secret456';
  process.env.DISCORD_GUILD_ID = '111111111111111111';
  linkRow = [];
  ownerRows = [];
  rewardRows = [];
  swagClaimRows = [];
  stateRows = [];
  resetDiscordRateLimits();
  dbMock.query.mockReset();
  dbMock.query.mockImplementation((sql: string) => Promise.resolve(defaultRouter(sql)));
});
afterEach(() => {
  vi.restoreAllMocks();
});

const noopGrant = () => {};
function parse(res: any) {
  return { status: res.statusCode, data: res.body ? JSON.parse(res.body) : {} };
}

describe('POST /api/auth/discord/start', () => {
  it('returns a discord.com authorize URL and persists the state row', async () => {
    const res = makeRes();
    await handleDiscordStart(makeReq({ url: '/api/auth/discord/start?mode=login' }), res, {
      mode: 'login',
      accountId: null,
    });
    const { status, data } = parse(res);
    expect(status).toBe(200);
    const url = new URL(data.url);
    expect(url.origin + url.pathname).toBe('https://discord.com/oauth2/authorize');
    expect(url.searchParams.get('client_id')).toBe('client123');
    expect(url.searchParams.get('redirect_uri')).toContain('/api/auth/discord/callback');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    // state row persisted (PKCE verifier stays server-side, never in the URL).
    const insert = dbMock.query.mock.calls.find((c) =>
      String(c[0]).includes('INSERT INTO discord_oauth_states'),
    );
    expect(insert).toBeTruthy();
    expect(url.searchParams.get('code_challenge')).not.toBeNull();
  });

  it('503s when Discord is not configured', async () => {
    delete process.env.DISCORD_CLIENT_ID;
    const res = makeRes();
    await handleDiscordStart(makeReq(), res, { mode: 'login', accountId: null });
    expect(parse(res).status).toBe(503);
  });
});

describe('GET /api/discord (status)', () => {
  it('reports unlinked with zeroed rewards', async () => {
    const res = makeRes();
    await handleDiscordStatus(makeReq(), res, 1);
    const { status, data } = parse(res);
    expect(status).toBe(200);
    expect(data.linked).toBe(false);
    expect(data.points).toBe(0);
    expect(data.statusTier).toBe(0);
    expect(data.inviteUrl).toContain('discord.gg');
  });

  it('reports linked status, points and derived tier', async () => {
    linkRow = [
      {
        account_id: 1,
        discord_user_id: '80351110224678912',
        discord_username: 'maxp',
        discord_avatar: null,
        guild_member: true,
        linked_at: 'now',
      },
    ];
    rewardRows = [{ points: '1500', lifetime_points: '2500' }];
    swagClaimRows = [{ swag_id: 'title_discordian' }];
    const res = makeRes();
    await handleDiscordStatus(makeReq(), res, 1);
    const { data } = parse(res);
    expect(data.linked).toBe(true);
    expect(data.username).toBe('maxp');
    expect(data.guildMember).toBe(true);
    expect(data.points).toBe(1500);
    expect(data.lifetimePoints).toBe(2500);
    expect(data.statusTier).toBe(4); // 2500 lifetime -> knight (rung 4)
    expect(data.claimedSwagIds).toEqual(['title_discordian']);
  });
});

describe('DELETE /api/discord (unlink)', () => {
  it('removes the link', async () => {
    const res = makeRes();
    await handleDiscordUnlink(makeReq(), res, 1);
    expect(parse(res)).toEqual({ status: 200, data: { unlinked: true } });
    expect(
      dbMock.query.mock.calls.some((c) => String(c[0]).includes('DELETE FROM discord_links')),
    ).toBe(true);
  });
});

describe('POST /api/discord/swag/claim', () => {
  it('400s on an unknown swag id', async () => {
    const res = makeRes();
    await handleSwagClaim(makeReq({ body: { swagId: 'nope' } }), res, 1, noopGrant);
    expect(parse(res).status).toBe(400);
  });

  it('403s when the account has no linked Discord', async () => {
    linkRow = []; // not linked
    const res = makeRes();
    await handleSwagClaim(makeReq({ body: { swagId: 'title_discordian' } }), res, 1, noopGrant);
    expect(parse(res).status).toBe(403);
  });

  it('409s a tier-gated claim before spending anything', async () => {
    linkRow = [
      {
        account_id: 1,
        discord_user_id: '8',
        discord_username: 'm',
        discord_avatar: null,
        guild_member: false,
        linked_at: 'now',
      },
    ];
    rewardRows = [{ points: '5000', lifetime_points: '0' }]; // tier 1, below chroma minTier 3
    swagClaimRows = [];
    const res = makeRes();
    await handleSwagClaim(makeReq({ body: { swagId: 'chroma_blurple' } }), res, 1, noopGrant);
    const { status, data } = parse(res);
    expect(status).toBe(409);
    expect(data.error).toBe('tier');
    // No claim insert attempted on a gated request.
    expect(
      dbMock.query.mock.calls.some((c) => String(c[0]).includes('INSERT INTO swag_claims')),
    ).toBe(false);
  });
});

describe('GET /api/auth/discord/callback', () => {
  it('renders a cancelled bounce page when the user declines on Discord', async () => {
    const res = makeRes();
    await handleDiscordCallback(
      makeReq({ url: '/api/auth/discord/callback?error=access_denied' }),
      res,
    );
    expect(res.headers['Content-Type']).toContain('text/html');
    expect(res.body).toContain('woc-discord');
    expect(res.body).toContain('cancelled');
  });

  it('rejects an expired/forged state without calling Discord', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as any);
    stateRows = []; // consume returns nothing
    const res = makeRes();
    await handleDiscordCallback(
      makeReq({ url: '/api/auth/discord/callback?code=abc&state=forged' }),
      res,
    );
    expect(res.body).toContain('expired');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('409s a link when the Discord id already belongs to another account', async () => {
    // A live state row for a 'link' on account 1...
    stateRows = [
      { state: 's', code_verifier: 'v', mode: 'link', account_id: 1, redirect_to: null },
    ];
    // ...but the Discord id is already owned by account 2.
    ownerRows = [{ account_id: 2 }];
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as any).mockImplementation((url: any) => {
      const u = String(url);
      if (u.includes('/oauth2/token'))
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              access_token: 'tok',
              token_type: 'Bearer',
              scope: 'identify guilds',
              expires_in: 600,
            }),
        } as any);
      if (u.includes('/users/@me/guilds'))
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ id: '111111111111111111' }]),
        } as any);
      if (u.includes('/users/@me'))
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              id: '999999999999999999',
              username: 'taken',
              global_name: 'Taken',
              avatar: null,
            }),
        } as any);
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as any);
    });
    const res = makeRes();
    await handleDiscordCallback(
      makeReq({ url: '/api/auth/discord/callback?code=abc&state=s' }),
      res,
    );
    expect(fetchSpy).toHaveBeenCalled();
    expect(res.body).toContain('already_linked');
  });
});
