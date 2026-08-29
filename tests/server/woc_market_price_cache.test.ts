// The $WOC price cache policy (server/woc_market_price_cache.ts): the three
// H11 defects it exists to close, each pinned decisively. The clock is
// injected, so no timers or sleeps anywhere; the refresh mirrors the proxy
// contract (it RESOLVES an unavailable value, never rejects).

import { describe, expect, it } from 'vitest';
import {
  createWocPriceCache,
  WOC_PRICE_CACHE_TTL_MS,
  WOC_PRICE_FAILURE_TTL_MS,
  WOC_PRICE_STALE_SERVE_MAX_MS,
} from '../../server/woc_market_price_cache';

interface Price {
  available: boolean;
  tag: string;
}

const ok = (tag: string): Price => ({ available: true, tag });
const FAIL: Price = { available: false, tag: 'unavailable' };

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function rig(answers: () => Promise<Price>) {
  let clock = 1_000_000;
  let calls = 0;
  const cache = createWocPriceCache<Price>(
    () => {
      calls++;
      return answers();
    },
    { isFailure: (v) => !v.available, now: () => clock },
  );
  return {
    cache,
    calls: () => calls,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('woc price cache', () => {
  it('serves a success from cache inside the TTL with exactly one refresh', async () => {
    const r = rig(async () => ok('a'));
    expect((await r.cache.read()).tag).toBe('a');
    r.advance(WOC_PRICE_CACHE_TTL_MS - 1);
    expect((await r.cache.read()).tag).toBe('a');
    expect(r.calls()).toBe(1);
  });

  it('single-flights concurrent cold readers into one refresh', async () => {
    const gate = deferred<Price>();
    const r = rig(() => gate.promise);
    const reads = [r.cache.read(), r.cache.read(), r.cache.read()];
    // The decisive oracle: all three are in flight and only one refresh ran.
    expect(r.calls()).toBe(1);
    gate.resolve(ok('a'));
    const values = await Promise.all(reads);
    expect(values.map((v) => v.tag)).toEqual(['a', 'a', 'a']);
    expect(r.calls()).toBe(1);
  });

  it('stale-while-revalidate: an expired success serves immediately while the refresh lands behind it', async () => {
    const gate = deferred<Price>();
    let answer: () => Promise<Price> = async () => ok('old');
    const r = rig(() => answer());
    await r.cache.read();
    r.advance(WOC_PRICE_CACHE_TTL_MS + 1);
    answer = () => gate.promise;
    // Inside the stale-serve bound: the read resolves NOW with the old value
    // (it must not await the hung refresh), and a background flight starts.
    expect((await r.cache.read()).tag).toBe('old');
    expect(r.calls()).toBe(2);
    gate.resolve(ok('new'));
    await gate.promise;
    // Yield once so the background install lands before the next read.
    await Promise.resolve();
    expect((await r.cache.read()).tag).toBe('new');
    expect(r.calls()).toBe(2);
  });

  it('a failed refresh does not blank a success still inside the stale-serve bound', async () => {
    let answer = async () => ok('good');
    const r = rig(() => answer());
    await r.cache.read();
    r.advance(WOC_PRICE_CACHE_TTL_MS + 1);
    answer = async () => FAIL;
    expect((await r.cache.read()).tag).toBe('good');
    // The background failure landed; the success memo survives it.
    await Promise.resolve();
    expect(r.cache.peek().success?.value.tag).toBe('good');
    expect((await r.cache.read()).tag).toBe('good');
  });

  it('bounds the re-probe rate against a fast-failing service while stale-serving', async () => {
    let answer = async () => ok('good');
    const r = rig(() => answer());
    await r.cache.read();
    r.advance(WOC_PRICE_CACHE_TTL_MS + 1);
    answer = async () => FAIL;
    await r.cache.read();
    await Promise.resolve();
    const probesAfterFirst = r.calls();
    // Repeated reads inside the failure memo window must not add probes.
    await r.cache.read();
    await r.cache.read();
    expect(r.calls()).toBe(probesAfterFirst);
    // Past the failure memo, the next stale-serve read probes again.
    r.advance(WOC_PRICE_FAILURE_TTL_MS);
    await r.cache.read();
    expect(r.calls()).toBe(probesAfterFirst + 1);
  });

  it('converges to the failure answer once the success ages past the stale-serve bound', async () => {
    let answer = async () => ok('good');
    const r = rig(() => answer());
    await r.cache.read();
    answer = async () => FAIL;
    r.advance(WOC_PRICE_STALE_SERVE_MAX_MS + 1);
    // Beyond the bound there is no servable success: the read blocks on the
    // refresh and gets the truthful unavailable answer.
    expect((await r.cache.read()).available).toBe(false);
    expect(r.cache.peek().success).toBeNull();
  });

  it('caches a failure only briefly, never for the success TTL', async () => {
    let answer = async () => FAIL;
    const r = rig(() => answer());
    expect((await r.cache.read()).available).toBe(false);
    // Within the failure memo: answered from the memo, no new probe.
    r.advance(WOC_PRICE_FAILURE_TTL_MS - 1);
    expect((await r.cache.read()).available).toBe(false);
    expect(r.calls()).toBe(1);
    // One tick past the memo (still far inside the old 15s blanking window):
    // a recovered service is visible immediately.
    r.advance(2);
    answer = async () => ok('recovered');
    expect((await r.cache.read()).tag).toBe('recovered');
    expect(r.calls()).toBe(2);
  });

  it('a recovered success replaces the failure memo entirely', async () => {
    let answer = async () => FAIL;
    const r = rig(() => answer());
    await r.cache.read();
    r.advance(WOC_PRICE_FAILURE_TTL_MS + 1);
    answer = async () => ok('back');
    await r.cache.read();
    expect(r.cache.peek().failure).toBeNull();
    r.advance(WOC_PRICE_CACHE_TTL_MS - 1);
    expect((await r.cache.read()).tag).toBe('back');
    expect(r.calls()).toBe(2);
  });

  it('the exported bounds keep the documented ordering: ttl < stale-serve, failure memo well under both', () => {
    expect(WOC_PRICE_CACHE_TTL_MS).toBe(15_000);
    expect(WOC_PRICE_STALE_SERVE_MAX_MS).toBe(30_000);
    expect(WOC_PRICE_FAILURE_TTL_MS).toBe(3_000);
    expect(WOC_PRICE_STALE_SERVE_MAX_MS).toBeGreaterThan(WOC_PRICE_CACHE_TTL_MS);
    expect(WOC_PRICE_FAILURE_TTL_MS).toBeLessThan(WOC_PRICE_CACHE_TTL_MS);
  });
});

describe('exact boundaries (an off-by-one at any comparison site must fail HERE)', () => {
  it('age EXACTLY ttlMs is stale-serve, not a hit: the old value returns and a refresh kicks', async () => {
    let answer = ok('first');
    const r = rig(async () => answer);
    await r.cache.read();
    answer = ok('second');
    r.advance(WOC_PRICE_CACHE_TTL_MS);
    expect((await r.cache.read()).tag).toBe('first');
    // The kick ran (calls moved), so the flip from pure-hit to SWR happened
    // at the boundary itself, not one past it.
    expect(r.calls()).toBe(2);
  });

  it('age EXACTLY staleServeMaxMs is unservable: the read blocks on the refresh', async () => {
    let answer = ok('first');
    const r = rig(async () => answer);
    await r.cache.read();
    answer = ok('second');
    r.advance(WOC_PRICE_STALE_SERVE_MAX_MS);
    expect((await r.cache.read()).tag).toBe('second');
  });

  it('a failure landing with the success EXACTLY at the stale-serve bound clears it', async () => {
    let answer: Price = ok('first');
    const r = rig(async () => answer);
    await r.cache.read();
    answer = FAIL;
    r.advance(WOC_PRICE_STALE_SERVE_MAX_MS);
    expect((await r.cache.read()).available).toBe(false);
    // The >= at the install site: the out-of-bound success is GONE, so a
    // later read cannot resurrect a price older than the health ceiling.
    expect(r.cache.peek().success).toBeNull();
    expect(r.cache.peek().failure).not.toBeNull();
  });
});

describe('containment arms', () => {
  it('stale-serve readers JOIN a hanging refresh: one probe, never one per read', async () => {
    let gate: { promise: Promise<Price>; resolve: (v: Price) => void } | null = null;
    let answer: Price | null = ok('first');
    const r = rig(() => {
      if (answer !== null) return Promise.resolve(answer);
      gate = deferred<Price>();
      return gate.promise;
    });
    await r.cache.read();
    answer = null; // every later refresh hangs on its gate
    r.advance(WOC_PRICE_CACHE_TTL_MS + 1);
    // Three stale-serve reads against the hanging refresh: all serve the old
    // success immediately and share ONE in-flight probe (a per-read probe
    // against a hanging service is the storm single-flight exists to stop).
    expect((await r.cache.read()).tag).toBe('first');
    expect((await r.cache.read()).tag).toBe('first');
    expect((await r.cache.read()).tag).toBe('first');
    expect(r.calls()).toBe(2);
    (gate as unknown as { resolve: (v: Price) => void }).resolve(ok('second'));
    await Promise.resolve();
    expect((await r.cache.read()).tag).toBe('second');
  });

  it('a THROWN refresh on the stale-serve path is swallowed and the stale success keeps serving', async () => {
    let boom = false;
    const r = rig(async () => {
      if (boom) throw new Error('refresh bug');
      return ok('first');
    });
    await r.cache.read();
    boom = true;
    r.advance(WOC_PRICE_CACHE_TTL_MS + 1);
    // The kick's rejection is caught (an unhandled rejection here fails the
    // whole suite), the read still answers, and the settled flight clears so
    // the next read can retry.
    expect((await r.cache.read()).tag).toBe('first');
    await Promise.resolve();
    await Promise.resolve();
    boom = false;
    r.advance(1);
    expect((await r.cache.read()).tag).toBe('first');
  });

  it('a THROWN refresh on the cold path rejects the read but never wedges the flight slot', async () => {
    let boom = true;
    const r = rig(async () => {
      if (boom) throw new Error('refresh bug');
      return ok('recovered');
    });
    await expect(r.cache.read()).rejects.toThrow('refresh bug');
    boom = false;
    // The finally cleared inFlight, so the retry mints a fresh flight
    // instead of sharing the dead rejection forever.
    expect((await r.cache.read()).tag).toBe('recovered');
  });

  it('peek() hands out COPIES: mutating the readout cannot corrupt the state machine', async () => {
    const r = rig(async () => ok('first'));
    await r.cache.read();
    const seen = r.cache.peek();
    expect(seen.success).not.toBeNull();
    if (seen.success) seen.success.at = -1;
    // A second peek reads the LIVE memo, untouched by the caller's write,
    // and the cache still serves the in-TTL hit off the real timestamp.
    expect(r.cache.peek().success?.at).not.toBe(-1);
    expect((await r.cache.read()).tag).toBe('first');
    expect(r.calls()).toBe(1);
  });
});
