// Bank Storage phase 14: the proxy's mapping of a failed spend to the ONE fact
// the purchase flow is allowed to act on. server/service_reachability.ts decides
// what a rejected fetch means; this suite pins which call outcomes are even
// allowed to carry that verdict, which is the other half of the guarantee.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_reach';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { claudiumSpendDetailed } from '../../server/claudium_proxy';

const SPEND = {
  accountId: 7,
  itemId: 'strongbox_rung_01',
  kind: 'storage' as const,
  expectedCostClaudium: 100,
  idempotencyKey: 'reach-key',
};

function connectRefused(): Error {
  const cause = new Error('connect ECONNREFUSED 127.0.0.1:8788');
  (cause as { code?: string }).code = 'ECONNREFUSED';
  const err = new TypeError('fetch failed');
  (err as { cause?: unknown }).cause = cause;
  return err;
}

let fetchMock: ReturnType<typeof vi.fn>;
const REAL_URL = process.env.WOC_ECONOMY_SERVICE_URL;
const REAL_SECRET = process.env.WOC_ECONOMY_INTERNAL_SECRET;

beforeEach(() => {
  process.env.WOC_ECONOMY_SERVICE_URL = 'http://127.0.0.1:8788/v1/claudium/';
  process.env.WOC_ECONOMY_INTERNAL_SECRET = 'test-secret';
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (REAL_URL === undefined) delete process.env.WOC_ECONOMY_SERVICE_URL;
  else process.env.WOC_ECONOMY_SERVICE_URL = REAL_URL;
  if (REAL_SECRET === undefined) delete process.env.WOC_ECONOMY_INTERNAL_SECRET;
  else process.env.WOC_ECONOMY_INTERNAL_SECRET = REAL_SECRET;
});

describe('claudiumSpendDetailed: which failures may claim no debit is possible', () => {
  it('a connect refusal is the never-reached case, and still reads as unavailable', async () => {
    fetchMock.mockRejectedValue(connectRefused());
    const out = await claudiumSpendDetailed(SPEND);
    expect(out.neverReached).toBe(true);
    // The player-facing shape is unchanged: the fact is server-only.
    expect(out.result).toEqual({
      granted: false,
      balance: null,
      costClaudium: null,
      reason: 'unavailable',
    });
  });

  it('an HTTP error is AMBIGUOUS: bytes reached an application that could have debited', async () => {
    // The arm that matters most. A 500 raised AFTER the service took the money
    // is indistinguishable from one raised before, so it must never be called
    // never-reached, and the response path must not inherit the flag from a
    // connect failure that did not happen.
    for (const status of [400, 409, 500, 502, 503]) {
      fetchMock.mockResolvedValue(new Response('nope', { status }));
      const out = await claudiumSpendDetailed(SPEND);
      expect(out.neverReached, `status ${status}`).toBe(false);
      expect(out.result.reason).toBe('unavailable');
    }
  });

  it('a timeout and a mid-request socket error are AMBIGUOUS', async () => {
    const timeout = new Error('The operation was aborted due to timeout');
    timeout.name = 'TimeoutError';
    fetchMock.mockRejectedValue(timeout);
    expect((await claudiumSpendDetailed(SPEND)).neverReached).toBe(false);

    const reset = new TypeError('fetch failed');
    const cause = new Error('socket hang up');
    (cause as { code?: string }).code = 'ECONNRESET';
    (reset as { cause?: unknown }).cause = cause;
    fetchMock.mockRejectedValue(reset);
    expect((await claudiumSpendDetailed(SPEND)).neverReached).toBe(false);
  });

  it('composes caller cancellation with the service timeout and aborts active fetch', async () => {
    let requestSignal: AbortSignal | undefined;
    fetchMock.mockImplementation((_url: unknown, init: RequestInit) => {
      requestSignal = init.signal as AbortSignal;
      return new Promise((_resolve, reject) => {
        requestSignal?.addEventListener(
          'abort',
          () => reject(requestSignal?.reason ?? new DOMException('cancelled', 'AbortError')),
          { once: true },
        );
      });
    });
    const controller = new AbortController();
    const pending = claudiumSpendDetailed(SPEND, controller.signal);
    await vi.waitFor(() => expect(requestSignal).toBeDefined());
    expect(requestSignal).not.toBe(controller.signal);
    expect(requestSignal?.aborted).toBe(false);

    controller.abort(new DOMException('shutdown', 'AbortError'));
    await expect(pending).resolves.toMatchObject({
      result: { granted: false, reason: 'unavailable' },
      // Cancellation can race bytes already sent, so it is never proof that
      // the service did not debit.
      neverReached: false,
    });
    expect(requestSignal?.aborted).toBe(true);
  });

  it('a 2xx with an unreadable body is AMBIGUOUS, not never-reached', async () => {
    fetchMock.mockResolvedValue(new Response('{not json', { status: 200 }));
    const out = await claudiumSpendDetailed(SPEND);
    expect(out.neverReached).toBe(false);
    expect(out.result.granted).toBe(false);
  });

  it('a 2xx with a non-boolean grant verdict stays ambiguous and cannot grant storage', async () => {
    for (const granted of ['false', 1, null, {}, []]) {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ granted, balance: 900, costClaudium: 100 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
      const out = await claudiumSpendDetailed(SPEND);
      expect(out, JSON.stringify(granted)).toEqual({
        result: {
          granted: false,
          balance: null,
          costClaudium: null,
          reason: 'unavailable',
        },
        neverReached: false,
      });
    }
  });

  it('a 2xx with malformed currency or reason fields invalidates the whole response', async () => {
    for (const payload of [
      { granted: true, balance: '900', costClaudium: 100 },
      { granted: true, balance: -1, costClaudium: 100 },
      { granted: true, balance: 900.5, costClaudium: 100 },
      { granted: true, balance: 900, costClaudium: -1 },
      { granted: true, balance: 900, costClaudium: 100.5 },
      { granted: true, balance: 900, costClaudium: '100' },
      { granted: true, balance: 900, costClaudium: 100, reason: {} },
    ]) {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
      expect(await claudiumSpendDetailed(SPEND), JSON.stringify(payload)).toEqual({
        result: {
          granted: false,
          balance: null,
          costClaudium: null,
          reason: 'unavailable',
        },
        neverReached: false,
      });
    }
  });

  it('retains nullable optional fields without weakening the boolean verdict', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ granted: false, reason: 'insufficient_balance' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(await claudiumSpendDetailed(SPEND)).toEqual({
      result: {
        granted: false,
        balance: null,
        costClaudium: null,
        reason: 'insufficient_balance',
      },
      neverReached: false,
    });
  });

  it('a successful spend is never flagged, whatever the service answered', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ granted: true, balance: 900, costClaudium: 100 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const out = await claudiumSpendDetailed(SPEND);
    expect(out.neverReached).toBe(false);
    expect(out.result).toEqual({ granted: true, balance: 900, costClaudium: 100, reason: null });

    // A definitive REFUSAL is equally not a transport fact.
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ granted: false, balance: 5, reason: 'insufficient_balance' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const refused = await claudiumSpendDetailed(SPEND);
    expect(refused.neverReached).toBe(false);
    expect(refused.result.reason).toBe('insufficient_balance');
  });

  it('never follows a redirect, so a delivered POST cannot be mistaken for unsent', async () => {
    // A 307 or 308 preserves the method, so the first POST really was
    // delivered. With redirect:'follow' a connect failure against the redirect
    // TARGET would surface as a connect-level rejection and classify as
    // never-reached over a request that had already reached an application.
    // Refusing the redirect keeps the answer ambiguous, which is the safe
    // direction, and also stops the service secret header riding to whatever
    // the redirect named.
    const seen: RequestInit[] = [];
    fetchMock.mockImplementation((_url: unknown, init: RequestInit) => {
      seen.push(init);
      return Promise.resolve(
        new Response('', { status: 200, headers: { 'content-type': 'application/json' } }),
      );
    });
    await claudiumSpendDetailed(SPEND);
    expect(seen[0]?.redirect).toBe('error');

    // And when undici raises for the refused redirect, the outcome is ambiguous.
    const redirectRefused = new TypeError('unexpected redirect');
    fetchMock.mockRejectedValue(redirectRefused);
    expect((await claudiumSpendDetailed(SPEND)).neverReached).toBe(false);
  });

  it('an unconfigured service never sends, so nothing could have debited', async () => {
    delete process.env.WOC_ECONOMY_SERVICE_URL;
    const out = await claudiumSpendDetailed(SPEND);
    expect(out.neverReached).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();

    process.env.WOC_ECONOMY_SERVICE_URL = 'http://127.0.0.1:8788/v1/claudium/';
    delete process.env.WOC_ECONOMY_INTERNAL_SECRET;
    expect((await claudiumSpendDetailed(SPEND)).neverReached).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
