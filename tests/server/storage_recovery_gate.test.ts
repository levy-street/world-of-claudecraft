import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBackgroundDbGate } from '../../server/background_db_gate';
import { AMBIGUITY_HOLD_MAX_MS, WEDGED_HOLD_MAX_MS } from '../../server/storage_ladder_hold';
import type { StoragePurchaseRow } from '../../server/storage_purchase_db';
import {
  configureStoragePurchaseRuntime,
  executeStoragePurchase,
  kickStoragePurchaseRecovery,
  resetStoragePurchasesForTests,
  type StoragePurchaseHost,
  stopStoragePurchaseRecovery,
  storagePurchaseInFlight,
  storagePurchaseRecoveryMetrics,
} from '../../server/storage_purchases';

function row(characterId: number): StoragePurchaseRow {
  return {
    id: characterId,
    realm: 'testrealm',
    accountId: characterId,
    characterId,
    itemId: 'strongbox_rung_01',
    expectedCostClaudium: 100,
    idempotencyKey: `recovery-${characterId}`,
    status: 'pending',
  };
}

function host(over: Partial<StoragePurchaseHost> = {}): StoragePurchaseHost {
  return {
    resolveLiveCharacter: (accountId) => ({ characterId: accountId, pid: 1 }),
    grant: () => ({ status: 'fits' }),
    stageAppliedEffect: () => true,
    saveCharacter: async () => true,
    spend: async () => ({
      result: {
        granted: false,
        balance: 0,
        costClaudium: 100,
        reason: 'insufficient_balance',
      },
      neverReached: false,
    }),
    db: {
      begin: async () => ({ inserted: true, existing: null }),
      byKey: async () => null,
      claimSpend: async () => true,
      renewSpendClaim: async () => true,
      releaseSpendClaim: async () => true,
      settle: async () => true,
      discardWithoutDebit: async () => true,
      pendingFor: async () => null,
      openFor: async () => null,
    },
    realm: 'testrealm',
    warn: vi.fn(),
    ...over,
  };
}

async function waitFor(cond: () => boolean): Promise<void> {
  await vi.waitFor(() => {
    if (!cond()) throw new Error('not yet');
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(resetStoragePurchasesForTests);
afterEach(resetStoragePurchasesForTests);

describe('bounded storage recovery integration', () => {
  it('arms the gold hold synchronously and coalesces duplicate login kicks', async () => {
    const firstScan = deferred<StoragePurchaseRow | null>();
    const openFor = vi
      .fn<StoragePurchaseHost['db']['openFor']>()
      .mockImplementationOnce(() => firstScan.promise)
      .mockResolvedValue(null);
    const runtime = host({ db: { ...host().db, openFor } });
    configureStoragePurchaseRuntime(() => runtime);

    kickStoragePurchaseRecovery(42);
    kickStoragePurchaseRecovery(42);
    kickStoragePurchaseRecovery(42);
    expect(storagePurchaseInFlight(42)).toBe(true);
    expect(openFor).toHaveBeenCalledTimes(1);
    expect(storagePurchaseRecoveryMetrics()).toMatchObject({
      tracked: 1,
      coalescedKicks: 2,
      scanActive: 1,
    });

    firstScan.resolve(null);
    await waitFor(() => !storagePurchaseInFlight(42));
    // All duplicates collapse into one newer read, rather than one read per
    // kick, because the first scan's snapshot could predate their open row.
    expect(openFor).toHaveBeenCalledTimes(2);
    expect(storagePurchaseRecoveryMetrics().tracked).toBe(0);
  });

  it('reserves the exact pending key before spend and releases after confirmed delete', async () => {
    let heldDuringSpend = false;
    const runtime = host({
      spend: async (input) => {
        heldDuringSpend = storagePurchaseInFlight(input.accountId);
        return {
          result: {
            granted: false,
            balance: 0,
            costClaudium: 100,
            reason: 'insufficient_balance',
          },
          neverReached: false,
        };
      },
      db: {
        ...host().db,
        openFor: vi
          .fn<StoragePurchaseHost['db']['openFor']>()
          .mockResolvedValueOnce(row(51))
          .mockResolvedValueOnce(null),
      },
    });
    configureStoragePurchaseRuntime(() => runtime);
    kickStoragePurchaseRecovery(51);
    await waitFor(() => storagePurchaseRecoveryMetrics().tracked === 0);
    expect(heldDuringSpend).toBe(true);
    expect(storagePurchaseInFlight(51)).toBe(false);
    expect(runtime.db.discardWithoutDebit).toBeDefined();
  });

  it('keeps a scanned tail row gold-closed past the ambiguity horizon while drive slots are busy', async () => {
    type SpendOutcome = Awaited<ReturnType<StoragePurchaseHost['spend']>>;
    const spendGates = new Map<number, ReturnType<typeof deferred<SpendOutcome>>>();
    const spendStarted: number[] = [];
    const scans = new Map<number, number>();
    const runtime = host({
      spend: (input) => {
        spendStarted.push(input.accountId);
        const gate = deferred<SpendOutcome>();
        spendGates.set(input.accountId, gate);
        return gate.promise;
      },
      db: {
        ...host().db,
        openFor: async (characterId) => {
          const count = (scans.get(characterId) ?? 0) + 1;
          scans.set(characterId, count);
          return count === 1 ? row(characterId) : null;
        },
      },
    });
    configureStoragePurchaseRuntime(() => runtime);
    const clock = vi.spyOn(Date, 'now');
    const armedAt = 3_000_000;
    clock.mockReturnValue(armedAt);
    try {
      for (const characterId of [71, 72, 73]) kickStoragePurchaseRecovery(characterId);
      await waitFor(() => {
        const metrics = storagePurchaseRecoveryMetrics();
        return metrics.driveActive === 2 && metrics.driveQueued === 1;
      });
      const queuedCharacter = [71, 72, 73].find((id) => !spendStarted.includes(id));
      expect(queuedCharacter).toBeDefined();

      // A scan has proved this exact row open. Neither the 5s operational slot
      // target nor the 10m alert horizon is evidence that its older attempt did
      // not debit, so queue age must never open the conflicting gold rung.
      clock.mockReturnValue(armedAt + AMBIGUITY_HOLD_MAX_MS * 2);
      expect(storagePurchaseInFlight(queuedCharacter!)).toBe(true);

      const refused: SpendOutcome = {
        result: {
          granted: false,
          balance: 0,
          costClaudium: 100,
          reason: 'insufficient_balance',
        },
        neverReached: false,
      };
      spendGates.get(spendStarted[0]!)?.resolve(refused);
      await waitFor(() => spendStarted.includes(queuedCharacter!));
      // Admission restarts the active-operation clock without a one-turn gap.
      expect(storagePurchaseInFlight(queuedCharacter!)).toBe(true);

      for (const gate of spendGates.values()) gate.resolve(refused);
      await waitFor(() => storagePurchaseRecoveryMetrics().tracked === 0);
      expect(storagePurchaseInFlight(queuedCharacter!)).toBe(false);
    } finally {
      for (const gate of spendGates.values()) {
        gate.resolve({
          result: {
            granted: false,
            balance: 0,
            costClaudium: 100,
            reason: 'insufficient_balance',
          },
          neverReached: false,
        });
      }
      clock.mockRestore();
    }
  });

  it('aborts an active applied save and releases its shared background permit on stop', async () => {
    let saveSignal: AbortSignal | undefined;
    const permitRelease = vi.fn();
    const acquireBackgroundPermit = vi.fn(async () => ({ release: permitRelease }));
    const runtime = host({
      acquireBackgroundPermit,
      grant: (_pid, _sku, _key, dryRun) =>
        dryRun
          ? { status: 'fits' }
          : { status: 'applied', purchasedSlotsBefore: 0, purchasedSlotsAfter: 6 },
      saveCharacter: (_characterId, _shouldStart, signal) => {
        saveSignal = signal;
        return new Promise<boolean>((resolve) => {
          signal?.addEventListener('abort', () => resolve(false), { once: true });
        });
      },
      spend: async () => ({
        result: { granted: true, balance: 900, costClaudium: 100, reason: null },
        neverReached: false,
      }),
      db: {
        ...host().db,
        openFor: vi
          .fn<StoragePurchaseHost['db']['openFor']>()
          .mockResolvedValueOnce(row(74))
          .mockResolvedValue(null),
      },
    });
    configureStoragePurchaseRuntime(() => runtime);
    kickStoragePurchaseRecovery(74);
    await waitFor(() => saveSignal !== undefined);
    expect(saveSignal?.aborted).toBe(false);
    expect(permitRelease).toHaveBeenCalledTimes(3); // scan, claim, renewal; none spans save

    await stopStoragePurchaseRecovery();
    expect(saveSignal?.aborted).toBe(true);
    expect(acquireBackgroundPermit).toHaveBeenCalledTimes(3);
    expect(permitRelease).toHaveBeenCalledTimes(3);
    expect(storagePurchaseRecoveryMetrics().tracked).toBe(0);
  });

  it('releases each DB permit before an economy RPC or character-FIFO save wait', async () => {
    const gate = createBackgroundDbGate(1, 0);
    const permitDepths: number[] = [];
    const runtime = host({
      acquireBackgroundPermit: (signal) => gate.acquire(signal),
      grant: (_pid, _sku, _key, dryRun) =>
        dryRun
          ? { status: 'fits' }
          : { status: 'applied', purchasedSlotsBefore: 0, purchasedSlotsAfter: 6 },
      spend: async () => {
        permitDepths.push(gate.stats().inFlight);
        return {
          result: { granted: true, balance: 900, costClaudium: 100, reason: null },
          neverReached: false,
        };
      },
      saveCharacter: async () => {
        // The production host joins the character FIFO here and takes its own
        // permit only once that thunk runs. The coordinator must arrive with
        // no scan/claim/renew permit still held.
        permitDepths.push(gate.stats().inFlight);
        return true;
      },
      db: {
        ...host().db,
        openFor: vi
          .fn<StoragePurchaseHost['db']['openFor']>()
          .mockResolvedValueOnce(row(75))
          .mockResolvedValue(null),
      },
    });
    configureStoragePurchaseRuntime(() => runtime);

    kickStoragePurchaseRecovery(75);
    await waitFor(() => storagePurchaseRecoveryMetrics().tracked === 0);

    expect(permitDepths).toEqual([0, 0]);
    expect(gate.stats()).toMatchObject({
      inFlight: 0,
      waiting: 0,
      acquired: 4, // scan, claim, post-RPC renewal, final settlement
    });
  });

  it('never spends a new key while another key is open for the character', async () => {
    const blocking = row(53);
    const spend = vi.fn<StoragePurchaseHost['spend']>();
    const runtime = host({
      spend,
      db: {
        ...host().db,
        begin: async () => ({
          inserted: false,
          existing: null,
          blockedByOpen: blocking,
        }),
      },
    });

    const response = await executeStoragePurchase(runtime, {
      accountId: 53,
      itemId: blocking.itemId,
      expectedCostClaudium: blocking.expectedCostClaudium,
      idempotencyKey: 'different-new-key',
    });

    expect(response.reason).toBe('purchase_in_progress');
    expect(spend).not.toHaveBeenCalled();
    expect(storagePurchaseInFlight(53)).toBe(false);
  });

  it('re-drives a row inserted after an older scan snapshot without leaking its hold', async () => {
    const oldScan = deferred<StoragePurchaseRow | null>();
    const inserted = row(57);
    const openFor = vi
      .fn<StoragePurchaseHost['db']['openFor']>()
      .mockImplementationOnce(() => oldScan.promise)
      .mockResolvedValueOnce(inserted)
      .mockResolvedValueOnce(null);
    const spend = vi
      .fn<StoragePurchaseHost['spend']>()
      .mockResolvedValueOnce({
        result: {
          granted: false,
          balance: null,
          costClaudium: null,
          reason: 'unavailable',
        },
        neverReached: false,
      })
      .mockResolvedValueOnce({
        result: {
          granted: false,
          balance: 0,
          costClaudium: 100,
          reason: 'insufficient_balance',
        },
        neverReached: false,
      });
    const runtime = host({
      spend,
      db: {
        ...host().db,
        begin: async () => ({ inserted: true, existing: inserted }),
        openFor,
      },
    });
    configureStoragePurchaseRuntime(() => runtime);
    const clock = vi.spyOn(Date, 'now');
    try {
      const armedAt = 1_000_000;
      clock.mockReturnValue(armedAt);
      kickStoragePurchaseRecovery(57);

      // A wedged provisional scan yields its hold. The new request then inserts
      // a real pending row after that scan's database snapshot was taken.
      clock.mockReturnValue(armedAt + WEDGED_HOLD_MAX_MS + 1);
      const response = await executeStoragePurchase(runtime, {
        accountId: 57,
        itemId: inserted.itemId,
        expectedCostClaudium: inserted.expectedCostClaudium,
        idempotencyKey: inserted.idempotencyKey,
      });
      expect(response.reason).toBe('unavailable');
      expect(spend).toHaveBeenCalledTimes(1);

      oldScan.resolve(null);
      await waitFor(() => storagePurchaseRecoveryMetrics().tracked === 0);
      expect(openFor).toHaveBeenCalledTimes(3);
      expect(spend).toHaveBeenCalledTimes(2);
      expect(storagePurchaseInFlight(57)).toBe(false);
    } finally {
      clock.mockRestore();
    }
  });

  it('re-drives failed no-debit cleanup inserted after an older scan snapshot', async () => {
    const oldScan = deferred<StoragePurchaseRow | null>();
    const inserted = row(58);
    const openFor = vi
      .fn<StoragePurchaseHost['db']['openFor']>()
      .mockImplementationOnce(() => oldScan.promise)
      .mockResolvedValueOnce(inserted)
      .mockResolvedValueOnce(null);
    const spend = vi.fn<StoragePurchaseHost['spend']>().mockResolvedValue({
      result: {
        granted: false,
        balance: 0,
        costClaudium: 100,
        reason: 'insufficient_balance',
      },
      neverReached: false,
    });
    const discardWithoutDebit = vi
      .fn<StoragePurchaseHost['db']['discardWithoutDebit']>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const runtime = host({
      spend,
      db: {
        ...host().db,
        begin: async () => ({ inserted: true, existing: inserted }),
        discardWithoutDebit,
        openFor,
      },
    });
    configureStoragePurchaseRuntime(() => runtime);
    const clock = vi.spyOn(Date, 'now');
    try {
      const armedAt = 2_000_000;
      clock.mockReturnValue(armedAt);
      kickStoragePurchaseRecovery(58);

      // The request inserts after the active scan took its snapshot. Its first
      // definitive refusal cannot be surfaced because cleanup was unconfirmed,
      // so the finally kick must demand a scan newer than that insertion.
      clock.mockReturnValue(armedAt + WEDGED_HOLD_MAX_MS + 1);
      const response = await executeStoragePurchase(runtime, {
        accountId: 58,
        itemId: inserted.itemId,
        expectedCostClaudium: inserted.expectedCostClaudium,
        idempotencyKey: inserted.idempotencyKey,
      });
      expect(response.reason).toBe('unavailable');
      expect(spend).toHaveBeenCalledTimes(1);
      expect(discardWithoutDebit).toHaveBeenCalledTimes(1);

      oldScan.resolve(null);
      await waitFor(() => storagePurchaseRecoveryMetrics().tracked === 0);
      expect(openFor).toHaveBeenCalledTimes(3);
      expect(spend).toHaveBeenCalledTimes(2);
      expect(discardWithoutDebit).toHaveBeenCalledTimes(2);
      expect(storagePurchaseInFlight(58)).toBe(false);
    } finally {
      clock.mockRestore();
    }
  });

  it('runs only one oldest row per scan and crosses a turn before the sibling scan', async () => {
    const events: string[] = [];
    let crossedTurn = false;
    const firstDelete = deferred<boolean>();
    const openFor = vi
      .fn<StoragePurchaseHost['db']['openFor']>()
      .mockImplementationOnce(async () => {
        events.push('scan:a');
        return row(61);
      })
      .mockImplementationOnce(async () => {
        events.push(`scan:b:${crossedTurn}`);
        return { ...row(61), id: 62, idempotencyKey: 'recovery-61-b' };
      })
      .mockImplementationOnce(async () => {
        events.push('scan:empty');
        return null;
      });
    const runtime = host({
      spend: async (input) => {
        events.push(`spend:${input.idempotencyKey}`);
        return {
          result: {
            granted: false,
            balance: 0,
            costClaudium: 100,
            reason: 'insufficient_balance',
          },
          neverReached: false,
        };
      },
      db: {
        ...host().db,
        openFor,
        discardWithoutDebit: vi
          .fn<StoragePurchaseHost['db']['discardWithoutDebit']>()
          .mockImplementationOnce(() => firstDelete.promise)
          .mockResolvedValue(true),
      },
    });
    configureStoragePurchaseRuntime(() => runtime);
    kickStoragePurchaseRecovery(61);

    await waitFor(() => events.includes('spend:recovery-61'));
    setImmediate(() => {
      crossedTurn = true;
    });
    firstDelete.resolve(true);
    await waitFor(() => storagePurchaseRecoveryMetrics().tracked === 0);
    expect(events).toEqual([
      'scan:a',
      'spend:recovery-61',
      'scan:b:true',
      'spend:recovery-61-b',
      'scan:empty',
    ]);
  });
});
