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

import { hashPassword } from '../server/auth';
import {
  handleDiscordCallback,
  handleDiscordLoginLink,
  handleDiscordLoginNew,
  handleDiscordStart,
  handleDiscordStatus,
  handleDiscordUnlink,
  handleSwagClaim,
} from '../server/discord';
import { resetAuthFailures, resetDiscordRateLimits } from '../server/ratelimit';

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
let pendingRows: any[] = []; // discord_pending_logins peek/consume
let accountByIdRows: any[] = []; // accountById (password_set / username)
let findAccountRows: any[] = []; // findAccount (login/link password path)
let accountInsertRow: any[] = [{ id: 5, username: 'Maxp', password_hash: 'h' }]; // createAccount

function defaultRouter(sql: string) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  if (s.includes('INSERT INTO discord_oauth_states')) return { rows: [], rowCount: 0 };
  if (s.includes('DELETE FROM discord_oauth_states'))
    return { rows: stateRows, rowCount: stateRows.length };
  if (s.includes('DELETE FROM discord_pending_logins'))
    return { rows: pendingRows, rowCount: pendingRows.length };
  if (s.includes('FROM discord_pending_logins'))
    return { rows: pendingRows, rowCount: pendingRows.length };
  if (s.includes('SELECT account_id FROM discord_links WHERE discord_user_id'))
    return { rows: ownerRows, rowCount: ownerRows.length };
  if (s.includes('FROM discord_links WHERE account_id'))
    return { rows: linkRow, rowCount: linkRow.length };
  if (s.includes('INSERT INTO discord_links')) return { rows: [], rowCount: 1 };
  if (s.includes('DELETE FROM discord_links WHERE account_id')) return { rows: [], rowCount: 0 };
  // accounts table: distinct column lists / clauses disambiguate the helpers.
  if (s.includes('INSERT INTO accounts'))
    return { rows: accountInsertRow, rowCount: accountInsertRow.length };
  if (s.includes('FROM accounts WHERE username'))
    return { rows: findAccountRows, rowCount: findAccountRows.length };
  if (s.includes('password_set, email') && s.includes('FROM accounts WHERE id'))
    return { rows: accountByIdRows, rowCount: accountByIdRows.length };
  if (s.includes('banned_at, suspended_until')) return { rows: [], rowCount: 0 }; // not locked
  if (s.includes('SELECT points, lifetime_points FROM reward_points'))
    return { rows: rewardRows, rowCount: rewardRows.length };
  if (s.includes('INSERT INTO reward_ledger')) return { rows: [{ id: 1 }], rowCount: 1 };
  if (s.includes('INSERT INTO reward_points'))
    return { rows: [{ points: '250', lifetime_points: '250' }], rowCount: 1 };
  if (s.includes('SELECT swag_id FROM swag_claims'))
    return { rows: swagClaimRows, rowCount: swagClaimRows.length };
  // claimSwag's transactional claim path (the success tests): the claim row inserts
  // (not already claimed) and the priced spend succeeds with the balance RETURNING.
  if (s.includes('INSERT INTO swag_claims')) return { rows: [{ id: 1 }], rowCount: 1 };
  if (s.includes('UPDATE reward_points SET points = points -'))
    return { rows: [{ points: '4000' }], rowCount: 1 };
  if (s.includes('SELECT points FROM reward_points'))
    return { rows: [{ points: rewardRows[0]?.points ?? '0' }], rowCount: 1 };
  return { rows: [], rowCount: 0 };
}

beforeEach(() => {
  process.env.DISCORD_CLIENT_ID = 'client123';
  process.env.DISCORD_CLIENT_SECRET = 'secret456';
  process.env.DISCORD_GUILD_ID = '111111111111111111';
  // Auto-join is off by default; the auto-join describe sets a bot token per case.
  delete process.env.DISCORD_BOT_TOKEN;
  linkRow = [];
  ownerRows = [];
  rewardRows = [];
  swagClaimRows = [];
  stateRows = [];
  pendingRows = [];
  accountByIdRows = [];
  findAccountRows = [];
  accountInsertRow = [{ id: 5, username: 'Maxp', password_hash: 'h' }];
  resetDiscordRateLimits();
  resetAuthFailures();
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

// The two login endpoints take an isIpBlocked predicate (the route passes
// game.isIpBlocked). Default it to "not blocked" so the existing cases read clean; the
// blocked-IP cases pass `() => true` explicitly.
const loginNew = (req: any, res: any, isIpBlocked: (ip: string) => boolean = () => false) =>
  handleDiscordLoginNew(req, res, isIpBlocked);
const loginLink = (req: any, res: any, isIpBlocked: (ip: string) => boolean = () => false) =>
  handleDiscordLoginLink(req, res, isIpBlocked);

// Stub the discord.com token + identity + guilds calls for a callback test.
function mockDiscordFetch(
  user: Record<string, unknown> = {
    id: '999999999999999999',
    username: 'maxp',
    global_name: 'Maxp',
    avatar: null,
  },
  inGuild = true,
) {
  return vi.spyOn(globalThis, 'fetch' as any).mockImplementation((url: any) => {
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
        json: () => Promise.resolve(inGuild ? [{ id: '111111111111111111' }] : []),
      } as any);
    if (u.includes('/users/@me'))
      return Promise.resolve({ ok: true, json: () => Promise.resolve(user) } as any);
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as any);
  });
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

  it('surfaces passwordSet=false for a Discord-provisioned (password-less) account', async () => {
    accountByIdRows = [{ id: 1, username: 'disc123', password_set: false }];
    const res = makeRes();
    await handleDiscordStatus(makeReq(), res, 1);
    expect(parse(res).data.passwordSet).toBe(false);
  });

  it('defaults passwordSet=true when the account has a real password', async () => {
    accountByIdRows = [{ id: 1, username: 'maxp', password_set: true }];
    const res = makeRes();
    await handleDiscordStatus(makeReq(), res, 1);
    expect(parse(res).data.passwordSet).toBe(true);
  });
});

describe('DELETE /api/discord (unlink)', () => {
  it('removes the link for an account that already has a password', async () => {
    accountByIdRows = [{ id: 1, username: 'maxp', password_set: true }];
    const res = makeRes();
    await handleDiscordUnlink(makeReq(), res, 1);
    expect(parse(res)).toEqual({ status: 200, data: { unlinked: true } });
    const unlinkCall = dbMock.query.mock.calls.find((c) =>
      String(c[0]).includes('DELETE FROM discord_links'),
    );
    expect(unlinkCall).toBeDefined();
    // The delete is bound to the CALLER's account id (the guard-resolved parameter),
    // so a cross-account unlink is impossible by construction.
    expect(unlinkCall?.[1]).toEqual([1]);
    // A real-password account is never asked to set one, and nothing is reset.
    expect(
      dbMock.query.mock.calls.some((c) =>
        String(c[0]).includes('UPDATE accounts SET password_hash'),
      ),
    ).toBe(false);
  });

  it('refuses to strand a password-less account: requires a password first', async () => {
    accountByIdRows = [{ id: 1, username: 'disc123', password_set: false }];
    const res = makeRes();
    await handleDiscordUnlink(makeReq(), res, 1); // no password in the body
    const { status, data } = parse(res);
    expect(status).toBe(400);
    expect(data).toEqual({ error: 'password_required', code: 'discord.password_required' });
    // The link must NOT be removed when the account would be stranded.
    expect(
      dbMock.query.mock.calls.some((c) => String(c[0]).includes('DELETE FROM discord_links')),
    ).toBe(false);
  });

  it('sets the password then unlinks when one is supplied', async () => {
    accountByIdRows = [{ id: 1, username: 'disc123', password_set: false }];
    const res = makeRes();
    await handleDiscordUnlink(makeReq({ body: { password: 'hunter2pass' } }), res, 1);
    expect(parse(res)).toEqual({ status: 200, data: { unlinked: true } });
    const calls = dbMock.query.mock.calls.map((c) => String(c[0]));
    const setIdx = calls.findIndex((c) => c.includes('UPDATE accounts SET password_hash'));
    const unlinkIdx = calls.findIndex((c) => c.includes('DELETE FROM discord_links'));
    expect(setIdx).toBeGreaterThanOrEqual(0);
    expect(unlinkIdx).toBeGreaterThanOrEqual(0);
    // Password is set BEFORE the link is removed, so a later failure can't strand it.
    expect(setIdx).toBeLessThan(unlinkIdx);
  });

  it('rejects a too-short password without unlinking', async () => {
    accountByIdRows = [{ id: 1, username: 'disc123', password_set: false }];
    const res = makeRes();
    await handleDiscordUnlink(makeReq({ body: { password: 'short' } }), res, 1);
    expect(parse(res).status).toBe(400);
    expect(
      dbMock.query.mock.calls.some((c) => String(c[0]).includes('DELETE FROM discord_links')),
    ).toBe(false);
  });

  it('404s with the account.not_found code when the account row is gone', async () => {
    accountByIdRows = []; // the account vanished mid-session
    const res = makeRes();
    await handleDiscordUnlink(makeReq(), res, 1);
    expect(parse(res)).toEqual({
      status: 404,
      data: { error: 'account not found', code: 'account.not_found' },
    });
  });
});

describe('POST /api/discord/swag/claim', () => {
  it('400s on an unknown swag id', async () => {
    const res = makeRes();
    await handleSwagClaim(makeReq({ body: { swagId: 'nope' } }), res, 1, noopGrant);
    expect(parse(res)).toEqual({
      status: 400,
      data: { error: 'unknown swag item', code: 'discord.unknown_swag' },
    });
  });

  it('403s when the account has no linked Discord', async () => {
    linkRow = []; // not linked
    const res = makeRes();
    await handleSwagClaim(makeReq({ body: { swagId: 'title_discordian' } }), res, 1, noopGrant);
    expect(parse(res)).toEqual({
      status: 403,
      data: { error: 'link your Discord account first', code: 'discord.link_required' },
    });
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
    expect(data).toEqual({ error: 'tier', code: 'discord.swag_tier' });
    // No claim insert attempted on a gated request.
    expect(
      dbMock.query.mock.calls.some((c) => String(c[0]).includes('INSERT INTO swag_claims')),
    ).toBe(false);
  });

  it('409s a points-gated claim with the swag_points code', async () => {
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
    // Tier 5 via lifetime points, but the spendable balance is below the chroma cost.
    rewardRows = [{ points: '100', lifetime_points: '5000' }];
    swagClaimRows = [];
    const res = makeRes();
    await handleSwagClaim(makeReq({ body: { swagId: 'chroma_blurple' } }), res, 1, noopGrant);
    expect(parse(res)).toEqual({
      status: 409,
      data: { error: 'points', code: 'discord.swag_points' },
    });
  });

  it('409s an already-claimed swag with the swag_claimed code', async () => {
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
    rewardRows = [{ points: '5000', lifetime_points: '5000' }];
    swagClaimRows = [{ swag_id: 'chroma_blurple' }]; // already claimed
    const res = makeRes();
    await handleSwagClaim(makeReq({ body: { swagId: 'chroma_blurple' } }), res, 1, noopGrant);
    expect(parse(res)).toEqual({
      status: 409,
      data: { error: 'claimed', code: 'discord.swag_claimed' },
    });
  });

  it('claims a cosmetic and invokes the grant callback with the swag grantId (the live-chroma hook)', async () => {
    // The success path the Phase 16 route glue rides: a linked, tier-qualified,
    // point-rich account claims the chroma; the durable claim commits and the
    // grantCosmetic hook (game.grantMechChromaToAccount on the wired server) receives
    // the CATALOG grantId, never a client-supplied value.
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
    rewardRows = [{ points: '5000', lifetime_points: '5000' }]; // tier 5, >= chroma minTier 3
    swagClaimRows = [];
    const grant = vi.fn();
    const res = makeRes();
    await handleSwagClaim(makeReq({ body: { swagId: 'chroma_blurple' } }), res, 1, grant);
    const { status, data } = parse(res);
    expect(status).toBe(200);
    expect(grant).toHaveBeenCalledTimes(1);
    expect(grant).toHaveBeenCalledWith('vanguard_azure');
    expect(data.swagId).toBe('chroma_blurple');
    expect(data.kind).toBe('cosmetic');
    expect(data.claimed).toContain('chroma_blurple');
    // The spend is the parameterized cost against the caller's account row.
    const spend = dbMock.query.mock.calls.find((c) =>
      String(c[0]).includes('UPDATE reward_points SET points = points -'),
    );
    expect(spend?.[1]).toEqual([1, 1000]);
  });

  it('claims a title WITHOUT invoking the grant callback (only cosmetic-kind swag grants live)', async () => {
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
    rewardRows = [{ points: '0', lifetime_points: '0' }]; // tier 1 covers title_discordian (cost 0)
    swagClaimRows = [];
    const grant = vi.fn();
    const res = makeRes();
    await handleSwagClaim(makeReq({ body: { swagId: 'title_discordian' } }), res, 1, grant);
    const { status, data } = parse(res);
    expect(status).toBe(200);
    expect(data.kind).toBe('title');
    expect(grant).not.toHaveBeenCalled();
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

  it('first-time login parks a chooser instead of auto-provisioning an account', async () => {
    stateRows = [
      { state: 's', code_verifier: 'v', mode: 'login', account_id: null, redirect_to: null },
    ];
    ownerRows = []; // this Discord id has no account yet
    mockDiscordFetch();
    const res = makeRes();
    await handleDiscordCallback(
      makeReq({ url: '/api/auth/discord/callback?code=abc&state=s' }),
      res,
    );
    const calls = dbMock.query.mock.calls.map((c) => String(c[0]));
    // The whole point of issue 1: NO account is auto-created on first login.
    expect(calls.some((c) => c.includes('INSERT INTO accounts'))).toBe(false);
    // The verified identity is parked for the chooser, and the page offers the choice.
    expect(calls.some((c) => c.includes('INSERT INTO discord_pending_logins'))).toBe(true);
    // Assert on the inlined PAYLOAD (the static script always mentions both literals).
    expect(res.body).toContain('"choose":true');
    expect(res.body).toContain('"linkToken"');
    expect(res.body).not.toContain('"token"'); // no session minted yet
  });

  it('logs a returning Discord user straight in (mints a session, no chooser)', async () => {
    stateRows = [
      { state: 's', code_verifier: 'v', mode: 'login', account_id: null, redirect_to: null },
    ];
    ownerRows = [{ account_id: 1 }]; // already linked
    accountByIdRows = [{ id: 1, username: 'maxp', password_set: true }];
    mockDiscordFetch();
    const res = makeRes();
    await handleDiscordCallback(
      makeReq({ url: '/api/auth/discord/callback?code=abc&state=s' }),
      res,
    );
    // A session token is minted in the payload; the chooser is not offered.
    expect(res.body).toContain('"token"');
    expect(res.body).not.toContain('"choose":true');
  });
});

// Stub the token + identity + guilds + PUT-join calls for an auto-join callback.
// joinStatus mirrors Discord's PUT /guilds/{id}/members/{id}: 201 = added (default),
// 204 = already a member, a 4xx = failure. Production only reads resp.ok, so both
// 201 and 204 count as "in" and any 4xx leaves them not-joined.
function mockDiscordJoinFetch(
  opts: { inGuild?: boolean; joinStatus?: number; scope?: string } = {},
) {
  const inGuild = opts.inGuild ?? false;
  const joinStatus = opts.joinStatus ?? 201;
  const scope = opts.scope ?? 'identify guilds guilds.join';
  return vi.spyOn(globalThis, 'fetch' as any).mockImplementation((url: any, _init?: any) => {
    const u = String(url);
    // Most specific first: the Bot-authed PUT that adds the member.
    if (u.includes('/members/'))
      return Promise.resolve({
        ok: joinStatus >= 200 && joinStatus < 300,
        status: joinStatus,
        json: () => Promise.resolve(null),
      } as any);
    if (u.includes('/oauth2/token'))
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'tok',
            token_type: 'Bearer',
            scope,
            expires_in: 600,
          }),
      } as any);
    if (u.includes('/users/@me/guilds'))
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(inGuild ? [{ id: '111111111111111111' }] : []),
      } as any);
    if (u.includes('/users/@me'))
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            id: '999999999999999999',
            username: 'maxp',
            global_name: 'Maxp',
            avatar: null,
          }),
      } as any);
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as any);
  });
}

describe('auto-join on link/login (guilds.join)', () => {
  const LINK_STATE = [
    { state: 's', code_verifier: 'v', mode: 'link', account_id: 1, redirect_to: null },
  ];
  const putCall = (spy: any) =>
    spy.mock.calls.find((c: any[]) => String(c[0]).includes('/members/'));
  const linkInsert = () =>
    dbMock.query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO discord_links'));

  it('requests the guilds.join scope on start only when a bot token is set', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    const withToken = makeRes();
    await handleDiscordStart(makeReq({ url: '/api/auth/discord/start?mode=link' }), withToken, {
      mode: 'link',
      accountId: 1,
    });
    expect(new URL(parse(withToken).data.url).searchParams.get('scope')).toBe(
      'identify email guilds guilds.join',
    );

    delete process.env.DISCORD_BOT_TOKEN;
    const without = makeRes();
    await handleDiscordStart(makeReq({ url: '/api/auth/discord/start?mode=link' }), without, {
      mode: 'link',
      accountId: 1,
    });
    expect(new URL(parse(without).data.url).searchParams.get('scope')).toBe(
      'identify email guilds',
    );
  });

  it('adds a non-member to the guild and records membership + reward on link', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    stateRows = LINK_STATE;
    ownerRows = []; // the Discord id is free to link on account 1
    const fetchSpy = mockDiscordJoinFetch({ inGuild: false, joinStatus: 201 }); // 201 = added
    const res = makeRes();
    await handleDiscordCallback(
      makeReq({ url: '/api/auth/discord/callback?code=abc&state=s' }),
      res,
    );
    // The Bot-authed PUT carried the bot token + the user's access token.
    const put = putCall(fetchSpy);
    expect(put).toBeTruthy();
    expect(put[1].method).toBe('PUT');
    expect(put[1].headers.Authorization).toBe('Bot bot-token');
    expect(JSON.parse(put[1].body)).toEqual({ access_token: 'tok' });
    // The link row records guild_member = true (param $6, after the added
    // discord_email $5), and BOTH the link reward and the guild-member reward are
    // granted (two ledger writes).
    expect(linkInsert()?.[1]?.[5]).toBe(true);
    const ledger = dbMock.query.mock.calls.filter((c) =>
      String(c[0]).includes('INSERT INTO reward_ledger'),
    );
    expect(ledger.length).toBe(2);
    expect(res.body).toContain('"ok":true');
  });

  it('counts a 204 add response (a TOCTOU already-member) as joined', async () => {
    // If /users/@me/guilds was stale and the user is actually already in, the add
    // call returns 204; resp.ok is still true, so we treat them as a member.
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    stateRows = LINK_STATE;
    ownerRows = [];
    const fetchSpy = mockDiscordJoinFetch({ inGuild: false, joinStatus: 204 });
    const res = makeRes();
    await handleDiscordCallback(
      makeReq({ url: '/api/auth/discord/callback?code=abc&state=s' }),
      res,
    );
    expect(putCall(fetchSpy)).toBeTruthy();
    expect(linkInsert()?.[1]?.[5]).toBe(true);
  });

  it('skips the join when the user is already a guild member', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    stateRows = LINK_STATE;
    ownerRows = [];
    const fetchSpy = mockDiscordJoinFetch({ inGuild: true });
    const res = makeRes();
    await handleDiscordCallback(
      makeReq({ url: '/api/auth/discord/callback?code=abc&state=s' }),
      res,
    );
    expect(putCall(fetchSpy)).toBeFalsy(); // no add attempted, already in
    expect(linkInsert()?.[1]?.[5]).toBe(true);
  });

  it('does not attempt a join when no bot token is configured (membership only)', async () => {
    // DISCORD_BOT_TOKEN unset: a non-member stays a non-member; no PUT is made.
    stateRows = LINK_STATE;
    ownerRows = [];
    const fetchSpy = mockDiscordJoinFetch({ inGuild: false });
    const res = makeRes();
    await handleDiscordCallback(
      makeReq({ url: '/api/auth/discord/callback?code=abc&state=s' }),
      res,
    );
    expect(putCall(fetchSpy)).toBeFalsy();
    expect(linkInsert()?.[1]?.[5]).toBe(false);
  });

  it('links best-effort even when the guild join call fails', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    stateRows = LINK_STATE;
    ownerRows = [];
    mockDiscordJoinFetch({ inGuild: false, joinStatus: 403 }); // e.g. bot lacks Create Invite
    const res = makeRes();
    await handleDiscordCallback(
      makeReq({ url: '/api/auth/discord/callback?code=abc&state=s' }),
      res,
    );
    // A failed add leaves them recorded as a non-member, but the link still succeeds.
    expect(linkInsert()?.[1]?.[5]).toBe(false);
    expect(res.body).toContain('"ok":true');
  });

  it('does not join when the user declined the guilds.join scope', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    stateRows = LINK_STATE;
    ownerRows = [];
    // Token came back WITHOUT guilds.join granted -> we must not call the add.
    const fetchSpy = mockDiscordJoinFetch({ inGuild: false, scope: 'identify guilds' });
    const res = makeRes();
    await handleDiscordCallback(
      makeReq({ url: '/api/auth/discord/callback?code=abc&state=s' }),
      res,
    );
    expect(putCall(fetchSpy)).toBeFalsy();
    expect(linkInsert()?.[1]?.[5]).toBe(false);
  });
});

describe('recovery-email capture from the Discord email scope', () => {
  const LINK_STATE = [
    { state: 's', code_verifier: 'v', mode: 'link', account_id: 1, redirect_to: null },
  ];
  const linkInsert = () =>
    dbMock.query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO discord_links'));
  const backfill = () =>
    dbMock.query.mock.calls.find((c) =>
      String(c[0]).replace(/\s+/g, ' ').includes("email IS NULL OR email = ''"),
    );

  it('stores the address on the link and backfills a verified recovery email', async () => {
    stateRows = LINK_STATE;
    ownerRows = [];
    // /users/@me now returns a verified email (email scope was granted).
    mockDiscordFetch(
      {
        id: '999999999999999999',
        username: 'maxp',
        global_name: 'Maxp',
        avatar: null,
        email: 'maxp@example.com',
        verified: true,
      },
      true,
    );
    const res = makeRes();
    await handleDiscordCallback(
      makeReq({ url: '/api/auth/discord/callback?code=abc&state=s' }),
      res,
    );
    // The link row carries the captured email (param $5), and the account's empty
    // recovery email is backfilled with verified=true.
    expect(linkInsert()?.[1]?.[4]).toBe('maxp@example.com');
    expect(backfill()?.[1]).toEqual([1, 'maxp@example.com', true]);
    expect(res.body).toContain('"ok":true');
  });

  it('does not backfill the account email when Discord returned no address', async () => {
    stateRows = LINK_STATE;
    ownerRows = [];
    mockDiscordFetch(
      { id: '999999999999999999', username: 'maxp', global_name: 'Maxp', avatar: null },
      true,
    );
    const res = makeRes();
    await handleDiscordCallback(
      makeReq({ url: '/api/auth/discord/callback?code=abc&state=s' }),
      res,
    );
    expect(linkInsert()?.[1]?.[4]).toBeNull();
    expect(backfill()).toBeFalsy();
  });

  it('keeps an unverified Discord email but does not stamp it verified', async () => {
    stateRows = LINK_STATE;
    ownerRows = [];
    mockDiscordFetch(
      {
        id: '999999999999999999',
        username: 'maxp',
        global_name: 'Maxp',
        avatar: null,
        email: 'maxp@example.com',
        verified: false,
      },
      true,
    );
    const res = makeRes();
    await handleDiscordCallback(
      makeReq({ url: '/api/auth/discord/callback?code=abc&state=s' }),
      res,
    );
    // Address captured, but the verified flag passed to the backfill is false.
    expect(linkInsert()?.[1]?.[4]).toBe('maxp@example.com');
    expect(backfill()?.[1]).toEqual([1, 'maxp@example.com', false]);
  });
});

describe('POST /api/auth/discord/login/new', () => {
  it('400s on a missing/expired link token', async () => {
    pendingRows = []; // consume returns nothing
    const res = makeRes();
    await loginNew(makeReq({ body: { linkToken: 'gone' } }), res);
    expect(parse(res)).toEqual({
      status: 400,
      data: { error: 'expired', code: 'discord.expired' },
    });
  });

  it('409s with the already_linked code when the link insert loses the race and no owner is found', async () => {
    pendingRows = [
      {
        token: 't',
        discord_user_id: '999999999999999999',
        discord_username: 'Maxp',
        discord_avatar: null,
        guild_member: false,
      },
    ];
    ownerRows = []; // no owner before OR after the failed insert (the racing link vanished)
    findAccountRows = []; // username 'Maxp' is free, so a fresh account is provisioned
    dbMock.query.mockImplementation((sql: string) => {
      // The link upsert loses the discord_user_id TOCTOU race: linkDiscordToAccount
      // maps the 23505 unique violation to false (discord_db.ts), and with no owner
      // row to fall back to, loginNew answers the coded already_linked 409.
      if (String(sql).includes('INSERT INTO discord_links')) {
        return Promise.reject(Object.assign(new Error('duplicate key'), { code: '23505' }));
      }
      return Promise.resolve(defaultRouter(sql));
    });
    const res = makeRes();
    await loginNew(makeReq({ body: { linkToken: 't' } }), res);
    expect(parse(res)).toEqual({
      status: 409,
      data: { error: 'already_linked', code: 'discord.already_linked' },
    });
  });

  it('provisions a password-less account, links it, and returns a session', async () => {
    pendingRows = [
      {
        token: 't',
        discord_user_id: '999999999999999999',
        discord_username: 'Maxp',
        discord_avatar: null,
        guild_member: false,
      },
    ];
    ownerRows = []; // not yet linked
    findAccountRows = []; // username 'Maxp' is free
    accountInsertRow = [{ id: 5, username: 'Maxp', password_hash: 'h' }];
    const res = makeRes();
    await loginNew(makeReq({ body: { linkToken: 't' } }), res);
    const { status, data } = parse(res);
    expect(status).toBe(200);
    expect(data.username).toBe('Maxp');
    expect(typeof data.token).toBe('string');
    const calls = dbMock.query.mock.calls;
    const insertAcct = calls.find((c) => String(c[0]).includes('INSERT INTO accounts'));
    expect(insertAcct).toBeTruthy();
    // The provisioned account is created password-less (issue 2 hinges on this).
    expect(insertAcct?.[1]?.[4]).toBe(false);
    expect(calls.some((c) => String(c[0]).includes('INSERT INTO discord_links'))).toBe(true);
    expect(calls.some((c) => String(c[0]).includes('INSERT INTO auth_tokens'))).toBe(true);
  });

  it('429s a blocked IP before consuming the token or provisioning', async () => {
    pendingRows = [
      {
        token: 't',
        discord_user_id: '999999999999999999',
        discord_username: 'Maxp',
        discord_avatar: null,
        guild_member: false,
      },
    ];
    const res = makeRes();
    await loginNew(makeReq({ body: { linkToken: 't' } }), res, () => true);
    expect(parse(res).status).toBe(429);
    // The block short-circuits before any DB work: no token consume, no account insert.
    const calls = dbMock.query.mock.calls.map((c) => String(c[0]));
    expect(calls.some((c) => c.includes('DELETE FROM discord_pending_logins'))).toBe(false);
    expect(calls.some((c) => c.includes('INSERT INTO accounts'))).toBe(false);
  });
});

describe('POST /api/auth/discord/login/link', () => {
  const PENDING = {
    token: 't',
    discord_user_id: '999999999999999999',
    discord_username: 'Maxp',
    discord_avatar: null,
    guild_member: false,
  };

  it('400s on a missing/expired link token', async () => {
    pendingRows = [];
    const res = makeRes();
    await loginLink(
      makeReq({ body: { linkToken: 'gone', username: 'maxp', password: 'whatever' } }),
      res,
    );
    expect(parse(res)).toEqual({
      status: 400,
      data: { error: 'expired', code: 'discord.expired' },
    });
  });

  it('401s on a wrong password and does NOT consume the token', async () => {
    pendingRows = [{ ...PENDING }];
    findAccountRows = [
      { id: 1, username: 'maxp', password_hash: await hashPassword('correcthorse') },
    ];
    const res = makeRes();
    await loginLink(
      makeReq({ body: { linkToken: 't', username: 'maxp', password: 'wrongpassword' } }),
      res,
    );
    expect(parse(res)).toEqual({
      status: 401,
      data: { error: 'invalid username or password', code: 'auth.invalid_credentials' },
    });
    expect(
      dbMock.query.mock.calls.some((c) =>
        String(c[0]).includes('DELETE FROM discord_pending_logins'),
      ),
    ).toBe(false);
  });

  it('returns twoFactorRequired (token preserved) when the account has 2FA and no code', async () => {
    pendingRows = [{ ...PENDING }];
    findAccountRows = [
      {
        id: 1,
        username: 'maxp',
        password_hash: await hashPassword('correcthorse'),
        totp_enabled_at: '2026-01-01T00:00:00Z',
        totp_secret: 'SECRET',
      },
    ];
    const res = makeRes();
    await loginLink(
      makeReq({ body: { linkToken: 't', username: 'maxp', password: 'correcthorse' } }),
      res,
    );
    expect(parse(res).data.twoFactorRequired).toBe(true);
    expect(
      dbMock.query.mock.calls.some((c) =>
        String(c[0]).includes('DELETE FROM discord_pending_logins'),
      ),
    ).toBe(false);
  });

  it('feeds the per-account brute-force lockout on a bad 2FA code (parity with /api/login)', async () => {
    // Correct password, wrong second factor each time. A recovery code is used so the
    // verification is deterministic (consumeRecoveryCode finds nothing -> false).
    findAccountRows = [
      {
        id: 1,
        username: 'maxp',
        password_hash: await hashPassword('correcthorse'),
        totp_enabled_at: '2026-01-01T00:00:00Z',
        totp_secret: 'SECRET',
      },
    ];
    let throttled = false;
    for (let i = 0; i < 13; i++) {
      pendingRows = [{ ...PENDING }]; // token survives a failed attempt (peek, not consumed)
      const res = makeRes();
      await loginLink(
        makeReq({
          body: {
            linkToken: 't',
            username: 'maxp',
            password: 'correcthorse',
            recoveryCode: `bad${i}`,
          },
        }),
        res,
      );
      const { status, data } = parse(res);
      if (status === 429 && /too many failed attempts/.test(data.error)) {
        throttled = true; // the per-account lockout (not the per-IP bucket) tripped
        break;
      }
    }
    expect(throttled).toBe(true);
  });

  it('links the existing account on a correct password (never provisions a new one)', async () => {
    pendingRows = [{ ...PENDING }];
    findAccountRows = [
      { id: 1, username: 'maxp', password_hash: await hashPassword('correcthorse') },
    ];
    ownerRows = []; // the Discord id is free to link
    const res = makeRes();
    await loginLink(
      makeReq({ body: { linkToken: 't', username: 'maxp', password: 'correcthorse' } }),
      res,
    );
    const { status, data } = parse(res);
    expect(status).toBe(200);
    expect(data.username).toBe('maxp');
    expect(typeof data.token).toBe('string');
    const calls = dbMock.query.mock.calls.map((c) => String(c[0]));
    expect(calls.some((c) => c.includes('DELETE FROM discord_pending_logins'))).toBe(true);
    expect(calls.some((c) => c.includes('INSERT INTO discord_links'))).toBe(true);
    expect(calls.some((c) => c.includes('INSERT INTO auth_tokens'))).toBe(true);
    expect(calls.some((c) => c.includes('INSERT INTO accounts'))).toBe(false);
  });

  it('429s a blocked IP before consuming the token or verifying the password', async () => {
    pendingRows = [{ ...PENDING }];
    findAccountRows = [
      { id: 1, username: 'maxp', password_hash: await hashPassword('correcthorse') },
    ];
    const res = makeRes();
    await loginLink(
      makeReq({ body: { linkToken: 't', username: 'maxp', password: 'correcthorse' } }),
      res,
      () => true,
    );
    expect(parse(res).status).toBe(429);
    // No token consume and no link write: the gate fires before any of that.
    const calls = dbMock.query.mock.calls.map((c) => String(c[0]));
    expect(calls.some((c) => c.includes('DELETE FROM discord_pending_logins'))).toBe(false);
    expect(calls.some((c) => c.includes('INSERT INTO discord_links'))).toBe(false);
  });
});
