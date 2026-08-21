// The account-wealth sweep logic (server/account_wealth.ts): the pure escrow
// fold over the mail/market blobs, the refresh orchestration, the self-clocked
// sweep loop, and the top-holders cached read. No pool: the db half is typed
// through the deps bag and faked here.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ACCOUNT_WEALTH_REFRESH_MS,
  configureTopWealthHolders,
  escrowTotalsFromStateRows,
  parseEscrowStateKey,
  readTopWealthHolders,
  redactActiveFlagCounts,
  refreshAccountWealth,
  resetTopWealthHoldersForTests,
  startAccountWealthSweep,
} from '../server/account_wealth';
import type { TopWealthHolderRow } from '../server/account_wealth_db';

afterEach(() => {
  resetTopWealthHoldersForTests();
  vi.useRealTimers();
});

describe('parseEscrowStateKey', () => {
  it('parses realm-scoped mail and market keys and rejects everything else', () => {
    expect(parseEscrowStateKey('mail:eastbrook')).toEqual({ kind: 'mail', realm: 'eastbrook' });
    expect(parseEscrowStateKey('market:eastbrook')).toEqual({
      kind: 'market',
      realm: 'eastbrook',
    });
    // The retained pre-scoping rollback artifact and unrelated keys never parse.
    expect(parseEscrowStateKey('market')).toBeNull();
    expect(parseEscrowStateKey('rift:eastbrook')).toBeNull();
    expect(parseEscrowStateKey('retention_sweep:last_run')).toBeNull();
  });
});

describe('escrowTotalsFromStateRows', () => {
  it('folds mail attachments and market collections per character id', () => {
    const totals = escrowTotalsFromStateRows([
      {
        key: 'mail:eastbrook',
        data: {
          mail: [
            { recipientKey: '12', copper: 500 },
            { recipientKey: '12', copper: 250 },
            { recipientKey: '30', copper: 0 }, // no coin: skipped
          ],
        },
      },
      {
        key: 'market:eastbrook',
        data: {
          collections: [
            { key: '12', copper: 1_000 },
            { key: '', copper: 9_999 }, // house stock: skipped
          ],
        },
      },
    ]);
    expect(totals).toEqual([
      {
        characterId: 12,
        characterName: null,
        realm: null,
        mailCopper: 750,
        marketCopper: 1_000,
      },
    ]);
  });

  it('keeps legacy name-keyed entries realm-scoped and skips invalid copper', () => {
    const totals = escrowTotalsFromStateRows([
      {
        key: 'market:eastbrook',
        data: { collections: [{ key: 'Oldname', copper: 300 }] },
      },
      {
        key: 'market:westvale',
        data: { collections: [{ key: 'Oldname', copper: 200 }] },
      },
      {
        key: 'mail:eastbrook',
        data: {
          mail: [
            { recipientKey: '5', copper: Number.NaN },
            { recipientKey: '5', copper: -20 },
            { recipientKey: '5', copper: 'lots' },
          ],
        },
      },
    ]);
    // Same legacy name on two realms stays two entries (names are only unique
    // per realm); the invalid copper letters contribute nothing.
    expect(totals).toEqual([
      {
        characterId: null,
        characterName: 'Oldname',
        realm: 'eastbrook',
        mailCopper: 0,
        marketCopper: 300,
      },
      {
        characterId: null,
        characterName: 'Oldname',
        realm: 'westvale',
        mailCopper: 0,
        marketCopper: 200,
      },
    ]);
  });

  it('tolerates malformed blobs without throwing', () => {
    expect(
      escrowTotalsFromStateRows([
        { key: 'mail:eastbrook', data: null },
        { key: 'market:eastbrook', data: 'oops' },
        { key: 'mail:westvale', data: { mail: 'not an array' } },
        { key: 'market:westvale', data: { collections: [null, { key: 7, copper: 5 }] } },
      ]),
    ).toEqual([]);
  });
});

describe('refreshAccountWealth', () => {
  it('runs the SQL purse pass, then folds the escrow blobs into the apply call', async () => {
    const calls: string[] = [];
    const deps = {
      refreshAccountPurseTotals: vi.fn(async () => {
        calls.push('purses');
      }),
      listEscrowStateRows: vi.fn(async () => {
        calls.push('list');
        return [{ key: 'mail:eastbrook', data: { mail: [{ recipientKey: '12', copper: 750 }] } }];
      }),
      applyEscrowTotals: vi.fn(async () => {
        calls.push('apply');
      }),
    };
    await refreshAccountWealth(deps);
    expect(calls).toEqual(['purses', 'list', 'apply']);
    expect(deps.applyEscrowTotals).toHaveBeenCalledWith([
      { characterId: 12, characterName: null, realm: null, mailCopper: 750, marketCopper: 0 },
    ]);
  });
});

describe('startAccountWealthSweep', () => {
  it('refreshes every interval under the lock, logs failures, and stops cleanly', async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const deps = {
      refreshAccountPurseTotals: vi
        .fn(async () => {})
        .mockRejectedValueOnce(new Error('transient')),
      listEscrowStateRows: vi.fn(async () => []),
      applyEscrowTotals: vi.fn(async () => {}),
      withSweepLock: vi.fn(async (run: () => Promise<void>) => {
        await run();
        return true;
      }),
    };
    const sweep = startAccountWealthSweep(deps, { onError });
    await vi.advanceTimersByTimeAsync(ACCOUNT_WEALTH_REFRESH_MS);
    expect(deps.withSweepLock).toHaveBeenCalledTimes(1);
    expect(deps.refreshAccountPurseTotals).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);

    // The failure did not kill the loop: the next tick refreshes fully.
    await vi.advanceTimersByTimeAsync(ACCOUNT_WEALTH_REFRESH_MS);
    expect(deps.refreshAccountPurseTotals).toHaveBeenCalledTimes(2);
    expect(deps.applyEscrowTotals).toHaveBeenCalledTimes(1);

    sweep.stop();
    await vi.advanceTimersByTimeAsync(ACCOUNT_WEALTH_REFRESH_MS * 3);
    expect(deps.refreshAccountPurseTotals).toHaveBeenCalledTimes(2);
  });

  it('stands down for the tick when a peer process holds the sweep lock', async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const deps = {
      refreshAccountPurseTotals: vi.fn(async () => {}),
      listEscrowStateRows: vi.fn(async () => []),
      applyEscrowTotals: vi.fn(async () => {}),
      // A losing try-lock never runs the pass and is not an error.
      withSweepLock: vi.fn(async () => false),
    };
    const sweep = startAccountWealthSweep(deps, { onError });
    await vi.advanceTimersByTimeAsync(ACCOUNT_WEALTH_REFRESH_MS * 2);
    expect(deps.withSweepLock).toHaveBeenCalledTimes(2);
    expect(deps.refreshAccountPurseTotals).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    sweep.stop();
  });
});

describe('readTopWealthHolders', () => {
  it('refuses unconfigured, then serves through one single-flight cached read', async () => {
    expect(() => readTopWealthHolders()).toThrow(/not configured/);
    const rows: TopWealthHolderRow[] = [];
    const source = vi.fn(async () => rows);
    configureTopWealthHolders(source);
    await expect(readTopWealthHolders()).resolves.toBe(rows);
    await readTopWealthHolders();
    expect(source).toHaveBeenCalledTimes(1);
  });
});

describe('redactActiveFlagCounts', () => {
  it('drops the flag count and nothing else (the accounts-list moderation rule)', () => {
    const row: TopWealthHolderRow = {
      accountId: 7,
      username: 'midas',
      purseCopper: 1,
      mailCopper: 2,
      marketCopper: 3,
      totalCopper: 6,
      maxLevel: 60,
      lastLogin: null,
      bannedAt: null,
      suspendedUntil: null,
      activeFlagCount: 4,
      updatedAt: '2026-08-19T06:20:00Z',
    };
    const [redacted] = redactActiveFlagCounts([row]);
    expect('activeFlagCount' in redacted).toBe(false);
    const { activeFlagCount: _dropped, ...rest } = row;
    expect(redacted).toEqual(rest);
  });
});
