import type { BankLedgerAdmission } from './bank_ledger_admission';
import { type BankLedgerSessionJournal, bankLedgerJournalNeedsSave } from './bank_ledger_session';
import { type BankCommandName, type BankSim, dispatchBankCommand } from './bank_wire';
import { dispatchVaultCommand, type VaultSim } from './vault_wire';

type StorageCommand = BankCommandName | Parameters<typeof dispatchVaultCommand>[2];

/** Both personal stores share admission and the post-command durability trigger. */
export function dispatchBankStorageCommand(
  sim: BankSim & VaultSim,
  session: {
    pid: number;
    characterId: number;
    accountId: number;
    bankVaultLedgerGuard: { admission: BankLedgerAdmission };
    bankLedgerJournal: BankLedgerSessionJournal;
  },
  command: StorageCommand,
  msg: Record<string, unknown>,
  scheduleSave: () => void,
): void {
  const admission = session.bankVaultLedgerGuard.admission;
  switch (command) {
    case 'bank_deposit':
    case 'bank_withdraw':
    case 'bank_buy_slots':
    case 'bank_unlock_socket':
    case 'bank_socket_bag':
    case 'bank_unsocket_bag':
      dispatchBankCommand(sim, session, command, msg, session.pid, admission);
      break;
    default:
      dispatchVaultCommand(sim, session, command, msg, session.pid, admission);
  }
  if (bankLedgerJournalNeedsSave(session.bankLedgerJournal.outbox)) scheduleSave();
}
