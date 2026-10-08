import { describe, expect, it, vi } from 'vitest';
import { AccountSettingsClient } from '../src/net/account_settings';
import { ApiError } from '../src/net/api_error';

describe('account settings REST transport', () => {
  it('uses a stable non-secret account identity for journal isolation', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ acknowledged: false, accountId: 17 })));
    const client = new AccountSettingsClient('a', '', fetcher);
    expect(await client.status()).toEqual({ acknowledged: false, accountId: 17 });
    fetcher.mockResolvedValue(new Response(JSON.stringify({ acknowledged: true, accountId: -1 })));
    await expect(client.status()).rejects.toThrow('invalid account settings status');
  });

  it('captures credentials and sends validated device preferences and acknowledgement', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ entries: { ev_music_on: '0' } })));
    const client = new AccountSettingsClient('account-a', 'https://game.example', fetcher);
    expect(await client.initialize('phone', 7, { ev_music_on: '1' })).toEqual({ ev_music_on: '0' });
    expect(fetcher).toHaveBeenCalledWith(
      'https://game.example/api/account/settings/initialize',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer account-a' }),
        body: JSON.stringify({
          deviceType: 'phone',
          characterId: 7,
          entries: { ev_music_on: '1' },
        }),
      }),
    );
    fetcher.mockResolvedValue(new Response(JSON.stringify({ acknowledged: true })));
    await client.acknowledge();
    expect(fetcher.mock.calls[1][1].body).toBe('{"understood":true}');
  });

  it('preserves stable errors and rejects malformed successful responses', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: 'denied', code: 'auth.required' }), { status: 401 }),
      );
    const client = new AccountSettingsClient('a', '', fetcher);
    await expect(client.status()).rejects.toMatchObject({ status: 401, code: 'auth.required' });
    fetcher.mockResolvedValue(new Response(JSON.stringify({ entries: { woc_token: 'secret' } })));
    await expect(client.initialize('desktop', 1, {})).rejects.toThrow(
      'invalid account settings response',
    );
    await expect(client.save('desktop', { woc_token: 'secret' })).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(new ApiError('denied', 401).status).toBe(401);
  });

  it('bounds a stalled request using an abort signal and carries keepalive', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn(
        (_url: unknown, init: RequestInit | undefined) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      );
      const client = new AccountSettingsClient('a', '', fetcher, 100);
      const request = client.save('tablet', {}, true);
      const rejection = expect(request).rejects.toThrow('aborted');
      await vi.advanceTimersByTimeAsync(100);
      await rejection;
      expect(fetcher.mock.calls[0][1]?.keepalive).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
