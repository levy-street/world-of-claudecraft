import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountSessionApi } from '../src/net/account_session_api';
import { ApiError } from '../src/net/api_error';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number {
    return this.values.size;
  }
  clear(): void {
    this.values.clear();
  }
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('AccountSessionApi', () => {
  const storage = new MemoryStorage();

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal('localStorage', storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('logs in with the existing body and persists the shared session', async () => {
    const fetchMock = vi.fn(async () => response({ token: 'tok', username: 'alice' }));
    vi.stubGlobal('fetch', fetchMock);
    const api = new AccountSessionApi();

    await expect(api.login('alice', 'secret', 'turnstile')).resolves.toEqual({});
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          username: 'alice',
          password: 'secret',
          turnstileToken: 'turnstile',
          code: '',
          recoveryCode: '',
          nativeAttestation: undefined,
        }),
      }),
    );
    expect(api.token).toBe('tok');
    api.saveSession();
    expect(JSON.parse(storage.getItem('woc_session') ?? '')).toEqual({
      token: 'tok',
      username: 'alice',
    });
  });

  it('does not replace session state when a second factor is required', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({ twoFactorRequired: true })),
    );
    const api = new AccountSessionApi();
    api.token = 'prior';
    api.username = 'prior-user';

    await expect(api.login('alice', 'secret')).resolves.toEqual({ twoFactorRequired: true });
    expect(api.token).toBe('prior');
    expect(api.username).toBe('prior-user');
  });

  it('restores, clears, and rejects malformed stored sessions without throwing', () => {
    storage.setItem('woc_session', JSON.stringify({ token: 'tok', username: 'alice' }));
    const api = new AccountSessionApi();
    expect(api.restoreSession()).toBe(true);
    expect(api.token).toBe('tok');
    api.clearSession();
    expect(api.token).toBeNull();
    expect(storage.getItem('woc_session')).toBeNull();

    storage.setItem('woc_session', '{broken');
    expect(api.restoreSession()).toBe(false);
  });

  it('sends the bearer for account, character, wallet, and logout reads', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ username: 'alice', email: 'a@b.c' }))
      .mockResolvedValueOnce(
        response({ realm: 'Azeroth', characters: [{ id: 7, name: 'A', class: 'warrior' }] }),
      )
      .mockResolvedValueOnce(response({ wallet: { pubkey: 'wallet', linkedAt: 'now' } }))
      .mockResolvedValueOnce(response({}));
    vi.stubGlobal('fetch', fetchMock);
    const api = new AccountSessionApi();
    api.token = 'tok';

    await api.getAccount();
    expect(await api.characters()).toHaveLength(1);
    expect(api.realm).toBe('Azeroth');
    expect(await api.linkedWallet()).toEqual({ pubkey: 'wallet', linkedAt: 'now' });
    await api.logout();

    for (const [, init] of fetchMock.mock.calls) {
      expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok' });
    }
    expect(api.token).toBe('tok');
  });

  it('preserves stable error status, code, and params', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response({ error: 'denied', code: 'auth.denied', retryAfterSeconds: 3 }, 401),
      ),
    );
    const api = new AccountSessionApi();

    const err = await api.getAccount().catch((value: unknown) => value);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 401,
      code: 'auth.denied',
      params: { retryAfterSeconds: 3 },
    });
  });
});
