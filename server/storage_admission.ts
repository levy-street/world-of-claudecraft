// Shared live-session fence for synchronous storage mutations. No database IO.
import type { VaultConsumptionAdmission } from '../src/sim/types';
import type { BankLedgerSessionJournal } from './bank_ledger_session';
import type { BankVaultLedgerGuardRuntime } from './bank_vault_ledger_guard';

export interface StorageAdmissionSession {
  pid: number;
  characterId: number;
  accountId: number;
  left: boolean;
  escrowQuarantined: boolean;
  bankLedgerJournal: BankLedgerSessionJournal;
  bankVaultLedgerGuard: BankVaultLedgerGuardRuntime;
}
export function storageAdmissionSession(
  session: StorageAdmissionSession | undefined,
  meta: { characterId?: number } | null | undefined,
  pid: number,
): StorageAdmissionSession | null {
  if (
    !session ||
    session.pid !== pid ||
    session.left ||
    session.escrowQuarantined ||
    meta?.characterId !== session.characterId ||
    session.bankLedgerJournal.outbox.owner.characterId !== session.characterId ||
    session.bankLedgerJournal.outbox.owner.accountId !== session.accountId
  )
    return null;
  return session;
}
export function vaultConsumptionAdmissionFor(
  sessionFor: (pid: number) => StorageAdmissionSession | undefined,
  metaFor: (pid: number) => { characterId?: number } | null | undefined,
): VaultConsumptionAdmission {
  return (pid, takes, vaultUpgrades) => {
    const session = storageAdmissionSession(sessionFor(pid), metaFor(pid), pid);
    return (
      session?.bankVaultLedgerGuard.reserveVaultConsumption(takes.length, () =>
        session.bankLedgerJournal.reserveVaultConsumption(takes, vaultUpgrades),
      ) ?? null
    );
  };
}
