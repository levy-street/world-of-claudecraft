// The Steam Web API fetch shell (server/steam/web_api.ts), driven directly
// through its fetchImpl injection param: every fault-mapping branch (network
// error, timeout, non-2xx, malformed 2xx, all to 'upstream'), the verdict
// pass-throughs, the push boolean arms, and the publisher-key-embedding
// request builders the shell feeds to fetch. No module mocks: the injection
// seam exists precisely so this file can run the REAL shell code.
import { describe, expect, it, vi } from 'vitest';

import {
  buildAuthenticateUserTicketUrl,
  buildSetAchievementRequest,
  PARTNER_API_HOST,
  TICKET_IDENTITY,
} from '../../server/steam/ticket';
import { pushAchievementUnlock, verifyLinkTicket } from '../../server/steam/web_api';

const OPTS = { key: 'PUBKEY', appId: 480, ticket: 'deadbeef' };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const OK_BODY = {
  response: { params: { result: 'OK', steamid: '76561198000000001', vacbanned: false } },
};

describe('verifyLinkTicket fault mapping', () => {
  it('maps a network error (fetch rejects) to upstream', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await verifyLinkTicket(OPTS, fetchImpl as unknown as typeof fetch)).toEqual({
      kind: 'upstream',
    });
  });

  it('maps a timeout abort to upstream', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new DOMException('The operation timed out.', 'TimeoutError');
    });
    expect(await verifyLinkTicket(OPTS, fetchImpl as unknown as typeof fetch)).toEqual({
      kind: 'upstream',
    });
  });

  it('maps a non-2xx status to upstream', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ any: 'body' }, 503));
    expect(await verifyLinkTicket(OPTS, fetchImpl as unknown as typeof fetch)).toEqual({
      kind: 'upstream',
    });
  });

  it('maps a non-JSON 2xx body to upstream', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>not json</html>', { status: 200 }));
    expect(await verifyLinkTicket(OPTS, fetchImpl as unknown as typeof fetch)).toEqual({
      kind: 'upstream',
    });
  });

  it('maps a JSON 2xx body that parses to malformed to upstream, never a verdict', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ response: { params: { result: 'Bad' } } }));
    expect(await verifyLinkTicket(OPTS, fetchImpl as unknown as typeof fetch)).toEqual({
      kind: 'upstream',
    });
  });
});

describe('verifyLinkTicket verdict pass-through', () => {
  it('passes through ok with the steam id', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(OK_BODY));
    expect(await verifyLinkTicket(OPTS, fetchImpl as unknown as typeof fetch)).toEqual({
      kind: 'ok',
      steamId: '76561198000000001',
    });
  });

  it('passes through banned', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        response: {
          params: { result: 'OK', steamid: '76561198000000001', vacbanned: true },
        },
      }),
    );
    expect(await verifyLinkTicket(OPTS, fetchImpl as unknown as typeof fetch)).toEqual({
      kind: 'banned',
    });
  });

  it('passes through invalid (upstream error object)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ response: { error: { errorcode: 101, errordesc: 'Invalid ticket' } } }),
    );
    expect(await verifyLinkTicket(OPTS, fetchImpl as unknown as typeof fetch)).toEqual({
      kind: 'invalid',
    });
  });
});

describe('verifyLinkTicket request shape', () => {
  it('GETs the built AuthenticateUserTicket URL with a timeout signal', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(OK_BODY));
    await verifyLinkTicket(OPTS, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(
      'https://partner.steam-api.com/ISteamUserAuth/AuthenticateUserTicket/v1/',
    );
    expect(parsed.searchParams.get('key')).toBe('PUBKEY');
    expect(parsed.searchParams.get('appid')).toBe('480');
    expect(parsed.searchParams.get('ticket')).toBe('deadbeef');
    expect(parsed.searchParams.get('identity')).toBe('wocc-link');
    expect(init.method).toBe('GET');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('pushAchievementUnlock', () => {
  const PUSH = { key: 'PUBKEY', appId: 480, steamId: '76561198000000001', achName: 'DEED_X' };

  it('returns true on a 2xx', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ response: {} }));
    expect(await pushAchievementUnlock(PUSH, fetchImpl as unknown as typeof fetch)).toBe(true);
  });

  it('returns false on a non-2xx', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ any: 'body' }, 500));
    expect(await pushAchievementUnlock(PUSH, fetchImpl as unknown as typeof fetch)).toBe(false);
  });

  it('returns false on a network error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await pushAchievementUnlock(PUSH, fetchImpl as unknown as typeof fetch)).toBe(false);
  });

  it('POSTs the built form body with the achievement latched at 1', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ response: {} }));
    await pushAchievementUnlock(PUSH, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://partner.steam-api.com/ISteamUserStats/SetUserStatsForGame/v1/');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/x-www-form-urlencoded',
    );
    const body = init.body as URLSearchParams;
    expect(body.get('key')).toBe('PUBKEY');
    expect(body.get('steamid')).toBe('76561198000000001');
    expect(body.get('appid')).toBe('480');
    expect(body.get('count')).toBe('1');
    expect(body.get('name[0]')).toBe('DEED_X');
    expect(body.get('value[0]')).toBe('1');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('request builders (publisher-key embedding)', () => {
  it('pins the partner host so no builder can drift to the public API host', () => {
    expect(PARTNER_API_HOST).toBe('https://partner.steam-api.com');
    expect(TICKET_IDENTITY).toBe('wocc-link');
  });

  it('buildAuthenticateUserTicketUrl embeds every param and honors an explicit identity', () => {
    const url = new URL(
      buildAuthenticateUserTicketUrl({ key: 'K', appId: 12, ticket: 'T', identity: 'custom-id' }),
    );
    expect(url.origin + url.pathname).toBe(
      'https://partner.steam-api.com/ISteamUserAuth/AuthenticateUserTicket/v1/',
    );
    expect(url.searchParams.get('key')).toBe('K');
    expect(url.searchParams.get('appid')).toBe('12');
    expect(url.searchParams.get('ticket')).toBe('T');
    expect(url.searchParams.get('identity')).toBe('custom-id');
  });

  it('buildSetAchievementRequest form-encodes multi-achievement name/value pairs', () => {
    const { url, body } = buildSetAchievementRequest({
      key: 'K',
      appId: 12,
      steamId: '765611980001',
      achNames: ['A_ONE', 'A_TWO'],
    });
    expect(url).toBe('https://partner.steam-api.com/ISteamUserStats/SetUserStatsForGame/v1/');
    expect(body.get('key')).toBe('K');
    expect(body.get('steamid')).toBe('765611980001');
    expect(body.get('appid')).toBe('12');
    expect(body.get('count')).toBe('2');
    expect(body.get('name[0]')).toBe('A_ONE');
    expect(body.get('value[0]')).toBe('1');
    expect(body.get('name[1]')).toBe('A_TWO');
    expect(body.get('value[1]')).toBe('1');
  });
});
