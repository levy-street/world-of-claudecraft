import { afterEach, describe, expect, it, vi } from 'vitest';

import { Api } from '../src/net/online';

// Api.realmStatus reads only fetch plus the module-level URL helpers, so a bare
// prototype instance exercises the decode without a token or realm bootstrap
// (the bareClient idiom from snapshots.test.ts).
const api = Object.create(Api.prototype) as Api;

const statusResponse = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Api.realmStatus players_cap decode', () => {
  it('returns a positive players_cap as the cap', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => statusResponse({ ok: true, players_online: 3, players_cap: 5000 })),
    );
    expect(await api.realmStatus('http://realm.test')).toEqual({
      online: true,
      players: 3,
      cap: 5000,
    });
  });

  it('treats a missing players_cap (an older server) as disabled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => statusResponse({ ok: true, players_online: 42 })),
    );
    expect(await api.realmStatus('http://realm.test')).toEqual({
      online: true,
      players: 42,
      cap: 0,
    });
  });

  it('treats an explicit 0 and a non-numeric players_cap as disabled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => statusResponse({ ok: true, players_online: 1, players_cap: 0 })),
    );
    expect((await api.realmStatus('http://realm.test')).cap).toBe(0);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => statusResponse({ ok: true, players_online: 1, players_cap: 'lots' })),
    );
    expect((await api.realmStatus('http://realm.test')).cap).toBe(0);
  });

  it('reports offline with zeroed fields on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => statusResponse({}, false)),
    );
    expect(await api.realmStatus('http://realm.test')).toEqual({
      online: false,
      players: 0,
      cap: 0,
    });
  });

  it('reports offline when the fetch itself rejects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    expect(await api.realmStatus('http://realm.test')).toEqual({
      online: false,
      players: 0,
      cap: 0,
    });
  });
});
