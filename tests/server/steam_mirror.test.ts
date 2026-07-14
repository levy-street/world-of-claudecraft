// The Steam achievement mirror (server/steam/mirror.ts): observer-only
// no-op guards, the hot-path never-awaits contract, in-flight dedupe, the
// capped retry ladder, the link cache (TTL + synchronous invalidation on
// link change), reconcile-on-link pushing exactly the mapped subset, and the
// push-time link revalidation that makes an unlink a revocation barrier.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_steam_mirror_units';

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACHIEVEMENT_MAP } from '../../server/steam/achievement_map';
import {
  LINK_CACHE_MAX,
  LINK_CACHE_TTL_MS,
  LOGIN_RECONCILE_TTL_MS,
  linkCacheHasForTests,
  linkCacheSizeForTests,
  MAX_PUSH_ATTEMPTS,
  OUTAGE_TRIP_BATCHES,
  onDeedRecorded,
  onLinkChanged,
  PUSH_BACKOFF_BASE_MS,
  RECONCILE_STAMP_SWEEP_SIZE,
  reconcileLink,
  reconcileOnLogin,
  reconcileStampCountForTests,
  reconcileSweepCountForTests,
  reconcileSweepThresholdForTests,
  resetSteamMirrorForTests,
  setSteamMirrorDepsForTests,
  steamMirrorIdle,
  stopSteamMirror,
} from '../../server/steam/mirror';

const ACCOUNT_ID = 7;
const STEAM_ID = '76561198000000001';
const OLD_STEAM_ID = '76561198000000002';

// Real mapped ids straight from the shipped map (the map suite pins the map
// itself; this suite only needs members and a guaranteed non-member).
const mappedEntries = Object.entries(ACHIEVEMENT_MAP);
const [MAPPED_DEED, MAPPED_ACH] = mappedEntries[0];
const [MAPPED_DEED_2, MAPPED_ACH_2] = mappedEntries[1];
const [MAPPED_DEED_3, MAPPED_ACH_3] = mappedEntries[2];
const [MAPPED_DEED_4, MAPPED_ACH_4] = mappedEntries[3];
const UNMAPPED_DEED = 'not_a_real_deed_id';

const savedEnv: Record<string, string | undefined> = {};
const STEAM_ENV_KEYS = ['STEAM_ENABLED', 'STEAM_APP_ID', 'STEAM_WEB_API_KEY'] as const;

function enableSteam(): void {
  process.env.STEAM_ENABLED = '1';
  process.env.STEAM_APP_ID = '480';
  process.env.STEAM_WEB_API_KEY = 'raw-test-publisher-value';
}

let pushMock: ReturnType<typeof vi.fn>;
let linkMock: ReturnType<typeof vi.fn>;
let earnedMock: ReturnType<typeof vi.fn>;
let delayMock: ReturnType<typeof vi.fn>;
let clock: number;

/** Give every queued microtask chain (cache lookup -> enqueue -> drain) room
 *  to settle; the injected delay resolves instantly so this is bounded. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await steamMirrorIdle();
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await steamMirrorIdle();
}

beforeEach(() => {
  for (const key of STEAM_ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  clock = 1_000_000;
  pushMock = vi.fn(async () => true);
  linkMock = vi.fn(async () => ({ steamId: STEAM_ID }));
  earnedMock = vi.fn(async () => [] as string[]);
  delayMock = vi.fn(async () => {});
  setSteamMirrorDepsForTests({
    pushUnlocks: pushMock as never,
    linkForAccount: linkMock as never,
    earnedDeedIds: earnedMock as never,
    delay: delayMock as never,
    now: () => clock,
  });
});

afterEach(() => {
  resetSteamMirrorForTests();
  for (const key of STEAM_ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  vi.restoreAllMocks();
});

describe('observer no-op guards', () => {
  it('does nothing when the flag is off: no link read, no push', async () => {
    onDeedRecorded(ACCOUNT_ID, MAPPED_DEED);
    await settle();
    expect(linkMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('does nothing for an unmapped deed, without even a link read', async () => {
    enableSteam();
    onDeedRecorded(ACCOUNT_ID, UNMAPPED_DEED);
    await settle();
    expect(linkMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('does nothing for an unlinked account', async () => {
    enableSteam();
    linkMock.mockResolvedValue(null);
    onDeedRecorded(ACCOUNT_ID, MAPPED_DEED);
    await settle();
    expect(linkMock).toHaveBeenCalledTimes(1);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('enabled but unprovisioned (no app id or key) drops with one warn and never pushes', async () => {
    // A misconfigured host: STEAM_ENABLED=1 with STEAM_APP_ID/STEAM_WEB_API_KEY
    // unset. The drain must drop the unlock (one fixed warn line, no secrets to
    // leak because there are none) rather than crash or push garbage, and the
    // queue must keep draining afterwards.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.STEAM_ENABLED = '1';
    onDeedRecorded(ACCOUNT_ID, MAPPED_DEED);
    await settle();
    expect(pushMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      'steam mirror: enabled without STEAM_APP_ID/STEAM_WEB_API_KEY, dropping unlock',
    );
    // The drop did not wedge the worker: a later provisioned unlock pushes.
    enableSteam();
    onDeedRecorded(ACCOUNT_ID, MAPPED_DEED_2);
    await settle();
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith(
      expect.objectContaining({ steamId: STEAM_ID, achNames: [MAPPED_ACH_2] }),
    );
  });

  it('swallows a failing link read and does not cache the failure', async () => {
    enableSteam();
    linkMock.mockRejectedValueOnce(new Error('db down'));
    onDeedRecorded(ACCOUNT_ID, MAPPED_DEED);
    await settle();
    expect(pushMock).not.toHaveBeenCalled();
    // The failed lookup was evicted: the next unlock re-reads and delivers
    // (two lookup reads plus the delivered push's revalidation read).
    onDeedRecorded(ACCOUNT_ID, MAPPED_DEED);
    await settle();
    expect(linkMock).toHaveBeenCalledTimes(3);
    expect(pushMock).toHaveBeenCalledTimes(1);
  });
});

describe('the hot path never awaits', () => {
  it('onDeedRecorded returns synchronously (void) and nothing downstream runs until the IO resolves', async () => {
    enableSteam();
    // The link read is held open: if the hot path awaited anything, control
    // would never come back while this promise is pending.
    let release: (row: { steamId: string } | null) => void = () => {};
    linkMock.mockImplementationOnce(
      () => new Promise<{ steamId: string } | null>((resolve) => (release = resolve)),
    );
    const returned = onDeedRecorded(ACCOUNT_ID, MAPPED_DEED);
    // Synchronous contract: undefined return with the lookup still pending,
    // and no push has happened (the game loop moved on already).
    expect(returned).toBeUndefined();
    expect(pushMock).not.toHaveBeenCalled();
    release({ steamId: STEAM_ID });
    await settle();
    expect(pushMock).toHaveBeenCalledTimes(1);
  });

  it('reconcileLink returns synchronously (void) too', () => {
    enableSteam();
    const returned = reconcileLink(ACCOUNT_ID, STEAM_ID);
    expect(returned).toBeUndefined();
    expect(pushMock).not.toHaveBeenCalled();
  });
});

describe('delivery, dedupe, and the retry ladder', () => {
  it('pushes a mapped unlock for a linked account with the provisioned key + app id', async () => {
    enableSteam();
    onDeedRecorded(ACCOUNT_ID, MAPPED_DEED);
    await settle();
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith({
      key: 'raw-test-publisher-value',
      appId: 480,
      steamId: STEAM_ID,
      achNames: [MAPPED_ACH],
    });
  });

  it('dedupes an in-flight (account, steamId, achievement) triple to one push', async () => {
    enableSteam();
    let release: (ok: boolean) => void = () => {};
    pushMock.mockImplementationOnce(() => new Promise<boolean>((resolve) => (release = resolve)));
    onDeedRecorded(ACCOUNT_ID, MAPPED_DEED);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    // Duplicate delivery while the first is in flight (retro re-emit shape).
    onDeedRecorded(ACCOUNT_ID, MAPPED_DEED);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    release(true);
    await settle();
    expect(pushMock).toHaveBeenCalledTimes(1);
  });

  it('retries with capped exponential backoff then drops with one warn line', async () => {
    enableSteam();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    pushMock.mockResolvedValue(false);
    onDeedRecorded(ACCOUNT_ID, MAPPED_DEED);
    await settle();
    expect(pushMock).toHaveBeenCalledTimes(MAX_PUSH_ATTEMPTS);
    // The ladder shape below is a self-comparison against the constant, so pin
    // the base magnitude to a literal: changing 1000 to 1 or 600000 (a broken
    // backoff) would otherwise keep the ladder assertion green.
    expect(PUSH_BACKOFF_BASE_MS).toBe(1000);
    expect(delayMock.mock.calls.map((c) => c[0])).toEqual([
      PUSH_BACKOFF_BASE_MS,
      PUSH_BACKOFF_BASE_MS * 2,
      PUSH_BACKOFF_BASE_MS * 4,
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    // The batched drop line reports the count and the attempt cap, not secrets.
    expect(line).toBe(`steam mirror: dropping 1 unlock(s) after ${MAX_PUSH_ATTEMPTS} attempts`);
    // The drop line never leaks the key or an upstream URL/body.
    expect(line).not.toContain('raw-test-publisher-value');
    expect(line).not.toContain('http');
  });

  it('a mid-ladder success stops the retries and drops nothing', async () => {
    enableSteam();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    pushMock.mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValue(true);
    onDeedRecorded(ACCOUNT_ID, MAPPED_DEED);
    await settle();
    expect(pushMock).toHaveBeenCalledTimes(3);
    expect(warn).not.toHaveBeenCalled();
  });

  it('a failed pair may redeliver later (dedupe clears after the attempt settles)', async () => {
    enableSteam();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    pushMock.mockResolvedValue(false);
    onDeedRecorded(ACCOUNT_ID, MAPPED_DEED);
    await settle();
    pushMock.mockResolvedValue(true);
    onDeedRecorded(ACCOUNT_ID, MAPPED_DEED);
    await settle();
    expect(pushMock).toHaveBeenCalledTimes(MAX_PUSH_ATTEMPTS + 1);
  });
});

describe('the link cache', () => {
  it('a same-tick burst for one account does one lookup read and one batched push', async () => {
    enableSteam();
    onDeedRecorded(ACCOUNT_ID, MAPPED_DEED);
    onDeedRecorded(ACCOUNT_ID, MAPPED_DEED_2);
    await settle();
    // One cached lookup read for the whole burst, plus one batch revalidation
    // read for the single delivered batch: two reads, not three.
    expect(linkMock).toHaveBeenCalledTimes(2);
    // Both unlocks coalesce into ONE SetUserStatsForGame call carrying both names.
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith(
      expect.objectContaining({ steamId: STEAM_ID, achNames: [MAPPED_ACH, MAPPED_ACH_2] }),
    );
  });

  it('re-reads after the TTL expires', async () => {
    enableSteam();
    onDeedRecorded(ACCOUNT_ID, MAPPED_DEED);
    await settle();
    clock += LINK_CACHE_TTL_MS + 1;
    onDeedRecorded(ACCOUNT_ID, MAPPED_DEED_2);
    await settle();
    // Two lookup reads (the TTL expired between the unlocks) plus one
    // revalidation read per delivered push.
    expect(linkMock).toHaveBeenCalledTimes(4);
  });

  it('is bounded: caching past the max evicts the oldest by insertion order, keeping the newest', async () => {
    enableSteam();
    // Pin the cap magnitude as a literal (the eviction counts below are all
    // derived from it, so a drifted constant must not read as green).
    expect(LINK_CACHE_MAX).toBe(8192);
    // onLinkChanged writes the cache directly, so drive it well past the cap.
    const overflow = 200;
    for (let acct = 1; acct <= LINK_CACHE_MAX + overflow; acct++) {
      onLinkChanged(acct, `steam-${acct}`);
    }
    // The map never grows past the hard cap: the oldest entries were evicted as
    // new ones landed.
    expect(linkCacheSizeForTests()).toBe(LINK_CACHE_MAX);
    // The most recently linked account is still cached; the oldest (account 1)
    // and everything up to the overflow were evicted in insertion order.
    const newest = LINK_CACHE_MAX + overflow;
    expect(linkCacheHasForTests(newest)).toBe(true);
    expect(linkCacheHasForTests(1)).toBe(false);
    expect(linkCacheHasForTests(overflow)).toBe(false);
    // The first surviving account is exactly overflow + 1 (the oldest not evicted).
    expect(linkCacheHasForTests(overflow + 1)).toBe(true);
  });
});

describe('reconcile-on-link', () => {
  it('pushes exactly the earned-and-mapped intersection to the new steam id', async () => {
    enableSteam();
    earnedMock.mockResolvedValue([MAPPED_DEED, UNMAPPED_DEED, MAPPED_DEED_2]);
    reconcileLink(ACCOUNT_ID, STEAM_ID);
    await settle();
    expect(earnedMock).toHaveBeenCalledWith(ACCOUNT_ID);
    // The whole earned-and-mapped set ships as ONE batched call (the unmapped
    // deed is filtered out), preserving earned order in the names array.
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith(
      expect.objectContaining({ steamId: STEAM_ID, achNames: [MAPPED_ACH, MAPPED_ACH_2] }),
    );
  });

  it('is inert while the flag is off (a stray call cannot leak)', async () => {
    reconcileLink(ACCOUNT_ID, STEAM_ID);
    await settle();
    expect(earnedMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('after unlink + relink, unlocks flow to the NEW id and never the old one', async () => {
    enableSteam();
    // Seed the cache with the OLD link (an unlock while it was live).
    linkMock.mockResolvedValue({ steamId: OLD_STEAM_ID });
    onDeedRecorded(ACCOUNT_ID, MAPPED_DEED);
    await settle();
    expect(pushMock).toHaveBeenLastCalledWith(expect.objectContaining({ steamId: OLD_STEAM_ID }));

    // Unlink: the route deletes the row, then calls onLinkChanged(account,
    // null) in-request, so the stale cached id is dead immediately, not a
    // TTL later.
    linkMock.mockResolvedValue(null);
    onLinkChanged(ACCOUNT_ID, null);
    onDeedRecorded(ACCOUNT_ID, MAPPED_DEED_2);
    await settle();
    expect(pushMock).toHaveBeenCalledTimes(1);

    // Relink to the NEW id (the route inserts the row before reconciling):
    // reconcile re-pushes history there, and fresh unlocks follow, all
    // without ever touching the old id again. This also pins that the
    // push-time revalidation compares Steam ids rather than mere row
    // existence: queued pushes for the NEW id must keep flowing.
    linkMock.mockResolvedValue({ steamId: STEAM_ID });
    earnedMock.mockResolvedValue([MAPPED_DEED]);
    reconcileLink(ACCOUNT_ID, STEAM_ID);
    await settle();
    onDeedRecorded(ACCOUNT_ID, MAPPED_DEED_2);
    await settle();
    const pushedAfterRelink = pushMock.mock.calls.slice(1).map((c) => c[0].steamId);
    expect(pushedAfterRelink).toEqual([STEAM_ID, STEAM_ID]);
  });
});

describe('unlink is a revocation barrier', () => {
  it('drops a reconcile push when the account unlinks while the earned read is in flight', async () => {
    enableSteam();
    let releaseEarned: (deedIds: string[]) => void = () => {};
    earnedMock.mockImplementationOnce(
      () => new Promise<string[]>((resolve) => (releaseEarned = resolve)),
    );
    reconcileLink(ACCOUNT_ID, STEAM_ID);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    // The unlink lands while the earned read is pending: row deleted, cache
    // flipped, but the reconcile closure already captured the steam id.
    linkMock.mockResolvedValue(null);
    onLinkChanged(ACCOUNT_ID, null);
    releaseEarned([MAPPED_DEED]);
    await settle();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('drops an unlock when the account unlinks while the link lookup is in flight', async () => {
    enableSteam();
    let releaseLookup: (row: { steamId: string } | null) => void = () => {};
    linkMock.mockImplementationOnce(
      () => new Promise<{ steamId: string } | null>((resolve) => (releaseLookup = resolve)),
    );
    onDeedRecorded(ACCOUNT_ID, MAPPED_DEED);
    // The unlink lands mid-lookup; every later read sees no row, but the
    // pending lookup promise still resolves to the old link.
    linkMock.mockResolvedValue(null);
    onLinkChanged(ACCOUNT_ID, null);
    releaseLookup({ steamId: OLD_STEAM_ID });
    await settle();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('a warm cache from before a peer-process unlink cannot push past the DB row', async () => {
    enableSteam();
    onDeedRecorded(ACCOUNT_ID, MAPPED_DEED);
    await settle();
    expect(pushMock).toHaveBeenCalledTimes(1);
    // The unlink lands on ANOTHER realm process: the DB row is gone, but
    // onLinkChanged never fires here, so this process's cache entry stays
    // positive for the TTL tail.
    linkMock.mockResolvedValue(null);
    onDeedRecorded(ACCOUNT_ID, MAPPED_DEED_2);
    await settle();
    expect(pushMock).toHaveBeenCalledTimes(1);
  });

  it("a reconcile for the NEW account is not swallowed by the OLD account's in-flight push", async () => {
    enableSteam();
    const ACCOUNT_B = ACCOUNT_ID + 1;
    // Hold account A's push open so its pending entry is still live when the
    // Steam account moves: the dedupe key must not collide across accounts,
    // or B's reconcile item is silently discarded and nothing ever heals it
    // (reconcile runs only at link time).
    let releasePush: (ok: boolean) => void = () => {};
    pushMock.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => (releasePush = resolve)),
    );
    onDeedRecorded(ACCOUNT_ID, MAPPED_DEED);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(pushMock).toHaveBeenCalledTimes(1);
    // The Steam account moves from A to B: A's row is gone, B's row names S.
    linkMock.mockImplementation(async (accountId: number) =>
      accountId === ACCOUNT_B ? { steamId: STEAM_ID } : null,
    );
    earnedMock.mockResolvedValue([MAPPED_DEED]);
    reconcileLink(ACCOUNT_B, STEAM_ID);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    releasePush(true);
    await settle();
    expect(pushMock).toHaveBeenCalledTimes(2);
    expect(pushMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ steamId: STEAM_ID, achNames: [MAPPED_ACH] }),
    );
  });

  it('a warm cache from before a peer-process RELINK cannot push to the old id', async () => {
    enableSteam();
    // Seed this process's cache with the OLD link.
    linkMock.mockResolvedValue({ steamId: OLD_STEAM_ID });
    onDeedRecorded(ACCOUNT_ID, MAPPED_DEED);
    await settle();
    expect(pushMock).toHaveBeenLastCalledWith(expect.objectContaining({ steamId: OLD_STEAM_ID }));
    // The relink lands on ANOTHER realm process: the DB row now names a
    // DIFFERENT steam id, while this process's warm cache still answers the
    // old one. The push-time revalidation must compare ids, not row
    // existence, so the stale-id push is dropped.
    linkMock.mockResolvedValue({ steamId: STEAM_ID });
    onDeedRecorded(ACCOUNT_ID, MAPPED_DEED_2);
    await settle();
    const pushedIds = pushMock.mock.calls.map((c) => c[0].steamId);
    expect(pushedIds).toEqual([OLD_STEAM_ID]);
  });
});

describe('push-time revalidation read resilience', () => {
  it('retries a rejected revalidation read once and still delivers the push', async () => {
    enableSteam();
    linkMock
      .mockResolvedValueOnce({ steamId: STEAM_ID }) // the lookup-path (cache) read
      .mockRejectedValueOnce(new Error('transient blip')) // revalidation, first try
      .mockResolvedValueOnce({ steamId: STEAM_ID }); // revalidation retry
    onDeedRecorded(ACCOUNT_ID, MAPPED_DEED);
    await settle();
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith(expect.objectContaining({ achNames: [MAPPED_ACH] }));
    expect(linkMock).toHaveBeenCalledTimes(3);
  });

  it('a push attempt that THROWS drops that batch with one warn and never wedges the drain', async () => {
    // pushUnlocks' contract is resolve-boolean, but the drain must survive a
    // contract breach: without the backstop the rejection becomes an unhandled
    // rejection (process-fatal under Node defaults) and every queued batch
    // behind it stalls until some future enqueue restarts the worker. Enqueue
    // the two unlocks in SEPARATE ticks so they form two batches, not one: the
    // first batch's push throws and drops, the second still delivers.
    enableSteam();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    pushMock.mockRejectedValueOnce(new Error('contract breach'));
    onDeedRecorded(ACCOUNT_ID, MAPPED_DEED);
    await settle();
    onDeedRecorded(ACCOUNT_ID, MAPPED_DEED_2);
    await settle();
    // The first batch dropped with the backstop line; the second still delivered.
    expect(pushMock).toHaveBeenCalledTimes(2);
    expect(pushMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ achNames: [MAPPED_ACH_2] }),
    );
    const backstopLines = warn.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes('push attempt threw unexpectedly'));
    expect(backstopLines).toEqual([
      'steam mirror: dropping 1 unlock(s), push attempt threw unexpectedly',
    ]);
  });

  it('drops with one warn line, never silently, when the revalidation read fails twice', async () => {
    enableSteam();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    linkMock
      .mockResolvedValueOnce({ steamId: STEAM_ID })
      .mockRejectedValueOnce(new Error('down'))
      .mockRejectedValueOnce(new Error('still down'));
    onDeedRecorded(ACCOUNT_ID, MAPPED_DEED);
    await settle();
    expect(pushMock).not.toHaveBeenCalled();
    const dropLines = warn.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes('link revalidation read failed twice'));
    expect(dropLines).toHaveLength(1);
    // One fixed line, no URL, no body, no key (the module's log contract).
    expect(dropLines[0]).toBe(
      'steam mirror: dropping 1 unlock(s), link revalidation read failed twice',
    );
  });
});

describe('per-attempt revalidation is a mid-ladder revocation barrier', () => {
  it('an unlink BETWEEN retry attempts stops the ladder: no push to the revoked id', async () => {
    enableSteam();
    linkMock.mockResolvedValue({ steamId: STEAM_ID });
    // Attempt 1 pushes (fails); the unlink lands before attempt 2 can
    // revalidate. A once-before-the-loop read would have kept pushing to the
    // dead id for all MAX_PUSH_ATTEMPTS attempts.
    pushMock.mockImplementationOnce(async () => {
      linkMock.mockResolvedValue(null);
      return false;
    });
    onDeedRecorded(ACCOUNT_ID, MAPPED_DEED);
    await settle();
    // Exactly one push: attempt 2's fresh revalidation saw the revoked link and
    // dropped the item before pushing again.
    expect(pushMock).toHaveBeenCalledTimes(1);
  });

  it('a RELINK to a new id between attempts drops the in-flight item, never pushing the old item to the new id', async () => {
    enableSteam();
    linkMock.mockResolvedValue({ steamId: OLD_STEAM_ID });
    // Attempt 1 targets the old id (fails); a relink to a NEW id lands before
    // attempt 2 revalidates.
    pushMock.mockImplementationOnce(async () => {
      linkMock.mockResolvedValue({ steamId: STEAM_ID });
      return false;
    });
    onDeedRecorded(ACCOUNT_ID, MAPPED_DEED);
    await settle();
    expect(pushMock).toHaveBeenCalledTimes(1);
    // The single push named the OLD id; nothing was ever pushed to the new id
    // under this (old-id) item.
    expect(pushMock).toHaveBeenCalledWith(expect.objectContaining({ steamId: OLD_STEAM_ID }));
    const pushedIds = pushMock.mock.calls.map((c) => c[0].steamId);
    expect(pushedIds).not.toContain(STEAM_ID);
  });
});

describe('reconcile-on-login: the durable heal for a dropped push', () => {
  it('re-pushes an unlock that the retry ladder dropped (character_deeds is the outbox)', async () => {
    enableSteam();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // A live unlock whose push exhausts the ladder and drops: the in-memory
    // queue holds nothing afterward and grantDeed never re-emits it.
    pushMock.mockResolvedValue(false);
    onDeedRecorded(ACCOUNT_ID, MAPPED_DEED);
    await settle();
    expect(pushMock).toHaveBeenCalledTimes(MAX_PUSH_ATTEMPTS);
    expect(warn).toHaveBeenCalledTimes(1);
    // The next login reconciles from the durable earned set with delivery now
    // healthy: the dropped unlock is re-pushed to the linked Steam id.
    pushMock.mockClear();
    pushMock.mockResolvedValue(true);
    earnedMock.mockResolvedValue([MAPPED_DEED]);
    reconcileOnLogin(ACCOUNT_ID);
    await settle();
    expect(earnedMock).toHaveBeenCalledWith(ACCOUNT_ID);
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith(
      expect.objectContaining({ steamId: STEAM_ID, achNames: [MAPPED_ACH] }),
    );
  });

  it('throttles repeated logins: two calls inside the TTL do exactly one earned read', async () => {
    // Pin the magnitude too: the clock stepping below uses the constant, so
    // without this literal the test would accept any TTL value.
    expect(LOGIN_RECONCILE_TTL_MS).toBe(6 * 60 * 60 * 1000);
    enableSteam();
    earnedMock.mockResolvedValue([MAPPED_DEED]);
    reconcileOnLogin(ACCOUNT_ID);
    await settle();
    reconcileOnLogin(ACCOUNT_ID);
    await settle();
    expect(earnedMock).toHaveBeenCalledTimes(1);
    // Past the TTL the same account reconciles again.
    clock += LOGIN_RECONCILE_TTL_MS + 1;
    reconcileOnLogin(ACCOUNT_ID);
    await settle();
    expect(earnedMock).toHaveBeenCalledTimes(2);
  });

  it('is inert while the flag is off (no read, no push)', async () => {
    reconcileOnLogin(ACCOUNT_ID);
    await settle();
    expect(linkMock).not.toHaveBeenCalled();
    expect(earnedMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('does nothing for an unlinked account: resolves the link, reads no earned set, pushes nothing', async () => {
    enableSteam();
    linkMock.mockResolvedValue(null);
    reconcileOnLogin(ACCOUNT_ID);
    await settle();
    expect(earnedMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('a transient earned-read failure clears the stamp so the next login retries (not throttled 6h)', async () => {
    enableSteam();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // The link resolves, but the earned read rejects once: the stamp taken
    // before the read must be cleared so a retry at the same instant re-reads.
    earnedMock.mockRejectedValueOnce(new Error('transient blip'));
    reconcileOnLogin(ACCOUNT_ID);
    await settle();
    expect(earnedMock).toHaveBeenCalledTimes(1);
    // A second login at the SAME fake now: the failure did not burn the throttle.
    earnedMock.mockResolvedValue([MAPPED_DEED]);
    reconcileOnLogin(ACCOUNT_ID);
    await settle();
    expect(earnedMock).toHaveBeenCalledTimes(2);
    expect(pushMock).toHaveBeenCalledTimes(1);
  });

  it('a transient link-read failure clears the stamp so the next login retries', async () => {
    enableSteam();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // The link read itself rejects: reconcile reads the link DIRECTLY (not via
    // the error-swallowing cache), so the rejection reaches the catch and clears
    // the stamp rather than looking like a genuine unlink that keeps it.
    linkMock.mockRejectedValueOnce(new Error('db down'));
    reconcileOnLogin(ACCOUNT_ID);
    await settle();
    expect(earnedMock).not.toHaveBeenCalled();
    // Retry at the same fake now re-reads and, now healthy, enqueues.
    linkMock.mockResolvedValue({ steamId: STEAM_ID });
    earnedMock.mockResolvedValue([MAPPED_DEED]);
    reconcileOnLogin(ACCOUNT_ID);
    await settle();
    expect(earnedMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledTimes(1);
  });

  it('a RESOLVED unlinked account keeps its stamp: a second login inside the TTL does not re-read', async () => {
    enableSteam();
    // steamId resolves null (a genuine unlink, not a read failure): the stamp is
    // deliberately kept so a relink-then-reconnect burst cannot hammer the reads.
    linkMock.mockResolvedValue(null);
    reconcileOnLogin(ACCOUNT_ID);
    await settle();
    expect(linkMock).toHaveBeenCalledTimes(1);
    reconcileOnLogin(ACCOUNT_ID);
    await settle();
    expect(linkMock).toHaveBeenCalledTimes(1);
  });

  it('does not re-run the full sweep per insert while nothing has expired', async () => {
    enableSteam();
    // Pin the base sweep bound as a literal (the fill counts and thresholds
    // below are derived from it, so a drifted constant must not read as green).
    expect(RECONCILE_STAMP_SWEEP_SIZE).toBe(8192);
    linkMock.mockResolvedValue(null);
    // Unlinked accounts still take a stamp (by design), which fills the map
    // cheaply. Filling to the base bound crosses no sweep yet (the trigger is
    // the NEXT insert once size >= threshold).
    for (let acct = 1; acct <= RECONCILE_STAMP_SWEEP_SIZE; acct++) reconcileOnLogin(acct);
    await settle();
    expect(reconcileStampCountForTests()).toBe(RECONCILE_STAMP_SWEEP_SIZE);
    expect(reconcileSweepCountForTests()).toBe(0);
    // The first insert at the bound sweeps once (frees nothing, all live) and
    // then backs the threshold off to twice the live size.
    reconcileOnLogin(RECONCILE_STAMP_SWEEP_SIZE + 1);
    await settle();
    expect(reconcileSweepCountForTests()).toBe(1);
    expect(reconcileSweepThresholdForTests()).toBe(RECONCILE_STAMP_SWEEP_SIZE * 2);
    // Subsequent inserts stay below the raised threshold: no more O(n) sweeps.
    reconcileOnLogin(RECONCILE_STAMP_SWEEP_SIZE + 2);
    reconcileOnLogin(RECONCILE_STAMP_SWEEP_SIZE + 3);
    await settle();
    expect(reconcileSweepCountForTests()).toBe(1);
  });

  it('past the TTL a sweep reclaims the expired stamps and resets the threshold to the base bound', async () => {
    enableSteam();
    linkMock.mockResolvedValue(null);
    for (let acct = 1; acct <= RECONCILE_STAMP_SWEEP_SIZE; acct++) reconcileOnLogin(acct);
    await settle();
    expect(reconcileStampCountForTests()).toBe(RECONCILE_STAMP_SWEEP_SIZE);
    // Advance past the TTL so every stamp is now dead weight, then the next
    // insert crosses the base threshold and sweeps them all in one pass.
    clock += LOGIN_RECONCILE_TTL_MS + 1;
    reconcileOnLogin(RECONCILE_STAMP_SWEEP_SIZE + 1);
    await settle();
    // Only the new stamp survives, and the drop below the base bound restores
    // the base sweep cadence.
    expect(reconcileStampCountForTests()).toBe(1);
    expect(reconcileSweepCountForTests()).toBe(1);
    expect(reconcileSweepThresholdForTests()).toBe(RECONCILE_STAMP_SWEEP_SIZE);
  });
});

describe('batching, the outage trip-wire, and bounded shutdown', () => {
  it("batches an account's whole reconcile set into ONE push carrying every mapped name", async () => {
    enableSteam();
    linkMock.mockResolvedValue({ steamId: STEAM_ID });
    earnedMock.mockResolvedValue([MAPPED_DEED, MAPPED_DEED_2, MAPPED_DEED_3]);
    reconcileOnLogin(ACCOUNT_ID);
    await settle();
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith(
      expect.objectContaining({
        steamId: STEAM_ID,
        achNames: [MAPPED_ACH, MAPPED_ACH_2, MAPPED_ACH_3],
      }),
    );
  });

  it('groups by account: interleaved reconciles for two accounts yield one batch each, never merged', async () => {
    enableSteam();
    const ACCOUNT_B = ACCOUNT_ID + 1;
    linkMock.mockImplementation(async (acct: number) =>
      acct === ACCOUNT_B ? { steamId: OLD_STEAM_ID } : { steamId: STEAM_ID },
    );
    earnedMock.mockImplementation(async (acct: number) =>
      acct === ACCOUNT_B ? [MAPPED_DEED_2] : [MAPPED_DEED, MAPPED_DEED_3],
    );
    reconcileOnLogin(ACCOUNT_ID);
    reconcileOnLogin(ACCOUNT_B);
    await settle();
    expect(pushMock).toHaveBeenCalledTimes(2);
    const calls = pushMock.mock.calls.map((c) => c[0]);
    expect(calls).toContainEqual(
      expect.objectContaining({ steamId: STEAM_ID, achNames: [MAPPED_ACH, MAPPED_ACH_3] }),
    );
    expect(calls).toContainEqual(
      expect.objectContaining({ steamId: OLD_STEAM_ID, achNames: [MAPPED_ACH_2] }),
    );
  });

  it('head-of-line bound: one exhausted ladder per account, then the trip-wire fast-drops the rest', async () => {
    enableSteam();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Pin the ladder cap and the trip threshold as literals (the counts below
    // are derived from them, so a drifted constant must not read as green).
    expect(MAX_PUSH_ATTEMPTS).toBe(4);
    expect(OUTAGE_TRIP_BATCHES).toBe(2);
    pushMock.mockResolvedValue(false); // Steam is down: every push fails.
    const A = ACCOUNT_ID;
    const B = ACCOUNT_ID + 1;
    const C = ACCOUNT_ID + 2;
    linkMock.mockResolvedValue({ steamId: STEAM_ID });
    earnedMock.mockImplementation(async (acct: number) =>
      acct === A ? [MAPPED_DEED, MAPPED_DEED_2] : acct === B ? [MAPPED_DEED_3] : [MAPPED_DEED_4],
    );
    reconcileOnLogin(A);
    reconcileOnLogin(B);
    reconcileOnLogin(C);
    await settle();
    const names = pushMock.mock.calls.map((c) => c[0].achNames);
    // Account A is ONE exhausted ladder (its batch pushed MAX_PUSH_ATTEMPTS
    // times), then account B is the second exhausted ladder.
    expect(names.slice(0, MAX_PUSH_ATTEMPTS)).toEqual(
      Array(MAX_PUSH_ATTEMPTS).fill([MAPPED_ACH, MAPPED_ACH_2]),
    );
    expect(names.slice(MAX_PUSH_ATTEMPTS, MAX_PUSH_ATTEMPTS * 2)).toEqual(
      Array(MAX_PUSH_ATTEMPTS).fill([MAPPED_ACH_3]),
    );
    expect(pushMock).toHaveBeenCalledTimes(MAX_PUSH_ATTEMPTS * 2);
    // The trip-wire fast-dropped account C entirely: it was never pushed.
    expect(names.flat()).not.toContain(MAPPED_ACH_4);
    const tripLines = warn.mock.calls
      .map((c) => String(c[0]))
      .filter((l) => l.includes('Steam unreachable'));
    expect(tripLines).toHaveLength(1);
  });

  it('drops a whole batch (zero pushes) when the revalidated steam id differs from the queued id', async () => {
    enableSteam();
    // The link now names a DIFFERENT id than the reconcile queued for (a relink
    // landed): the per-attempt revalidation drops the ENTIRE batch, unpushed.
    linkMock.mockResolvedValue({ steamId: OLD_STEAM_ID });
    earnedMock.mockResolvedValue([MAPPED_DEED, MAPPED_DEED_2]);
    reconcileLink(ACCOUNT_ID, STEAM_ID);
    await settle();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('shutdown races the drain against the deadline and reports the residual when the deadline wins', async () => {
    enableSteam();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // A push that never resolves: the drain parks forever on the in-flight batch.
    pushMock.mockImplementation(() => new Promise<boolean>(() => {}));
    // A controllable deadline delay so the test decides when it elapses.
    let fireDeadline: () => void = () => {};
    delayMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          fireDeadline = resolve;
        }),
    );
    linkMock.mockResolvedValue({ steamId: STEAM_ID });
    // Two accounts: one batch parks in flight, one stays queued -> residual > 0.
    onDeedRecorded(ACCOUNT_ID, MAPPED_DEED);
    onDeedRecorded(ACCOUNT_ID + 1, MAPPED_DEED_2);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const stop = stopSteamMirror(5000);
    let resolved = false;
    void stop.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    // Neither the drain (parked) nor the deadline (not fired) has settled.
    expect(resolved).toBe(false);
    fireDeadline();
    await stop;
    const residualLines = warn.mock.calls
      .map((c) => String(c[0]))
      .filter((l) => l.includes('shutdown deadline reached'));
    expect(residualLines).toHaveLength(1);
    expect(residualLines[0]).toMatch(/[1-9]\d* unlock\(s\) undelivered/);
  });

  it('under shutdown a failing push skips the retry ladder and the backoff sleeps', async () => {
    enableSteam();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Park the first push so shutdown begins while it is in flight.
    let releasePush: (ok: boolean) => void = () => {};
    pushMock.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          releasePush = resolve;
        }),
    );
    pushMock.mockResolvedValue(false);
    linkMock.mockResolvedValue({ steamId: STEAM_ID });
    onDeedRecorded(ACCOUNT_ID, MAPPED_DEED);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(pushMock).toHaveBeenCalledTimes(1);
    // Enter shutdown (instant deadline), then fail the in-flight push.
    await stopSteamMirror(0);
    releasePush(false);
    await settle();
    // shuttingDown short-circuited the ladder: no attempt 2, and no backoff sleep
    // (the only delay call is the shutdown deadline itself, never a backoff).
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(delayMock.mock.calls.map((c) => c[0])).not.toContain(PUSH_BACKOFF_BASE_MS);
  });
});

describe('server/main.ts shutdown drains the mirror queue', () => {
  // Source scan (main.ts builds a pg pool at load, so it is never imported):
  // an unlock still queued in the mirror's in-memory FIFO at shutdown would be
  // lost on pool.end(), so the drain must call stopSteamMirror (which flips the
  // shutdown flag and races the drain tail against a deadline) alongside the
  // other FIFO drains, right after the deeds-records drain and before the lease
  // sweep that lets a replacement process reload the same characters.
  const src = readFileSync(new URL('../../server/main.ts', import.meta.url), 'utf8');

  it('awaits stopSteamMirror(5000) after deedRecordsIdle and before the lease sweep', () => {
    // The bounded-deadline shutdown, pinned to the 5s literal: a stuck upstream
    // must never hang the process shutdown.
    expect(src).toContain('await stopSteamMirror(5000);');
    const deedIdle = src.indexOf('await deedRecordsIdle();');
    const stopMirror = src.indexOf('await stopSteamMirror(5000);');
    const leaseSweep = src.indexOf('releaseAllCharacterLeases(');
    expect(deedIdle).toBeGreaterThan(-1);
    expect(stopMirror).toBeGreaterThan(deedIdle);
    expect(leaseSweep).toBeGreaterThan(stopMirror);
  });
});
