// The marketplace auth-guard cache (server/woc_auth_guard_cache.ts): the
// security contract, mechanic by mechanic, over fake readers and an injected
// clock. Raw rows only (verdicts move with the clock over one cached row), no
// negative caching, no stale-serve, single-flight, the lost-bust rule, LRU
// bounds, the account-to-token index with its over-bust safety, and the
// singleton wiring the free bust functions ride.
import { afterEach, describe, expect, it } from 'vitest';
import type { AccountModerationRow, AuthTokenRow } from '../../server/auth_guard_core';
import type { BearerActiveGuardDb } from '../../server/http/middleware/bearer_active_guard';
import {
  bustWocAuthGuardAccount,
  bustWocAuthGuardAll,
  bustWocAuthGuardToken,
  configureWocAuthGuardCache,
  resetWocAuthGuardCache,
  WOC_AUTH_GUARD_ACCOUNT_CACHE_MAX,
  WOC_AUTH_GUARD_CACHE_TTL_MS,
  WOC_AUTH_GUARD_INDEX_SWEEP_FACTOR,
  WOC_AUTH_GUARD_RECENT_BUST_MIN_AGE_MS,
  WOC_AUTH_GUARD_RECENT_BUST_RETENTION_MS,
  WOC_AUTH_GUARD_RECENT_BUSTS_MAX,
  WOC_AUTH_GUARD_TOKEN_CACHE_MAX,
  WocAuthGuardCache,
  wocAuthGuardCacheStats,
  wocAuthGuardDb,
} from '../../server/woc_auth_guard_cache';

const NOW = 1_820_000_000_000;
const TTL = WOC_AUTH_GUARD_CACHE_TTL_MS;

function liveToken(accountId = 7, over: Partial<AuthTokenRow> = {}): AuthTokenRow {
  return { accountId, scope: 'full', expiresAtMs: NOW + 7 * 24 * 3600 * 1000, ...over };
}

function cleanRow(over: Partial<AccountModerationRow> = {}): AccountModerationRow {
  return {
    banned_at: null,
    suspended_until: null,
    moderation_reason: null,
    chat_muted_until: null,
    chat_strikes: 0,
    deactivated_at: null,
    messages: null,
    window_minutes: null,
    ...over,
  };
}

/** A rig with countable fake readers, a mutable row store, and a hand clock. */
function rig(opts: { ttlMs?: number; tokenMaxEntries?: number; accountMaxEntries?: number } = {}) {
  let nowMs = NOW;
  const tokens = new Map<string, AuthTokenRow>();
  const accounts = new Map<number, AccountModerationRow>();
  const calls = { token: 0, moderation: 0 };
  const cache = new WocAuthGuardCache(
    {
      fetchTokenRow: async (token) => {
        calls.token += 1;
        return tokens.get(token) ?? null;
      },
      fetchModerationRow: async (accountId) => {
        calls.moderation += 1;
        return accounts.get(accountId) ?? null;
      },
    },
    { now: () => nowMs, ...opts },
  );
  return {
    cache,
    tokens,
    accounts,
    calls,
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

// The cached bundle must satisfy the guard factories' db interface
// structurally; a drift here is a compile error, which is the pin.
const _structural: BearerActiveGuardDb = new WocAuthGuardCache({
  fetchTokenRow: async () => null,
  fetchModerationRow: async () => null,
});
void _structural;

afterEach(() => {
  resetWocAuthGuardCache();
});

describe('token arm', () => {
  it('collapses repeat reads inside the TTL into one fetch', async () => {
    const r = rig();
    r.tokens.set('t1', liveToken());
    await expect(r.cache.accountAndScopeForToken('t1')).resolves.toEqual({
      accountId: 7,
      scope: 'full',
    });
    await expect(r.cache.accountAndScopeForToken('t1')).resolves.toEqual({
      accountId: 7,
      scope: 'full',
    });
    expect(r.calls.token).toBe(1);
    r.advance(TTL);
    await r.cache.accountAndScopeForToken('t1');
    expect(r.calls.token).toBe(2);
  });

  it('shares one in-flight fetch between concurrent readers (single-flight)', async () => {
    let nowMs = NOW;
    let resolveFetch: (row: AuthTokenRow | null) => void = () => {};
    let fetches = 0;
    const cache = new WocAuthGuardCache(
      {
        fetchTokenRow: () => {
          fetches += 1;
          return new Promise((resolve) => {
            resolveFetch = resolve;
          });
        },
        fetchModerationRow: async () => null,
      },
      { now: () => nowMs },
    );
    const a = cache.accountAndScopeForToken('t1');
    const b = cache.accountAndScopeForToken('t1');
    resolveFetch(liveToken());
    await expect(a).resolves.toEqual({ accountId: 7, scope: 'full' });
    await expect(b).resolves.toEqual({ accountId: 7, scope: 'full' });
    expect(fetches).toBe(1);
    nowMs += 1;
    await cache.accountAndScopeForToken('t1');
    expect(fetches).toBe(1);
  });

  it('never caches a null probe (no negative caching, no eviction lever)', async () => {
    const r = rig();
    await expect(r.cache.accountAndScopeForToken('junk')).resolves.toBeNull();
    await expect(r.cache.accountAndScopeForToken('junk')).resolves.toBeNull();
    expect(r.calls.token).toBe(2);
    expect(r.cache.stats().tokens.entries).toBe(0);
  });

  it('never stale-serves: a failing refresh past the TTL rejects', async () => {
    let nowMs = NOW;
    let fail = false;
    const cache = new WocAuthGuardCache(
      {
        fetchTokenRow: async () => {
          if (fail) throw new Error('db down');
          return liveToken();
        },
        fetchModerationRow: async () => null,
      },
      { now: () => nowMs },
    );
    await expect(cache.accountAndScopeForToken('t1')).resolves.not.toBeNull();
    nowMs += TTL;
    fail = true;
    await expect(cache.accountAndScopeForToken('t1')).rejects.toThrow('db down');
    // Nothing installed by the failure: recovery refetches.
    fail = false;
    await expect(cache.accountAndScopeForToken('t1')).resolves.not.toBeNull();
  });

  it('refuses a cached row at its own expires_at, before the TTL lapses', async () => {
    const r = rig();
    r.tokens.set('t1', liveToken(7, { expiresAtMs: NOW + 2_000 }));
    await expect(r.cache.accountAndScopeForToken('t1')).resolves.not.toBeNull();
    r.advance(2_000);
    // Well inside the cache TTL, but past the row's own expiry: refuse, and
    // drop the dead entry so the next read re-probes.
    await expect(r.cache.accountAndScopeForToken('t1')).resolves.toBeNull();
    expect(r.cache.stats().tokens.entries).toBe(0);
  });

  it('answers null after a token-keyed bust via a fresh probe, leaving strangers warm', async () => {
    const r = rig();
    r.tokens.set('t1', liveToken());
    r.tokens.set('stranger', liveToken(8));
    await r.cache.accountAndScopeForToken('t1');
    await r.cache.accountAndScopeForToken('stranger');
    r.tokens.delete('t1');
    // Without the bust the cached row would still answer.
    await expect(r.cache.accountAndScopeForToken('t1')).resolves.not.toBeNull();
    r.cache.bustToken('t1');
    await expect(r.cache.accountAndScopeForToken('t1')).resolves.toBeNull();
    // KEYED, not a flush: the stranger's entry never refetches (a flush-all
    // bust would turn every logout into a guard-read stampede).
    const before = r.calls.token;
    await expect(r.cache.accountAndScopeForToken('stranger')).resolves.not.toBeNull();
    expect(r.calls.token).toBe(before);
  });

  it('declines the install of a fetch a bust cancelled mid-flight (lost-bust rule)', async () => {
    let resolveFetch: (row: AuthTokenRow | null) => void = () => {};
    let fetches = 0;
    const cache = new WocAuthGuardCache(
      {
        fetchTokenRow: () => {
          fetches += 1;
          return new Promise((resolve) => {
            resolveFetch = resolve;
          });
        },
        fetchModerationRow: async () => null,
      },
      { now: () => NOW },
    );
    const preBust = cache.accountAndScopeForToken('t1');
    const settlePreBust = resolveFetch;
    cache.bustToken('t1');
    // A post-bust reader refuses the cancelled flight and starts a fresh one.
    const postBust = cache.accountAndScopeForToken('t1');
    expect(fetches).toBe(2);
    settlePreBust(liveToken());
    // The pre-bust joiner still receives the value its flight computed...
    await expect(preBust).resolves.toEqual({ accountId: 7, scope: 'full' });
    // ...but nothing installed: the cache holds no entry from the dead flight.
    expect(cache.stats().tokens.entries).toBe(0);
    resolveFetch(null);
    await expect(postBust).resolves.toBeNull();
  });

  it('vetoes the install of a token fetch an ACCOUNT-keyed bust outran (the index-blind race)', async () => {
    // The account index only learns a token at INSTALL time, so an
    // account-keyed bust (revocation sweep, prefix delete, password reset)
    // cannot cancel a flight for a not-yet-cached token. The install veto
    // closes that half of the lost-bust rule: a row fetched BEFORE the bust
    // must never install after it.
    let resolveFetch: (row: AuthTokenRow | null) => void = () => {};
    let fetches = 0;
    const cache = new WocAuthGuardCache(
      {
        fetchTokenRow: () => {
          fetches += 1;
          return new Promise((resolve) => {
            resolveFetch = resolve;
          });
        },
        fetchModerationRow: async () => null,
      },
      { now: () => NOW },
    );
    const inFlight = cache.accountAndScopeForToken('t1');
    const settle = resolveFetch;
    // The revocation commits and busts BY ACCOUNT while the fetch is mid-air.
    cache.bustAccount(7);
    settle(liveToken(7));
    // The pre-bust joiner still receives its flight's answer once...
    await expect(inFlight).resolves.toEqual({ accountId: 7, scope: 'full' });
    // ...but the pre-delete row must NOT be installed: the next read
    // re-probes instead of serving the revoked token for a TTL.
    expect(cache.stats().tokens.entries).toBe(0);
    const next = cache.accountAndScopeForToken('t1');
    expect(fetches).toBe(2);
    resolveFetch(null);
    await expect(next).resolves.toBeNull();
    // A STRANGER's fetch racing the same bust installs fine (the veto is
    // keyed by the row's account, not a flush).
    const stranger = cache.accountAndScopeForToken('t2');
    resolveFetch(liveToken(8));
    await expect(stranger).resolves.toEqual({ accountId: 8, scope: 'full' });
    expect(cache.stats().tokens.entries).toBe(1);
  });

  it('refetches for a reader that arrives AFTER an account bust instead of joining the stale flight', async () => {
    // The JOIN half of the index-blind race: an account-keyed bust cannot
    // cancel a flight for a not-yet-indexed token, so without the join
    // re-check a reader arriving strictly after the revocation would be
    // answered from the pre-delete snapshot. The pre-bust caller keeps the
    // recorded once-per-flight acceptance; the post-bust arrival must not.
    let nowMs = NOW;
    const settlers: Array<(row: AuthTokenRow | null) => void> = [];
    let fetches = 0;
    const cache = new WocAuthGuardCache(
      {
        fetchTokenRow: () => {
          fetches += 1;
          return new Promise((resolve) => {
            settlers.push(resolve);
          });
        },
        fetchModerationRow: async () => null,
      },
      { now: () => nowMs },
    );
    const preBust = cache.accountAndScopeForToken('t1');
    nowMs += 1;
    cache.bustAccount(7);
    nowMs += 1;
    const postBust = cache.accountAndScopeForToken('t1');
    // Only the one flight is in the air; the joiner decides at resolution.
    expect(fetches).toBe(1);
    settlers[0](liveToken(7));
    // The pre-bust caller keeps its flight's answer (the judged acceptance)...
    await expect(preBust).resolves.toEqual({ accountId: 7, scope: 'full' });
    // ...the post-bust arrival refetched instead of accepting it, and the
    // fresh probe's answer (the row is deleted) is what it returns.
    expect(fetches).toBe(2);
    settlers[1](null);
    await expect(postBust).resolves.toBeNull();
    expect(cache.stats().tokens.entries).toBe(0);
  });

  it('refetches for a joiner even when a SECOND same-account bust lands after it (ledger overwrite)', async () => {
    // The veto ledger keeps only the LAST bust per account, so a second bust
    // arriving after the joiner would overwrite and hide the one that vetoed
    // it if the join guard compared against the joiner's arrival time; the
    // guard therefore refetches on ANY bust at or after the flight's start
    // (found live by the fix-round review, executed before the fix).
    let nowMs = NOW;
    const settlers: Array<(row: AuthTokenRow | null) => void> = [];
    let fetches = 0;
    const cache = new WocAuthGuardCache(
      {
        fetchTokenRow: () => {
          fetches += 1;
          return new Promise((resolve) => {
            settlers.push(resolve);
          });
        },
        fetchModerationRow: async () => null,
      },
      { now: () => nowMs },
    );
    const creator = cache.accountAndScopeForToken('t1');
    nowMs += 1;
    cache.bustAccount(7);
    nowMs += 1;
    const joiner = cache.accountAndScopeForToken('t1');
    nowMs += 1;
    cache.bustAccount(7);
    settlers[0](liveToken(7));
    await expect(creator).resolves.toEqual({ accountId: 7, scope: 'full' });
    expect(fetches).toBe(2);
    settlers[1](null);
    await expect(joiner).resolves.toBeNull();
    expect(cache.stats().tokens.entries).toBe(0);
  });

  it('bounds vetoed-joiner refetches: N joiners collapse onto ONE fresh flight and terminate', async () => {
    // The re-read terminates only because a settled flight has already
    // cleared its registration (the finally on the assigned promise chain),
    // so a vetoed joiner can never re-join the flight it just left: N
    // vetoed joiners cost exactly one extra fetch, not N and not a spin.
    let nowMs = NOW;
    const settlers: Array<(row: AuthTokenRow | null) => void> = [];
    let fetches = 0;
    const cache = new WocAuthGuardCache(
      {
        fetchTokenRow: () => {
          fetches += 1;
          return new Promise((resolve) => {
            settlers.push(resolve);
          });
        },
        fetchModerationRow: async () => null,
      },
      { now: () => nowMs },
    );
    const creator = cache.accountAndScopeForToken('t1');
    nowMs += 1;
    cache.bustAccount(7);
    nowMs += 1;
    const joiners = [
      cache.accountAndScopeForToken('t1'),
      cache.accountAndScopeForToken('t1'),
      cache.accountAndScopeForToken('t1'),
    ];
    settlers[0](liveToken(7));
    await expect(creator).resolves.toEqual({ accountId: 7, scope: 'full' });
    // All three vetoed joiners collapsed onto ONE fresh flight.
    expect(fetches).toBe(2);
    settlers[1](null);
    await expect(Promise.all(joiners)).resolves.toEqual([null, null, null]);
    // And the veto-driven refetches are separable from ordinary misses.
    expect(cache.stats().joinVetoRefetches).toBe(3);
  });

  it('freezes installed rows one level deep (shared-row decoration defense)', async () => {
    const r = rig();
    const nested = new Date(NOW + 60_000);
    const tokenRow = liveToken(7);
    r.tokens.set('t1', tokenRow);
    r.accounts.set(7, cleanRow({ suspended_until: nested }));
    await r.cache.accountAndScopeForToken('t1');
    await r.cache.moderationStatusForAccount(7);
    // The cache freezes the very objects the readers returned, nested
    // object values included (a frozen Date's setTime remains callable,
    // the freezeShared precedent's recorded limit).
    expect(Object.isFrozen(tokenRow)).toBe(true);
    expect(Object.isFrozen(r.accounts.get(7))).toBe(true);
    expect(Object.isFrozen(nested)).toBe(true);
  });

  it('resumes installs for a bust account once a fetch starts after the bust (fence, not blacklist)', async () => {
    let nowMs = NOW;
    const settlers: Array<(row: AuthTokenRow | null) => void> = [];
    let fetches = 0;
    const cache = new WocAuthGuardCache(
      {
        fetchTokenRow: () => {
          fetches += 1;
          return new Promise((resolve) => {
            settlers.push(resolve);
          });
        },
        fetchModerationRow: async () => null,
      },
      { now: () => nowMs },
    );
    cache.bustAccount(7);
    nowMs += 1;
    const read = cache.accountAndScopeForToken('t1');
    settlers[0](liveToken(7));
    await expect(read).resolves.toEqual({ accountId: 7, scope: 'full' });
    // The veto is a point-in-time fence, not a permanent per-account
    // blacklist: the post-bust fetch's row installed and serves the next
    // read without a refetch. (A permanent veto would silently disable the
    // cache for every account after its first revocation or moderation
    // write: the exact perf cliff this rider exists to prevent.)
    expect(cache.stats().tokens.entries).toBe(1);
    await cache.accountAndScopeForToken('t1');
    expect(fetches).toBe(1);
  });

  it('anchors the entry TTL at the fetch START, so slow fetches never extend staleness', async () => {
    let nowMs = NOW;
    const settlers: Array<(row: AuthTokenRow | null) => void> = [];
    let fetches = 0;
    const cache = new WocAuthGuardCache(
      {
        fetchTokenRow: () => {
          fetches += 1;
          return new Promise((resolve) => {
            settlers.push(resolve);
          });
        },
        fetchModerationRow: async () => null,
      },
      { now: () => nowMs },
    );
    const read = cache.accountAndScopeForToken('t1');
    // The fetch takes 2s to settle: the entry's age must count from the
    // START (the row is as-of a snapshot no later than that), or the
    // documented cross-process ceiling silently becomes TTL + fetch RTT.
    nowMs += 2_000;
    settlers[0](liveToken(7));
    await read;
    // TTL from the start: at start + TTL the entry is expired even though
    // only TTL - 2s has passed since the install.
    nowMs = NOW + TTL;
    void cache.accountAndScopeForToken('t1');
    expect(fetches).toBe(2);
    settlers[1](null);
  });

  it('evicts the coldest entry at the cap and counts it', async () => {
    const r = rig({ tokenMaxEntries: 2 });
    r.tokens.set('t1', liveToken(1));
    r.tokens.set('t2', liveToken(2));
    r.tokens.set('t3', liveToken(3));
    await r.cache.accountAndScopeForToken('t1');
    await r.cache.accountAndScopeForToken('t2');
    // Touch t1 so t2 is the coldest at the insert.
    await r.cache.accountAndScopeForToken('t1');
    await r.cache.accountAndScopeForToken('t3');
    expect(r.cache.stats().tokens).toMatchObject({ entries: 2, evictions: 1 });
    // t2 was evicted: a re-read must refetch; t1 must still be warm.
    const before = r.calls.token;
    await r.cache.accountAndScopeForToken('t1');
    expect(r.calls.token).toBe(before);
    await r.cache.accountAndScopeForToken('t2');
    expect(r.calls.token).toBe(before + 1);
  });
});

describe('moderation arm', () => {
  it('serves a warm suspension verdict inside the TTL from one fetch', async () => {
    const r = rig();
    r.accounts.set(7, cleanRow({ suspended_until: new Date(NOW + 60_000).toISOString() }));
    expect((await r.cache.moderationStatusForAccount(7)).locked).toBe(true);
    r.advance(TTL - 1_000);
    // Still warm: the second locked verdict came from the cached row.
    expect((await r.cache.moderationStatusForAccount(7)).locked).toBe(true);
    expect(r.calls.moderation).toBe(1);
    // Past the TTL the row refetches exactly once.
    r.advance(TTL);
    expect((await r.cache.moderationStatusForAccount(7)).locked).toBe(true);
    expect(r.calls.moderation).toBe(2);
  });

  it('flips locked to unlocked across suspended_until over ONE cached row', async () => {
    const r = rig({ ttlMs: 120_000 });
    r.accounts.set(7, cleanRow({ suspended_until: new Date(NOW + 60_000).toISOString() }));
    expect((await r.cache.moderationStatusForAccount(7)).locked).toBe(true);
    r.advance(60_000);
    expect((await r.cache.moderationStatusForAccount(7)).locked).toBe(false);
    expect(r.calls.moderation).toBe(1);
  });

  it('keeps a cached ban locked at any clock inside the entry lifetime', async () => {
    const r = rig({ ttlMs: 120_000 });
    r.accounts.set(7, cleanRow({ banned_at: '2026-01-01T00:00:00Z' }));
    expect((await r.cache.moderationStatusForAccount(7)).locked).toBe(true);
    r.advance(119_000);
    const status = await r.cache.moderationStatusForAccount(7);
    expect(status.locked).toBe(true);
    expect(status.message).toBe('This account has been banned.');
    expect(r.calls.moderation).toBe(1);
  });

  it('does not cache a missing row and answers the unlocked default', async () => {
    const r = rig();
    expect((await r.cache.moderationStatusForAccount(9)).locked).toBe(false);
    expect((await r.cache.moderationStatusForAccount(9)).locked).toBe(false);
    expect(r.calls.moderation).toBe(2);
    expect(r.cache.stats().accounts.entries).toBe(0);
  });

  it('serves a fresh ban immediately after an account-keyed bust, leaving strangers warm', async () => {
    const r = rig();
    r.accounts.set(7, cleanRow());
    r.accounts.set(8, cleanRow());
    expect((await r.cache.moderationStatusForAccount(7)).locked).toBe(false);
    expect((await r.cache.moderationStatusForAccount(8)).locked).toBe(false);
    r.accounts.set(7, cleanRow({ banned_at: '2026-01-01T00:00:00Z' }));
    expect((await r.cache.moderationStatusForAccount(7)).locked).toBe(false);
    r.cache.bustAccount(7);
    expect((await r.cache.moderationStatusForAccount(7)).locked).toBe(true);
    // KEYED on the moderation arm too: the stranger's row never refetched.
    const before = r.calls.moderation;
    expect((await r.cache.moderationStatusForAccount(8)).locked).toBe(false);
    expect(r.calls.moderation).toBe(before);
  });

  it('evicts on the ACCOUNT arm at its own injected cap (constructor wiring)', async () => {
    const r = rig({ accountMaxEntries: 1 });
    r.accounts.set(7, cleanRow());
    r.accounts.set(8, cleanRow());
    await r.cache.moderationStatusForAccount(7);
    await r.cache.moderationStatusForAccount(8);
    expect(r.cache.stats().accounts).toMatchObject({ entries: 1, evictions: 1 });
    // 7 was evicted by 8's install: re-reading it refetches.
    const before = r.calls.moderation;
    await r.cache.moderationStatusForAccount(7);
    expect(r.calls.moderation).toBe(before + 1);
  });
});

describe('account-keyed bust and the token index', () => {
  it('drops the moderation row AND every cached token of the account (the prefix over-bust)', async () => {
    const r = rig();
    r.tokens.set('t1', liveToken(7));
    r.tokens.set('t2', liveToken(7));
    r.tokens.set('other', liveToken(8));
    r.accounts.set(7, cleanRow());
    await r.cache.accountAndScopeForToken('t1');
    await r.cache.accountAndScopeForToken('t2');
    await r.cache.accountAndScopeForToken('other');
    await r.cache.moderationStatusForAccount(7);
    // The prefix-keyed revocation deletes by account and 8-char prefix; the
    // cache cannot know which token matched, so BOTH of the account's cached
    // tokens must drop (over-busting is the safe direction). The stranger's
    // entry stays (the symmetric-fixture rule: prove the qual, not the flush).
    r.tokens.delete('t1');
    r.cache.bustAccount(7);
    await expect(r.cache.accountAndScopeForToken('t1')).resolves.toBeNull();
    const beforeOther = r.calls.token;
    await r.cache.accountAndScopeForToken('other');
    expect(r.calls.token).toBe(beforeOther);
    // t2 refetches (bust dropped it) and re-answers from the store.
    await expect(r.cache.accountAndScopeForToken('t2')).resolves.not.toBeNull();
    expect(r.calls.token).toBe(beforeOther + 1);
  });

  it('bounds the recent-bust veto ledger under a burst, never dropping young entries', async () => {
    const r = rig();
    // A burst of distinct-account busts inside the min-age floor: nothing is
    // provably dead, so the ledger may exceed the cap (the documented soft
    // bound) rather than drop an entry a live flight could still need.
    const burst = WOC_AUTH_GUARD_RECENT_BUSTS_MAX + 40;
    for (let i = 1; i <= burst; i++) r.cache.bustAccount(i);
    expect(r.cache.stats().recentBusts).toBe(burst);
    // Age the burst past the min-age floor (still inside retention): the
    // next bust's prune drops oldest-first down to the cap.
    r.advance(WOC_AUTH_GUARD_RECENT_BUST_MIN_AGE_MS + 1);
    r.cache.bustAccount(burst + 1);
    expect(r.cache.stats().recentBusts).toBeLessThanOrEqual(WOC_AUTH_GUARD_RECENT_BUSTS_MAX);
    // A young entry always survives a prune, pinned EXACTLY: age everything
    // out past retention and bust once more; the prune leaves precisely the
    // two young entries (the previous trigger bust, at the retention
    // boundary, and the new one), never zero and never the pre-prune size.
    r.advance(WOC_AUTH_GUARD_RECENT_BUST_RETENTION_MS);
    r.cache.bustAccount(burst + 2);
    expect(r.cache.stats().recentBusts).toBe(2);
    // And the surviving newest entry is LIVE, not merely counted: it still
    // vetoes the install of a fetch that started before it (1ms later the
    // fence lifts and the install lands, the fence-not-blacklist rule).
    r.tokens.set('tv', liveToken(burst + 2));
    await r.cache.accountAndScopeForToken('tv');
    expect(r.cache.stats().tokens.entries).toBe(0);
    r.advance(1);
    await r.cache.accountAndScopeForToken('tv');
    expect(r.cache.stats().tokens.entries).toBe(1);
  });

  it('runs the over-cap prune walk ONCE per wedged window, not once per bust (the fan-out stall)', async () => {
    const r = rig();
    // Fill past the cap inside the floor window: the first over-cap bust
    // pays one walk, learns nothing can drop until the floor passes, and
    // every further bust in the window skips the walk (a realm-wide resync
    // fan-out at the 5,000-account cap otherwise pays a measured ~70ms of
    // synchronous walks on the game-loop thread).
    const burst = WOC_AUTH_GUARD_RECENT_BUSTS_MAX + 200;
    for (let i = 1; i <= burst; i++) r.cache.bustAccount(i);
    expect(r.cache.prunePassesForTests()).toBe(1);
    // Once the floor has passed, the next bust prunes again (the gate is a
    // delay, never a disable): size returns to the cap.
    r.advance(WOC_AUTH_GUARD_RECENT_BUST_MIN_AGE_MS + 1);
    r.cache.bustAccount(burst + 1);
    expect(r.cache.prunePassesForTests()).toBe(2);
    expect(r.cache.stats().recentBusts).toBeLessThanOrEqual(WOC_AUTH_GUARD_RECENT_BUSTS_MAX);
  });

  it('drops entries past RETENTION even below the floor pass cap target (the retention pass is live)', async () => {
    const r = rig();
    // Overfill, then age EVERYTHING past retention: the retention pass alone
    // must clear the stale entries, taking the ledger BELOW the cap (the
    // floor pass stops AT the cap, so a below-cap result proves the
    // retention pass ran and is not shadowed by it).
    const burst = WOC_AUTH_GUARD_RECENT_BUSTS_MAX + 40;
    for (let i = 1; i <= burst; i++) r.cache.bustAccount(i);
    r.advance(WOC_AUTH_GUARD_RECENT_BUST_RETENTION_MS + 1);
    r.cache.bustAccount(burst + 1);
    // Every burst entry was past retention: only the triggering bust stays.
    expect(r.cache.stats().recentBusts).toBe(1);
  });

  it('applies the lost-bust cancel on the MODERATION arm (same-key bust mid-flight)', async () => {
    const nowMs = NOW;
    const settlers: Array<(row: AccountModerationRow | null) => void> = [];
    let fetches = 0;
    const cache = new WocAuthGuardCache(
      {
        fetchTokenRow: async () => null,
        fetchModerationRow: () => {
          fetches += 1;
          return new Promise((resolve) => {
            settlers.push(resolve);
          });
        },
      },
      { now: () => nowMs },
    );
    const read = cache.moderationStatusForAccount(7);
    cache.bustAccount(7);
    settlers[0](cleanRow());
    await read;
    // The pre-bust moderation row must not install: the next read refetches.
    expect(cache.stats().accounts.entries).toBe(0);
    void cache.moderationStatusForAccount(7);
    expect(fetches).toBe(2);
    settlers[1](null);
  });

  it('stays safe over eviction residue and sweeps the index at its bound', async () => {
    const r = rig({ tokenMaxEntries: 2 });
    // Install more tokens than the cap so the index accumulates residue for
    // entries the LRU already dropped.
    const total = 2 * WOC_AUTH_GUARD_INDEX_SWEEP_FACTOR + 3;
    for (let i = 0; i < total; i++) {
      r.tokens.set(`t${i}`, liveToken(7));
      await r.cache.accountAndScopeForToken(`t${i}`);
    }
    // The sweep bound held: residue never exceeds cap * factor + 1.
    expect(r.cache.stats().index).toBeLessThanOrEqual(2 * WOC_AUTH_GUARD_INDEX_SWEEP_FACTOR + 1);
    // Over-busting an account whose tokens are mostly evicted cannot throw
    // and still drops the cached survivors.
    r.cache.bustAccount(7);
    expect(r.cache.stats().tokens.entries).toBe(0);
    expect(r.cache.stats().index).toBe(0);
  });
});

describe('constants and the singleton wiring', () => {
  it('pins the TTL and bounds, and the docblock prose derives from the constant', async () => {
    expect(WOC_AUTH_GUARD_CACHE_TTL_MS).toBe(5_000);
    // Sized against the 5,000-player realm admission cap (the
    // character_rank_cache precedent) times a small per-account token
    // multiple: LRU degrades as a cliff, so the caps sit ABOVE the realm
    // working set, and the relation below keeps them ordered (more tokens
    // than accounts, both above the realm cap).
    expect(WOC_AUTH_GUARD_TOKEN_CACHE_MAX).toBe(10_240);
    expect(WOC_AUTH_GUARD_ACCOUNT_CACHE_MAX).toBe(5_120);
    expect(WOC_AUTH_GUARD_TOKEN_CACHE_MAX).toBeGreaterThan(WOC_AUTH_GUARD_ACCOUNT_CACHE_MAX);
    expect(WOC_AUTH_GUARD_ACCOUNT_CACHE_MAX).toBeGreaterThanOrEqual(5_000);
    expect(WOC_AUTH_GUARD_INDEX_SWEEP_FACTOR).toBe(4);
    // The veto ledger's min-age floor must cover the WORST live-flight
    // lifetime (driver query backstop + pool checkout wait), or a prune
    // could drop the veto a still-in-flight fetch needs; the retention pass
    // must sit above the floor for the same reason. Derived from the
    // exported db constants so a deadline raise reds here.
    const { DB_POOL_CONNECT_TIMEOUT_MS, DB_QUERY_TIMEOUT_MS } = await import('../../server/db');
    // At least 5s ABOVE the derived flight bound, not equal to it: the veto
    // is consulted a scheduling delay after the query settles, so equality
    // would leave the "no live flight can predate the floor" claim resting
    // on a zero-latency event loop.
    expect(WOC_AUTH_GUARD_RECENT_BUST_MIN_AGE_MS).toBeGreaterThanOrEqual(
      DB_QUERY_TIMEOUT_MS + DB_POOL_CONNECT_TIMEOUT_MS + 5_000,
    );
    expect(WOC_AUTH_GUARD_RECENT_BUST_RETENTION_MS).toBeGreaterThan(
      WOC_AUTH_GUARD_RECENT_BUST_MIN_AGE_MS,
    );
    expect(WOC_AUTH_GUARD_RECENT_BUSTS_MAX).toBe(512);
    const src = (await import('node:fs')).readFileSync(
      new URL('../../server/woc_auth_guard_cache.ts', import.meta.url),
      'utf8',
    );
    // The staleness prose must state the SAME bound the constant encodes,
    // ANCHORED to the TTL constant's own docblock (the comment block that
    // ends at the constant declaration), not anywhere in the file.
    const ttlDecl = src.indexOf('export const WOC_AUTH_GUARD_CACHE_TTL_MS');
    expect(ttlDecl).toBeGreaterThan(0);
    const ttlDoc = src.slice(src.lastIndexOf('/**', ttlDecl), ttlDecl);
    expect(ttlDoc).toContain(`${WOC_AUTH_GUARD_CACHE_TTL_MS / 1000} seconds`);
  });

  it('routes the free bust functions through the configured singleton and no-ops after reset', async () => {
    expect(wocAuthGuardDb()).toBeNull();
    expect(wocAuthGuardCacheStats()).toBeNull();
    // No-ops before wiring: never a throw.
    bustWocAuthGuardToken('t1');
    bustWocAuthGuardAccount(7);
    const tokens = new Map<string, AuthTokenRow>([['t1', liveToken(7)]]);
    const cache = configureWocAuthGuardCache(
      {
        fetchTokenRow: async (t) => tokens.get(t) ?? null,
        fetchModerationRow: async () => cleanRow(),
      },
      { now: () => NOW },
    );
    expect(wocAuthGuardDb()).toBe(cache);
    await cache.accountAndScopeForToken('t1');
    tokens.delete('t1');
    bustWocAuthGuardToken('t1');
    // The token arm's bust counter moved (the free function reached the
    // singleton), and the fresh probe then answers null.
    expect(wocAuthGuardCacheStats()?.tokens.busts).toBe(1);
    await expect(cache.accountAndScopeForToken('t1')).resolves.toBeNull();
    await cache.moderationStatusForAccount(7);
    bustWocAuthGuardAccount(7);
    expect(wocAuthGuardCacheStats()?.accounts.busts).toBe(1);
    // The soft-bounded internals are numbers on the stats payload (the
    // production observability for bounds that are soft BY DESIGN).
    expect(wocAuthGuardCacheStats()?.recentBusts).toBe(1);
    expect(wocAuthGuardCacheStats()?.index).toBe(0);
    // The free flush lever (no production caller yet: main.ts flushes
    // through its own instance handle) drains both arms through the
    // singleton so the export cannot rot unrun.
    await cache.moderationStatusForAccount(7);
    bustWocAuthGuardAll();
    expect(wocAuthGuardCacheStats()?.tokens.entries).toBe(0);
    expect(wocAuthGuardCacheStats()?.accounts.entries).toBe(0);
    // The flush accumulated into the bust counters (one flushed account
    // entry on top of the earlier keyed bust) and drained the ledger.
    expect(wocAuthGuardCacheStats()?.accounts.busts).toBe(2);
    expect(wocAuthGuardCacheStats()?.recentBusts).toBe(0);
    resetWocAuthGuardCache();
    expect(wocAuthGuardDb()).toBeNull();
    // Busts against the cleared singleton are no-ops, not throws.
    bustWocAuthGuardToken('t1');
    bustWocAuthGuardAccount(7);
  });
});
