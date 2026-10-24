import { courierSlotFingerprint } from '../src/sim/courier/identity';
import type { CourierState } from '../src/sim/courier/types';
import type { InvSlot } from '../src/sim/types';
import { bankVaultLedgerMaxRows } from './bank_vault_ledger_guard';
import { personalBankLedgerRowBound } from './personal_bank_ledger_row_bound';

export interface CourierLedgerState {
  courier?: Pick<CourierState, 'cargo' | 'withdrawals'>;
  bank: { inventory: readonly InvSlot[] };
}

/** Visit only the trip's selected slots, before either leg mutates custody.
 * Depositing and withdrawing the same identity still creates two ledger rows. */
export function courierLedgerRowBound(meta: CourierLedgerState): number {
  let rows = 0;
  for (const slot of meta.courier?.cargo ?? []) rows += personalBankLedgerRowBound(slot);
  for (const selection of meta.courier?.withdrawals ?? []) {
    const slot = meta.bank.inventory[selection.index];
    if (slot && courierSlotFingerprint(slot) === selection.fingerprint)
      rows += personalBankLedgerRowBound(slot);
  }
  return Math.max(bankVaultLedgerMaxRows('courier_dispatch'), rows);
}
