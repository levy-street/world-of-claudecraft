import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  insertBankLedgerRow: vi.fn(async () => {}),
  insertBankLedgerRows: vi.fn(async () => {}),
}));
vi.mock('../server/guild_bank_log', () => ({
  bustGuildBankLog: vi.fn(),
  GUILD_BANK_LOG_VISIBLE_OPS: [],
}));
vi.mock('../server/http/game_signals', () => ({
  gameMetricsCounters: () => ({ vaultLedgerIncident: vi.fn() }),
}));
vi.mock('../server/storage_purchases', () => ({
  storagePurchaseInFlight: () => false,
}));
vi.mock('../server/storage_store_cache', () => ({
  nextRungClaudiumPriceFor: () => undefined,
}));

import type {
  BankLedgerAdmission,
  BankLedgerAdmissionHandle,
} from '../server/bank_ledger_admission';
import { type BankSim, dispatchBankCommand } from '../server/bank_wire';
import { dispatchVaultCommand, type VaultSim } from '../server/vault_wire';
import {
  type MaterialSourceTransferSelection,
  materialSourceTransferSelectionMatches,
} from '../src/sim/material_source_transfer_selection';
import type { BankInfo, VaultInfo } from '../src/world_api';

const WHO = Object.freeze({ characterId: 101, accountId: 202 });
const PID = 9;
const ORE = 'copper_ore';
const OTHER_ITEM = 'iron_ore';

function selection(slotIndex = 3, itemId = ORE, count = 2): MaterialSourceTransferSelection {
  return {
    itemId,
    target: {
      slotIndex,
      pin: '0'.repeat(32),
      anchor: { ordinal: 0, count: 1 },
    },
    quantities: [{ sourceIndex: 0, count }],
  };
}

function bankInfo(): BankInfo {
  return {
    slots: [],
    capacity: 24,
    purchasedSlots: 0,
    bonusSlots: 0,
    nextExpansionCost: 500,
    bonusSources: [],
    socketsUnlocked: 0,
    socketBags: [null, null, null, null],
    nextSocketCost: 1_000_000,
    generalCapacity: 24,
    materialsCapacity: 0,
    generalUsed: 0,
    materialsUsed: 0,
  };
}

function vaultInfo(): VaultInfo {
  return {
    stock: {},
    special: [],
    upgrades: 1,
    perMaterialCap: 40,
    nextUpgradeCost: 50_000,
  };
}

function bankSim(): BankSim {
  return {
    ctx: {
      resolve: () => ({ meta: { entityId: 77, bank: { purchasedSlots: 0 } } }),
      error: vi.fn(),
    },
    bankInfoFor: () => bankInfo(),
    bankDeposit: vi.fn(),
    bankWithdraw: vi.fn(),
    bankBuySlots: vi.fn(),
    bankUnlockSocket: vi.fn(),
    bankSocketBag: vi.fn(),
    bankUnsocketBag: vi.fn(),
  };
}

function vaultSim(): VaultSim {
  return {
    ctx: {
      resolve: () => ({ meta: { entityId: 88 } }),
      error: vi.fn(),
    },
    vaultInfoFor: () => vaultInfo(),
    vaultDeposit: vi.fn(),
    vaultWithdraw: vi.fn(),
    vaultDepositAll: vi.fn(),
    vaultBuyUpgrade: vi.fn(),
  };
}

function admissionRig(): {
  admission: BankLedgerAdmission;
  tryReserve: ReturnType<typeof vi.fn>;
  handle: BankLedgerAdmissionHandle;
} {
  const handle: BankLedgerAdmissionHandle = {
    commit: vi.fn(() => true),
    cancel: vi.fn(() => true),
    failAfterMutation: vi.fn(),
  };
  const tryReserve = vi.fn(() => handle);
  return { admission: { tryReserve }, tryReserve, handle };
}

describe('selected personal-bank wire commands validate before ledger admission', () => {
  it.each(['bank_deposit', 'bank_withdraw'] as const)(
    '%s refuses mismatched slot and count envelopes before reserve',
    (command) => {
      for (const message of [
        { slot: 4, count: 2, selection: selection(3) },
        { slot: 3, count: 1, selection: selection(3) },
        { slot: 3, count: '2', selection: selection(3) },
        { slot: 3, count: null, selection: selection(3) },
      ]) {
        const sim = bankSim();
        const rig = admissionRig();

        dispatchBankCommand(sim, WHO, command, message, PID, rig.admission);

        expect(rig.tryReserve, JSON.stringify(message)).not.toHaveBeenCalled();
        expect(
          command === 'bank_deposit' ? sim.bankDeposit : sim.bankWithdraw,
          JSON.stringify(message),
        ).not.toHaveBeenCalled();
      }
    },
  );

  it.each(['bank_deposit', 'bank_withdraw'] as const)(
    '%s treats an own selection property with undefined as malformed',
    (command) => {
      const sim = bankSim();
      const rig = admissionRig();

      dispatchBankCommand(sim, WHO, command, { slot: 3, selection: undefined }, PID, rig.admission);

      expect(rig.tryReserve).not.toHaveBeenCalled();
      expect(
        command === 'bank_deposit' ? sim.bankDeposit : sim.bankWithdraw,
      ).not.toHaveBeenCalled();
    },
  );

  it('keeps legacy omitted-selection count coercion and admits a valid selected command', () => {
    const deposit = bankSim();
    const depositRig = admissionRig();
    dispatchBankCommand(
      deposit,
      WHO,
      'bank_deposit',
      { slot: 3, count: '2' },
      PID,
      depositRig.admission,
    );
    expect(depositRig.tryReserve).toHaveBeenCalledOnce();
    expect(deposit.bankDeposit).toHaveBeenCalledWith(3, undefined, undefined, PID);

    const withdraw = bankSim();
    const withdrawRig = admissionRig();
    const selected = selection(3);
    dispatchBankCommand(
      withdraw,
      WHO,
      'bank_withdraw',
      { slot: 3, selection: selected },
      PID,
      withdrawRig.admission,
    );
    expect(withdrawRig.tryReserve).toHaveBeenCalledOnce();
    expect(withdraw.bankWithdraw).toHaveBeenCalledWith(3, undefined, selected, PID);
  });
});

describe('selected vault wire commands validate before ledger admission', () => {
  it('refuses deposit slot, count, and present-undefined mismatches before reserve', () => {
    for (const message of [
      { slot: 4, count: 2, selection: selection(3) },
      { slot: 3, count: 1, selection: selection(3) },
      { slot: 3, count: '2', selection: selection(3) },
      { slot: 3, count: null, selection: selection(3) },
      { slot: 3, selection: undefined },
    ]) {
      const sim = vaultSim();
      const rig = admissionRig();

      dispatchVaultCommand(sim, WHO, 'vault_deposit', message, PID, rig.admission);

      expect(rig.tryReserve, JSON.stringify(message)).not.toHaveBeenCalled();
      expect(sim.vaultDeposit, JSON.stringify(message)).not.toHaveBeenCalled();
    }
  });

  it('refuses withdrawal item, index, count, and present-undefined mismatches before reserve', () => {
    for (const message of [
      {
        itemId: OTHER_ITEM,
        count: 2,
        special: { index: 3, selection: selection(3) },
      },
      {
        itemId: ORE,
        count: 2,
        special: { index: 4, selection: selection(3) },
      },
      {
        itemId: ORE,
        count: 1,
        special: { index: 3, selection: selection(3) },
      },
      {
        itemId: ORE,
        count: '2',
        special: { index: 3, selection: selection(3) },
      },
      {
        itemId: ORE,
        count: null,
        special: { index: 3, selection: selection(3) },
      },
      {
        itemId: ORE,
        special: { index: 3, selection: undefined },
      },
    ]) {
      const sim = vaultSim();
      const rig = admissionRig();

      dispatchVaultCommand(sim, WHO, 'vault_withdraw', message, PID, rig.admission);

      expect(rig.tryReserve, JSON.stringify(message)).not.toHaveBeenCalled();
      expect(sim.vaultWithdraw, JSON.stringify(message)).not.toHaveBeenCalled();
    }
  });

  it('keeps legacy omitted-selection count coercion and admits a valid selected withdrawal', () => {
    const legacy = vaultSim();
    const legacyRig = admissionRig();
    dispatchVaultCommand(
      legacy,
      WHO,
      'vault_withdraw',
      { itemId: ORE, count: '2', special: { index: 3 } },
      PID,
      legacyRig.admission,
    );
    expect(legacyRig.tryReserve).toHaveBeenCalledOnce();
    expect(legacy.vaultWithdraw).toHaveBeenCalledWith(ORE, undefined, { index: 3 }, PID);

    const selectedSim = vaultSim();
    const selectedRig = admissionRig();
    const selected = selection(3);
    dispatchVaultCommand(
      selectedSim,
      WHO,
      'vault_withdraw',
      { itemId: ORE, special: { index: 3, selection: selected } },
      PID,
      selectedRig.admission,
    );
    expect(selectedRig.tryReserve).toHaveBeenCalledOnce();
    expect(selectedSim.vaultWithdraw).toHaveBeenCalledWith(
      ORE,
      undefined,
      { index: 3, selection: selected },
      PID,
    );
  });
});

describe('the guild wire shared selection envelope predicate', () => {
  it('refuses the slot, count, and item mismatches checked before runGuildBankOp', () => {
    const selected = selection(3);
    expect(materialSourceTransferSelectionMatches(selected, { slotIndex: 4, count: 2 })).toBe(
      false,
    );
    expect(materialSourceTransferSelectionMatches(selected, { slotIndex: 3, count: 1 })).toBe(
      false,
    );
    expect(materialSourceTransferSelectionMatches(selected, { slotIndex: 3, count: '2' })).toBe(
      false,
    );
    expect(
      materialSourceTransferSelectionMatches(selected, {
        itemId: OTHER_ITEM,
        slotIndex: 3,
        count: 2,
      }),
    ).toBe(false);
    expect(materialSourceTransferSelectionMatches(selected, { slotIndex: 3, count: 2 })).toBe(true);
  });
});
