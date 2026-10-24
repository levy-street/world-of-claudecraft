import { describe, expect, it, vi } from 'vitest';

vi.mock('../../server/db', () => ({ insertBankLedgerRow: vi.fn(), insertBankLedgerRows: vi.fn() }));
vi.mock('../../server/storage_purchases', () => ({ storagePurchaseInFlight: () => false }));
vi.mock('../../server/storage_store_cache', () => ({ nextRungClaudiumPriceFor: () => undefined }));

import { BankLedgerOutboxAdmission } from '../../server/bank_ledger_admission';
import { BankLedgerOutbox, BankLedgerOutboxBudget } from '../../server/bank_ledger_outbox';
import { createBankVaultLedgerGuardCoordinator } from '../../server/bank_vault_ledger_guard';
import { type BankSim, dispatchBankCommand } from '../../server/bank_wire';
import { REALM } from '../../server/realm';
import { moveBetweenContainers } from '../../src/sim/bank';
import { resolveMaterialSourceTransferSelection } from '../../src/sim/material_source_transfer_selection';
import { captureMaterialStackSelection } from '../../src/sim/material_stack_selection';
import type { InvSlot } from '../../src/sim/types';
import type { BankInfo } from '../../src/world_api';

const WHO = { characterId: 101, accountId: 202 };
function mixed(count = 20): InvSlot {
  return {
    itemId: 'minor_healing_potion',
    count,
    materialSources: Array.from({ length: count }, (_, i) => ({
      source: { signer: `Maker${String(i).padStart(3, '0')}` },
      count: 1,
    })),
  };
}
function harness(count = 20, rowLimit = 200) {
  const inventory = [mixed(count)];
  const stored: InvSlot[] = [];
  const errors: string[] = [];
  const mutate = vi.fn();
  const sim: BankSim = {
    ctx: {
      resolve: () => ({ meta: { entityId: 1, inventory, bank: { purchasedSlots: 0 } } }),
      error: (_pid, text) => errors.push(text),
    },
    bankInfoFor: () =>
      ({
        slots: structuredClone(stored),
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
        generalUsed: stored.length,
        materialsUsed: 0,
      }) satisfies BankInfo,
    bankDeposit: (slot, quantity, selection) => {
      mutate();
      const resolved =
        typeof selection === 'object'
          ? resolveMaterialSourceTransferSelection(inventory, selection)
          : undefined;
      if (resolved && !resolved.ok) return;
      moveBetweenContainers(
        inventory,
        slot,
        quantity,
        stored,
        { general: 24, materials: 0 },
        resolved?.value.sources,
      );
    },
    bankWithdraw: (slot, quantity) => {
      mutate();
      moveBetweenContainers(stored, slot, quantity, inventory, { general: 16, materials: 0 });
    },
    bankBuySlots: () => {},
    bankUnlockSocket: () => {},
    bankSocketBag: () => {},
    bankUnsocketBag: () => {},
  };
  const budget = new BankLedgerOutboxBudget({
    maxRows: rowLimit,
    maxEncodedBytes: 2 * 1024 * 1024,
  });
  let key = 0;
  const outbox = new BankLedgerOutbox({
    owner: { realm: REALM, ...WHO },
    budget,
    limits: { maxRows: rowLimit, maxEncodedBytes: 2 * 1024 * 1024 },
    nextBatchKey: () => `source-bank:${++key}`,
  });
  const projectionFailure = vi.fn();
  const inner = new BankLedgerOutboxAdmission(outbox, { onProjectionFailure: projectionFailure });
  const reserve = vi.spyOn(inner, 'tryReserve');
  const coordinator = createBankVaultLedgerGuardCoordinator(() => 0);
  const runtime = coordinator.createRuntime(WHO.accountId, inner, vi.fn());
  return {
    sim,
    inventory,
    stored,
    errors,
    mutate,
    outbox,
    projectionFailure,
    reserve,
    coordinator,
    admission: runtime.admission,
  };
}

describe('personal bank reserves mixed maker audit rows before mutation', () => {
  it('reserves and commits all twenty maker rows for deposit and withdrawal', () => {
    const h = harness();
    dispatchBankCommand(h.sim, WHO, 'bank_deposit', { slot: 0 }, 1, h.admission);
    expect(h.reserve).toHaveBeenNthCalledWith(1, 20, 0, 'personal');
    expect(h.outbox.usage.queuedRows).toBe(20);
    expect(h.stored).toEqual([mixed()]);
    dispatchBankCommand(h.sim, WHO, 'bank_withdraw', { slot: 0 }, 1, h.admission);
    expect(h.reserve).toHaveBeenNthCalledWith(2, 20, 0, 'personal');
    expect(h.outbox.usage.queuedRows).toBe(40);
    expect(h.inventory).toEqual([mixed()]);
    expect(h.projectionFailure).not.toHaveBeenCalled();
  });

  it('refunds the nineteen reserved rows not used by a one-unit transfer', () => {
    const h = harness();
    const target = captureMaterialStackSelection(h.inventory, 'minor_healing_potion', 0);
    if (!target) throw new Error('missing selected mixed stack');
    dispatchBankCommand(
      h.sim,
      WHO,
      'bank_deposit',
      {
        slot: 0,
        count: 1,
        selection: {
          itemId: 'minor_healing_potion',
          target,
          quantities: [{ sourceIndex: 19, count: 1 }],
        },
      },
      1,
      h.admission,
    );
    expect(h.reserve).toHaveBeenCalledWith(20, 0, 'personal');
    expect(h.outbox.usage.queuedRows).toBe(1);
    expect(h.coordinator.snapshot().realmRowTokens).toBe(241);
    expect(h.inventory[0].count).toBe(19);
    expect(h.stored[0].materialSources).toEqual([{ source: { signer: 'Maker019' }, count: 1 }]);
    expect(h.admission.tryReserve(121, 0, 'personal')).toBeNull();
    const remainingBudget = h.admission.tryReserve(120, 0, 'personal');
    expect(remainingBudget).not.toBeNull();
    remainingBudget?.cancel();
    expect(h.projectionFailure).not.toHaveBeenCalled();
  });

  it.each([
    [20, 19],
    [122, 200],
  ])('refuses %s maker rows with limit %s before changing either container', (count, limit) => {
    const h = harness(count, limit);
    dispatchBankCommand(h.sim, WHO, 'bank_deposit', { slot: 0 }, 1, h.admission);
    expect(h.mutate).not.toHaveBeenCalled();
    expect(h.inventory).toEqual([mixed(count)]);
    expect(h.stored).toEqual([]);
    expect(h.outbox.usage.queuedRows).toBe(0);
    expect(h.errors).toEqual(['You are busy.']);
    expect(h.projectionFailure).not.toHaveBeenCalled();
  });
});
