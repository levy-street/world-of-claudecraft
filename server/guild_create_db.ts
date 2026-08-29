// Atomic paid guild creation. The founder's already-charged character state,
// every effect captured before the request, the create_fee receipt, guild,
// leader membership, and canonical empty bank commit together or not at all.

import type { PoolClient } from 'pg';
import type { CharacterState } from '../src/sim/character_state';
import { createEmptyGuildBankState, GUILD_CREATION_FEE_COPPER } from '../src/sim/guild_bank';
import { bustAdminGuildListReads } from './admin_guilds_read';
import { bankLedgerCommandBatchPayloadSha256 } from './bank_ledger_batch_db';
import {
  BankLedgerGrowthLimitExceeded,
  bankLedgerGrowthLimitFromError,
} from './bank_ledger_growth_budget';
import { type BankLedgerCommandBatch, serializeBankLedgerCommandBatch } from './bank_ledger_outbox';
import {
  type BankLedgerSaveEffects,
  lockCharacterSaveAccountParentKeyShareOnClient,
} from './bank_ledger_save_effects_db';
import { beginCharacterSaveTx, prepareCharacterSaveEffects } from './character_save_transaction';
import { saveCharacterStateOnClient } from './db';
import {
  backendCancelViaPool,
  createDbTransactionDeadline,
  DbTransactionAborted,
  type DbTransactionDeadlineClient,
  DbTransactionDeadlineExceeded,
} from './db_transaction_deadline';
import {
  GUILD_NAME_ADVISORY_LOCK_SQL,
  GUILD_NAME_COLLISION_SQL,
  guildNameLockKey,
} from './guild_name_db';
import { throwProvedRollback } from './pg_rollback_proof';
import { REALM } from './realm';
import type { StorageAppliedEffect } from './storage_purchase_db';

export interface PaidGuildCreateDbClient extends DbTransactionDeadlineClient {}

export interface PaidGuildCreateDbPool {
  connect(): Promise<PaidGuildCreateDbClient>;
  /** Optional so narrow fakes stay valid; with it, a deadline that destroys a
   * paid-create socket also fires pg_cancel_backend so held locks drop early. */
  query?(sql: string, values: unknown[]): Promise<unknown>;
}

/** One admission through the major-background gate; release is idempotent. */
export interface PaidGuildBackgroundPermit {
  release(): void;
}

/** FIFO wait on the realm's ONE major-background database gate. Null means
 * the signal fired before a permit was granted. */
export type PaidGuildAcquireBackgroundPermit = (
  signal?: AbortSignal,
) => Promise<PaidGuildBackgroundPermit | null>;

// Paid guild creation checks out pool clients for background-shaped work (the
// atomic create rides the character-save FIFO; receipt reconciliation is
// retryable), so its checkouts must count against the SAME realm-wide
// major-producer gate as autosave, storage recovery, and market escrow.
// Ungated, its in-flight cap (2) stacked ON TOP of the gate's permits and the
// composition arithmetic exceeded the pool at peak. The gate instance lives in
// server/main.ts; game.ts builds the deps, so main.ts registers the acquirer
// here at boot (the configure*Runtime idiom). Unit worlds that construct deps
// directly may inject deps.acquireBackgroundPermit instead; with NEITHER
// present, checkouts proceed ungated (DB-mocked worlds only, never production).
let registeredAcquireBackgroundPermit: PaidGuildAcquireBackgroundPermit | null = null;

export function configurePaidGuildCreateBackgroundGate(
  acquire: PaidGuildAcquireBackgroundPermit | null,
): void {
  registeredAcquireBackgroundPermit = acquire;
}

/** Bound on the background-permit wait. The create job's FIFO queue timeout
 * is cleared the moment the queued closure starts (paid_guild_creation.ts),
 * so an unbounded gate wait here would pin the character's save-FIFO slot
 * forever under a saturated gate; the sibling escrow path bounds the same
 * wait (main.ts WOC_ESCROW_BACKGROUND_PERMIT_WAIT_MS) at the same value. */
export const PAID_GUILD_BACKGROUND_PERMIT_WAIT_MS = 15_000;
export const PAID_GUILD_RECEIPT_RECONCILE_ATTEMPTS = 3;
export const PAID_GUILD_RECEIPT_RECONCILE_QUERY_TIMEOUT_MS = 500;
/** Minimum reconcile budget worth opening a transaction for. The 500ms
 * deadline is stamped BEFORE the pool checkout, which under load can eat
 * almost all of it; below this floor a BEGIN would only buy a doomed
 * few-millisecond SELECT, and three such attempts would convert pure pool
 * contention into a definitive "no receipt" for a founder who was already
 * charged. Such an attempt is a retryable acquisition failure instead. */
export const PAID_GUILD_RECEIPT_MIN_BUDGET_MS = 50;
export const PAID_GUILD_RECEIPT_SERVER_TIMEOUT_MAX_MS = 400;
export const PAID_GUILD_RECEIPT_CLEANUP_MARGIN_MS = 25;
export const PAID_GUILD_RECEIPT_RECONCILE_BACKOFF_MS = 25;

export interface PaidGuildCreateFee {
  /** Stable command identity, allocated once for this request. */
  readonly batchKey: string;
  /** Positive copper the guild gate reported charging. */
  readonly chargedCopper: number;
  /** Independently measured signed purse movement, normally -chargedCopper. */
  readonly purseCopperDelta: number;
}

/** Caller bug after a live purse mutation. A mismatched measurement is not a
 *  normal refusal and must not be compensated from only one side of the mismatch. */
export class PaidGuildCreateFeeInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaidGuildCreateFeeInvariantError';
  }
}

export interface PaidGuildCreateArgs {
  /** Already validated and normalized by the social service. */
  readonly name: string;
  readonly characterId: number;
  readonly accountId: number;
  readonly level: number;
  /** Exact post-charge character snapshot captured inside the save FIFO. */
  readonly state: CharacterState;
  /** Required: a paid guild may never use the unfenced save arm. */
  readonly leaseNonce: string;
  /** Exact already-captured prefix, not a later view of either queue. */
  readonly storageEffects: readonly StorageAppliedEffect[];
  readonly ledgerEffects: BankLedgerSaveEffects | undefined;
  readonly fee: PaidGuildCreateFee;
  readonly signal?: AbortSignal;
}

export interface PaidGuildCreateDeps {
  readonly pool: PaidGuildCreateDbPool;
  /** Overrides the module-registered gate acquirer (unit worlds). Production
   * wiring goes through configurePaidGuildCreateBackgroundGate in main.ts. */
  readonly acquireBackgroundPermit?: PaidGuildAcquireBackgroundPermit;
  /** Overrides the pool-derived deadline canceller: production wires db.ts's
   * dedicated side-pool hook so an expiry cancel never rides the saturated
   * main pool it exists to relieve. */
  readonly cancelBackend?: (processId: number) => Promise<void>;
  /** PgSocialDb owns this instance-local cache, so its owner supplies the bust. */
  readonly bustGuildRoster: (guildId: number) => void;
  /** Cache invalidation must not replace a known durability result. */
  readonly onCacheBustError?: (error: unknown, guildId: number) => void;
  /** Transaction cleanup failures are operational, never a new durability verdict. */
  readonly onCleanupError?: (error: unknown) => void;
}

export type PaidGuildCreateNotCommittedReason =
  | 'name_taken'
  | 'already_in_guild'
  | 'lease_lost'
  | 'database_error';

export type PaidGuildCreateResult =
  | {
      readonly durability: 'committed';
      readonly guildId: number;
      readonly feeBatchKey: string;
    }
  | {
      readonly durability: 'not_committed';
      readonly reason: Exclude<PaidGuildCreateNotCommittedReason, 'database_error'>;
    }
  | {
      readonly durability: 'not_committed';
      readonly reason: 'database_error';
      readonly error: unknown;
    }
  | {
      readonly durability: 'commit_ambiguous';
      readonly guildId: number;
      readonly feeBatchKey: string;
      readonly error: unknown;
    };

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}

interface PreparedPaidGuildCreateArgs extends PaidGuildCreateArgs {
  readonly storageEffects: readonly Readonly<StorageAppliedEffect>[];
  readonly fee: Readonly<PaidGuildCreateFee>;
}

function reportCleanupError(deps: PaidGuildCreateDeps, error: unknown): void {
  if (deps.onCleanupError) {
    try {
      deps.onCleanupError(error);
      return;
    } catch {
      // The original transaction outcome remains authoritative.
    }
  }
  try {
    console.error('paid guild transaction cleanup failed:', error);
  } catch {
    // A diagnostic sink is never part of the durability decision.
  }
}

/** Tie the gate permit's lifetime to the pool client's: whichever path
 * releases the client (deadline destruction included) frees the permit too,
 * and permit release is idempotent so double-release paths stay safe. */
function clientWithPermit(
  client: PaidGuildCreateDbClient,
  permit: PaidGuildBackgroundPermit,
): PaidGuildCreateDbClient {
  return {
    query: (text: string, values?: unknown[]) => client.query(text, values),
    release: (error?: Error | boolean) => {
      try {
        if (error === undefined) client.release();
        else client.release(error);
      } finally {
        permit.release();
      }
    },
    on: (event: 'error', listener: (error: Error) => void) => client.on(event, listener),
    removeListener: (event: 'error', listener: (error: Error) => void) =>
      client.removeListener(event, listener),
    processID: client.processID,
  } as PaidGuildCreateDbClient;
}

/**
 * Gate-then-checkout: a major-background permit is acquired BEFORE the pool
 * checkout so paid guild creation composes under the realm's one background
 * gate instead of stacking its own cap on top of it. A null permit (the
 * caller's signal fired while queued on the gate) is the same prompt abort a
 * cancelled checkout answers. On the abort-while-queued checkout path the
 * permit releases with the rejection; the eventual client is destroyed in the
 * background and returns to the pool on arrival.
 */
async function acquirePaidGuildCreateClient(
  deps: PaidGuildCreateDeps,
  signal: AbortSignal | undefined,
  operation = 'paid guild create',
): Promise<PaidGuildCreateDbClient> {
  const acquirePermit = deps.acquireBackgroundPermit ?? registeredAcquireBackgroundPermit;
  if (!acquirePermit) return acquirePaidGuildCreateCheckout(deps, signal, operation);
  // Bounded wait: the caller's signal may never fire once the queued create
  // job has started (its queue timeout is already cleared), so compose it
  // with a timer-backed abort. A null permit is the ordinary prompt refusal.
  const waitController = new AbortController();
  const waitTimer = setTimeout(() => waitController.abort(), PAID_GUILD_BACKGROUND_PERMIT_WAIT_MS);
  waitTimer.unref();
  let permit: PaidGuildBackgroundPermit | null;
  try {
    permit = await acquirePermit(
      signal ? AbortSignal.any([signal, waitController.signal]) : waitController.signal,
    );
  } finally {
    clearTimeout(waitTimer);
  }
  if (!permit) throw new DbTransactionAborted(operation, false);
  let client: PaidGuildCreateDbClient;
  try {
    client = await acquirePaidGuildCreateCheckout(deps, signal, operation);
  } catch (error) {
    permit.release();
    throw error;
  }
  return clientWithPermit(client, permit);
}

/**
 * Pool checkout has no cancellation API. If abort wins while queued, return
 * promptly and destroy the eventual client so a stale waiter cannot borrow it.
 */
function acquirePaidGuildCreateCheckout(
  deps: PaidGuildCreateDeps,
  signal: AbortSignal | undefined,
  operation = 'paid guild create',
): Promise<PaidGuildCreateDbClient> {
  if (!signal) return deps.pool.connect();
  if (signal.aborted) {
    return Promise.reject(new DbTransactionAborted(operation, false));
  }

  let checkout: Promise<PaidGuildCreateDbClient>;
  try {
    checkout = deps.pool.connect();
  } catch (error) {
    return Promise.reject(error);
  }

  return new Promise((resolve, reject) => {
    let state: 'waiting' | 'aborted' | 'settled' = 'waiting';
    let abortError: DbTransactionAborted | null = null;
    const detach = () => signal.removeEventListener('abort', onAbort);
    const onAbort = () => {
      if (state !== 'waiting') return;
      state = 'aborted';
      abortError = new DbTransactionAborted(operation, false);
      detach();
      reject(abortError);
    };

    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();

    void checkout.then(
      (client) => {
        if (state === 'aborted') {
          try {
            client.release(abortError ?? new DbTransactionAborted(operation, false));
          } catch (error) {
            reportCleanupError(deps, error);
          }
          return;
        }
        state = 'settled';
        detach();
        resolve(client);
      },
      (error) => {
        if (state !== 'waiting') return;
        state = 'settled';
        detach();
        reject(error);
      },
    );
  });
}

interface PaidGuildReceiptRow {
  readonly realm: unknown;
  readonly character_id: unknown;
  readonly account_id: unknown;
  readonly row_count: unknown;
  readonly payload_sha256: unknown;
}

/** DbTransactionDeadline owns outcome state, while this adapter makes the
 * driver's cleanup callback observational: a throwing release must be logged,
 * never replace the receipt query's primary result or error. */
function receiptDeadlineClient(
  deps: PaidGuildCreateDeps,
  client: PaidGuildCreateDbClient,
): PaidGuildCreateDbClient {
  return {
    query: (text: string, values?: unknown[]) => client.query(text, values),
    release: (error?: Error | boolean) => {
      try {
        if (error === undefined) client.release();
        else client.release(error);
      } catch (releaseError) {
        reportCleanupError(deps, releaseError);
      }
    },
    on: (event: 'error', listener: (error: Error) => void) => client.on(event, listener),
    removeListener: (event: 'error', listener: (error: Error) => void) =>
      client.removeListener(event, listener),
    processID: client.processID,
  } as PaidGuildCreateDbClient;
}

async function readPaidGuildReceiptOnce(
  deps: PaidGuildCreateDeps,
  batchKey: string,
): Promise<PaidGuildReceiptRow | null> {
  const operation = 'paid guild receipt reconciliation';
  const deadlineAtMs = Date.now() + PAID_GUILD_RECEIPT_RECONCILE_QUERY_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    PAID_GUILD_RECEIPT_RECONCILE_QUERY_TIMEOUT_MS,
  );
  timeout.unref();

  let transaction: ReturnType<typeof createDbTransactionDeadline> | null = null;
  let unownedClient: PaidGuildCreateDbClient | null = null;
  try {
    unownedClient = await acquirePaidGuildCreateClient(deps, controller.signal, operation);
    const client = unownedClient;
    // The checkout may have consumed most of the deadline. Below the minimum
    // useful budget, refuse as a retryable acquisition failure (release the
    // client, let the attempt ladder retry) rather than open a transaction
    // whose SELECT is doomed by construction.
    const transactionBudgetMs = deadlineAtMs - Date.now();
    if (transactionBudgetMs < PAID_GUILD_RECEIPT_MIN_BUDGET_MS) {
      controller.abort();
      const aborted = new DbTransactionAborted(operation, false);
      try {
        // Plain release, never release(error): nothing ran on this client,
        // the only established fact is that the CHECKOUT was slow. A truthy
        // release makes pg-pool destroy the connection, so under contention
        // the three attempts would destroy three healthy connections and
        // force three fresh TCP+auth handshakes into the already contended
        // pool.
        client.release();
      } catch (releaseError) {
        reportCleanupError(deps, releaseError);
      }
      unownedClient = null;
      throw aborted;
    }
    try {
      transaction = createDbTransactionDeadline(receiptDeadlineClient(deps, client), {
        operation,
        timeoutMs: transactionBudgetMs,
        signal: controller.signal,
        cancelBackend:
          deps.cancelBackend ??
          (deps.pool.query
            ? backendCancelViaPool({ query: deps.pool.query.bind(deps.pool) })
            : undefined),
      });
      unownedClient = null;
    } catch (error) {
      try {
        client.release(error instanceof Error ? error : new Error(String(error)));
      } catch (releaseError) {
        reportCleanupError(deps, releaseError);
      }
      unownedClient = null;
      throw error;
    }
    await transaction.query('BEGIN READ ONLY');
    const remainingMs = deadlineAtMs - Date.now();
    if (remainingMs <= PAID_GUILD_RECEIPT_CLEANUP_MARGIN_MS) {
      controller.abort();
      throw new DbTransactionAborted(operation, false);
    }
    const statementBudgetMs = Math.min(
      PAID_GUILD_RECEIPT_SERVER_TIMEOUT_MAX_MS,
      remainingMs - PAID_GUILD_RECEIPT_CLEANUP_MARGIN_MS,
    );
    // The JavaScript deadline bounds checkout plus every round trip. These
    // LOCAL GUCs independently stop a lock-waiting backend even if PostgreSQL
    // has not yet noticed that node-postgres destroyed its frontend socket.
    await transaction.query(
      `SET LOCAL statement_timeout = ${statementBudgetMs}; ` +
        `SET LOCAL lock_timeout = ${statementBudgetMs}; ` +
        `SET LOCAL idle_in_transaction_session_timeout = ${statementBudgetMs}`,
    );
    const result = await transaction.query(
      `SELECT realm, character_id, account_id, row_count, payload_sha256
         FROM bank_ledger_batch_receipts
        WHERE batch_key = $1`,
      [batchKey],
    );
    // No write exists to commit. ROLLBACK ends the snapshot and clears every
    // LOCAL setting; cleanup failure cannot erase the already-known read.
    try {
      await transaction.rollback();
    } catch (error) {
      reportCleanupError(deps, error);
    }
    try {
      transaction.release();
    } catch (error) {
      reportCleanupError(deps, error);
    }
    return (result.rows[0] as PaidGuildReceiptRow | undefined) ?? null;
  } catch (error) {
    if (transaction) await rollbackAndRelease(deps, transaction);
    throw error;
  } finally {
    clearTimeout(timeout);
    if (unownedClient) {
      try {
        unownedClient.release(new DbTransactionAborted(operation, false));
      } catch (error) {
        reportCleanupError(deps, error);
      }
    }
  }
}

async function rollbackAndRelease(
  deps: PaidGuildCreateDeps,
  transaction: Awaited<ReturnType<typeof beginCharacterSaveTx>>,
): Promise<void> {
  try {
    await transaction.rollback();
  } catch (error) {
    reportCleanupError(deps, error);
  }
  try {
    transaction.release();
  } catch (error) {
    reportCleanupError(deps, error);
  }
}

function releaseCommittedTransaction(
  deps: PaidGuildCreateDeps,
  transaction: Awaited<ReturnType<typeof beginCharacterSaveTx>>,
): void {
  try {
    transaction.release();
  } catch (error) {
    // COMMIT already returned. Cleanup cannot demote known durability to
    // ambiguity, but it remains an operator-visible pool incident.
    reportCleanupError(deps, error);
  }
}

function assertImmutableLedgerEffects(effects: BankLedgerSaveEffects | undefined): void {
  if (!effects) return;
  if (!Object.isFrozen(effects.batches)) {
    throw new TypeError('paid guild ledger batch snapshot must be frozen');
  }
  for (const batch of effects.batches) {
    if (!Object.isFrozen(batch) || !Object.isFrozen(batch.rows)) {
      throw new TypeError('paid guild ledger command batches must be immutable');
    }
    for (const row of batch.rows) {
      if (!Object.isFrozen(row)) {
        throw new TypeError('paid guild ledger command rows must be immutable');
      }
    }
    if (batch.guildEffect) {
      if (!Object.isFrozen(batch.guildEffect) || !Object.isFrozen(batch.guildEffect.deltas)) {
        throw new TypeError('paid guild ledger guild effects must be immutable');
      }
      for (const delta of batch.guildEffect.deltas) {
        if (!Object.isFrozen(delta)) {
          throw new TypeError('paid guild ledger guild deltas must be immutable');
        }
      }
    }
  }
}

function prepareArgs(args: PaidGuildCreateArgs): PreparedPaidGuildCreateArgs {
  if (typeof args.name !== 'string' || args.name.length === 0) {
    throw new TypeError('paid guild name must be a non-empty string');
  }
  assertPositiveSafeInteger(args.characterId, 'paid guild characterId');
  assertPositiveSafeInteger(args.accountId, 'paid guild accountId');
  assertPositiveSafeInteger(args.level, 'paid guild level');
  if (typeof args.leaseNonce !== 'string' || args.leaseNonce.length === 0) {
    throw new TypeError('paid guild creation requires a character lease nonce');
  }
  if (!Array.isArray(args.storageEffects)) {
    throw new TypeError('paid guild storage effects must be an array');
  }
  if (args.fee.chargedCopper !== GUILD_CREATION_FEE_COPPER) {
    throw new PaidGuildCreateFeeInvariantError(
      `paid guild charge must be exactly ${GUILD_CREATION_FEE_COPPER} copper`,
    );
  }
  if (args.fee.purseCopperDelta !== -GUILD_CREATION_FEE_COPPER) {
    throw new PaidGuildCreateFeeInvariantError(
      `paid guild purse delta must be exactly ${-GUILD_CREATION_FEE_COPPER} copper`,
    );
  }
  if (args.ledgerEffects) {
    const owner = args.ledgerEffects.owner;
    if (
      owner.realm !== REALM ||
      owner.characterId !== args.characterId ||
      owner.accountId !== args.accountId
    ) {
      throw new Error('paid guild ledger owner does not match the founder');
    }
  }
  if (typeof args.fee.batchKey !== 'string' || args.fee.batchKey.length === 0) {
    throw new TypeError('paid guild fee batch key must be a non-empty string');
  }
  assertImmutableLedgerEffects(args.ledgerEffects);
  const prepared = Object.freeze({
    name: args.name,
    characterId: args.characterId,
    accountId: args.accountId,
    level: args.level,
    state: structuredClone(args.state),
    leaseNonce: args.leaseNonce,
    storageEffects: Object.freeze(
      args.storageEffects.map((effect) => Object.freeze({ ...effect })),
    ),
    ledgerEffects: args.ledgerEffects
      ? Object.freeze({
          owner: Object.freeze({ ...args.ledgerEffects.owner }),
          batches: args.ledgerEffects.batches,
        })
      : undefined,
    fee: Object.freeze({ ...args.fee }),
    signal: args.signal,
  });
  // Validate and isolate the whole save shape before pool checkout. Guild id 1
  // is a throwaway positive correlation id; the transaction rebuilds the fee
  // batch with the id its INSERT returns.
  const ledger = paidGuildLedgerEffects(prepared, 1);
  prepareCharacterSaveEffects(prepared.characterId, prepared.storageEffects, ledger);
  const keys = new Set<string>();
  for (const batch of ledger.batches) {
    if (keys.has(batch.batchKey)) {
      throw new Error(`duplicate bank ledger batch key: ${batch.batchKey}`);
    }
    keys.add(batch.batchKey);
  }
  return prepared;
}

function paidGuildFeeBatch(args: PaidGuildCreateArgs, guildId: number): BankLedgerCommandBatch {
  return serializeBankLedgerCommandBatch(args.fee.batchKey, [
    {
      realm: REALM,
      characterId: args.characterId,
      accountId: args.accountId,
      op: 'create_fee',
      itemId: null,
      count: null,
      instance: null,
      copperDelta: -args.fee.chargedCopper,
      purchasedSlotsAfter: 0,
      container: 'guild',
      containerId: guildId,
      counterpartyCopperDelta: args.fee.purseCopperDelta,
      counterpartyCount: 0,
    },
  ]);
}

function paidGuildLedgerEffects(args: PaidGuildCreateArgs, guildId: number): BankLedgerSaveEffects {
  const feeBatch = paidGuildFeeBatch(args, guildId);
  return Object.freeze({
    owner:
      args.ledgerEffects?.owner ??
      Object.freeze({ realm: REALM, characterId: args.characterId, accountId: args.accountId }),
    batches: Object.freeze([...(args.ledgerEffects?.batches ?? []), feeBatch]),
  });
}

function paidGuildReceiptMatches(
  row: PaidGuildReceiptRow,
  args: PaidGuildCreateArgs,
  expectedPayloadSha256: string,
): boolean {
  return (
    row.realm === REALM &&
    Number(row.character_id) === args.characterId &&
    Number(row.account_id) === args.accountId &&
    Number(row.row_count) === 1 &&
    row.payload_sha256 === expectedPayloadSha256
  );
}

const receiptReconcileBackoff = (attempt: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, PAID_GUILD_RECEIPT_RECONCILE_BACKOFF_MS * attempt));

/** A matching immutable receipt proves the otherwise-lost COMMIT landed. */
async function reconcilePaidGuildReceipt(
  deps: PaidGuildCreateDeps,
  args: PaidGuildCreateArgs,
  guildId: number,
): Promise<boolean> {
  const expectedPayloadSha256 = bankLedgerCommandBatchPayloadSha256(
    paidGuildFeeBatch(args, guildId),
  );
  for (let attempt = 1; attempt <= PAID_GUILD_RECEIPT_RECONCILE_ATTEMPTS; attempt++) {
    try {
      const row = await readPaidGuildReceiptOnce(deps, args.fee.batchKey);
      if (row) return paidGuildReceiptMatches(row, args, expectedPayloadSha256);
    } catch {
      // A bounded retry may outlive a pool/socket blip. It never reruns the write.
    }
    if (attempt < PAID_GUILD_RECEIPT_RECONCILE_ATTEMPTS) {
      await receiptReconcileBackoff(attempt);
    }
  }
  return false;
}

async function knownRefusal(
  deps: PaidGuildCreateDeps,
  transaction: Awaited<ReturnType<typeof beginCharacterSaveTx>>,
  reason: Exclude<PaidGuildCreateNotCommittedReason, 'database_error'>,
): Promise<PaidGuildCreateResult> {
  await rollbackAndRelease(deps, transaction);
  return { durability: 'not_committed', reason };
}

function bustGuildCreateCaches(deps: PaidGuildCreateDeps, guildId: number): void {
  const errors: unknown[] = [];
  try {
    bustAdminGuildListReads();
  } catch (error) {
    errors.push(error);
  }
  try {
    deps.bustGuildRoster(guildId);
  } catch (error) {
    errors.push(error);
  }
  for (const error of errors) {
    if (deps.onCacheBustError) {
      try {
        deps.onCacheBustError(error, guildId);
      } catch {
        // Durability is already decided. A diagnostic hook cannot change it.
      }
    } else {
      try {
        console.error(`paid guild ${guildId} cache bust failed:`, error);
      } catch {
        // A diagnostic sink is never part of the durability decision.
      }
    }
  }
}

function uniqueViolation(error: unknown): boolean {
  const pgError = error as { code?: unknown; constraint?: unknown } | null;
  return (
    pgError?.code === '23505' &&
    (pgError.constraint === 'guilds_realm_name' ||
      pgError.constraint === 'guilds_realm_lower_name_guard')
  );
}

function errorProvesCommitDidNotStart(error: unknown): boolean {
  return (
    ((error instanceof DbTransactionAborted || error instanceof DbTransactionDeadlineExceeded) &&
      !error.commitMayHaveSucceeded) ||
    throwProvedRollback(error)
  );
}

/**
 * Create one paid guild without a crash window between durable membership and
 * the founder charge. This function deliberately never retries the whole
 * transaction: a lost COMMIT answer is returned as ambiguity for reconciliation.
 */
export async function createPaidGuildWithLeaderAtomic(
  deps: PaidGuildCreateDeps,
  args: PaidGuildCreateArgs,
): Promise<PaidGuildCreateResult> {
  const input = prepareArgs(args);

  let transaction: Awaited<ReturnType<typeof beginCharacterSaveTx>> | null = null;
  let guildId: number | null = null;
  let commitIssued = false;
  try {
    const client = await acquirePaidGuildCreateClient(deps, input.signal);
    // Same lock-drop story as db.ts's beginSaveTx wrapper: a destroyed socket
    // also cancels the backend so held locks drop early. Production supplies
    // deps.cancelBackend (the dedicated side-pool hook); the pool-derived
    // form is the fallback for narrow test worlds.
    const cancelBackend =
      deps.cancelBackend ??
      (deps.pool.query
        ? backendCancelViaPool({ query: deps.pool.query.bind(deps.pool) })
        : undefined);
    transaction = await beginCharacterSaveTx(
      client,
      'paid guild create',
      input.signal,
      cancelBackend,
    );

    await transaction.query(GUILD_NAME_ADVISORY_LOCK_SQL, [guildNameLockKey(REALM, input.name)]);
    const collision = await transaction.query(GUILD_NAME_COLLISION_SQL, [REALM, input.name, null]);
    if (collision.rows[0]) return knownRefusal(deps, transaction, 'name_taken');

    // The account parent precedes every character child lock in the save-effect
    // hierarchy. The opaque proof also prevents the save helper from taking it twice.
    const accountLock = await lockCharacterSaveAccountParentKeyShareOnClient(
      transaction,
      input.accountId,
    );

    try {
      const guild = await transaction.query(
        'INSERT INTO guilds (name, realm) VALUES ($1, $2) RETURNING id',
        [input.name, REALM],
      );
      guildId = Number(guild.rows[0]?.id);
      assertPositiveSafeInteger(guildId, 'inserted guild id');
    } catch (error) {
      if (uniqueViolation(error)) return knownRefusal(deps, transaction, 'name_taken');
      throw error;
    }

    const leader = await transaction.query(
      `INSERT INTO guild_members (guild_id, character_id, rank) VALUES ($1, $2, 'leader')
       ON CONFLICT (character_id) DO NOTHING`,
      [guildId, input.characterId],
    );
    if ((leader.rowCount ?? 0) === 0) {
      return knownRefusal(deps, transaction, 'already_in_guild');
    }

    const ledgerEffects = paidGuildLedgerEffects(input, guildId);
    // DbTransactionDeadline intentionally exposes the query-only shape this
    // helper uses. The cast bridges db.ts's historical PoolClient annotation;
    // every query still routes through the wall-clock deadline wrapper.
    const saved = await saveCharacterStateOnClient(
      transaction as unknown as PoolClient,
      input.characterId,
      input.level,
      input.state,
      input.leaseNonce,
      input.storageEffects,
      ledgerEffects,
      accountLock,
    );
    if (!saved) return knownRefusal(deps, transaction, 'lease_lost');

    await transaction.query(
      `INSERT INTO guild_banks (guild_id, realm, data)
       VALUES ($1, $2, $3::jsonb)`,
      [guildId, REALM, JSON.stringify(createEmptyGuildBankState())],
    );

    commitIssued = true;
    await transaction.commit();
    releaseCommittedTransaction(deps, transaction);
    bustGuildCreateCaches(deps, guildId);
    return { durability: 'committed', guildId, feeBatchKey: input.fee.batchKey };
  } catch (error) {
    if (transaction) await rollbackAndRelease(deps, transaction);
    const failure =
      error instanceof BankLedgerGrowthLimitExceeded
        ? error
        : (bankLedgerGrowthLimitFromError(error) ?? error);
    if (
      commitIssued &&
      guildId !== null &&
      !(failure instanceof BankLedgerGrowthLimitExceeded) &&
      !errorProvesCommitDidNotStart(failure)
    ) {
      // The rows may already be visible on another connection. Invalidate both
      // positive and negative cache entries, then let reconciliation decide.
      const receiptProvedCommit = await reconcilePaidGuildReceipt(deps, input, guildId);
      bustGuildCreateCaches(deps, guildId);
      if (receiptProvedCommit) {
        return { durability: 'committed', guildId, feeBatchKey: input.fee.batchKey };
      }
      return {
        durability: 'commit_ambiguous',
        guildId,
        feeBatchKey: input.fee.batchKey,
        error: failure,
      };
    }
    return { durability: 'not_committed', reason: 'database_error', error: failure };
  }
}
