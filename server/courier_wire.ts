// Owner-only courier snapshots and the admitted personal-bank exchange.
// Cargo is bounded to 24 stacks. Moving the courier never rebuilds its bank projection.
import type {
  CourierBankExchange,
  CourierDispatchRequest,
  CourierInfo,
  CourierPose,
} from '../src/sim/courier';
import type { VaultConsumptionAdmission } from '../src/sim/types';
import type { BankInfo } from '../src/world_api/bank';
import { buildPersonalBankLedgerRows } from './bank_ledger';
import { bankVaultLedgerMaxRows } from './bank_vault_ledger_guard';
import {
  type StorageAdmissionSession,
  storageAdmissionSession,
  vaultConsumptionAdmissionFor,
} from './storage_admission';

export interface CourierWireSim {
  courierDispatch(request: CourierDispatchRequest, pid: number): void;
  courierInfoFor(pid: number): CourierInfo | null;
  courierPoseFor(pid: number): CourierPose | null;
  courierWireRevisionFor(pid: number): string | number | null;
  courierBankInfoFor(pid: number): BankInfo | null;
  meta(pid: number): { characterId?: number } | null | undefined;
}
export interface CourierWireSession {
  pid: number;
  lastSent: Readonly<Record<string, string>>;
  lastCourierWireRevision: string | number | null;
}
export function readCourierDispatch(value: Record<string, unknown>): CourierDispatchRequest | null {
  if (Object.keys(value).some((key) => !['t', 'cmd', 'deposits', 'withdrawals'].includes(key)))
    return null;
  const { deposits, withdrawals } = value;
  if (
    !Array.isArray(deposits) ||
    !Array.isArray(withdrawals) ||
    deposits.length + withdrawals.length < 1 ||
    deposits.length + withdrawals.length > 24 ||
    Buffer.byteLength(JSON.stringify(value), 'utf8') > 12 * 1024
  )
    return null;
  for (const selections of [deposits, withdrawals]) {
    const indexes = new Set<number>();
    for (const row of selections) {
      if (
        !row ||
        typeof row !== 'object' ||
        Array.isArray(row) ||
        Object.keys(row).some((key) => key !== 'index' && key !== 'fingerprint') ||
        !Number.isSafeInteger(row.index) ||
        row.index < 0 ||
        typeof row.fingerprint !== 'string' ||
        !row.fingerprint.length ||
        row.fingerprint.length > 12 * 1024 ||
        indexes.has(row.index)
      )
        return null;
      indexes.add(row.index);
    }
  }
  return { deposits, withdrawals };
}
export function dispatchCourierCommand(
  sim: CourierWireSim,
  message: Record<string, unknown>,
  pid: number,
): void {
  const request = readCourierDispatch(message);
  if (request) sim.courierDispatch(request, pid);
}
export function emitCourierSelfKeys(
  emit: (key: string, value: unknown) => void,
  sim: CourierWireSim,
  session: CourierWireSession,
): void {
  emit('courier', sim.courierPoseFor(session.pid));
  const revision = sim.courierWireRevisionFor(session.pid);
  if (session.lastSent.courierData === undefined || revision !== session.lastCourierWireRevision) {
    const info = revision === null ? null : sim.courierInfoFor(session.pid);
    if (!info) emit('courierData', null);
    else {
      const {
        phase: _phase,
        x: _x,
        z: _z,
        bankerId: _bankerId,
        inventoryRevision: _inventoryRevision,
        ...data
      } = info;
      emit('courierData', data);
    }
    session.lastCourierWireRevision = revision;
  }
}
export function courierBankExchangeFor(
  sim: CourierWireSim,
  session: StorageAdmissionSession | undefined,
  pid: number,
  deposit: () => void,
  withdraw: () => void,
): boolean {
  const owner = storageAdmissionSession(session, sim.meta(pid), pid);
  if (!owner) return false;
  const reservation = owner.bankVaultLedgerGuard.admission.tryReserve(
    bankVaultLedgerMaxRows('courier_dispatch'),
    0,
    'personal',
  );
  if (!reservation) return false;
  let before: BankInfo | null;
  try {
    before = sim.courierBankInfoFor(pid);
  } catch (error) {
    reservation.cancel();
    throw error;
  }
  if (!before) {
    reservation.cancel();
    return false;
  }
  try {
    deposit();
    const middle = sim.courierBankInfoFor(pid);
    if (!middle) throw new Error('courier bank disappeared after deposit');
    withdraw();
    const after = sim.courierBankInfoFor(pid);
    if (!after) throw new Error('courier bank disappeared after withdraw');
    // Separate legs are essential: depositing and withdrawing the same item
    // must retain both movements rather than disappearing in a net-zero diff.
    const rows = [
      ...buildPersonalBankLedgerRows('deposit', owner, before, middle),
      ...buildPersonalBankLedgerRows('withdraw', owner, middle, after),
    ];
    if (!reservation.commit(rows)) throw new Error('courier bank ledger commit refused');
    return true;
  } catch (error) {
    reservation.failAfterMutation(error);
    throw error;
  }
}

/** Both live storage callbacks share the same fenced session resolver. */
export function storageAdmissionsFor(
  simFor: () => CourierWireSim,
  sessionFor: (pid: number) => StorageAdmissionSession | undefined,
): [VaultConsumptionAdmission, CourierBankExchange] {
  return [
    vaultConsumptionAdmissionFor(sessionFor, (pid) => simFor().meta(pid)),
    (pid, deposit, withdraw) =>
      courierBankExchangeFor(simFor(), sessionFor(pid), pid, deposit, withdraw),
  ];
}
