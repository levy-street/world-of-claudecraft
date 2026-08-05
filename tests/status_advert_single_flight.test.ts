// The three /api/status capability adverts (steam, epic, dev commands) run
// back to back on every login and session-restore path, so concurrent reads
// share ONE GET /api/status. Nothing is memoized past settle (a later advert
// reads the server fresh), the flight is keyed by realm base (a mid-flight
// realm switch never serves the old realm's document), and every advert still
// fails closed on a network error.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Api } from '../src/net/online';

function statusResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Api status advert single-flight', () => {
  it('concurrent steam/epic/dev adverts share one GET /api/status and each reads its own field', async () => {
    const fetchMock = vi.fn(async (..._args: unknown[]) =>
      statusResponse({
        ok: true,
        steam: { enabled: true },
        epic: { enabled: false },
        dev_commands: true,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const api = new Api();
    const [steam, epic, dev] = await Promise.all([
      api.steamAdvert(),
      api.epicAdvert(),
      api.devCommandsAdvert(),
    ]);
    expect(steam).toBe(true);
    expect(epic).toBe(false);
    expect(dev).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/status');
  });

  it('a later advert re-reads fresh: nothing is memoized past settle', async () => {
    const fetchMock = vi.fn(async () => statusResponse({ epic: { enabled: true } }));
    vi.stubGlobal('fetch', fetchMock);
    const api = new Api();
    expect(await api.epicAdvert()).toBe(true);
    expect(await api.epicAdvert()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a realm switch mid-flight starts a fresh read instead of serving the old realm document', async () => {
    let releaseFirst: (r: Response) => void = () => {};
    const fetchMock = vi
      .fn<(...args: unknown[]) => Promise<Response>>()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            releaseFirst = resolve;
          }),
      )
      .mockImplementation(async () => statusResponse({ epic: { enabled: true } }));
    vi.stubGlobal('fetch', fetchMock);
    const api = new Api();
    const beforeSwitch = api.epicAdvert();
    api.setRealm('https://realm2.example');
    const afterSwitch = api.epicAdvert();
    releaseFirst(statusResponse({ epic: { enabled: false } }));
    expect(await beforeSwitch).toBe(false);
    expect(await afterSwitch).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain('realm2.example');
  });

  it('concurrent adverts on a dead server all fail closed off one attempt, and the next call retries', async () => {
    const fetchMock = vi.fn<(...args: unknown[]) => Promise<Response>>(async () => {
      throw new TypeError('offline');
    });
    vi.stubGlobal('fetch', fetchMock);
    const api = new Api();
    const [steam, epic] = await Promise.all([api.steamAdvert(), api.epicAdvert()]);
    expect(steam).toBe(false);
    expect(epic).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockImplementation(async () => statusResponse({ epic: { enabled: true } }));
    expect(await api.epicAdvert()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
