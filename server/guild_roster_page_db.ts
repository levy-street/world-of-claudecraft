// Atomic guild roster page purchase (docs/prd/guild-roster-expansion.md, "Who
// pays, and from where"). The buyer's already-charged character state, the
// page itself (a compare-and-set on guilds.roster_pages), and a receipt row
// commit together or not at all, inside one lease-fenced character-save
// transaction: the sibling of server/guild_create_db.ts at roster scale.
//
// Why one transaction: the first cut charged the live purse, wrote the page
// with the pool, and persisted the purse through a LATER character save. A
// crash, a lease takeover, or a fenced-out save between those two writes
// left a page bought and never paid for, and a lost database answer after
// COMMIT was refunded as if the page had not landed. Here the purse and the
// page share one COMMIT, and a lost COMMIT answer is returned as
// 'commit_ambiguous' for the receipt to decide (reconcileReceipt), never as a
// refusal the caller would compensate.
//
// The receipt table is bounded by construction (one row per page, at most
// GUILD_ROSTER_MAX_PAGES per guild, cascading with the guild), so it needs
// no retention sweep.

import type { PoolClient } from 'pg';
import type { CharacterState } from '../src/sim/character_state';
import { GUILD_ROSTER_MAX_PAGES } from '../src/sim/guild_roster';
import { bustAdminGuildListReads } from './admin_guilds_read';
import {
  type BankLedgerSaveEffects,
  lockCharacterSaveAccountParentKeyShareOnClient,
} from './bank_ledger_save_effects_db';
import { beginCharacterSaveTx } from './character_save_transaction';
import { saveCharacterStateOnClient } from './db';
import {
  backendCancelViaPool,
  DbTransactionAborted,
  type DbTransactionDeadline,
  type DbTransactionDeadlineClient,
  DbTransactionDeadlineExceeded,
} from './db_transaction_deadline';
import {
  acquirePaidGuildCreateClient,
  type PaidGuildCreateDeps,
  readReceiptRowOnce,
} from './guild_create_db';
import { throwProvedRollback } from './pg_rollback_proof';
import type { StorageAppliedEffect } from './storage_purchase_db';

/** How many times a lost COMMIT answer is checked against the receipt table
 *  before the purchase is declared ambiguous, and the backoff between checks.
 *  The paid guild create's figures: a receipt written by a COMMIT the server
 *  did process is visible on another connection at once, so three short
 *  looks bound the wait without turning contention into a false "no". Each
 *  look is the paid guild create's gated, deadline-cancelled point read
 *  (readReceiptRowOnce), so a slow database never accumulates reads. */
export const GUILD_ROSTER_RECEIPT_RECONCILE_ATTEMPTS = 3;
export const GUILD_ROSTER_RECEIPT_RECONCILE_BACKOFF_MS = 25;
export const GUILD_ROSTER_RECEIPT_RECONCILE_OPERATION = 'guild roster receipt reconciliation';

export interface GuildRosterPageDbPool {
  connect(): Promise<DbTransactionDeadlineClient>;
  query(sql: string, values: unknown[]): Promise<{ rows: unknown[] }>;
}

/** The paid guild create's deps shape (the checkout rides its gate), with
 *  the reconcile read's pool query made mandatory. */
export interface GuildRosterPageDeps extends Omit<PaidGuildCreateDeps, 'pool'> {
  readonly pool: GuildRosterPageDbPool;
}

export interface GuildRosterPageReceipt {
  /** Stable purchase identity, allocated once per request: the reconcile key. */
  readonly batchKey: string;
  /** The copper the live purse was charged for this page. */
  readonly copper: number;
}

export interface GuildRosterPageArgs {
  readonly guildId: number;
  /** The pages-bought count the caller priced from: the compare-and-set value. */
  readonly expectedPages: number;
  readonly characterId: number;
  readonly accountId: number;
  readonly level: number;
  /** Exact post-charge character snapshot captured inside the save FIFO. */
  readonly state: CharacterState;
  /** Required: a paid page may never use the unfenced save arm. */
  readonly leaseNonce: string;
  readonly storageEffects: readonly StorageAppliedEffect[];
  readonly ledgerEffects: BankLedgerSaveEffects | undefined;
  readonly receipt: GuildRosterPageReceipt;
  readonly signal?: AbortSignal;
}

export type GuildRosterPageRefusal = 'stale' | 'no_guild' | 'lease_lost';

export type GuildRosterPageResult =
  | { readonly durability: 'committed'; readonly pages: number }
  | { readonly durability: 'not_committed'; readonly reason: GuildRosterPageRefusal }
  | {
      readonly durability: 'not_committed';
      readonly reason: 'database_error';
      readonly error: unknown;
    }
  | { readonly durability: 'commit_ambiguous'; readonly error: unknown };

/** The compare-and-set. The page is bought only if the guild still stands at
 *  exactly the count the caller priced from (compared FLOORED, the load path
 *  the price came from, and advanced from the same floor, so a tampered
 *  negative column heals to page one instead of looping through a refused
 *  write), the ladder has a page left, and the buyer is STILL the Guild
 *  Master: a double-click, a second client, or a demotion racing the
 *  purchase misses the write instead of charging twice or expanding on a
 *  stale rank. RETURNING carries the new count for the receipt and the
 *  caller's broadcast. */
export const GUILD_ROSTER_PAGE_CAS_SQL = `UPDATE guilds SET roster_pages = GREATEST(roster_pages, 0) + 1
  WHERE id = $1 AND GREATEST(roster_pages, 0) = $2 AND roster_pages < $3
    AND EXISTS (
      SELECT 1 FROM guild_members
       WHERE guild_id = $1 AND character_id = $4 AND rank = 'leader'
    )
  RETURNING roster_pages`;

export const GUILD_ROSTER_RECEIPT_INSERT_SQL = `INSERT INTO guild_roster_receipts
  (batch_key, guild_id, page, character_id, copper)
  VALUES ($1, $2, $3, $4, $5)`;

export const GUILD_ROSTER_RECEIPT_SELECT_SQL = `SELECT guild_id, page, character_id, copper
  FROM guild_roster_receipts WHERE batch_key = $1`;

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}

function prepareArgs(args: GuildRosterPageArgs): GuildRosterPageArgs {
  assertPositiveSafeInteger(args.guildId, 'guild id');
  assertPositiveSafeInteger(args.characterId, 'character id');
  assertPositiveSafeInteger(args.accountId, 'account id');
  assertPositiveSafeInteger(args.receipt.copper, 'receipt copper');
  if (!Number.isSafeInteger(args.expectedPages) || args.expectedPages < 0) {
    throw new RangeError('expected pages must be a non-negative safe integer');
  }
  if (typeof args.leaseNonce !== 'string' || args.leaseNonce.length === 0) {
    throw new TypeError('a paid roster page needs the session lease nonce');
  }
  if (typeof args.receipt.batchKey !== 'string' || args.receipt.batchKey.length === 0) {
    throw new TypeError('roster page receipt batch key must be a non-empty string');
  }
  // The snapshot is written after awaits the live sim keeps ticking through;
  // a private copy is what makes "the exact post-charge state" true.
  return { ...args, state: structuredClone(args.state), receipt: { ...args.receipt } };
}

function reportCleanupError(deps: GuildRosterPageDeps, error: unknown): void {
  try {
    if (deps.onCleanupError) deps.onCleanupError(error);
    else console.error('guild roster page transaction cleanup failed:', error);
  } catch {
    // A diagnostic sink is never part of the durability decision.
  }
}

async function rollbackAndRelease(
  deps: GuildRosterPageDeps,
  transaction: DbTransactionDeadline,
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

async function knownRefusal(
  deps: GuildRosterPageDeps,
  transaction: DbTransactionDeadline,
  reason: GuildRosterPageRefusal,
): Promise<GuildRosterPageResult> {
  await rollbackAndRelease(deps, transaction);
  return { durability: 'not_committed', reason };
}

function bustCaches(deps: GuildRosterPageDeps, guildId: number): void {
  try {
    deps.bustGuildRoster(guildId);
  } catch (error) {
    reportCleanupError(deps, error);
  }
  try {
    bustAdminGuildListReads();
  } catch (error) {
    reportCleanupError(deps, error);
  }
}

/** The twin of guild_create_db.ts's test: only a deadline that fired before
 *  COMMIT was sent, or a statement-level SQLSTATE from a class that aborts
 *  the transaction, proves the page did not land. Everything else after a
 *  COMMIT was issued (a dead socket, an unknown errno) is ambiguous. */
function errorProvesCommitDidNotStart(error: unknown): boolean {
  return (
    ((error instanceof DbTransactionAborted || error instanceof DbTransactionDeadlineExceeded) &&
      !error.commitMayHaveSucceeded) ||
    throwProvedRollback(error)
  );
}

interface ReceiptRow {
  guild_id: unknown;
  page: unknown;
  character_id: unknown;
  copper: unknown;
}

function receiptMatches(row: ReceiptRow, args: GuildRosterPageArgs): boolean {
  return (
    Number(row.guild_id) === args.guildId &&
    Number(row.character_id) === args.characterId &&
    Number(row.copper) === args.receipt.copper &&
    Number(row.page) === args.expectedPages + 1
  );
}

const backoff = (attempt: number): Promise<void> =>
  new Promise((resolve) =>
    setTimeout(resolve, GUILD_ROSTER_RECEIPT_RECONCILE_BACKOFF_MS * attempt).unref?.(),
  );

/** A matching receipt under the purchase's own key proves the otherwise-lost
 *  COMMIT landed; a row that does not match is treated as no proof. Every
 *  look takes a background permit and is torn down by its own deadline
 *  (socket destroyed, backend cancelled) before the next one starts, so
 *  retries can never stack reads on a struggling pool. */
async function reconcileReceipt(
  deps: GuildRosterPageDeps,
  args: GuildRosterPageArgs,
): Promise<boolean> {
  for (let attempt = 1; attempt <= GUILD_ROSTER_RECEIPT_RECONCILE_ATTEMPTS; attempt += 1) {
    try {
      const row = await readReceiptRowOnce<ReceiptRow>(
        deps as PaidGuildCreateDeps,
        GUILD_ROSTER_RECEIPT_RECONCILE_OPERATION,
        GUILD_ROSTER_RECEIPT_SELECT_SQL,
        [args.receipt.batchKey],
      );
      if (row !== null) return receiptMatches(row, args);
    } catch {
      // A failed or timed-out look is not a "no": the next attempt asks again.
    }
    if (attempt < GUILD_ROSTER_RECEIPT_RECONCILE_ATTEMPTS) await backoff(attempt);
  }
  return false;
}

/**
 * Buy one roster page without a crash window between the durable page and
 * the buyer's charge. Never retries the whole transaction: a lost COMMIT
 * answer is returned as ambiguity for the caller to quarantine, exactly like
 * the paid guild create.
 */
export async function buyGuildRosterPageAtomic(
  deps: GuildRosterPageDeps,
  args: GuildRosterPageArgs,
): Promise<GuildRosterPageResult> {
  const input = prepareArgs(args);
  let transaction: DbTransactionDeadline | null = null;
  let commitIssued = false;
  try {
    // Gate-then-checkout on the realm's one major-background gate (the paid
    // guild create's acquirer, registered by main.ts), abort-aware while
    // queued on the pool: this transaction rides the character save FIFO,
    // so its checkout must count against the same budget as autosaves.
    const client = await acquirePaidGuildCreateClient(
      deps as PaidGuildCreateDeps,
      input.signal,
      'guild roster page',
    );
    const cancelBackend =
      deps.cancelBackend ??
      backendCancelViaPool({ query: (sql, values) => deps.pool.query(sql, values) });
    transaction = await beginCharacterSaveTx(
      client,
      'guild roster page',
      input.signal,
      cancelBackend,
    );

    // The account parent precedes the character child in the save-effect
    // lock hierarchy (accounts, then guilds, then characters here): the same
    // order as every other capped write, so no path can deadlock this one.
    const accountLock = await lockCharacterSaveAccountParentKeyShareOnClient(
      transaction,
      input.accountId,
    );

    const cas = await transaction.query<{ roster_pages: unknown }>(GUILD_ROSTER_PAGE_CAS_SQL, [
      input.guildId,
      input.expectedPages,
      GUILD_ROSTER_MAX_PAGES,
      input.characterId,
    ]);
    if ((cas.rowCount ?? 0) === 0) {
      const exists = await transaction.query('SELECT 1 FROM guilds WHERE id = $1', [input.guildId]);
      return knownRefusal(deps, transaction, (exists.rowCount ?? 0) > 0 ? 'stale' : 'no_guild');
    }
    const pages = Number(cas.rows[0]?.roster_pages);
    assertPositiveSafeInteger(pages, 'bought page count');

    await transaction.query(GUILD_ROSTER_RECEIPT_INSERT_SQL, [
      input.receipt.batchKey,
      input.guildId,
      pages,
      input.characterId,
      input.receipt.copper,
    ]);

    // DbTransactionDeadline exposes the query-only shape the save helper
    // uses; the cast bridges db.ts's historical PoolClient annotation, and
    // every statement still rides the wall-clock deadline wrapper.
    const saved = await saveCharacterStateOnClient(
      transaction as unknown as PoolClient,
      input.characterId,
      input.level,
      input.state,
      input.leaseNonce,
      input.storageEffects,
      input.ledgerEffects,
      accountLock,
    );
    if (!saved) return knownRefusal(deps, transaction, 'lease_lost');

    commitIssued = true;
    await transaction.commit();
    try {
      transaction.release();
    } catch (error) {
      // COMMIT already returned: a pool incident, never a demotion of known
      // durability to ambiguity.
      reportCleanupError(deps, error);
    }
    bustCaches(deps, input.guildId);
    return { durability: 'committed', pages };
  } catch (error) {
    if (transaction) await rollbackAndRelease(deps, transaction);
    if (commitIssued && !errorProvesCommitDidNotStart(error)) {
      // The row may already be visible on another connection: let the
      // receipt decide, and drop both cache polarities either way.
      const proved = await reconcileReceipt(deps, input);
      bustCaches(deps, input.guildId);
      if (proved) return { durability: 'committed', pages: input.expectedPages + 1 };
      return { durability: 'commit_ambiguous', error };
    }
    return { durability: 'not_committed', reason: 'database_error', error };
  }
}
