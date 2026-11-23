// Owner-only courier snapshots and the admitted bank and vault exchange.
// Cargo is bounded to 24 stacks. Moving the courier never rebuilds its bank projection.
import {
  type CourierAccountExchange,
  type CourierBankExchange,
  type CourierDispatchRequest,
  type CourierInfo,
  type CourierPose,
  type CourierVaultSelection,
  courierSelectionCount,
  courierVaultInfoFor,
  courierVaultTripFor,
} from '../src/sim/courier';
import type { SimContext } from '../src/sim/sim_context';
import type { InvSlot, VaultConsumptionAdmission } from '../src/sim/types';
import type { BankInfo, VaultInfo } from '../src/world_api/bank';
import { buildPersonalBankLedgerRows, buildVaultLedgerRows } from './bank_ledger';
import { BANK_VAULT_LEDGER_ROW_BURST } from './bank_vault_ledger_guard';
import { type CourierLedgerState, courierLedgerRowBound } from './courier_ledger_row_bound';
import {
  type StorageAdmissionSession,
  storageAdmissionSession,
  vaultConsumptionAdmissionFor,
} from './storage_admission';
import { vaultLedgerKeyCount } from './vault_ledger_row_bound';

const DISPATCH_KEYS = [
  't',
  'cmd',
  'deposits',
  'withdrawals',
  'vaultDeposits',
  'vaultWithdrawals',
  'account',
];

function readSelections(value: unknown): { index: number; fingerprint: string }[] | null {
  if (!Array.isArray(value)) return null;
  const indexes = new Set<number>();
  for (const row of value) {
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
  return value;
}

function readVaultRows(value: unknown): CourierVaultSelection[] | null {
  if (!Array.isArray(value)) return null;
  for (const row of value) {
    if (
      !row ||
      typeof row !== 'object' ||
      Array.isArray(row) ||
      Object.keys(row).some((key) => !['itemId', 'count', 'special'].includes(key)) ||
      typeof row.itemId !== 'string' ||
      !row.itemId.length ||
      row.itemId.length > 64 ||
      !Number.isSafeInteger(row.count) ||
      row.count <= 0 ||
      (row.special !== undefined && readSelections([row.special]) === null)
    )
      return null;
  }
  return value;
}

export interface CourierWireSim {
  courierDispatch(request: CourierDispatchRequest, pid: number): void;
  courierInfoFor(pid: number): CourierInfo | null;
  courierPoseFor(pid: number): CourierPose | null;
  courierWireRevisionFor(pid: number): string | number | null;
  courierBankInfoFor(pid: number): BankInfo | null;
  /** The vault leg reads go straight to the courier module (no Sim delegates). */
  readonly ctx: SimContext;
  meta(
    pid: number,
  ):
    | ({ characterId?: number; inventory?: readonly InvSlot[] } & CourierLedgerState)
    | null
    | undefined;
}
export interface CourierWireSession {
  pid: number;
  lastSent: Readonly<Record<string, string>>;
  lastCourierWireRevision: string | number | null;
}
export function readCourierDispatch(value: Record<string, unknown>): CourierDispatchRequest | null {
  if (Object.keys(value).some((key) => !DISPATCH_KEYS.includes(key))) return null;
  const deposits = readSelections(value.deposits);
  const withdrawals = readSelections(value.withdrawals);
  if (!deposits || !withdrawals) return null;
  const request: CourierDispatchRequest = { deposits, withdrawals };
  if (value.vaultDeposits !== undefined) {
    const vaultDeposits = readSelections(value.vaultDeposits);
    if (!vaultDeposits) return null;
    request.vaultDeposits = vaultDeposits;
  }
  if (value.vaultWithdrawals !== undefined) {
    const vaultWithdrawals = readVaultRows(value.vaultWithdrawals);
    if (!vaultWithdrawals) return null;
    request.vaultWithdrawals = vaultWithdrawals;
  }
  if (value.account !== undefined) {
    const account = value.account as Record<string, unknown> | null;
    if (
      !account ||
      typeof account !== 'object' ||
      Array.isArray(account) ||
      Object.keys(account).some(
        (key) => !['characterId', 'deposits', 'withdrawals'].includes(key),
      ) ||
      !Number.isSafeInteger(account.characterId) ||
      (account.characterId as number) <= 0
    )
      return null;
    const accountDeposits = readSelections(account.deposits);
    const accountWithdrawals = readSelections(account.withdrawals);
    if (!accountDeposits || !accountWithdrawals) return null;
    request.account = {
      characterId: account.characterId as number,
      deposits: accountDeposits,
      withdrawals: accountWithdrawals,
    };
  }
  if (
    // Zero selections is the courier dismissal (the window closed unsent).
    courierSelectionCount(request) > 24 ||
    Buffer.byteLength(JSON.stringify(value), 'utf8') > 12 * 1024
  )
    return null;
  return request;
}
export function dispatchCourierCommand(
  sim: CourierWireSim,
  message: Record<string, unknown>,
  pid: number,
): void {
  const request = readCourierDispatch(message);
  if (!request) return;
  // The vault leg must fit one vault ledger reservation at the banker, or the
  // courier would wait there forever: refuse such a trip before it leaves.
  if (request.vaultDeposits?.length || request.vaultWithdrawals?.length) {
    const inventory = sim.meta(pid)?.inventory ?? [];
    const vaultCargo = (request.vaultDeposits ?? []).flatMap((s) =>
      inventory[s.index] ? [inventory[s.index]] : [],
    );
    const bound = courierVaultLedgerRowBound(courierVaultInfoFor(sim.ctx, pid), {
      vaultCargo,
      vaultWithdrawals: request.vaultWithdrawals,
    });
    if (bound > BANK_VAULT_LEDGER_ROW_BURST) return;
  }
  sim.courierDispatch(request, pid);
}
export function emitCourierSelfKeys(
  emit: (key: string, value: unknown) => void,
  sim: CourierWireSim,
  session: CourierWireSession,
): void {
  const pose = sim.courierPoseFor(session.pid);
  // Older clients strictly validate the original pose keys. Publish timing as
  // a separate self delta, which they ignore, while retaining the legacy pose.
  if (pose) {
    const { travelTicks, legTicks, ...legacyPose } = pose;
    emit('courier', legacyPose);
    emit('courierTravelTicks', travelTicks ?? null);
    emit('courierLegTicks', legTicks ?? null);
  } else {
    emit('courier', null);
    emit('courierTravelTicks', null);
    emit('courierLegTicks', null);
  }
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
        travelDistance: _travelDistance,
        travelTicks: _travelTicks,
        legTicks: _legTicks,
        remainingDistance: _remainingDistance,
        vault,
        vaultCargo,
        vaultWithdrawals,
        account,
        ...data
      } = info;
      emit('courierData', data);
      // Its own key: older clients reject any courierData key they do not know.
      emit('courierStores', {
        vault: vault ?? null,
        vaultCargo: vaultCargo ?? [],
        vaultWithdrawals: vaultWithdrawals ?? [],
        account: account ?? null,
      });
    }
    if (!info) emit('courierStores', null);
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
  const meta = sim.meta(pid);
  const owner = storageAdmissionSession(session, meta, pid);
  if (!owner || !meta?.courier) return false;
  const rowBound = courierLedgerRowBound(meta);
  // A trip that can never fit the journal's burst returns its cargo unchanged.
  // Resolving it without either callback lets the sim return home instead of
  // retrying forever at the bank. Temporary admission pressure still retries.
  if (rowBound > BANK_VAULT_LEDGER_ROW_BURST) return true;
  const reservation = owner.bankVaultLedgerGuard.admission.tryReserve(rowBound, 0, 'personal');
  if (!reservation) return false;
  let before: BankInfo | null;
  let vaultBefore: VaultInfo | null = null;
  let vaultReservation: ReturnType<typeof owner.bankVaultLedgerGuard.admission.tryReserve> = null;
  try {
    before = sim.courierBankInfoFor(pid);
    const trip = courierVaultTripFor(sim.ctx, pid);
    if (trip?.vaultCargo?.length || trip?.vaultWithdrawals?.length) {
      vaultBefore = courierVaultInfoFor(sim.ctx, pid);
      const rows = courierVaultLedgerRowBound(vaultBefore, trip);
      // A restored trip or changed vault row can outgrow the dispatch bound.
      // Settle without mutations so its cargo returns home, as for the bank.
      if (rows > BANK_VAULT_LEDGER_ROW_BURST) {
        reservation.cancel();
        return true;
      }
      // Temporary admission pressure waits at the banker.
      vaultReservation =
        vaultBefore && rows <= BANK_VAULT_LEDGER_ROW_BURST
          ? owner.bankVaultLedgerGuard.admission.tryReserve(rows, 0, 'vault')
          : null;
      if (!vaultReservation) {
        reservation.cancel();
        return false;
      }
    }
  } catch (error) {
    reservation.cancel();
    vaultReservation?.cancel();
    throw error;
  }
  if (!before) {
    reservation.cancel();
    vaultReservation?.cancel();
    return false;
  }
  try {
    deposit();
    const middle = sim.courierBankInfoFor(pid);
    if (!middle) throw new Error('courier bank disappeared after deposit');
    const vaultMiddle = vaultReservation ? courierVaultInfoFor(sim.ctx, pid) : null;
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
    if (vaultReservation) {
      const vaultAfter = courierVaultInfoFor(sim.ctx, pid);
      const vaultRows = [
        ...buildVaultLedgerRows('deposit', owner, vaultBefore, vaultMiddle),
        ...buildVaultLedgerRows('withdraw', owner, vaultMiddle, vaultAfter),
      ];
      if (!vaultReservation.commit(vaultRows))
        throw new Error('courier vault ledger commit refused');
    }
    return true;
  } catch (error) {
    reservation.failAfterMutation(error);
    vaultReservation?.failAfterMutation(error);
    throw error;
  }
}

/** Vault ledger rows one trip can write: one per distinct ledger identity across
 *  the vault-bound stacks (deposit leg) plus the rows they withdraw (each its
 *  own identities, pooled stock one). Read from the pre-exchange snapshots. */
export function courierVaultLedgerRowBound(
  vault: VaultInfo | null,
  trip: Pick<CourierInfo, 'vaultCargo' | 'vaultWithdrawals'>,
): number {
  const withdrawn = (trip.vaultWithdrawals ?? []).map((s) => {
    const row = s.special ? vault?.special[s.special.index] : undefined;
    return row ? vaultLedgerKeyCount([row]) : 1;
  });
  return (
    Math.max(1, vaultLedgerKeyCount(trip.vaultCargo ?? [])) +
    withdrawn.reduce((sum, n) => sum + Math.max(1, n), 0)
  );
}

/** Both live storage callbacks share the same fenced session resolver. */
export function storageAdmissionsFor(
  simFor: () => CourierWireSim,
  sessionFor: (pid: number) => StorageAdmissionSession | undefined,
  courierAccountExchange: CourierAccountExchange,
): [VaultConsumptionAdmission, CourierBankExchange, CourierAccountExchange] {
  return [
    vaultConsumptionAdmissionFor(sessionFor, (pid) => simFor().meta(pid)),
    (pid, deposit, withdraw) =>
      courierBankExchangeFor(simFor(), sessionFor(pid), pid, deposit, withdraw),
    courierAccountExchange,
  ];
}
