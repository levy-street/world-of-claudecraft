import { describe, expect, it, vi } from 'vitest';
import {
  BankLedgerOutboxBudget,
  type BankLedgerOutboxRowInput,
  serializeBankLedgerCommandBatch,
} from '../../server/bank_ledger_outbox';
import {
  acknowledgeCharacterSaveEffects,
  BANK_LEDGER_SAVE_HIGH_WATER_BYTES,
  BANK_LEDGER_SAVE_HIGH_WATER_ROWS,
  bankLedgerJournalNeedsSave,
  bankLedgerSaveEffects,
  createBankLedgerSessionJournal,
} from '../../server/bank_ledger_session';
import { REALM } from '../../server/realm';
import type { StorageAppliedEffect } from '../../server/storage_purchase_db';

const OWNER = Object.freeze({ realm: REALM, characterId: 7, accountId: 11 });

function storageEffect(key: string): StorageAppliedEffect {
  return {
    realm: OWNER.realm,
    characterId: OWNER.characterId,
    accountId: OWNER.accountId,
    itemId: 'strongbox_charter_lesser',
    expectedCostClaudium: 500,
    idempotencyKey: key,
    spendClaimToken: `claim:${key}`,
    purchasedSlotsBefore: 24,
    purchasedSlotsAfter: 36,
  };
}

function journal(
  hooks: Parameters<typeof createBankLedgerSessionJournal>[1] = {
    onProjectionFailure: vi.fn(),
  },
) {
  return createBankLedgerSessionJournal(OWNER, hooks, {
    budget: new BankLedgerOutboxBudget({ maxRows: 4_096, maxEncodedBytes: 4 * 1024 * 1024 }),
    limits: { maxRows: 2_048, maxEncodedBytes: 2 * 1024 * 1024 },
  });
}

describe('bank ledger session journal', () => {
  it('stages a craft consumption only when the guarded mutation commits', () => {
    const j = journal();
    const cancelled = j.reserveVaultConsumption([{ itemId: 'copper_ore', count: 2 }], 3);
    expect(cancelled).not.toBeNull();
    cancelled?.cancel();
    expect(j.outbox.snapshot().rowCount).toBe(0);

    const committed = j.reserveVaultConsumption([{ itemId: 'fine_copper_ore', count: 1 }], 3);
    committed?.commit();
    const snapshot = j.outbox.snapshot();
    expect(snapshot.rowCount).toBe(1);
    // Full-row toEqual, deliberately: the old writer suite pinned the whole
    // craft_consume row shape (realm, null instanceJson, zero copperDelta, null
    // containerId included), and a partial match would let one of those
    // invariant fields drift unpinned.
    expect(snapshot.batches[0]?.rows[0]).toEqual({
      realm: OWNER.realm,
      characterId: OWNER.characterId,
      accountId: OWNER.accountId,
      op: 'craft_consume',
      itemId: 'fine_copper_ore',
      count: 1,
      instanceJson: null,
      copperDelta: 0,
      counterpartyCount: null,
      counterpartyCopperDelta: null,
      purchasedSlotsAfter: 3,
      container: 'vault',
      containerId: null,
    });
  });

  it('keeps a high-water scheduling failure outside the projection quarantine', () => {
    const projectionFailure = vi.fn();
    const reservationFailure = vi.fn();
    const j = journal({
      onProjectionFailure: projectionFailure,
      onReservationFailure: reservationFailure,
      onHighWater: () => {
        throw new Error('scheduler unavailable');
      },
    });
    const takes = Array.from({ length: BANK_LEDGER_SAVE_HIGH_WATER_ROWS }, (_, index) => ({
      itemId: `material_${index}`,
      count: 1,
    }));
    expect(() => j.reserveVaultConsumption(takes, 2)?.commit()).not.toThrow();
    expect(j.outbox.snapshot().rowCount).toBe(BANK_LEDGER_SAVE_HIGH_WATER_ROWS);
    expect(projectionFailure).not.toHaveBeenCalled();
    expect(reservationFailure).toHaveBeenCalledOnce();
  });

  it('turns a non-empty exact snapshot into DB effects and elides an empty one', () => {
    const j = journal();
    expect(bankLedgerSaveEffects(j.outbox.snapshot())).toBeUndefined();
    const batch = serializeBankLedgerCommandBatch('ledger:test', [
      {
        realm: OWNER.realm,
        characterId: OWNER.characterId,
        accountId: OWNER.accountId,
        op: 'deposit',
        itemId: 'copper_ore',
        count: 1,
        instance: null,
        copperDelta: 0,
        purchasedSlotsAfter: 0,
        container: 'vault',
        containerId: null,
      },
    ]);
    const reservation = j.outbox.tryReservePrepared(batch);
    expect(reservation).not.toBeNull();
    if (reservation) j.outbox.commitPrepared(reservation);
    const snapshot = j.outbox.snapshot();
    expect(bankLedgerSaveEffects(snapshot)).toEqual({
      owner: snapshot.owner,
      batches: snapshot.batches,
    });
  });

  it('acknowledges storage and ledger together while retaining later appends', () => {
    const j = journal();
    const first = j.reserveVaultConsumption([{ itemId: 'copper_ore', count: 1 }], 2);
    first?.commit();
    const ledgerSnapshot = j.outbox.snapshot();
    const pendingStorageEffects = [storageEffect('one')];
    const storageSnapshot = pendingStorageEffects.map((effect) => ({ ...effect }));
    const later = j.reserveVaultConsumption([{ itemId: 'iron_ore', count: 2 }], 2);
    later?.commit();
    const committed = vi.fn();

    expect(
      acknowledgeCharacterSaveEffects({
        pendingStorageEffects,
        storageSnapshot,
        ledgerOutbox: j.outbox,
        ledgerSnapshot,
        onStorageCommitted: committed,
      }),
    ).toBe(true);
    expect(pendingStorageEffects).toEqual([]);
    expect(j.outbox.snapshot().rowCount).toBe(1);
    expect(committed).toHaveBeenCalledWith(OWNER.characterId, storageSnapshot);
  });

  it('retains both queues when either exact-prefix preflight fails', () => {
    const j = journal();
    j.reserveVaultConsumption([{ itemId: 'copper_ore', count: 1 }], 1)?.commit();
    const ledgerSnapshot = j.outbox.snapshot();
    const pendingStorageEffects = [storageEffect('live')];
    const mismatched = [storageEffect('other')];
    const committed = vi.fn();

    expect(
      acknowledgeCharacterSaveEffects({
        pendingStorageEffects,
        storageSnapshot: mismatched,
        ledgerOutbox: j.outbox,
        ledgerSnapshot,
        onStorageCommitted: committed,
      }),
    ).toBe(false);
    expect(pendingStorageEffects).toHaveLength(1);
    expect(j.outbox.snapshot().rowCount).toBe(1);
    expect(committed).not.toHaveBeenCalled();
  });

  it('uses the documented row and byte high-water thresholds', () => {
    const rowJournal = createBankLedgerSessionJournal(
      OWNER,
      { onProjectionFailure: vi.fn() },
      {
        budget: new BankLedgerOutboxBudget({
          maxRows: BANK_LEDGER_SAVE_HIGH_WATER_ROWS,
          maxEncodedBytes: 4 * 1024 * 1024,
        }),
        limits: {
          maxRows: BANK_LEDGER_SAVE_HIGH_WATER_ROWS,
          maxEncodedBytes: 4 * 1024 * 1024,
        },
      },
    );
    const rows: BankLedgerOutboxRowInput[] = Array.from(
      { length: BANK_LEDGER_SAVE_HIGH_WATER_ROWS },
      (_, index) => ({
        realm: OWNER.realm,
        characterId: OWNER.characterId,
        accountId: OWNER.accountId,
        op: 'deposit',
        itemId: `material_${index}`,
        count: 1,
        instance: null,
        copperDelta: 0,
        purchasedSlotsAfter: 0,
        container: 'vault',
        containerId: null,
      }),
    );
    const batch = serializeBankLedgerCommandBatch('ledger:high-water', rows);
    const reservation = rowJournal.outbox.tryReservePrepared(batch);
    expect(reservation).not.toBeNull();
    if (reservation) rowJournal.outbox.commitPrepared(reservation);
    expect(bankLedgerJournalNeedsSave(rowJournal.outbox)).toBe(true);
    expect(BANK_LEDGER_SAVE_HIGH_WATER_BYTES).toBe(1_048_576);
  });
});
