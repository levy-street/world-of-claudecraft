import { afterEach, describe, expect, it, vi } from 'vitest';
import { Api, ApiError } from '../src/net/online';

// Exercises the REAL Api.requestPasswordReset / Api.resetPassword request shaping
// (method, path, JSON body, error propagation). Only the network transport (global
// fetch) is stubbed; the code under test runs for real. The server-side flow is
// covered separately by password_reset_server.test.ts.
describe('Api password-reset request shaping', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubOkFetch(): { calls: Array<{ url: string; init: RequestInit }> } {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url: String(url), init });
        return { ok: true, json: async () => ({}) } as unknown as Response;
      }),
    );
    return { calls };
  }

  it('requestPasswordReset POSTs /api/account/password/forgot with { username }', async () => {
    const { calls } = stubOkFetch();

    await new Api().requestPasswordReset('sir-test');

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(url).toContain('/api/account/password/forgot');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ username: 'sir-test' });
  });

  it('resetPassword POSTs /api/account/password/reset with { token, next }', async () => {
    const { calls } = stubOkFetch();
    const token = 'a'.repeat(64);

    await new Api().resetPassword(token, 'new-secret');

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(url).toContain('/api/account/password/reset');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ token, next: 'new-secret' });
  });

  it('requestPasswordReset resolves on a 200 (no account enumeration)', async () => {
    stubOkFetch();
    await expect(new Api().requestPasswordReset('unknown-user')).resolves.toBeUndefined();
  });

  it('resetPassword throws the server error text on an invalid/expired link', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: false,
            status: 400,
            json: async () => ({ error: 'invalid or expired link' }),
          }) as unknown as Response,
      ),
    );

    await expect(new Api().resetPassword('b'.repeat(64), 'short')).rejects.toBeInstanceOf(ApiError);
    await expect(new Api().resetPassword('b'.repeat(64), 'short')).rejects.toThrow(
      'invalid or expired link',
    );
  });
});
