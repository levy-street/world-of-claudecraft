import { afterEach, describe, expect, it, vi } from 'vitest';
import { solanaRpc, signatureStatus, fetchFinalizedTransaction } from '../server/solana_rpc';

// Exercise the real RPC plumbing by stubbing ONLY global fetch (transport). No db,
// no network. Asserts the request the code issues + the value it decodes.
const okJson = (body: unknown) => ({ ok: true, json: async () => body });
const notOk = (status: number) => ({ ok: false, status, json: async () => ({}) });
const stubFetch = (impl: () => unknown) => {
  const f = vi.fn((_url: string, _init?: RequestInit): Promise<unknown> => Promise.resolve(impl()));
  vi.stubGlobal('fetch', f);
  return f;
};
const initOf = (f: ReturnType<typeof stubFetch>, i = 0): RequestInit => f.mock.calls[i][1]!;

afterEach(() => vi.unstubAllGlobals());

describe('solanaRpc — JSON-RPC transport', () => {
  it('sends a well-formed JSON-RPC POST and returns result on success', async () => {
    const f = stubFetch(() => okJson({ result: { value: 42 } }));
    const out = await solanaRpc<{ value: number }>('getThing', ['a', { b: 1 }]);
    expect(out).toEqual({ value: 42 });
    const init = initOf(f);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ jsonrpc: '2.0', id: 1, method: 'getThing', params: ['a', { b: 1 }] });
  });

  it('returns null on a non-2xx response (429/500)', async () => {
    stubFetch(() => notOk(429));
    expect(await solanaRpc('x', [])).toBeNull();
  });

  it('returns null when the body carries a JSON-RPC error', async () => {
    stubFetch(() => okJson({ error: { code: -32602, message: 'bad params' } }));
    expect(await solanaRpc('x', [])).toBeNull();
  });

  it('returns null when result is null or absent', async () => {
    stubFetch(() => okJson({ result: null }));
    expect(await solanaRpc('x', [])).toBeNull();
    stubFetch(() => okJson({}));
    expect(await solanaRpc('x', [])).toBeNull();
  });
});

describe('signatureStatus — landed? via getSignatureStatuses(searchTransactionHistory)', () => {
  it('finalized + no error => confirmed', async () => {
    stubFetch(() => okJson({ result: { value: [{ confirmationStatus: 'finalized', err: null }] } }));
    expect(await signatureStatus('sig')).toBe('confirmed');
  });

  it('landed but reverted (err set) => failed, even if finalized', async () => {
    stubFetch(() => okJson({ result: { value: [{ confirmationStatus: 'finalized', err: { InstructionError: [0, 'Custom'] } }] } }));
    expect(await signatureStatus('sig')).toBe('failed');
  });

  it('not found in history (value [null]) => unknown', async () => {
    stubFetch(() => okJson({ result: { value: [null] } }));
    expect(await signatureStatus('sig')).toBe('unknown');
  });

  it('seen but only confirmed (not yet finalized) => unknown (we only trust finalized)', async () => {
    stubFetch(() => okJson({ result: { value: [{ confirmationStatus: 'confirmed', err: null }] } }));
    expect(await signatureStatus('sig')).toBe('unknown');
  });

  it('RPC error (solanaRpc null) => unknown (never misreports as failed/confirmed)', async () => {
    stubFetch(() => notOk(500));
    expect(await signatureStatus('sig')).toBe('unknown');
    // and it asks history-wide, not just the recent-status window.
    const f = stubFetch(() => okJson({ result: { value: [null] } }));
    await signatureStatus('sigX');
    expect(JSON.parse(initOf(f).body as string)).toMatchObject({
      method: 'getSignatureStatuses', params: [['sigX'], { searchTransactionHistory: true }],
    });
  });
});

describe('fetchFinalizedTransaction — request contract', () => {
  it('asks getTransaction at finalized/jsonParsed and returns result (or null)', async () => {
    const f = stubFetch(() => okJson({ result: { meta: { err: null } } }));
    expect(await fetchFinalizedTransaction('sig')).toEqual({ meta: { err: null } });
    expect(JSON.parse(initOf(f).body as string).params)
      .toEqual(['sig', { commitment: 'finalized', encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]);
    stubFetch(() => notOk(404));
    expect(await fetchFinalizedTransaction('sig')).toBeNull();
  });
});
