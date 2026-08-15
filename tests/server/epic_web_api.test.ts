// The Epic Auth Web API fetch shell (server/epic/web_api.ts), driven directly
// through its fetchImpl injection param: every fault-mapping branch (network
// error, timeout, non-2xx classification, malformed 2xx, all to the matching
// outcome), the verdict pass-throughs, and the secret-embedding request the
// shell feeds to fetch. No module mocks: the injection seam exists precisely
// so this file can run the REAL shell code.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildClientCredentialsTokenRequest,
  buildExchangeCodeTokenRequest,
  buildExternalAccountMappingUrl,
  buildUnlockAchievementsRequest,
  CLIENT_CREDENTIALS_GRANT,
  EPIC_CONNECT_TOKEN_URL,
  EPIC_GS_HOST,
  EPIC_IDENTITY_PROVIDER,
  EPIC_TOKEN_URL,
  EXCHANGE_CODE_GRANT,
  parseClientCredentialsTokenResponse,
  parseExternalAccountMappingResponse,
} from '../../server/epic/ticket';
import {
  PUID_CACHE_MAX,
  pushAchievementUnlock,
  pushAchievementUnlocks,
  resetEpicWebApiCachesForTests,
  UPSTREAM_TIMEOUT_MS,
  verifyLinkProof,
} from '../../server/epic/web_api';

// The push path memoizes the client token and the product-user mapping per
// process; every case starts from a cold cache so call-count pins stay exact.
beforeEach(() => {
  resetEpicWebApiCachesForTests();
});
afterEach(() => {
  vi.useRealTimers();
});

const OPTS = {
  clientId: 'CID',
  clientSecret: 'CSEC',
  deploymentId: 'DEP',
  proof: 'EXCHANGE01',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const OK_BODY = {
  access_token: 'eg1~unused',
  token_type: 'bearer',
  expires_in: 7200,
  account_id: 'a1b2c3d4e5f60718',
  client_id: 'CID',
};

describe('verifyLinkProof fault mapping', () => {
  it('maps a network error (fetch rejects) to upstream', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await verifyLinkProof(OPTS, fetchImpl as unknown as typeof fetch)).toEqual({
      kind: 'upstream',
    });
  });

  it('maps a timeout abort to upstream', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new DOMException('The operation timed out.', 'TimeoutError');
    });
    expect(await verifyLinkProof(OPTS, fetchImpl as unknown as typeof fetch)).toEqual({
      kind: 'upstream',
    });
  });

  it('maps a non-JSON 4xx body to upstream', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>not json</html>', { status: 400 }));
    expect(await verifyLinkProof(OPTS, fetchImpl as unknown as typeof fetch)).toEqual({
      kind: 'upstream',
    });
  });

  it('maps a non-JSON 2xx body to upstream', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>not json</html>', { status: 200 }));
    expect(await verifyLinkProof(OPTS, fetchImpl as unknown as typeof fetch)).toEqual({
      kind: 'upstream',
    });
  });

  it('maps a JSON 2xx body that parses to malformed to upstream, never a verdict', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ access_token: 'x' }));
    expect(await verifyLinkProof(OPTS, fetchImpl as unknown as typeof fetch)).toEqual({
      kind: 'upstream',
    });
  });

  it('maps a 5xx status to upstream', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'server_error' }, 503));
    expect(await verifyLinkProof(OPTS, fetchImpl as unknown as typeof fetch)).toEqual({
      kind: 'upstream',
    });
  });

  it('maps invalid_client on 401 to upstream (credentials fault)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'invalid_client' }, 401));
    expect(await verifyLinkProof(OPTS, fetchImpl as unknown as typeof fetch)).toEqual({
      kind: 'upstream',
    });
  });
});

describe('verifyLinkProof verdict pass-through', () => {
  it('passes through ok with the epic account id', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(OK_BODY));
    expect(await verifyLinkProof(OPTS, fetchImpl as unknown as typeof fetch)).toEqual({
      kind: 'ok',
      epicAccountId: 'a1b2c3d4e5f60718',
    });
  });

  it('passes through invalid (invalid_grant)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'invalid_grant' }, 400));
    expect(await verifyLinkProof(OPTS, fetchImpl as unknown as typeof fetch)).toEqual({
      kind: 'invalid',
    });
  });

  it('passes through banned (access_denied)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'access_denied' }, 403));
    expect(await verifyLinkProof(OPTS, fetchImpl as unknown as typeof fetch)).toEqual({
      kind: 'banned',
    });
  });
});

describe('verifyLinkProof request shape', () => {
  it('POSTs the built exchange_code token request with a timeout signal', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(OK_BODY));
    await verifyLinkProof(OPTS, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(EPIC_TOKEN_URL);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/x-www-form-urlencoded',
    );
    const body = init.body as URLSearchParams;
    expect(body.get('grant_type')).toBe(EXCHANGE_CODE_GRANT);
    expect(body.get('exchange_code')).toBe('EXCHANGE01');
    expect(body.get('deployment_id')).toBe('DEP');
    expect(body.get('client_id')).toBe('CID');
    expect(body.get('client_secret')).toBe('CSEC');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('request builders (client-secret embedding)', () => {
  it('buildExchangeCodeTokenRequest embeds every param on the official host', () => {
    const { url, body } = buildExchangeCodeTokenRequest({
      clientId: 'K',
      clientSecret: 'S',
      deploymentId: 'D',
      exchangeCode: 'E',
    });
    expect(url).toBe('https://api.epicgames.dev/epic/oauth/v2/token');
    expect(body.get('grant_type')).toBe('exchange_code');
    expect(body.get('exchange_code')).toBe('E');
    expect(body.get('deployment_id')).toBe('D');
    expect(body.get('client_id')).toBe('K');
    expect(body.get('client_secret')).toBe('S');
  });
});

// ---------------------------------------------------------------------------
// Achievement unlock push (O2 server-trusted path). No live Epic calls.
// ---------------------------------------------------------------------------

const UNLOCK_OPTS = {
  clientId: 'CID',
  clientSecret: 'CSEC',
  deploymentId: 'DEP',
  epicAccountId: 'a1b2c3d4e5f60718',
  achNames: ['ACH_FIRST_STEPS', 'ACH_LEVEL_CAP'] as const,
};

const CLIENT_TOKEN_BODY = {
  access_token: 'eg1~client-token',
  token_type: 'bearer',
  expires_in: 3600,
};

const PUID = '0002a1b2c3d4e5f60718192021222324';
const MAPPING_BODY = {
  ids: { [UNLOCK_OPTS.epicAccountId]: PUID },
};

describe('O2 unlock request builders (host/path/field pins)', () => {
  it('buildClientCredentialsTokenRequest uses Connect token host and Basic auth', () => {
    const { url, body, headers } = buildClientCredentialsTokenRequest({
      clientId: 'K',
      clientSecret: 'S',
    });
    expect(url).toBe(EPIC_CONNECT_TOKEN_URL);
    expect(url).toBe('https://api.epicgames.dev/auth/v1/oauth/token');
    // The grant literal itself, pinned so an edit to the shared constant cannot
    // move both sides of the comparison below at once.
    expect(CLIENT_CREDENTIALS_GRANT).toBe('client_credentials');
    expect(body.get('grant_type')).toBe(CLIENT_CREDENTIALS_GRANT);
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(headers.Authorization).toBe(`Basic ${Buffer.from('K:S', 'utf8').toString('base64')}`);
  });

  it('buildExternalAccountMappingUrl pins user accounts path and epicgames provider', () => {
    // The provider literal itself, pinned for the same both-sides-move reason.
    expect(EPIC_IDENTITY_PROVIDER).toBe('epicgames');
    const url = buildExternalAccountMappingUrl({ epicAccountId: 'acct1' });
    expect(url).toBe(
      `${EPIC_GS_HOST}/user/v1/accounts?accountId=acct1&identityProviderId=${EPIC_IDENTITY_PROVIDER}`,
    );
  });

  it('the upstream fetch deadline is 5s (a drift to a hung-click magnitude reds here)', () => {
    expect(UPSTREAM_TIMEOUT_MS).toBe(5000);
  });

  it('buildUnlockAchievementsRequest pins Stats Achievements unlock path and body field', () => {
    const { url, body, headers } = buildUnlockAchievementsRequest({
      deploymentId: 'DEP',
      productUserId: PUID,
      accessToken: 'tok',
      achievementIds: ['ACH_A', 'ACH_B'],
    });
    expect(url).toBe(`https://api.epicgames.dev/stats/v1/DEP/players/${PUID}/achievements/unlock`);
    expect(JSON.parse(body)).toEqual({ achievementIds: ['ACH_A', 'ACH_B'] });
    expect(headers.Authorization).toBe('Bearer tok');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('parseClientCredentialsTokenResponse and mapping parse are defensive', () => {
    expect(parseClientCredentialsTokenResponse({ access_token: 't' })).toBe('t');
    expect(parseClientCredentialsTokenResponse({})).toBeNull();
    expect(parseExternalAccountMappingResponse(MAPPING_BODY, UNLOCK_OPTS.epicAccountId)).toBe(PUID);
    expect(parseExternalAccountMappingResponse({ ids: {} }, UNLOCK_OPTS.epicAccountId)).toBeNull();
  });

  it('mapping parse clamps the product user id shape (it is interpolated into the unlock URL path)', () => {
    const bodyWith = (puid: string) => ({ ids: { [UNLOCK_OPTS.epicAccountId]: puid } });
    // Dot segments must die at the parse: encodeURIComponent leaves dots
    // alone, so a dot-bearing value would survive into the Stats path and
    // normalize to a different endpoint on the same host.
    expect(
      parseExternalAccountMappingResponse(
        bodyWith('../../auth/v1/oauth/token'),
        UNLOCK_OPTS.epicAccountId,
      ),
    ).toBeNull();
    expect(
      parseExternalAccountMappingResponse(bodyWith('short'), UNLOCK_OPTS.epicAccountId),
    ).toBeNull();
    expect(
      parseExternalAccountMappingResponse(bodyWith('x'.repeat(129)), UNLOCK_OPTS.epicAccountId),
    ).toBeNull();
    expect(parseExternalAccountMappingResponse(bodyWith(PUID), UNLOCK_OPTS.epicAccountId)).toBe(
      PUID,
    );
  });
});

describe('pushAchievementUnlocks (mocked fetchImpl)', () => {
  it('walks token -> map -> unlock and returns true on 2xx unlock', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('/auth/v1/oauth/token')) return jsonResponse(CLIENT_TOKEN_BODY);
      if (String(url).includes('/user/v1/accounts')) return jsonResponse(MAPPING_BODY);
      // Undici rejects Response bodies on 204; a bare 200 stands in for success.
      if (String(url).includes('/achievements/unlock')) return new Response(null, { status: 200 });
      throw new Error(`unexpected url ${url}`);
    });
    expect(
      await pushAchievementUnlocks(
        { ...UNLOCK_OPTS, achNames: [...UNLOCK_OPTS.achNames] },
        fetchImpl as never,
      ),
    ).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    // Authorization threading, pinned per hop: the token mint carries Basic
    // clientId:clientSecret, and the MINTED token (never the client secret)
    // rides Bearer on the mapping read and the unlock POST. Without these
    // pins a credential misroute (secret as Bearer, blank token, no header)
    // would stay green.
    const tokenCall = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((tokenCall[1].headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from('CID:CSEC', 'utf8').toString('base64')}`,
    );
    const mappingCall = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    expect((mappingCall[1].headers as Record<string, string>).Authorization).toBe(
      'Bearer eg1~client-token',
    );
    const unlockCall = fetchImpl.mock.calls[2] as unknown as [string, RequestInit];
    expect(unlockCall[0]).toContain('/stats/v1/DEP/players/');
    expect(unlockCall[0]).toContain('/achievements/unlock');
    expect(unlockCall[1].method).toBe('POST');
    expect((unlockCall[1].headers as Record<string, string>).Authorization).toBe(
      'Bearer eg1~client-token',
    );
    expect(JSON.parse(String(unlockCall[1].body))).toEqual({
      achievementIds: ['ACH_FIRST_STEPS', 'ACH_LEVEL_CAP'],
    });
  });

  it('returns false when client token fetch fails (network)', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    expect(
      await pushAchievementUnlocks({ ...UNLOCK_OPTS, achNames: ['ACH_X'] }, fetchImpl as never),
    ).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('returns false when product user mapping is empty', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('/auth/v1/oauth/token')) return jsonResponse(CLIENT_TOKEN_BODY);
      if (String(url).includes('/user/v1/accounts')) return jsonResponse({ ids: {} });
      throw new Error(`unexpected url ${url}`);
    });
    expect(
      await pushAchievementUnlocks({ ...UNLOCK_OPTS, achNames: ['ACH_X'] }, fetchImpl as never),
    ).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('returns false when unlock POST is non-2xx', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('/auth/v1/oauth/token')) return jsonResponse(CLIENT_TOKEN_BODY);
      if (String(url).includes('/user/v1/accounts')) return jsonResponse(MAPPING_BODY);
      return jsonResponse({ error: 'server_error' }, 503);
    });
    expect(
      await pushAchievementUnlocks({ ...UNLOCK_OPTS, achNames: ['ACH_X'] }, fetchImpl as never),
    ).toBe(false);
  });

  it('empty achNames is a no-op success without fetch', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    expect(await pushAchievementUnlocks({ ...UNLOCK_OPTS, achNames: [] }, fetchImpl as never)).toBe(
      true,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('pushAchievementUnlock (singular) delegates to the batch path with one name', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('/auth/v1/oauth/token')) return jsonResponse(CLIENT_TOKEN_BODY);
      if (String(url).includes('/user/v1/accounts')) return jsonResponse(MAPPING_BODY);
      if (String(url).includes('/achievements/unlock')) return new Response(null, { status: 200 });
      throw new Error(`unexpected url ${url}`);
    });
    expect(
      await pushAchievementUnlock(
        {
          clientId: UNLOCK_OPTS.clientId,
          clientSecret: UNLOCK_OPTS.clientSecret,
          deploymentId: UNLOCK_OPTS.deploymentId,
          epicAccountId: UNLOCK_OPTS.epicAccountId,
          achName: 'ACH_ONLY',
        },
        fetchImpl as never,
      ),
    ).toBe(true);
    const unlockCall = fetchImpl.mock.calls[2] as unknown as [string, RequestInit];
    expect(JSON.parse(String(unlockCall[1].body))).toEqual({ achievementIds: ['ACH_ONLY'] });
  });
});

// ---------------------------------------------------------------------------
// Push-path caches: the client token memo and the product-user mapping cache.
// Without them every push attempt costs three upstream round trips (token,
// mapping, unlock) and a mass-reconnect reconcile multiplies that per account.
// ---------------------------------------------------------------------------

describe('push-path caching (token memo + mapping cache)', () => {
  const walkImpl = (
    calls: { token: number; mapping: number; unlock: number },
    unlockStatus = 200,
  ) =>
    vi.fn(async (url: string) => {
      if (String(url).includes('/auth/v1/oauth/token')) {
        calls.token++;
        return jsonResponse(CLIENT_TOKEN_BODY);
      }
      if (String(url).includes('/user/v1/accounts')) {
        calls.mapping++;
        return jsonResponse(MAPPING_BODY);
      }
      if (String(url).includes('/achievements/unlock')) {
        calls.unlock++;
        return new Response(null, { status: unlockStatus });
      }
      throw new Error(`unexpected url ${url}`);
    });

  it('a second push reuses the memoized token and cached mapping: one round trip, not three', async () => {
    const calls = { token: 0, mapping: 0, unlock: 0 };
    const fetchImpl = walkImpl(calls);
    expect(
      await pushAchievementUnlocks({ ...UNLOCK_OPTS, achNames: ['ACH_A'] }, fetchImpl as never),
    ).toBe(true);
    expect(
      await pushAchievementUnlocks({ ...UNLOCK_OPTS, achNames: ['ACH_B'] }, fetchImpl as never),
    ).toBe(true);
    expect(calls).toEqual({ token: 1, mapping: 1, unlock: 2 });
  });

  it('the mapping cache reaches its real cap and evicts the OLDEST entry, keeping the rest', async () => {
    // Per-account fetch that maps every requested account id (the shared
    // MAPPING_BODY only maps one), counting mapping reads per account.
    const mappingReads = new Map<string, number>();
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('/auth/v1/oauth/token')) return jsonResponse(CLIENT_TOKEN_BODY);
      if (String(url).includes('/user/v1/accounts')) {
        const acct = new URL(String(url)).searchParams.get('accountId') ?? '';
        mappingReads.set(acct, (mappingReads.get(acct) ?? 0) + 1);
        return jsonResponse({ ids: { [acct]: PUID } });
      }
      if (String(url).includes('/achievements/unlock')) return new Response(null, { status: 200 });
      throw new Error(`unexpected url ${url}`);
    });
    const push = (acct: string) =>
      pushAchievementUnlocks(
        { ...UNLOCK_OPTS, epicAccountId: acct, achNames: ['ACH_A'] },
        fetchImpl as never,
      );
    const acctId = (n: number) => `epicacct${String(n).padStart(8, '0')}`;
    // Fill the cache to its REAL cap (a bound never reached is constant-true).
    for (let n = 1; n <= PUID_CACHE_MAX; n++) await push(acctId(n));
    // One past the cap evicts exactly the oldest (Map insertion order).
    await push(acctId(PUID_CACHE_MAX + 1));
    // Survivor first (before reinsertion churn moves the eviction line): the
    // second-oldest entry is still served from cache.
    await push(acctId(2));
    expect(mappingReads.get(acctId(2))).toBe(1);
    // The evicted oldest must re-read the mapping.
    await push(acctId(1));
    expect(mappingReads.get(acctId(1))).toBe(2);
    expect(mappingReads.get(acctId(PUID_CACHE_MAX + 1))).toBe(1);
  });

  it('the token memo honors expires_in: past the lifetime the next push re-mints', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-31T12:00:00Z'));
    const calls = { token: 0, mapping: 0, unlock: 0 };
    const fetchImpl = walkImpl(calls);
    await pushAchievementUnlocks({ ...UNLOCK_OPTS, achNames: ['ACH_A'] }, fetchImpl as never);
    expect(calls.token).toBe(1);
    // CLIENT_TOKEN_BODY reports expires_in 3600s; one hour later the memo has
    // aged out (the refresh margin already retired it a minute early).
    vi.setSystemTime(new Date('2026-07-31T13:00:01Z'));
    await pushAchievementUnlocks({ ...UNLOCK_OPTS, achNames: ['ACH_B'] }, fetchImpl as never);
    expect(calls.token).toBe(2);
  });

  it('a 401 unlock invalidates the token memo so the next push mints fresh', async () => {
    const calls = { token: 0, mapping: 0, unlock: 0 };
    const failing = walkImpl(calls, 401);
    expect(
      await pushAchievementUnlocks({ ...UNLOCK_OPTS, achNames: ['ACH_A'] }, failing as never),
    ).toBe(false);
    expect(calls.token).toBe(1);
    const healthy = walkImpl(calls);
    expect(
      await pushAchievementUnlocks({ ...UNLOCK_OPTS, achNames: ['ACH_A'] }, healthy as never),
    ).toBe(true);
    // A fresh mint, not the revoked memo. The mapping cache is untouched by
    // the 401 (the mapping was valid; only the token was refused).
    expect(calls.token).toBe(2);
    expect(calls.mapping).toBe(1);
  });

  it('an unmapped (null) mapping is never cached: the next push asks Epic again', async () => {
    const calls = { token: 0, mapping: 0, unlock: 0 };
    const unmapped = vi.fn(async (url: string) => {
      if (String(url).includes('/auth/v1/oauth/token')) {
        calls.token++;
        return jsonResponse(CLIENT_TOKEN_BODY);
      }
      if (String(url).includes('/user/v1/accounts')) {
        calls.mapping++;
        return jsonResponse({ ids: {} });
      }
      throw new Error(`unexpected url ${url}`);
    });
    expect(
      await pushAchievementUnlocks({ ...UNLOCK_OPTS, achNames: ['ACH_A'] }, unmapped as never),
    ).toBe(false);
    const healthy = walkImpl(calls);
    expect(
      await pushAchievementUnlocks({ ...UNLOCK_OPTS, achNames: ['ACH_A'] }, healthy as never),
    ).toBe(true);
    // The player connected to the product between the two pushes: the second
    // mapping read must reach Epic (2 total), not serve a cached miss.
    expect(calls.mapping).toBe(2);
  });
});
