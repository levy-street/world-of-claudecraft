// The relic-find observer (server/account_ledger_records.ts): a fire-and-forget
// FIFO mirror of the sim's relicRecorded events into account_relic_finds, the
// exact sibling of server/deeds_records.ts. Pins the write shape, the FIFO
// survival of a rejected insert, the login reconcile riding the same tail,
// and the public-sheet cache bust that lets the /c/ page see a new find on
// its next read instead of waiting out the TTL.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/account_ledger_db', () => ({
  insertAccountRelicFinds: vi.fn(async () => {}),
  loadAccountLedgerKeys: vi.fn(async () => ({ deeds: new Set(), relics: new Set() })),
}));

import { insertAccountRelicFinds } from '../../server/account_ledger_db';
import {
  accountLedgerKeysFor,
  setAccountLedgerKeysReaderForTests,
} from '../../server/account_ledger_keys_cache';
import {
  reconcileAccountRelics,
  recordRelicFinds,
  relicRecordsIdle,
} from '../../server/account_ledger_records';
import { REALM } from '../../server/realm';

const insertMock = vi.mocked(insertAccountRelicFinds);
const WHO = { characterId: 42, accountId: 7, name: 'Hilda', cls: 'warrior' as const };

async function settle(): Promise<void> {
  await relicRecordsIdle();
  await new Promise((resolve) => setImmediate(resolve));
}

/** Warm the cached public-sheet ledger view for one account; the returned
 *  counter climbs only when a later read had to refresh (the entry was busted). */
async function warmLedgerKeys(accountId: number): Promise<() => number> {
  let reads = 0;
  setAccountLedgerKeysReaderForTests(async () => {
    reads++;
    return { deeds: new Set<string>(), relics: new Set<string>() };
  });
  await accountLedgerKeysFor(accountId);
  expect(reads).toBe(1);
  return () => reads;
}

beforeEach(async () => {
  await relicRecordsIdle();
  insertMock.mockClear();
  insertMock.mockImplementation(async () => {});
});

afterEach(async () => {
  await settle();
  setAccountLedgerKeysReaderForTests(null);
  vi.restoreAllMocks();
});

describe('recordRelicFinds', () => {
  it('mirrors a batch in ONE insert with the realm and the finder snapshot, in event order', async () => {
    recordRelicFinds(WHO, ['item:cryptbone_helm', 'mark:gather_event:pristine_vein']);
    await settle();
    expect(insertMock).toHaveBeenCalledTimes(1);
    const [who, keys, opts] = insertMock.mock.calls[0];
    expect(who).toEqual({ realm: REALM, ...WHO });
    expect([...keys]).toEqual(['item:cryptbone_helm', 'mark:gather_event:pristine_vein']);
    // Live finds are dated: the row default stamps the find moment.
    expect(opts).toBeUndefined();
  });

  it('an empty slice never touches the tail', async () => {
    recordRelicFinds(WHO, []);
    await settle();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("busts the account's cached public-sheet ledger keys once the insert lands", async () => {
    const reads = await warmLedgerKeys(7);
    recordRelicFinds(WHO, ['item:cryptbone_helm']);
    await settle();
    await accountLedgerKeysFor(7);
    expect(reads()).toBe(2);
  });

  it('a rejected insert logs, keeps the entry warm, never breaks the tail, and the reconcile replays the keys', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reads = await warmLedgerKeys(7);
    insertMock.mockRejectedValueOnce(new Error('db down'));
    expect(() => recordRelicFinds(WHO, ['item:cryptbone_helm'])).not.toThrow();
    await settle();
    expect(errorSpy).toHaveBeenCalledWith('account_relic_finds write failed:', expect.any(Error));
    // No row landed, so nothing to show: the cached view is not busted.
    await accountLedgerKeysFor(7);
    expect(reads()).toBe(1);
    // The FIFO tail survived: the login reconcile heals by replaying the keys.
    reconcileAccountRelics(WHO, ['item:cryptbone_helm']);
    await settle();
    expect(insertMock).toHaveBeenCalledTimes(2);
    expect([...insertMock.mock.calls[1][1]]).toEqual(['item:cryptbone_helm']);
    // The reconcile's rows are UNDATED: the blob keeps no per-relic day and
    // the replay moment is not the find, so a veteran's historic finds never
    // show the first post-rollout login as their date.
    expect(insertMock.mock.calls[1][2]).toEqual({ undated: true });
    await accountLedgerKeysFor(7);
    expect(reads()).toBe(2);
  });
});
