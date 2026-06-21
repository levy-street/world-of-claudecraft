import { afterEach, describe, expect, it, vi } from 'vitest';
import { Api } from '../src/net/online';

// Exercise the real REST Api methods, stubbing ONLY global fetch (transport).
// Asserts the URL / headers / body the method produces and the value it returns.
type FetchResult = { ok: boolean; status?: number; json: () => Promise<unknown> };
const ok = (body: unknown): FetchResult => ({ ok: true, json: async () => body });
const bad = (status: number, body: unknown = {}): FetchResult => ({ ok: false, status, json: async () => body });
const throws = (): FetchResult => ({ ok: false, json: async () => { throw new Error('unparseable'); } });
const stub = (...results: FetchResult[]) => {
  const f = vi.fn(async (..._args: unknown[]): Promise<FetchResult> => results.shift() ?? ok({}));
  vi.stubGlobal('fetch', f);
  return f;
};
const urlOf = (f: ReturnType<typeof stub>, i = 0) => String(f.mock.calls[i][0]);
const initOf = (f: ReturnType<typeof stub>, i = 0) => f.mock.calls[i][1] as RequestInit | undefined;

afterEach(() => vi.unstubAllGlobals());

const authed = () => { const api = new Api(); api.token = 'tok123'; return api; };

describe('Api.creatorSkins — public registry, degrade-to-empty', () => {
  it('returns the skins array on success (page-origin URL, no base)', async () => {
    const f = stub(ok({ skins: [{ id: 'skin_1' }] }));
    expect(await new Api().creatorSkins()).toEqual([{ id: 'skin_1' }]);
    expect(urlOf(f)).toBe('/api/skins/registry');
  });
  it('returns [] when skins is absent, on non-ok, and when fetch throws', async () => {
    stub(ok({}));
    expect(await new Api().creatorSkins()).toEqual([]);
    stub(bad(503));
    expect(await new Api().creatorSkins()).toEqual([]);
    stub(throws());
    expect(await new Api().creatorSkins()).toEqual([]);
  });
});

describe('Api.quoteSkin — authed POST with skinId encoding', () => {
  it('POSTs an empty body to the encoded quote URL with the bearer token', async () => {
    const f = stub(ok({ quoteId: 'q1', mint: 'M' }));
    const out = await authed().quoteSkin('skin/weird id');
    expect(out).toMatchObject({ quoteId: 'q1' });
    expect(urlOf(f)).toBe('/api/marketplace/skins/skin%2Fweird%20id/quote');
    const init = initOf(f)!;
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok123');
    expect(init.body).toBe('{}');
  });
  it('surfaces the server error reason verbatim, and the transport fallback on an unparseable body', async () => {
    stub(bad(400, { error: 'quote_expired' }));
    await expect(authed().quoteSkin('s')).rejects.toThrow('quote_expired');
    stub(throws());
    await expect(authed().quoteSkin('s')).rejects.toThrow('request failed (undefined)');
  });
});

describe('Api.buySkin — authed POST, realm-base aware', () => {
  it('POSTs {quoteId, signature} and returns the grant result', async () => {
    const f = stub(ok({ ok: true, skinId: 'skin_1' }));
    expect(await authed().buySkin('q_abc', 'sig_xyz')).toEqual({ ok: true, skinId: 'skin_1' });
    expect(urlOf(f)).toBe('/api/marketplace/buy');
    expect(JSON.parse(initOf(f)!.body as string)).toEqual({ quoteId: 'q_abc', signature: 'sig_xyz' });
  });
  it('prefixes the realm base origin when one is set', async () => {
    const api = authed(); api.setRealm('https://realm2.example');
    const f = stub(ok({ ok: true, skinId: 'x' }));
    await api.buySkin('q', 's');
    expect(urlOf(f)).toBe('https://realm2.example/api/marketplace/buy');
  });
});

describe('Api.burnLedger — public ledger, degrade-to-empty', () => {
  const EMPTY = { cumulativeWocBurned: '0', cumulativeUsdcIn: '0', batches: [] };
  it('uses the default + custom limit and returns the parsed body', async () => {
    const f = stub(ok({ cumulativeWocBurned: '5', cumulativeUsdcIn: '9', batches: [] }));
    expect(await new Api().burnLedger()).toMatchObject({ cumulativeWocBurned: '5' });
    expect(urlOf(f)).toBe('/api/marketplace/burn-ledger?limit=50');
    const f2 = stub(ok(EMPTY));
    await new Api().burnLedger(10);
    expect(urlOf(f2)).toBe('/api/marketplace/burn-ledger?limit=10');
  });
  it('degrades to the documented empty shape on non-ok and on throw', async () => {
    stub(bad(500));
    expect(await new Api().burnLedger()).toEqual(EMPTY);
    stub(throws());
    expect(await new Api().burnLedger()).toEqual(EMPTY);
  });
});
