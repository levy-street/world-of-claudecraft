// ClientWorld.reliquaryRarity: the online facet arm is a lazy anonymous REST
// read with a hard soft-fail contract (null), the deedsRarity twin, so every
// failure arm gets its own pin: non-ok status, malformed payload (each of the
// three fields), and a rejecting fetch.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientWorld } from '../src/net/online';

// The deeds_rarity_client.test.ts bare-prototype idiom: this read touches only
// `base`, so no socket or snapshot machinery is needed.
function bareClient(): ClientWorld {
  const c = Object.create(ClientWorld.prototype) as ClientWorld;
  (c as unknown as { base: string }).base = '';
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

describe('ClientWorld.reliquaryRarity', () => {
  it('resolves the endpoint payload verbatim on a 200, hitting the anonymous route', async () => {
    const payload = {
      totalEligible: 120,
      found: { cryptbone_helm: 3, 'slain:old_greyjaw': 2 },
      illuminated: { conquerors_hollow_crypt: 1 },
    };
    const mock = stubFetch({ ok: true, json: async () => payload });
    await expect(bareClient().reliquaryRarity()).resolves.toEqual(payload);
    // Anonymous by design: one positional URL argument, no headers object.
    expect(mock).toHaveBeenCalledWith('/api/reliquary/rarity');
  });

  it('resolves null on a non-ok status', async () => {
    stubFetch({ ok: false, status: 429, json: async () => ({ error: 'rate limited' }) });
    await expect(bareClient().reliquaryRarity()).resolves.toBeNull();
  });

  it('resolves null on a malformed payload, each field pinned separately', async () => {
    // A wrong shape entirely.
    stubFetch({ ok: true, json: async () => ({ hello: 'world' }) });
    await expect(bareClient().reliquaryRarity()).resolves.toBeNull();
    // totalEligible not a number.
    stubFetch({
      ok: true,
      json: async () => ({ totalEligible: 'many', found: {}, illuminated: {} }),
    });
    await expect(bareClient().reliquaryRarity()).resolves.toBeNull();
    // A null found map (typeof null is 'object'; the guard must not pass it).
    stubFetch({ ok: true, json: async () => ({ totalEligible: 5, found: null, illuminated: {} }) });
    await expect(bareClient().reliquaryRarity()).resolves.toBeNull();
    // A missing illuminated map.
    stubFetch({ ok: true, json: async () => ({ totalEligible: 5, found: {} }) });
    await expect(bareClient().reliquaryRarity()).resolves.toBeNull();
    stubFetch({ ok: true, json: async () => ({ totalEligible: 5, found: {}, illuminated: null }) });
    await expect(bareClient().reliquaryRarity()).resolves.toBeNull();
  });

  it('resolves null (never rejects) when the fetch itself throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    await expect(bareClient().reliquaryRarity()).resolves.toBeNull();
  });
});
