// Tests for the two-tier rate-limit middleware (server/http/middleware/rate_limit.ts).
// The resolver runs the in-process sliding-window limiter (tier-1) first, then a
// pg-backed GLOBAL store (tier-2) only when tier-1 allows; a rejection throws
// HttpError(429, 'rate_limit.exceeded', { retryAfterSeconds }, <draft-11 headers>).
// The clock is pinned via the injected clock seam so a flood, a window reset, the
// exact header values, and the tier ordering are all deterministic. The tier-2
// store slot is reset to null in afterEach so a store installed by one test never
// leaks into another.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type AttackSignalKeyKind,
  type AttackSignalSink,
  noopAttackSignalSink,
  setAttackSignalSink,
} from '../../../server/http/attack_signals';
import { mapError } from '../../../server/http/errors';
import { logger } from '../../../server/http/logger';
import {
  CARD_UPLOAD_POLICY,
  CHARACTER_CREATE_POLICY,
  CHARACTER_DELETE_POLICY,
  CHARACTER_RENAME_POLICY,
  CHARACTER_TAKEOVER_POLICY,
  CLAUDIUM_CONFIRM_POLICY,
  CLAUDIUM_CONFIRM_PRE_AUTH_POLICY,
  CLAUDIUM_PURCHASE_POLICY,
  CLAUDIUM_PURCHASE_PRE_AUTH_POLICY,
  CLAUDIUM_QUOTE_POLICY,
  CLAUDIUM_QUOTE_PRE_AUTH_POLICY,
  CLAUDIUM_SPEND_POLICY,
  CLAUDIUM_SPEND_PRE_AUTH_POLICY,
  DISCORD_POLICY,
  PUBLIC_READ_POLICY,
  type RateLimitPolicy,
  REPORTS_CREATE_POLICY,
  rateLimit,
  resetTier2ErrorLogThrottle,
  WALLET_LINK_POLICY,
  WOC_BALANCE_POLICY,
} from '../../../server/http/middleware/rate_limit';
import type { RateLimitOutcome, RateLimitStore } from '../../../server/http/types';
import {
  CARD_UPLOAD_MAX_PER_MINUTE,
  CHARACTER_MUTATION_MAX_PER_MINUTE,
  CLAUDIUM_CONFIRM_MAX_PER_MINUTE,
  CLAUDIUM_PURCHASE_MAX_PER_MINUTE,
  CLAUDIUM_QUOTE_MAX_PER_MINUTE,
  CLAUDIUM_SPEND_MAX_PER_MINUTE,
  DISCORD_MAX_PER_MINUTE,
  PUBLIC_READ_MAX_PER_MINUTE,
  REPORTS_CREATE_MAX_PER_MINUTE,
  resetCardUploadRateLimits,
  resetClaudiumMutationRateLimits,
  resetDiscordRateLimits,
  resetRateLimitClock,
  resetWalletLinkRateLimits,
  resetWocBalanceRateLimits,
  setRateLimitClock,
  setRateLimitTier2Store,
  WALLET_LINK_MAX_PER_MINUTE,
  WINDOW_MS,
  WOC_BALANCE_MAX_PER_MINUTE,
} from '../../../server/ratelimit';
import { createPgRateLimitStore } from '../../../server/ratelimit_db';
import { fakeCtx } from '../helpers/fake_ctx';

const WINDOW_SECONDS = WINDOW_MS / 1000;
const PINNED = 1_000_000;

// A recording fake tier-2 store: it logs every hit (key + advertised max) and
// returns whatever the per-key outcome function decides, so a test can trip,
// allow, or throw from tier-2 deterministically. Named Recording* (not Fake*)
// so it never shadows the DIFFERENT sliding-window FakeRateLimitStore in
// tests/server/helpers/fake_ratelimit_store.ts.
class RecordingRateLimitStore implements RateLimitStore {
  hits: Array<{ key: string; max: number }> = [];
  constructor(private readonly outcomeFor: (key: string) => RateLimitOutcome) {}
  async hit(key: string, maxPerMinute: number): Promise<RateLimitOutcome> {
    this.hits.push({ key, max: maxPerMinute });
    return this.outcomeFor(key);
  }
  async reset(): Promise<void> {
    this.hits = [];
  }
}

const ALWAYS_ALLOWED: RateLimitOutcome = { allowed: true, remaining: 999, resetSeconds: 1 };

// A recording fake AttackSignalSink: it captures every rate_limit_hits_total and
// pg_limiter_writes_total emission so a test can assert the exact (policy, keyKind)
// tuple and the exact call count. Installed via setAttackSignalSink in beforeEach and
// restored to the no-op in afterEach so it never leaks across tests.
class RecordingAttackSignalSink implements AttackSignalSink {
  rateLimitHits: Array<{ policy: string; keyKind: AttackSignalKeyKind }> = [];
  pgLimiterWrites: string[] = [];
  rateLimitHit(policy: string, keyKind: AttackSignalKeyKind): void {
    this.rateLimitHits.push({ policy, keyKind });
  }
  authFailure(): void {}
  bolaDenied(): void {}
  pgLimiterWrite(policy: string): void {
    this.pgLimiterWrites.push(policy);
  }
}

beforeEach(() => {
  setRateLimitClock(() => PINNED);
  resetWocBalanceRateLimits();
  resetCardUploadRateLimits();
  resetClaudiumMutationRateLimits();
});

afterEach(() => {
  // ALWAYS restore the clock AND the tier-2 slot so nothing leaks across tests.
  resetRateLimitClock();
  setRateLimitTier2Store(null);
  resetWocBalanceRateLimits();
  resetCardUploadRateLimits();
  resetClaudiumMutationRateLimits();
  resetTier2ErrorLogThrottle();
});

describe('rateLimit: tier-1 ip policy flood', () => {
  it('allows up to the cap, then rejects the next call with an accurate 429', async () => {
    const ctx = fakeCtx();
    for (let i = 0; i < WOC_BALANCE_MAX_PER_MINUTE; i++) {
      await expect(rateLimit(WOC_BALANCE_POLICY)(ctx, async () => {})).resolves.toBeUndefined();
    }
    // At the pinned clock the whole window filled at PINNED, so resetSeconds is the
    // full window (60): the accurate per-request value happens to equal the old
    // constant here, and remaining has bottomed out at 0.
    await expect(rateLimit(WOC_BALANCE_POLICY)(ctx, async () => {})).rejects.toMatchObject({
      status: 429,
      code: 'rate_limit.exceeded',
      params: { retryAfterSeconds: WINDOW_SECONDS },
    });
  });

  it('emits the exact draft-11 headers on the 429 (r=0, t=window, q=limit, w=window)', async () => {
    const ctx = fakeCtx();
    for (let i = 0; i < WOC_BALANCE_MAX_PER_MINUTE; i++) {
      await rateLimit(WOC_BALANCE_POLICY)(ctx, async () => {});
    }
    try {
      await rateLimit(WOC_BALANCE_POLICY)(ctx, async () => {});
      throw new Error('expected rateLimit to reject');
    } catch (err) {
      const e = err as { headers?: Record<string, string>; params?: Record<string, number> };
      expect(e.params?.retryAfterSeconds).toBe(WINDOW_SECONDS);
      expect(e.headers?.['Retry-After']).toBe(String(WINDOW_SECONDS));
      expect(e.headers?.RateLimit).toBe(`"woc_balance";r=0;t=${WINDOW_SECONDS}`);
      expect(e.headers?.['RateLimit-Policy']).toBe(`"woc_balance";q=20;w=${WINDOW_SECONDS}`);

      // The headers survive applyImpliedHeaders and reach the serialized response.
      const serialized = mapError(err, fakeCtx(), { surface: 'problem' });
      expect(serialized.status).toBe(429);
      expect(serialized.headers['Retry-After']).toBe(String(WINDOW_SECONDS));
      expect(serialized.headers.RateLimit).toBe(`"woc_balance";r=0;t=${WINDOW_SECONDS}`);
      expect(serialized.headers['RateLimit-Policy']).toBe(`"woc_balance";q=20;w=${WINDOW_SECONDS}`);
    }
  });
});

describe('rateLimit: window reset', () => {
  it('allows a call again once the window has fully elapsed', async () => {
    const ctx = fakeCtx();
    for (let i = 0; i < WOC_BALANCE_MAX_PER_MINUTE; i++) {
      await rateLimit(WOC_BALANCE_POLICY)(ctx, async () => {});
    }
    await expect(rateLimit(WOC_BALANCE_POLICY)(ctx, async () => {})).rejects.toMatchObject({
      status: 429,
      code: 'rate_limit.exceeded',
    });
    setRateLimitClock(() => PINNED + WINDOW_MS + 1);
    await expect(rateLimit(WOC_BALANCE_POLICY)(ctx, async () => {})).resolves.toBeUndefined();
  });
});

describe('rateLimit: ip+account policy', () => {
  it('limits per-account after the cap', async () => {
    const ctx = fakeCtx({ account: { accountId: 7, scope: 'full' } });
    for (let i = 0; i < CARD_UPLOAD_MAX_PER_MINUTE; i++) {
      await rateLimit(CARD_UPLOAD_POLICY)(ctx, async () => {});
    }
    await expect(rateLimit(CARD_UPLOAD_POLICY)(ctx, async () => {})).rejects.toMatchObject({
      status: 429,
      code: 'rate_limit.exceeded',
    });
  });

  it('throws a 500 internal.error when ctx.account is missing (a composition bug)', async () => {
    // tier1 reads ctxAccountId, which 500s before any tier-2 work when account is unset.
    const ctx = fakeCtx();
    await expect(rateLimit(CARD_UPLOAD_POLICY)(ctx, async () => {})).rejects.toMatchObject({
      status: 500,
      code: 'internal.error',
    });
  });
});

describe('rateLimit: wallet-link and discord ip+account policies', () => {
  beforeEach(() => {
    resetWalletLinkRateLimits();
    resetDiscordRateLimits();
  });
  afterEach(() => {
    resetWalletLinkRateLimits();
    resetDiscordRateLimits();
  });

  it('WALLET_LINK_POLICY is ip+account and 429s once its cap is exceeded', async () => {
    expect(WALLET_LINK_POLICY.keyClass).toBe('ip+account');
    const ctx = fakeCtx({ account: { accountId: 11, scope: 'full' } });
    for (let i = 0; i < WALLET_LINK_MAX_PER_MINUTE; i++) {
      await rateLimit(WALLET_LINK_POLICY)(ctx, async () => {});
    }
    await expect(rateLimit(WALLET_LINK_POLICY)(ctx, async () => {})).rejects.toMatchObject({
      status: 429,
      code: 'rate_limit.exceeded',
    });
  });

  it('DISCORD_POLICY is ip+account and 429s once its cap is exceeded', async () => {
    expect(DISCORD_POLICY.keyClass).toBe('ip+account');
    const ctx = fakeCtx({ account: { accountId: 12, scope: 'full' } });
    for (let i = 0; i < DISCORD_MAX_PER_MINUTE; i++) {
      await rateLimit(DISCORD_POLICY)(ctx, async () => {});
    }
    await expect(rateLimit(DISCORD_POLICY)(ctx, async () => {})).rejects.toMatchObject({
      status: 429,
      code: 'rate_limit.exceeded',
    });
  });

  it('DISCORD_POLICY 500s when ctx.account is missing (ip+account composition bug)', async () => {
    const ctx = fakeCtx();
    await expect(rateLimit(DISCORD_POLICY)(ctx, async () => {})).rejects.toMatchObject({
      status: 500,
      code: 'internal.error',
    });
  });
});

describe('rateLimit: allowed call', () => {
  it('runs next() when under the limit and no tier-2 store is wired', async () => {
    const ctx = fakeCtx();
    let nextRan = false;
    await rateLimit(WOC_BALANCE_POLICY)(ctx, async () => {
      nextRan = true;
    });
    expect(nextRan).toBe(true);
  });
});

describe('rateLimit: tier-1 rejects before tier-2', () => {
  it('never records a tier-2 hit for the flooded (tier-1-rejected) portion', async () => {
    const store = new RecordingRateLimitStore(() => ALWAYS_ALLOWED);
    setRateLimitTier2Store(store);
    const ctx = fakeCtx();

    // The under-cap portion passes tier-1 and DOES record one tier-2 hit each.
    for (let i = 0; i < WOC_BALANCE_MAX_PER_MINUTE; i++) {
      await rateLimit(WOC_BALANCE_POLICY)(ctx, async () => {});
    }
    expect(store.hits.length).toBe(WOC_BALANCE_MAX_PER_MINUTE);
    const hitsAtCap = store.hits.length;

    // Every over-cap attempt is rejected at tier-1 and must NOT reach pg.
    for (let i = 0; i < 5; i++) {
      await expect(rateLimit(WOC_BALANCE_POLICY)(ctx, async () => {})).rejects.toMatchObject({
        status: 429,
      });
    }
    expect(store.hits.length).toBe(hitsAtCap);
  });
});

describe('rateLimit: tier-2 trip', () => {
  it('throws the 429 with the TIER-2 numbers when tier-1 allows but tier-2 rejects', async () => {
    const store = new RecordingRateLimitStore(() => ({
      allowed: false,
      remaining: 3,
      resetSeconds: 17,
    }));
    setRateLimitTier2Store(store);
    const ctx = fakeCtx();

    try {
      await rateLimit(WOC_BALANCE_POLICY)(ctx, async () => {});
      throw new Error('expected tier-2 rejection');
    } catch (err) {
      const e = err as { headers?: Record<string, string>; params?: Record<string, number> };
      expect(e.params?.retryAfterSeconds).toBe(17);
      expect(e.headers?.['Retry-After']).toBe('17');
      expect(e.headers?.RateLimit).toBe('"woc_balance";r=3;t=17');
      expect(e.headers?.['RateLimit-Policy']).toBe(`"woc_balance";q=20;w=${WINDOW_SECONDS}`);
    }
    // tier-1 allowed, so tier-2 was consulted exactly once (ip-only policy).
    expect(store.hits).toEqual([
      { key: `woc_balance:ip:${ctx.ip}`, max: WOC_BALANCE_MAX_PER_MINUTE },
    ]);
  });
});

describe('rateLimit: tier-2 fails open', () => {
  it('proceeds (next runs) when the tier-2 store throws', async () => {
    const errSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const store = new RecordingRateLimitStore(() => {
      throw new Error('pg is down');
    });
    setRateLimitTier2Store(store);
    const ctx = fakeCtx();
    let nextRan = false;

    await expect(
      rateLimit(WOC_BALANCE_POLICY)(ctx, async () => {
        nextRan = true;
      }),
    ).resolves.toBeUndefined();
    expect(nextRan).toBe(true);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('logs the fail-open error at most once per window', async () => {
    // During a pg outage EVERY tier-1-allowed request lands in the fail-open
    // catch; the log line is throttled to one per WINDOW_MS (via the injected
    // clock) so an outage under load cannot flood the ops log.
    const errSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const store = new RecordingRateLimitStore(() => {
      throw new Error('pg is down');
    });
    setRateLimitTier2Store(store);
    const ctx = fakeCtx();

    await rateLimit(WOC_BALANCE_POLICY)(ctx, async () => {});
    await rateLimit(WOC_BALANCE_POLICY)(ctx, async () => {});
    expect(errSpy).toHaveBeenCalledTimes(1);

    // A full window later the next failure logs again.
    setRateLimitClock(() => PINNED + WINDOW_MS);
    await rateLimit(WOC_BALANCE_POLICY)(ctx, async () => {});
    expect(errSpy).toHaveBeenCalledTimes(2);
    errSpy.mockRestore();
  });
});

describe('rateLimit: ip+account tier-2 key composition and merge', () => {
  it('hits BOTH the ip and acct keys and merges to the tighter bucket (min remaining, max reset)', async () => {
    resetCardUploadRateLimits();
    // The ip bucket is looser (allowed, r=5, t=30); the acct bucket is the binding
    // one (rejected, r=0, t=45). The merge must reject with r=min(5,0)=0 and
    // t=max(30,45)=45.
    const store = new RecordingRateLimitStore((key) =>
      key.includes(':acct:')
        ? { allowed: false, remaining: 0, resetSeconds: 45 }
        : { allowed: true, remaining: 5, resetSeconds: 30 },
    );
    setRateLimitTier2Store(store);
    const ctx = fakeCtx({ ip: '1.2.3.4', account: { accountId: 7, scope: 'full' } });

    try {
      await rateLimit(CARD_UPLOAD_POLICY)(ctx, async () => {});
      throw new Error('expected the merged tier-2 rejection');
    } catch (err) {
      const e = err as { headers?: Record<string, string>; params?: Record<string, number> };
      expect(e.params?.retryAfterSeconds).toBe(45);
      expect(e.headers?.RateLimit).toBe('"card_upload";r=0;t=45');
      expect(e.headers?.['RateLimit-Policy']).toBe(`"card_upload";q=10;w=${WINDOW_SECONDS}`);
    }
    // Both keys were recorded, ip first then acct, each carrying the policy limit.
    expect(store.hits).toEqual([
      { key: 'card_upload:ip:1.2.3.4', max: CARD_UPLOAD_MAX_PER_MINUTE },
      { key: 'card_upload:acct:7', max: CARD_UPLOAD_MAX_PER_MINUTE },
    ]);
  });
});

describe('rateLimit: policy derivation guard', () => {
  it('every policy limit === its named constant and windowSeconds === WINDOW_MS / 1000', () => {
    // Import the constants by identity so a re-typed literal (e.g. limit: 20) fails.
    const table: ReadonlyArray<{ policy: RateLimitPolicy; limit: number }> = [
      { policy: PUBLIC_READ_POLICY, limit: PUBLIC_READ_MAX_PER_MINUTE },
      { policy: WOC_BALANCE_POLICY, limit: WOC_BALANCE_MAX_PER_MINUTE },
      { policy: CARD_UPLOAD_POLICY, limit: CARD_UPLOAD_MAX_PER_MINUTE },
      { policy: WALLET_LINK_POLICY, limit: WALLET_LINK_MAX_PER_MINUTE },
      { policy: CLAUDIUM_PURCHASE_PRE_AUTH_POLICY, limit: CLAUDIUM_PURCHASE_MAX_PER_MINUTE },
      { policy: CLAUDIUM_QUOTE_PRE_AUTH_POLICY, limit: CLAUDIUM_QUOTE_MAX_PER_MINUTE },
      { policy: CLAUDIUM_CONFIRM_PRE_AUTH_POLICY, limit: CLAUDIUM_CONFIRM_MAX_PER_MINUTE },
      { policy: CLAUDIUM_SPEND_PRE_AUTH_POLICY, limit: CLAUDIUM_SPEND_MAX_PER_MINUTE },
      { policy: CLAUDIUM_PURCHASE_POLICY, limit: CLAUDIUM_PURCHASE_MAX_PER_MINUTE },
      { policy: CLAUDIUM_QUOTE_POLICY, limit: CLAUDIUM_QUOTE_MAX_PER_MINUTE },
      { policy: CLAUDIUM_CONFIRM_POLICY, limit: CLAUDIUM_CONFIRM_MAX_PER_MINUTE },
      { policy: CLAUDIUM_SPEND_POLICY, limit: CLAUDIUM_SPEND_MAX_PER_MINUTE },
      { policy: CHARACTER_CREATE_POLICY, limit: CHARACTER_MUTATION_MAX_PER_MINUTE },
      { policy: CHARACTER_RENAME_POLICY, limit: CHARACTER_MUTATION_MAX_PER_MINUTE },
      { policy: CHARACTER_DELETE_POLICY, limit: CHARACTER_MUTATION_MAX_PER_MINUTE },
      { policy: CHARACTER_TAKEOVER_POLICY, limit: CHARACTER_MUTATION_MAX_PER_MINUTE },
      { policy: REPORTS_CREATE_POLICY, limit: REPORTS_CREATE_MAX_PER_MINUTE },
      { policy: DISCORD_POLICY, limit: DISCORD_MAX_PER_MINUTE },
    ];
    for (const { policy, limit } of table) {
      expect(policy.limit, `${policy.name} limit`).toBe(limit);
      expect(policy.windowSeconds, `${policy.name} window`).toBe(WINDOW_SECONDS);
      // Every mounted-and-unmounted policy is pg-global backed in the table.
      expect(policy.tier2, `${policy.name} tier2`).toBe('global');
    }
  });
});

describe('rateLimit: rate_limit_hits_total attack-signal counter', () => {
  let signals: RecordingAttackSignalSink;

  beforeEach(() => {
    signals = new RecordingAttackSignalSink();
    setAttackSignalSink(signals);
  });
  afterEach(() => {
    setAttackSignalSink(noopAttackSignalSink);
  });

  it('records one hit with the literal (name, ip) on a tier-1 rejection', async () => {
    const ctx = fakeCtx();
    for (let i = 0; i < WOC_BALANCE_MAX_PER_MINUTE; i++) {
      await rateLimit(WOC_BALANCE_POLICY)(ctx, async () => {});
    }
    // Nothing recorded while every call is under the cap.
    expect(signals.rateLimitHits).toEqual([]);

    await expect(rateLimit(WOC_BALANCE_POLICY)(ctx, async () => {})).rejects.toMatchObject({
      status: 429,
      code: 'rate_limit.exceeded',
    });
    expect(signals.rateLimitHits).toEqual([{ policy: 'woc_balance', keyKind: 'ip' }]);
  });

  it('records one hit with the literal (name, ip+account) on a tier-2 rejection', async () => {
    // tier-1 allows the first call; the pg-global store then rejects, so the 429
    // comes from tier-2 and the counter still fires exactly once.
    const store = new RecordingRateLimitStore(() => ({
      allowed: false,
      remaining: 0,
      resetSeconds: 30,
    }));
    setRateLimitTier2Store(store);
    const ctx = fakeCtx({ account: { accountId: 7, scope: 'full' } });

    await expect(rateLimit(CARD_UPLOAD_POLICY)(ctx, async () => {})).rejects.toMatchObject({
      status: 429,
      code: 'rate_limit.exceeded',
    });
    expect(signals.rateLimitHits).toEqual([{ policy: 'card_upload', keyKind: 'ip+account' }]);
  });

  it('records nothing for an allowed request', async () => {
    const ctx = fakeCtx();
    let nextRan = false;
    await rateLimit(WOC_BALANCE_POLICY)(ctx, async () => {
      nextRan = true;
    });
    expect(nextRan).toBe(true);
    expect(signals.rateLimitHits).toEqual([]);
  });

  it('under a tier-1 flood, records one hit per rejection and never touches pg (tier-2 store or pgLimiterWrite)', async () => {
    // A store IS wired, so the under-cap portion records tier-2 hits; the point is
    // that the over-cap (tier-1-rejected) portion reaches NEITHER the tier-2 store
    // NOR pg_limiter_writes_total. This is the "pg_limiter_writes_total stays 0 under
    // a tier-1 flood" guarantee (docs/api-pipeline/qa-checklist.md).
    const store = new RecordingRateLimitStore(() => ALWAYS_ALLOWED);
    setRateLimitTier2Store(store);
    const ctx = fakeCtx();

    // Fill tier-1 to the cap; each allowed call records exactly one tier-2 hit.
    for (let i = 0; i < WOC_BALANCE_MAX_PER_MINUTE; i++) {
      await rateLimit(WOC_BALANCE_POLICY)(ctx, async () => {});
    }
    const tier2HitsAtCap = store.hits.length;
    expect(signals.rateLimitHits).toEqual([]);

    // Three over-cap attempts, each rejected at tier-1.
    for (let i = 0; i < 3; i++) {
      await expect(rateLimit(WOC_BALANCE_POLICY)(ctx, async () => {})).rejects.toMatchObject({
        status: 429,
      });
    }

    // The flood never called the tier-2 store's hit() again. (The recording fake
    // never emits pgLimiterWrite, so the empty-writes line below is only decisive
    // by composition; the companion test with the REAL pg store closes that.)
    expect(store.hits.length).toBe(tier2HitsAtCap);
    expect(signals.pgLimiterWrites).toEqual([]);
    // Exactly one counter hit per rejected request: three rejections, three hits.
    expect(signals.rateLimitHits.length).toBe(3);
    expect(signals.rateLimitHits).toEqual([
      { policy: 'woc_balance', keyKind: 'ip' },
      { policy: 'woc_balance', keyKind: 'ip' },
      { policy: 'woc_balance', keyKind: 'ip' },
    ]);
  });

  it('under a tier-1 flood with the REAL pg store wired, pg sees zero queries and zero writes', async () => {
    // End-to-end companion to the test above: the tier-2 store here is the REAL
    // PgRateLimitStore over a counting fake pool, which emits one pgLimiterWrite
    // per upsert. If a tier-1-rejected request erroneously consulted tier-2, the
    // pool query count AND pg_limiter_writes_total would both move, so the
    // "pg_limiter_writes_total stays 0 under a tier-1 flood" claim
    // (docs/api-pipeline/qa-checklist.md) is pinned by the real store, not by a
    // fake that could never emit.
    let queries = 0;
    const pool = {
      query: async () => {
        queries += 1;
        return { rows: [{ count: 1, window_start: PINNED - (PINNED % WINDOW_MS) }] };
      },
    } as unknown as import('pg').Pool;
    setRateLimitTier2Store(createPgRateLimitStore({ pool, now: () => PINNED }));
    const ctx = fakeCtx();

    // Fill tier-1 to the cap: each allowed call reaches pg once and counts once.
    for (let i = 0; i < WOC_BALANCE_MAX_PER_MINUTE; i++) {
      await rateLimit(WOC_BALANCE_POLICY)(ctx, async () => {});
    }
    expect(queries).toBe(WOC_BALANCE_MAX_PER_MINUTE);
    expect(signals.pgLimiterWrites.length).toBe(WOC_BALANCE_MAX_PER_MINUTE);
    expect(signals.pgLimiterWrites[0]).toBe('woc_balance');

    // Three over-cap attempts, each rejected at tier-1: pg is never queried and
    // the write counter never moves.
    for (let i = 0; i < 3; i++) {
      await expect(rateLimit(WOC_BALANCE_POLICY)(ctx, async () => {})).rejects.toMatchObject({
        status: 429,
      });
    }
    expect(queries).toBe(WOC_BALANCE_MAX_PER_MINUTE);
    expect(signals.pgLimiterWrites.length).toBe(WOC_BALANCE_MAX_PER_MINUTE);
    expect(signals.rateLimitHits.length).toBe(3);
  });
});
