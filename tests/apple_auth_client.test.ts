import { afterEach, describe, expect, it, vi } from 'vitest';
import { Api } from '../src/net/online';

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Apple first-login client flow', () => {
  it('returns a chooser without installing a session for a new Apple identity', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ choose: true, linkToken: 'choice-token', username: 'Player One' }),
        ),
    );
    const api = new Api();
    await expect(api.appleLogin('identity', 'Player One', { proof: true })).resolves.toEqual({
      choose: true,
      linkToken: 'choice-token',
      username: 'Player One',
    });
    expect(api.token).toBeNull();
  });

  it('creates a new account from the pending choice and installs its session', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ token: 'session', username: 'PlayerOne' }));
    vi.stubGlobal('fetch', fetchMock);
    const api = new Api();
    await api.appleLoginNew('choice-token');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/apple/login/new');
    expect(api.token).toBe('session');
    expect(api.username).toBe('PlayerOne');
  });

  it.each(['apple', 'discord'] as const)(
    'sends the referral only with %s new-account intent',
    async (provider) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(jsonResponse({ token: 'session', username: 'New' }));
      vi.stubGlobal('fetch', fetchMock);
      const api = new Api();
      if (provider === 'apple') await api.appleLoginNew('choice-token', 'friend-token');
      else await api.discordLoginNew('choice-token', 'friend-token');
      expect(fetchMock.mock.calls[0][0]).toBe(`/api/auth/${provider}/login/new`);
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
        linkToken: 'choice-token',
        ref: 'friend-token',
      });
    },
  );

  it('keeps the choice pending when the existing account requires 2FA', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ twoFactorRequired: true })));
    const api = new Api();
    await expect(api.appleLoginLink('choice-token', 'PlayerOne', 'password')).resolves.toEqual({
      twoFactorRequired: true,
    });
    expect(api.token).toBeNull();
  });
});
