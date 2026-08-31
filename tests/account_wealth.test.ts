// The account-wealth sweep logic (server/account_wealth.ts): the pure escrow
// fold over the mail/market blobs, the refresh orchestration, the self-clocked
// sweep loop, and the top-holders cached read. No pool: the db half is typed
// through the deps bag and faked here.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ACCOUNT_WEALTH_REFRESH_MS,
  configureTopWealthHolders,
  escrowTotalsFromStateRows,
  formatAccountWealthSweepLine,
  parseEscrowStateKey,
  readLargeMovementsPane,
  readTopWealthHolders,
  redactActiveFlagCounts,
  refreshAccountWealth,
  resetTopWealthHoldersForTests,
  startAccountWealthSweep,
} from '../server/account_wealth';
import type { TopWealthHolderRow } from '../server/account_wealth_db';
import { mailPartitionMarkerKey, mailRecipientKey } from '../server/mail_partition_backfill';

afterEach(() => {
  resetTopWealthHoldersForTests();
  vi.useRealTimers();
});

describe('parseEscrowStateKey', () => {
  it('parses realm-scoped mail and market keys and rejects everything else', () => {
    expect(parseEscrowStateKey('mail:eastbrook')).toEqual({
      kind: 'mail',
      realm: 'eastbrook',
      format: 'legacy',
    });
    expect(parseEscrowStateKey(mailRecipientKey('eastbrook', '12'))).toEqual({
      kind: 'mail',
      realm: 'eastbrook',
      format: 'partition',
    });
    expect(parseEscrowStateKey(mailPartitionMarkerKey('eastbrook'))).toEqual({
      kind: 'mailPartitionMarker',
      realm: 'eastbrook',
    });
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

  it('ignores a retained legacy mail blob once that realm has partition rows', () => {
    const totals = escrowTotalsFromStateRows([
      {
        key: 'mail:eastbrook',
        data: { mail: [{ recipientKey: '12', copper: 500 }] },
      },
      {
        key: mailRecipientKey('eastbrook', '12'),
        data: { mail: [{ recipientKey: '12', copper: 500 }] },
      },
      {
        key: 'mail:westvale',
        data: { mail: [{ recipientKey: '12', copper: 700 }] },
      },
    ]);
    expect(totals).toEqual([
      { characterId: 12, characterName: null, realm: null, mailCopper: 1_200, marketCopper: 0 },
    ]);
  });

  it('ignores a retained legacy mail blob once that realm has only the marker', () => {
    const totals = escrowTotalsFromStateRows([
      {
        key: 'mail:eastbrook',
        data: { mail: [{ recipientKey: '12', copper: 500 }] },
      },
      {
        key: mailPartitionMarkerKey('eastbrook'),
        data: { legacyRowFound: true, recipientCount: 1, letterCount: 1 },
      },
    ]);
    expect(totals).toEqual([]);
  });
});

describe('refreshAccountWealth', () => {
  it('runs the SQL purse pass, then feeds the SQL-aggregated totals to the apply call', async () => {
    const calls: string[] = [];
    const deps = {
      refreshAccountPurseTotals: vi.fn(async () => {
        calls.push('purses');
        return { rowsChanged: 7, orphansZeroed: 2 };
      }),
      aggregateEscrowTotals: vi.fn(async () => {
        calls.push('aggregate');
        return [
          { characterId: 12, characterName: null, realm: null, mailCopper: 750, marketCopper: 0 },
        ];
      }),
      applyEscrowTotals: vi.fn(async () => {
        calls.push('apply');
        return 3;
      }),
    };
    // The summary carries every db count plus the aggregated entry count, so
    // the sweep's log line can name what the pass touched.
    await expect(refreshAccountWealth(deps)).resolves.toEqual({
      purseRowsChanged: 7,
      orphanPursesZeroed: 2,
      escrowEntries: 1,
      staleEscrowZeroed: 3,
    });
    expect(calls).toEqual(['purses', 'aggregate', 'apply']);
    expect(deps.applyEscrowTotals).toHaveBeenCalledWith([
      { characterId: 12, characterName: null, realm: null, mailCopper: 750, marketCopper: 0 },
    ]);
  });
});

describe('formatAccountWealthSweepLine', () => {
  it('names every count and the duration, zeros included', () => {
    expect(
      formatAccountWealthSweepLine(
        { purseRowsChanged: 7, orphanPursesZeroed: 2, escrowEntries: 1, staleEscrowZeroed: 3 },
        42,
      ),
    ).toBe(
      'account wealth sweep: 7 purse rows changed, 2 orphan purses zeroed, 1 escrow entries applied, 3 stale escrow rows zeroed in 42 ms',
    );
    expect(
      formatAccountWealthSweepLine(
        { purseRowsChanged: 0, orphanPursesZeroed: 0, escrowEntries: 0, staleEscrowZeroed: 0 },
        0,
      ),
    ).toBe(
      'account wealth sweep: 0 purse rows changed, 0 orphan purses zeroed, 0 escrow entries applied, 0 stale escrow rows zeroed in 0 ms',
    );
  });
});

describe('startAccountWealthSweep', () => {
  it('refreshes every interval under the lock, logs failures, and stops cleanly', async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const onInfo = vi.fn();
    const deps = {
      refreshAccountPurseTotals: vi
        .fn(async () => ({ rowsChanged: 5, orphansZeroed: 1 }))
        .mockRejectedValueOnce(new Error('transient')),
      aggregateEscrowTotals: vi.fn(async () => [
        { characterId: 12, characterName: null, realm: null, mailCopper: 750, marketCopper: 0 },
      ]),
      applyEscrowTotals: vi.fn(async () => 2),
      withSweepLock: vi.fn(async (run: () => Promise<void>) => {
        // Fake timers own Date.now, so the pass's measured duration is what
        // elapses here and nothing else.
        vi.advanceTimersByTime(30);
        await run();
        return true;
      }),
    };
    const sweep = startAccountWealthSweep(deps, { onError, onInfo });
    await vi.advanceTimersByTimeAsync(ACCOUNT_WEALTH_REFRESH_MS);
    expect(deps.withSweepLock).toHaveBeenCalledTimes(1);
    expect(deps.refreshAccountPurseTotals).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    // A failed pass reports through onError only: no success line to mistake
    // for a healthy sweep. It still carries how long the pass ran before
    // failing (the 30 ms the fake lock advanced), so a timeout and a fast
    // refusal are told apart in the log.
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 30);
    expect(onInfo).not.toHaveBeenCalled();

    // The failure did not kill the loop: the next tick refreshes fully and
    // emits the one per-pass line with its counts and duration.
    await vi.advanceTimersByTimeAsync(ACCOUNT_WEALTH_REFRESH_MS);
    expect(deps.refreshAccountPurseTotals).toHaveBeenCalledTimes(2);
    expect(deps.applyEscrowTotals).toHaveBeenCalledTimes(1);
    expect(onInfo).toHaveBeenCalledTimes(1);
    expect(onInfo).toHaveBeenCalledWith(
      'account wealth sweep: 5 purse rows changed, 1 orphan purses zeroed, 1 escrow entries applied, 2 stale escrow rows zeroed in 30 ms',
    );

    sweep.stop();
    await vi.advanceTimersByTimeAsync(ACCOUNT_WEALTH_REFRESH_MS * 3);
    expect(deps.refreshAccountPurseTotals).toHaveBeenCalledTimes(2);
  });

  it('stands down for the tick when a peer process holds the sweep lock', async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const onInfo = vi.fn();
    const deps = {
      refreshAccountPurseTotals: vi.fn(async () => ({ rowsChanged: 0, orphansZeroed: 0 })),
      aggregateEscrowTotals: vi.fn(async () => []),
      applyEscrowTotals: vi.fn(async () => 0),
      // A losing try-lock never runs the pass and is not an error.
      withSweepLock: vi.fn(async () => false),
    };
    const sweep = startAccountWealthSweep(deps, { onError, onInfo });
    await vi.advanceTimersByTimeAsync(ACCOUNT_WEALTH_REFRESH_MS * 2);
    expect(deps.withSweepLock).toHaveBeenCalledTimes(2);
    expect(deps.refreshAccountPurseTotals).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    // A stand-down is silent by design: at a 60 s cadence every losing realm
    // process would otherwise log once a minute forever.
    expect(onInfo).not.toHaveBeenCalled();
    sweep.stop();
  });

  it('defaults a failed pass to console.error with its elapsed time', async () => {
    vi.useFakeTimers();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const deps = {
      refreshAccountPurseTotals: vi.fn(async () => {
        throw new Error('statement timeout');
      }),
      aggregateEscrowTotals: vi.fn(async () => []),
      applyEscrowTotals: vi.fn(async () => 0),
      withSweepLock: vi.fn(async (run: () => Promise<void>) => {
        vi.advanceTimersByTime(2_000);
        await run();
        return true;
      }),
    };
    const sweep = startAccountWealthSweep(deps);
    try {
      await vi.advanceTimersByTimeAsync(ACCOUNT_WEALTH_REFRESH_MS);
      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(consoleError.mock.calls[0][0]).toBe('account wealth sweep failed after 2000 ms:');
      expect(consoleError.mock.calls[0][1]).toBeInstanceOf(Error);
    } finally {
      sweep.stop();
      consoleError.mockRestore();
    }
  });

  it('defaults the per-pass line to console.log', async () => {
    vi.useFakeTimers();
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    const deps = {
      refreshAccountPurseTotals: vi.fn(async () => ({ rowsChanged: 0, orphansZeroed: 0 })),
      aggregateEscrowTotals: vi.fn(async () => []),
      applyEscrowTotals: vi.fn(async () => 0),
      withSweepLock: vi.fn(async (run: () => Promise<void>) => {
        await run();
        return true;
      }),
    };
    const sweep = startAccountWealthSweep(deps);
    try {
      await vi.advanceTimersByTimeAsync(ACCOUNT_WEALTH_REFRESH_MS);
      expect(consoleLog).toHaveBeenCalledTimes(1);
      expect(consoleLog.mock.calls[0][0]).toMatch(
        /^account wealth sweep: 0 purse rows changed, .* in \d+ ms$/,
      );
    } finally {
      sweep.stop();
      consoleLog.mockRestore();
    }
  });
});

describe('readLargeMovementsPane', () => {
  it('passes a successful read through without the unavailable marker', async () => {
    const rows = [{ id: 1, op: 'withdraw_gold', copperDelta: -200_000 }];
    const pane = await readLargeMovementsPane(42, async () => rows as never);
    expect(pane).toEqual({ largeMovements: rows });
    expect('largeMovementsUnavailable' in pane).toBe(false);
  });

  it('degrades a failed read to an empty list with the marker, logged once', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const pane = await readLargeMovementsPane(42, async () => {
        throw new Error('canceling statement due to statement timeout');
      });
      expect(pane).toEqual({ largeMovements: [], largeMovementsUnavailable: true });
      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(consoleError.mock.calls[0][0]).toBe(
        'admin account wealth: large gold movements read failed for account 42:',
      );
      expect(consoleError.mock.calls[0][1]).toBeInstanceOf(Error);
    } finally {
      consoleError.mockRestore();
    }
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
