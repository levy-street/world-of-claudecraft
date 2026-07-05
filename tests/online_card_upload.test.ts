import { afterEach, describe, expect, it, vi } from 'vitest';
import { Api } from '../src/net/online';

// Exercises the REAL Api.uploadCard request shaping (query params, headers, body,
// error propagation). Only the network transport (global fetch) is stubbed; the
// code under test runs for real.
describe('Api.uploadCard request shaping', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });

  function stubOkFetch(): { calls: Array<{ url: string; init: RequestInit }> } {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url: String(url), init });
        return { ok: true, json: async () => ({ url: '/p/sir-test' }) } as unknown as Response;
      }),
    );
    return { calls };
  }

  const queryOf = (url: string) => new URLSearchParams(url.split('?')[1] ?? '');

  it('includes the character and lang in the query and returns the page url', async () => {
    const { calls } = stubOkFetch();
    const api = new Api();
    api.token = 'a'.repeat(64);

    const res = await api.uploadCard(5, png, 'es_ES');

    expect(res).toEqual({ url: '/p/sir-test' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/api/card?');
    const qs = queryOf(calls[0].url);
    expect(qs.get('character')).toBe('5');
    expect(qs.get('lang')).toBe('es_ES');
    expect(qs.has('level')).toBe(false);
  });

  it('never sends client-owned level metadata', async () => {
    const { calls } = stubOkFetch();
    await new Api().uploadCard(7, png, 'en');
    expect(queryOf(calls[0].url).has('level')).toBe(false);
  });

  it('sends a POST with the bearer token, image/png content type, and the PNG body', async () => {
    const { calls } = stubOkFetch();
    const api = new Api();
    api.token = 'b'.repeat(64);

    await api.uploadCard(3, png, 'en');

    const { init } = calls[0];
    const headers = init.headers as Record<string, string>;
    expect(init.method).toBe('POST');
    expect(headers['Content-Type']).toBe('image/png');
    expect(headers.Authorization).toBe(`Bearer ${'b'.repeat(64)}`);
    expect(init.body).toBe(png);
  });

  it('omits the Authorization header when there is no session token', async () => {
    const { calls } = stubOkFetch();
    await new Api().uploadCard(3, png, 'en');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('throws the server error text on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: false,
            status: 413,
            json: async () => ({ error: 'image too large' }),
          }) as unknown as Response,
      ),
    );
    await expect(new Api().uploadCard(5, png, 'en')).rejects.toThrow('image too large');
  });
});
