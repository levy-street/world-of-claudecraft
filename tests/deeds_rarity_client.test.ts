// ClientWorld.deedsRarity + ClientWorld.deedsLeaderboard: the online facet
// arms are lazy REST reads with hard soft-fail contracts (null for rarity,
// the empty page for the board), so every failure arm gets its own pin:
// non-ok status, malformed payload, and a rejecting fetch.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientWorld } from '../src/net/online';

// The xp.test.ts bare-prototype idiom: these reads touch only `base` (and,
// for the board, `token`), so no socket or snapshot machinery is needed.
function bareClient(): ClientWorld {
  const c = Object.create(ClientWorld.prototype) as ClientWorld;
  (c as unknown as { base: string }).base = '';
  (c as unknown as { token: string }).token = 'a'.repeat(64);
  return c;
}

function stubFetch(response: unknown): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async () => response);
  vi.stubGlobal('fetch', mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ClientWorld.deedsRarity', () => {
  it('resolves the endpoint payload verbatim on a 200, hitting the anonymous route', async () => {
    const payload = { totalEligible: 120, earned: { prog_veteran: 30 } };
    const mock = stubFetch({ ok: true, json: async () => payload });
    await expect(bareClient().deedsRarity()).resolves.toEqual(payload);
    // Anonymous by design: one positional URL argument, no headers object.
    expect(mock).toHaveBeenCalledWith('/api/deeds/rarity');
  });

  it('resolves null on a non-ok status', async () => {
    stubFetch({ ok: false, status: 429, json: async () => ({ error: 'rate limited' }) });
    await expect(bareClient().deedsRarity()).resolves.toBeNull();
  });

  it('resolves null on a malformed payload (wrong shape, and a null earned map)', async () => {
    stubFetch({ ok: true, json: async () => ({ hello: 'world' }) });
    await expect(bareClient().deedsRarity()).resolves.toBeNull();
    stubFetch({ ok: true, json: async () => ({ totalEligible: 5, earned: null }) });
    await expect(bareClient().deedsRarity()).resolves.toBeNull();
  });

  it('resolves null (never rejects) when the fetch itself throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    await expect(bareClient().deedsRarity()).resolves.toBeNull();
  });
});

describe('ClientWorld.deedsLeaderboard', () => {
  const EMPTY = { leaders: [], page: 0, pageCount: 1, total: 0, pageSize: 50 };

  it('maps a resolved page through, self included, sending the session bearer', async () => {
    const body = {
      realm: 'Claudemoon',
      scope: 'global',
      board: 'deeds',
      metric: 'renown',
      leaders: [
        {
          rank: 1,
          name: 'Aldwin',
          realm: 'Claudemoon',
          cls: 'warrior',
          level: 20,
          renown: 50,
          title: 'prog_veteran',
        },
      ],
      page: 1,
      pageCount: 3,
      total: 120,
      pageSize: 50,
      self: { rank: 12, topPercent: 4 },
    };
    const mock = stubFetch({ ok: true, json: async () => body });
    await expect(bareClient().deedsLeaderboard(1, 50)).resolves.toEqual({
      leaders: body.leaders,
      page: 1,
      pageCount: 3,
      total: 120,
      pageSize: 50,
      self: { rank: 12, topPercent: 4 },
    });
    expect(mock).toHaveBeenCalledWith('/api/leaderboard?board=deeds&page=1&pageSize=50', {
      headers: { Authorization: `Bearer ${'a'.repeat(64)}` },
    });
  });

  it('omits the self key entirely when the server sent none', async () => {
    stubFetch({ ok: true, json: async () => ({ leaders: [], page: 0, pageCount: 1, total: 0 }) });
    const page = await bareClient().deedsLeaderboard(0, 50);
    expect('self' in page).toBe(false);
  });

  it('defaults every missing field on a sparse payload', async () => {
    stubFetch({ ok: true, json: async () => ({}) });
    await expect(bareClient().deedsLeaderboard(2, 25)).resolves.toEqual({
      leaders: [],
      page: 2,
      pageCount: 1,
      total: 0,
      pageSize: 25,
    });
  });

  it('resolves the empty page on a non-ok status (a 401 stays a soft fail)', async () => {
    stubFetch({ ok: false, status: 401, json: async () => ({}) });
    await expect(bareClient().deedsLeaderboard(0, 50)).resolves.toEqual(EMPTY);
  });

  it('resolves the empty page (never rejects) when the fetch itself throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    await expect(bareClient().deedsLeaderboard(0, 50)).resolves.toEqual(EMPTY);
  });
});
