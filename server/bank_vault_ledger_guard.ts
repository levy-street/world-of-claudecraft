// Retained-ledger growth guard for the personal bank and Materials Vault.
//
// The shared command lane permits 30 commands per second, which is appropriate
// for combat but not for a keep-forever audit table. Bank, vault, and completed
// craft actions therefore share an account-keyed budget derived from the guild
// bank's human allowance: 10 commands of burst and 2 commands per second
// sustained. A second account bucket prices retained rows, not frames. A
// socket swap can retain two rows, so 4 rows per second is the account ceiling:
// 172,800 receipts and 345,600 rows per account-day after the one-time burst.
// The state survives character swaps and reconnects within this process.
// Account-bucket exhaustion REFUSES the command before the sim runs; it is the
// per-account abuse bound.
//
// The process/realm row bucket is TELEMETRY ONLY. It keeps the full token
// accounting (burst sized to two simultaneous maximum legal sweeps, an 8
// rows/s refill, worst-case reservation with post-commit refund of the unused
// tail), but exhausting it never refuses a player command: two accounts at
// their own 4 rows/s ceilings already saturate a burst-242/refill-8 bucket,
// and fifty players banking once per five seconds sit 2x over it, so refusing
// on it turned ordinary co-play into 'You are busy.' realm-wide. The
// AUTHORITATIVE aggregate bound is the database-wide growth ceiling in
// bank_ledger_growth_budget.ts (which has its own alerting) across processes
// and all writer paths; per-account abuse is bounded by the account bucket
// above. What the realm bucket contributes is the operator signal: every
// admission that WOULD have been refused increments the breach counter on the
// coordinator snapshot (realmRowBreaches), and the token gauge may run
// negative to show overload depth. Account refusals still ride the fixed
// woc_ws_messages_dropped_total{cause="bank_vault"} series.
//
// vault_deposit_all is the legitimate bulk exception. Plain stacks collapse by
// material id, but signed/crafted materials retain a distinct ledger identity
// per carried slot. Its exact committed maximum is therefore the 112-slot
// carried-inventory ceiling, not the smaller material-id set. The account row
// burst admits nine ordinary single-row actions followed by a full sweep in the
// same 10-command human burst. Both buckets reserve worst case before mutation,
// then refund unused rows after the journal accepts the exact immutable batch.
// Craft/enchant vault draws reserve their exact take count.

import type { VaultConsumptionReservation } from '../src/sim/types';
import type {
  BankLedgerAdmission,
  BankLedgerAdmissionHandle,
  BankLedgerProjectionSurface,
} from './bank_ledger_admission';
import type { BankLedgerGuildEffectInput } from './bank_ledger_outbox';
import type { BankLedgerRow } from './db';

export type BankVaultLedgerCommand =
  | 'bank_deposit'
  | 'bank_withdraw'
  | 'bank_buy_slots'
  | 'bank_unlock_socket'
  | 'bank_socket_bag'
  | 'bank_unsocket_bag'
  | 'vault_deposit'
  | 'vault_withdraw'
  | 'vault_deposit_all'
  | 'vault_buy_upgrade';

export type BankVaultLedgerRefusalReason =
  | 'account_command'
  | 'account_rows'
  | 'account_registry'
  // Kept in the union for callers that switch over it, but NO LONGER PRODUCED:
  // realm-bucket exhaustion admits and counts a breach instead of refusing
  // (see the header).
  | 'realm_rows';

export const BANK_VAULT_LEDGER_COMMAND_BURST = 10;
export const BANK_VAULT_LEDGER_COMMAND_REFILL_PER_SECOND = 2;
export const BANK_VAULT_LEDGER_ROW_REFILL_PER_SECOND = 4;
// Kept equal to vault_wire's pre-mutation bound: 16 backpack slots plus four
// 24-slot materials bags. Update both boundaries and their literal tests if
// the shipped inventory ceiling changes.
export const VAULT_DEPOSIT_ALL_LEDGER_MAX_ROWS = 112;

// Nine single-row actions plus the bulk command consume the command burst.
export const BANK_VAULT_LEDGER_ROW_BURST =
  VAULT_DEPOSIT_ALL_LEDGER_MAX_ROWS + BANK_VAULT_LEDGER_COMMAND_BURST - 1;

// Two accounts may land a maximum sweep together before the accounting dips
// negative. The 242/8 pair is the MEASUREMENT BASIS for the breach counter
// (see the header: the realm bucket observes, it does not refuse), kept at the
// values the original refusing guard shipped with so the series stays
// comparable across the conversion.
export const BANK_VAULT_LEDGER_REALM_ROW_BURST = BANK_VAULT_LEDGER_ROW_BURST * 2;
export const BANK_VAULT_LEDGER_REALM_ROW_REFILL_PER_SECOND = 8;

// A fully drained account row bucket reaches its exact initial state in 30.25
// seconds. The larger ordinary TTL avoids churn; pressure cleanup may safely
// evict any fully-refilled idle entry sooner without minting capacity.
export const BANK_VAULT_LEDGER_ACCOUNT_IDLE_TTL_SECONDS = 60;
// Sized ABOVE the DEFAULT realm admission cap (server/http/config.ts
// DEFAULT_MAX_PLAYERS_PER_REALM, 5000; ws_auth receives the resolved value):
// live-bound entries are unprunable, so a cache smaller than the number of
// concurrently admitted accounts would refuse the (cap+1)th account's every
// bank command on bind failure. 5120 is the FLOOR; game.ts derives the real
// capacity from the resolved cap via the resolver below.
export const BANK_VAULT_LEDGER_MAX_ACCOUNT_STATES = 5_120;

/** Mirror of server/http/config.ts DEFAULT_MAX_PLAYERS_PER_REALM (not
 * imported: config.ts fails fast without DATABASE_URL, and this module must
 * construct in DB-less unit worlds). */
const DEFAULT_REALM_PLAYER_CAP = 5_000;

/** Account-registry capacity from the RESOLVED realm player cap, so an
 * env-raised MAX_PLAYERS_PER_REALM cannot outgrow the registry: cap + 128
 * headroom, never below the shipped floor. The raw value is read with
 * config.ts's maxPlayersPerRealm contract (trimmed; unset, empty, or
 * non-finite falls back to the default). A cap of 0 or negative DISABLES
 * realm admission capping entirely (ws_auth admits unbounded fresh joins),
 * so there is no cap to size from and the floor stands. */
export function resolveBankVaultLedgerMaxAccountStates(
  rawMaxPlayersPerRealm: string | undefined,
): number {
  const trimmed = rawMaxPlayersPerRealm?.trim();
  const parsed =
    trimmed === undefined || trimmed === '' ? DEFAULT_REALM_PLAYER_CAP : Number(trimmed);
  const resolvedCap = Number.isFinite(parsed) ? parsed : DEFAULT_REALM_PLAYER_CAP;
  return Math.max(
    BANK_VAULT_LEDGER_MAX_ACCOUNT_STATES,
    resolvedCap > 0
      ? Math.min(Math.ceil(resolvedCap) + 128, Number.MAX_SAFE_INTEGER)
      : BANK_VAULT_LEDGER_MAX_ACCOUNT_STATES,
  );
}

const COMMAND_MAX_ROWS = Object.freeze({
  bank_deposit: 1,
  bank_withdraw: 1,
  bank_buy_slots: 1,
  bank_unlock_socket: 1,
  bank_socket_bag: 2,
  bank_unsocket_bag: 1,
  vault_deposit: 1,
  vault_withdraw: 1,
  vault_deposit_all: VAULT_DEPOSIT_ALL_LEDGER_MAX_ROWS,
  vault_buy_upgrade: 1,
} as const satisfies Record<BankVaultLedgerCommand, number>);

export interface BankVaultLedgerGuardState {
  commandTokens: number;
  rowTokens: number;
  lastRefillSec: number;
}

export interface BankVaultLedgerRealmGuardState {
  /** May run NEGATIVE: the telemetry bucket debits every admission in full so
   *  the gauge shows overload depth (refill clamps only the ceiling). */
  rowTokens: number;
  lastRefillSec: number;
  /** Admissions that the old refusing guard would have refused (rowTokens
   *  short at reservation time). Monotonic; the operator signal. */
  breaches: number;
  /** Optional per-breach hook (a metrics counter); set at creation. */
  onBreach?: () => void;
}

export interface BankVaultLedgerGuardReservation {
  readonly maxRows: number;
  settled: boolean;
}

interface RealmReservation {
  readonly maxRows: number;
  /** What the floor-clamped debit actually removed (at most maxRows). The
   *  credit paths return THIS, never the nominal reservation: while the
   *  bucket sits at its floor a debit removes less than maxRows, and
   *  crediting the nominal amount back would mint tokens on every settle and
   *  refund, climbing the bucket out of overload faster than the refill and
   *  under-counting the breaches the telemetry exists to surface. */
  readonly debited: number;
  settled: boolean;
}

interface CombinedReservation {
  readonly account: BankVaultLedgerGuardReservation;
  readonly realm: RealmReservation;
}

interface AccountEntry {
  readonly state: BankVaultLedgerGuardState;
  bindings: number;
  lastTouchedSec: number;
}

export interface BankVaultLedgerCoordinatorOptions {
  readonly maxAccountStates?: number;
  readonly accountIdleTtlSeconds?: number;
  /** Fires once per realm-bucket breach (an admission the old refusing guard
   *  would have dropped); the host exports it as a monotone counter. */
  readonly onRealmRowBreach?: () => void;
}

export interface BankVaultLedgerCoordinatorSnapshot {
  readonly accountStates: number;
  readonly realmRowTokens: number;
  readonly realmLastRefillSec: number;
  /** Monotonic count of admissions the refusing guard would have dropped. */
  readonly realmRowBreaches: number;
}

function checkedNow(nowSec: number): number {
  if (!Number.isFinite(nowSec)) throw new RangeError('bank-vault ledger time must be finite');
  return nowSec;
}

function checkedPositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function refillAccount(state: BankVaultLedgerGuardState, nowSec: number): void {
  const now = checkedNow(nowSec);
  const elapsed = Math.max(0, now - state.lastRefillSec);
  state.commandTokens = Math.min(
    BANK_VAULT_LEDGER_COMMAND_BURST,
    state.commandTokens + elapsed * BANK_VAULT_LEDGER_COMMAND_REFILL_PER_SECOND,
  );
  state.rowTokens = Math.min(
    BANK_VAULT_LEDGER_ROW_BURST,
    state.rowTokens + elapsed * BANK_VAULT_LEDGER_ROW_REFILL_PER_SECOND,
  );
  state.lastRefillSec = Math.max(state.lastRefillSec, now);
}

function refillRealm(state: BankVaultLedgerRealmGuardState, nowSec: number): void {
  const now = checkedNow(nowSec);
  const elapsed = Math.max(0, now - state.lastRefillSec);
  state.rowTokens = Math.min(
    BANK_VAULT_LEDGER_REALM_ROW_BURST,
    state.rowTokens + elapsed * BANK_VAULT_LEDGER_REALM_ROW_REFILL_PER_SECOND,
  );
  state.lastRefillSec = Math.max(state.lastRefillSec, now);
}

function accountIsFull(state: BankVaultLedgerGuardState): boolean {
  return (
    state.commandTokens === BANK_VAULT_LEDGER_COMMAND_BURST &&
    state.rowTokens === BANK_VAULT_LEDGER_ROW_BURST
  );
}

export function bankVaultLedgerMaxRows(command: BankVaultLedgerCommand): number {
  return COMMAND_MAX_ROWS[command];
}

export function createBankVaultLedgerGuard(nowSec: number): BankVaultLedgerGuardState {
  return {
    commandTokens: BANK_VAULT_LEDGER_COMMAND_BURST,
    rowTokens: BANK_VAULT_LEDGER_ROW_BURST,
    lastRefillSec: checkedNow(nowSec),
  };
}

export function createBankVaultLedgerRealmGuard(
  nowSec: number,
  onBreach?: () => void,
): BankVaultLedgerRealmGuardState {
  return {
    rowTokens: BANK_VAULT_LEDGER_REALM_ROW_BURST,
    lastRefillSec: checkedNow(nowSec),
    breaches: 0,
    onBreach,
  };
}

function reserveAccountRows(
  state: BankVaultLedgerGuardState,
  maxRows: number,
  nowSec: number,
): {
  reservation: BankVaultLedgerGuardReservation | null;
  reason?: 'account_command' | 'account_rows';
} {
  checkedPositiveInteger(maxRows, 'bank-vault ledger reservation row count');
  if (maxRows > BANK_VAULT_LEDGER_ROW_BURST) {
    throw new RangeError('bank-vault ledger reservation exceeds the account row burst');
  }
  refillAccount(state, nowSec);
  if (state.commandTokens < 1) return { reservation: null, reason: 'account_command' };
  if (state.rowTokens < maxRows) return { reservation: null, reason: 'account_rows' };
  state.commandTokens -= 1;
  state.rowTokens -= maxRows;
  return { reservation: { maxRows, settled: false } };
}

/** Reserve one account command and its full row worst case before mutation. */
export function reserveBankVaultLedgerCommand(
  state: BankVaultLedgerGuardState,
  command: BankVaultLedgerCommand,
  nowSec: number,
): BankVaultLedgerGuardReservation | null {
  return reserveAccountRows(state, bankVaultLedgerMaxRows(command), nowSec).reservation;
}

/** TELEMETRY debit: always succeeds. The full worst case is debited (tokens
 *  may run negative) and a shortfall at reservation time counts one breach,
 *  which is exactly the admission the old refusing guard would have dropped. */
function debitRealmRows(
  state: BankVaultLedgerRealmGuardState,
  maxRows: number,
  nowSec: number,
): RealmReservation {
  checkedPositiveInteger(maxRows, 'bank-vault realm reservation row count');
  if (maxRows > BANK_VAULT_LEDGER_REALM_ROW_BURST) {
    throw new RangeError('bank-vault ledger reservation exceeds the realm row burst');
  }
  refillRealm(state, nowSec);
  if (state.rowTokens < maxRows) {
    state.breaches++;
    state.onBreach?.();
  }
  // Floor clamp at one burst width: this bucket is telemetry only, so one
  // large event must depress it by at most a burst rather than driving it far
  // negative and pinning the breach signal for hours, which would destroy the
  // rate the conversion exists to report. (The matching refill clamps only
  // the ceiling.) The reservation records what the clamp actually removed so
  // the credit paths cannot over-credit past it.
  const beforeDebit = state.rowTokens;
  state.rowTokens = Math.max(beforeDebit - maxRows, -BANK_VAULT_LEDGER_REALM_ROW_BURST);
  return { maxRows, debited: beforeDebit - state.rowTokens, settled: false };
}

/** Settle an attempted command: unused rows refund, its command token does not. */
export function settleBankVaultLedgerCommand(
  state: BankVaultLedgerGuardState,
  reservation: BankVaultLedgerGuardReservation,
  actualRows: number,
): void {
  if (reservation.settled) throw new Error('bank-vault ledger reservation already settled');
  if (!Number.isSafeInteger(actualRows) || actualRows < 0 || actualRows > reservation.maxRows) {
    throw new RangeError('bank-vault ledger actual rows exceed the reserved worst case');
  }
  state.rowTokens = Math.min(
    BANK_VAULT_LEDGER_ROW_BURST,
    state.rowTokens + reservation.maxRows - actualRows,
  );
  reservation.settled = true;
}

/** Refund a reservation whose downstream admission/call proved no attempt ran. */
export function refundBankVaultLedgerCommand(
  state: BankVaultLedgerGuardState,
  reservation: BankVaultLedgerGuardReservation,
): void {
  if (reservation.settled) throw new Error('bank-vault ledger reservation already settled');
  state.commandTokens = Math.min(BANK_VAULT_LEDGER_COMMAND_BURST, state.commandTokens + 1);
  state.rowTokens = Math.min(BANK_VAULT_LEDGER_ROW_BURST, state.rowTokens + reservation.maxRows);
  reservation.settled = true;
}

function settleRealmRows(
  state: BankVaultLedgerRealmGuardState,
  reservation: RealmReservation,
  actualRows: number,
): void {
  if (reservation.settled) throw new Error('bank-vault realm reservation already settled');
  if (!Number.isSafeInteger(actualRows) || actualRows < 0 || actualRows > reservation.maxRows) {
    throw new RangeError('bank-vault realm actual rows exceed the reserved worst case');
  }
  // Unused rows refund against what was ACTUALLY debited (the clamp may have
  // removed less than maxRows), so a settle at the floor can never mint.
  state.rowTokens = Math.min(
    BANK_VAULT_LEDGER_REALM_ROW_BURST,
    state.rowTokens + Math.max(0, reservation.debited - actualRows),
  );
  reservation.settled = true;
}

function refundRealmRows(
  state: BankVaultLedgerRealmGuardState,
  reservation: RealmReservation,
): void {
  if (reservation.settled) throw new Error('bank-vault realm reservation already settled');
  // A full refund restores exactly what the (possibly clamped) debit took.
  state.rowTokens = Math.min(
    BANK_VAULT_LEDGER_REALM_ROW_BURST,
    state.rowTokens + reservation.debited,
  );
  reservation.settled = true;
}

function reserveCombinedRows(
  account: BankVaultLedgerGuardState,
  realm: BankVaultLedgerRealmGuardState,
  maxRows: number,
  nowSec: number,
): { reservation: CombinedReservation | null; reason?: BankVaultLedgerRefusalReason } {
  const accountResult = reserveAccountRows(account, maxRows, nowSec);
  if (!accountResult.reservation) return { reservation: null, reason: accountResult.reason };
  // The realm debit cannot refuse (telemetry only, see the header); only the
  // account bucket above decides admission.
  const realmReservation = debitRealmRows(realm, maxRows, nowSec);
  return { reservation: { account: accountResult.reservation, realm: realmReservation } };
}

function settleCombinedRows(
  account: BankVaultLedgerGuardState,
  realm: BankVaultLedgerRealmGuardState,
  reservation: CombinedReservation,
  actualRows: number,
): void {
  settleBankVaultLedgerCommand(account, reservation.account, actualRows);
  settleRealmRows(realm, reservation.realm, actualRows);
}

function refundCombinedRows(
  account: BankVaultLedgerGuardState,
  realm: BankVaultLedgerRealmGuardState,
  reservation: CombinedReservation,
): void {
  refundBankVaultLedgerCommand(account, reservation.account);
  refundRealmRows(realm, reservation.realm);
}

function reservationShapeIsKnown(
  maxRows: number,
  maxGuildEffectDeltas: number,
  surface: BankLedgerProjectionSurface,
): boolean {
  if (maxGuildEffectDeltas !== 0) return false;
  if (surface === 'personal') return maxRows === 1 || maxRows === 2;
  if (surface === 'vault') return maxRows === 1 || maxRows === VAULT_DEPOSIT_ALL_LEDGER_MAX_ROWS;
  return false;
}

function guardedAdmission(
  accountState: () => BankVaultLedgerGuardState | null,
  realm: BankVaultLedgerRealmGuardState,
  admission: BankLedgerAdmission,
  nowSec: () => number,
  onRefused: (reason: BankVaultLedgerRefusalReason, refusedAtSec: number) => void,
): BankLedgerAdmission {
  return Object.freeze({
    tryReserve(
      maxRows: number,
      maxGuildEffectDeltas = 0,
      surface: BankLedgerProjectionSurface = 'personal',
    ): BankLedgerAdmissionHandle | null {
      if (!reservationShapeIsKnown(maxRows, maxGuildEffectDeltas, surface)) {
        throw new Error('bank-vault wire reservation does not match its command budget');
      }
      const attemptedAtSec = checkedNow(nowSec());
      const account = accountState();
      if (!account) {
        onRefused('account_registry', attemptedAtSec);
        return null;
      }
      const capacity = reserveCombinedRows(account, realm, maxRows, attemptedAtSec);
      if (!capacity.reservation) {
        onRefused(capacity.reason ?? 'account_rows', attemptedAtSec);
        return null;
      }
      const reservation = capacity.reservation;

      let inner: BankLedgerAdmissionHandle | null;
      try {
        inner = admission.tryReserve(maxRows, maxGuildEffectDeltas, surface);
      } catch (error) {
        refundCombinedRows(account, realm, reservation);
        throw error;
      }
      if (!inner) {
        refundCombinedRows(account, realm, reservation);
        return null;
      }

      let active = true;
      return Object.freeze({
        commit(rows: readonly BankLedgerRow[], guildEffect?: BankLedgerGuildEffectInput | null) {
          if (!active) return false;
          const committed = inner.commit(rows, guildEffect);
          if (!committed) {
            // The downstream reservation no longer accepts a terminal action,
            // so its mutation state is not safely recoverable. Retain the
            // worst-case charge and make this wrapper terminal too.
            active = false;
            return false;
          }
          settleCombinedRows(account, realm, reservation, rows.length);
          active = false;
          return true;
        },
        cancel(): boolean {
          if (!active) return false;
          const cancelled = inner.cancel();
          if (!cancelled) {
            // A rejected cancel does not prove the mutation stayed out of Sim.
            // Retain worst-case capacity and reject every later callback.
            active = false;
            return false;
          }
          // The inner admission proves this command never reached Sim. A real
          // shape-valid Sim no-op commits an empty projection and stays charged.
          refundCombinedRows(account, realm, reservation);
          active = false;
          return true;
        },
        failAfterMutation(error: unknown): void {
          if (!active) return;
          active = false;
          // Mutation is unprovable, so retain worst-case capacity while the
          // journal callback synchronously quarantines the session.
          inner.failAfterMutation(error);
        },
      });
    },
  });
}

function guardedVaultConsumption(
  account: BankVaultLedgerGuardState,
  realm: BankVaultLedgerRealmGuardState,
  exactRows: number,
  reserveJournal: () => VaultConsumptionReservation | null,
  attemptedAtSec: number,
  onRefused: (reason: BankVaultLedgerRefusalReason, refusedAtSec: number) => void,
): VaultConsumptionReservation | null {
  const capacity = reserveCombinedRows(account, realm, exactRows, attemptedAtSec);
  if (!capacity.reservation) {
    onRefused(capacity.reason ?? 'account_rows', attemptedAtSec);
    return null;
  }
  const reservation = capacity.reservation;

  let journalReservation: VaultConsumptionReservation | null;
  try {
    journalReservation = reserveJournal();
  } catch (error) {
    refundCombinedRows(account, realm, reservation);
    throw error;
  }
  if (!journalReservation) {
    refundCombinedRows(account, realm, reservation);
    return null;
  }
  const journal = journalReservation;

  let active = true;
  return Object.freeze({
    commit(): void {
      if (!active) return;
      active = false;
      // A throw may follow a partial mutation, so exact capacity stays charged.
      journal.commit();
      settleCombinedRows(account, realm, reservation, exactRows);
    },
    cancel(): void {
      if (!active) return;
      active = false;
      journal.cancel();
      // The resolver calls cancel only when it proves no vault take occurred.
      refundCombinedRows(account, realm, reservation);
    },
  });
}

export interface BankVaultLedgerGuardRuntime {
  readonly admission: BankLedgerAdmission;
  reserveVaultConsumption(
    exactRows: number,
    reserveJournal: () => VaultConsumptionReservation | null,
  ): VaultConsumptionReservation | null;
  release(): void;
}

export interface BankVaultLedgerGuardCoordinator {
  createRuntime(
    accountId: number,
    admission: BankLedgerAdmission,
    onRefused: (reason: BankVaultLedgerRefusalReason, refusedAtSec: number) => void,
  ): BankVaultLedgerGuardRuntime;
  pruneIdle(): number;
  snapshot(): BankVaultLedgerCoordinatorSnapshot;
}

/** Own the process-wide row bucket and bounded account-keyed bucket cache. */
export function createBankVaultLedgerGuardCoordinator(
  nowSec: () => number,
  options: BankVaultLedgerCoordinatorOptions = {},
): BankVaultLedgerGuardCoordinator {
  const maxAccountStates = checkedPositiveInteger(
    options.maxAccountStates ?? BANK_VAULT_LEDGER_MAX_ACCOUNT_STATES,
    'bank-vault ledger max account states',
  );
  const idleTtlSeconds =
    options.accountIdleTtlSeconds ?? BANK_VAULT_LEDGER_ACCOUNT_IDLE_TTL_SECONDS;
  if (!Number.isFinite(idleTtlSeconds) || idleTtlSeconds < 0) {
    throw new RangeError('bank-vault ledger idle TTL must be finite and non-negative');
  }
  const initialNow = checkedNow(nowSec());
  const realm = createBankVaultLedgerRealmGuard(initialNow, options.onRealmRowBreach);
  const accounts = new Map<number, AccountEntry>();
  let lastPruneSec = initialNow;

  const prune = (atSec: number, underPressure: boolean): number => {
    let removed = 0;
    for (const [accountId, entry] of accounts) {
      if (entry.bindings > 0) continue;
      refillAccount(entry.state, atSec);
      // Never delete charged state. A short injected TTL, a regressed clock,
      // or cache pressure may only evict capacity that has fully regenerated.
      if (!accountIsFull(entry.state)) continue;
      const ttlExpired = atSec - entry.lastTouchedSec >= idleTtlSeconds;
      if (!ttlExpired && !underPressure) continue;
      accounts.delete(accountId);
      removed++;
    }
    lastPruneSec = Math.max(lastPruneSec, atSec);
    return removed;
  };

  const maybePrune = (atSec: number): void => {
    if (atSec - lastPruneSec >= idleTtlSeconds) prune(atSec, false);
  };

  const bind = (accountId: number, atSec: number): AccountEntry | null => {
    if (!Number.isSafeInteger(accountId) || accountId <= 0) {
      throw new RangeError('bank-vault ledger account id must be a positive safe integer');
    }
    maybePrune(atSec);
    let entry = accounts.get(accountId);
    if (!entry && accounts.size >= maxAccountStates) {
      prune(atSec, true);
      entry = accounts.get(accountId);
    }
    if (!entry && accounts.size >= maxAccountStates) return null;
    if (!entry) {
      entry = {
        state: createBankVaultLedgerGuard(atSec),
        bindings: 0,
        lastTouchedSec: atSec,
      };
      accounts.set(accountId, entry);
    }
    entry.bindings++;
    entry.lastTouchedSec = atSec;
    return entry;
  };

  return Object.freeze({
    createRuntime(
      accountId: number,
      admission: BankLedgerAdmission,
      onRefused: (reason: BankVaultLedgerRefusalReason, refusedAtSec: number) => void,
    ): BankVaultLedgerGuardRuntime {
      let released = false;
      if (!Number.isSafeInteger(accountId) || accountId <= 0) {
        throw new RangeError('bank-vault ledger account id must be a positive safe integer');
      }
      // A joined account that never touches bank/vault must not occupy this
      // smaller abuse-state cache. Bind lazily on its first guarded action.
      let entry: AccountEntry | null = null;
      const accountState = (): BankVaultLedgerGuardState | null => {
        if (released) return null;
        const atSec = checkedNow(nowSec());
        if (!entry) entry = bind(accountId, atSec);
        if (entry) entry.lastTouchedSec = atSec;
        return entry?.state ?? null;
      };
      const admissionGuard = guardedAdmission(accountState, realm, admission, nowSec, onRefused);

      return Object.freeze({
        admission: admissionGuard,
        reserveVaultConsumption(
          exactRows: number,
          reserveJournal: () => VaultConsumptionReservation | null,
        ): VaultConsumptionReservation | null {
          const attemptedAtSec = checkedNow(nowSec());
          const account = accountState();
          if (!account) {
            onRefused('account_registry', attemptedAtSec);
            return null;
          }
          return guardedVaultConsumption(
            account,
            realm,
            exactRows,
            reserveJournal,
            attemptedAtSec,
            onRefused,
          );
        },
        release(): void {
          if (released) return;
          released = true;
          if (!entry) return;
          entry.bindings = Math.max(0, entry.bindings - 1);
          entry.lastTouchedSec = checkedNow(nowSec());
          entry = null;
        },
      });
    },
    pruneIdle(): number {
      return prune(checkedNow(nowSec()), false);
    },
    snapshot(): BankVaultLedgerCoordinatorSnapshot {
      const atSec = checkedNow(nowSec());
      refillRealm(realm, atSec);
      return Object.freeze({
        accountStates: accounts.size,
        realmRowTokens: realm.rowTokens,
        realmLastRefillSec: realm.lastRefillSec,
        realmRowBreaches: realm.breaches,
      });
    },
  });
}
