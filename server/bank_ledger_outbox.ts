// A pure, bounded staging owner for bank_ledger command batches. The live
// coordinator reserves capacity BEFORE it mutates the Sim, then commits the
// command's immutable rows into this queue. A character save captures one exact
// prefix and acknowledges it only after the state and ledger rows commit in the
// same database transaction.

import type { GuildBankOpDelta } from '../src/sim/guild_bank';
import type { BankLedgerRow } from './db';

export interface BankLedgerOutboxLimits {
  readonly maxRows: number;
  readonly maxEncodedBytes: number;
}

// One account's shared bank/vault/craft guard admits at most its 121-row burst
// plus 4 rows/s, or 241 rows in a 30-second autosave window. This outbox also
// carries guild, storage-purchase, and one-shot lifecycle evidence, so the 2,048
// cap stays intentionally conservative until production mix measurements justify
// shrinking it. It remains a hard per-session fuse. The byte cap independently
// catches unusually large item instances before their object graphs can become
// an unbounded memory queue.
export const BANK_LEDGER_OUTBOX_DEFAULT_SESSION_LIMITS: BankLedgerOutboxLimits = Object.freeze({
  maxRows: 2_048,
  maxEncodedBytes: 2 * 1024 * 1024,
});

// At most 32 row-saturated sessions or 32 byte-saturated sessions can occupy a
// process at once. This is a pressure fuse, not extra throughput: callers must
// refuse a mutation whose reservation cannot fit and let healthy saves release
// committed prefixes. Encoded bytes count the stable batch key, every normalized
// row field, and the serialized instance payload in UTF-8.
export const BANK_LEDGER_OUTBOX_DEFAULT_GLOBAL_LIMITS: BankLedgerOutboxLimits = Object.freeze({
  maxRows: 65_536,
  maxEncodedBytes: 64 * 1024 * 1024,
});

// Matches the existing storage-purchase idempotency-key contract. UUIDs,
// session counters, and colon-scoped domain keys all fit without allowing
// whitespace, control characters, or log/SQL punctuation into receipts.
export const BANK_LEDGER_OUTBOX_BATCH_KEY_MAX_LENGTH = 200;
const BANK_LEDGER_OUTBOX_BATCH_KEY_SHAPE = /^[A-Za-z0-9_.:-]+$/;

export interface BankLedgerOutboxOwner {
  readonly realm: string;
  readonly characterId: number;
  readonly accountId: number;
}

export type BankLedgerOutboxRowInput = Readonly<BankLedgerRow>;

export interface BankLedgerGuildEffectInput {
  readonly guildId: number;
  readonly deltas: readonly GuildBankOpDelta[];
  /** The staff account that ORDERED an operator-attributed command (the admin
   *  purge). Absent/null on every player-target command. The owner check
   *  validates rows against THIS declared value, never against the rows'
   *  own accountId (which would prove only self-consistency). */
  readonly actorAccountId?: number | null;
}

export type SerializedBankLedgerGuildDelta = Readonly<
  Omit<GuildBankOpDelta, 'instance' | 'craftedRecipeId'> & {
    /** Detached JSON, kept beside the command receipt instead of a live Sim object. */
    readonly instanceJson: string | null;
    /** Optional source markers normalize to null so receipt bytes stay canonical. */
    readonly craftedRecipeId: string | null;
  }
>;

export interface SerializedBankLedgerGuildEffect {
  readonly guildId: number;
  readonly deltas: readonly SerializedBankLedgerGuildDelta[];
  /** Normalized operator attribution: null on player-target commands.
   *  Optional so older typed fixtures may omit it; receipt normalization
   *  (serializeBankLedgerGuildEffect) treats omission exactly as null, the
   *  same rule the batch's own guildEffect field follows. */
  readonly actorAccountId?: number | null;
}

export type SerializedBankLedgerOutboxRow = Readonly<
  Omit<BankLedgerRow, 'instance' | 'counterpartyCopperDelta' | 'counterpartyCount'> & {
    /** The detached JSON payload bound to the future jsonb parameter. */
    instanceJson: string | null;
    /** Optional DB columns are normalized so the encoded shape is stable. */
    counterpartyCopperDelta: number | null;
    counterpartyCount: number | null;
  }
>;

export interface BankLedgerCommandBatch {
  readonly batchKey: string;
  readonly rows: readonly SerializedBankLedgerOutboxRow[];
  readonly encodedBytes: number;
  /** One command's durable guild-book replay payload. Older typed fixtures may
   *  omit it; receipt normalization treats omission exactly as null. */
  readonly guildEffect?: SerializedBankLedgerGuildEffect | null;
}

/** Normal command rows belong to the character/outbox account. The sole
 *  cross-account exception is an operator-attributed admin purge: the carrier
 *  character owns the fenced guild-book transaction, while every row in that
 *  command names the staff account that ordered the destructive removal. */
export function bankLedgerBatchMatchesOwner(
  owner: BankLedgerOutboxOwner,
  batch: BankLedgerCommandBatch,
): boolean {
  const sameCharacter = batch.rows.every(
    (row) => row.realm === owner.realm && row.characterId === owner.characterId,
  );
  if (!sameCharacter) return false;
  if (batch.rows.every((row) => row.accountId === owner.accountId)) return true;
  // The staff attribution is the effect's DECLARED actorAccountId, threaded
  // from the admin route through runGuildBankOp; validating rows against
  // rows[0].accountId proved only that the rows agreed with themselves, so a
  // batch forged under any single wrong account passed. A batch whose rows
  // name any other account than the declared actor now refuses.
  const effect = batch.guildEffect;
  const actorAccountId = effect?.actorAccountId ?? null;
  return Boolean(
    effect &&
      actorAccountId !== null &&
      Number.isSafeInteger(actorAccountId) &&
      actorAccountId > 0 &&
      effect.deltas.length > 0 &&
      effect.deltas.every((delta) => delta.op === 'admin_purge') &&
      batch.rows.length === effect.deltas.length &&
      batch.rows.every(
        (row) =>
          row.accountId === actorAccountId &&
          row.op === 'admin_purge' &&
          row.container === 'guild' &&
          row.containerId === effect.guildId,
      ),
  );
}

/**
 * A batch detached by this module. Correlation fields are derived, while the
 * optional guild effect is part of both retained bytes and the receipt hash.
 */
export interface PreparedBankLedgerCommandBatch extends BankLedgerCommandBatch {
  readonly guildEffect: SerializedBankLedgerGuildEffect | null;
  readonly guildIds: readonly number[];
  readonly hasUnscopedRows: boolean;
}

export interface BankLedgerOutboxReservationRequest {
  readonly maxRows: number;
  readonly maxEncodedBytes: number;
  /**
   * A domain idempotency key, such as a storage purchase key. When absent, the
   * outbox calls its injected key factory exactly once for a successful attempt.
   */
  readonly batchKey?: string;
}

export interface BankLedgerOutboxReservation {
  readonly batchKey: string;
  readonly maxRows: number;
  readonly maxEncodedBytes: number;
}

export interface BankLedgerOutboxPreparedReservation extends BankLedgerOutboxReservation {
  readonly batch: PreparedBankLedgerCommandBatch;
}

export interface BankLedgerOutboxUsage {
  readonly queuedRows: number;
  readonly queuedEncodedBytes: number;
  readonly reservedRows: number;
  readonly reservedEncodedBytes: number;
}

export interface BankLedgerOutboxBudgetUsage {
  readonly rows: number;
  readonly encodedBytes: number;
}

export interface BankLedgerOutboxSnapshot {
  readonly owner: BankLedgerOutboxOwner;
  readonly batches: readonly PreparedBankLedgerCommandBatch[];
  readonly rowCount: number;
  readonly encodedBytes: number;
  /** Sorted guild ids mentioned anywhere in this blind exact prefix. */
  readonly guildIds: readonly number[];
  /** True when the prefix also carries personal or vault rows. */
  readonly hasUnscopedRows: boolean;
}

export type BankLedgerBatchKeyFactory = () => string;

interface BudgetState {
  rows: number;
  encodedBytes: number;
}

const budgetStates = new WeakMap<BankLedgerOutboxBudget, BudgetState>();

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}

function assertIntegerOrNull(value: number | null, name: string): void {
  if (value !== null && !Number.isSafeInteger(value)) {
    throw new RangeError(`${name} must be a safe integer or null`);
  }
}

function checkedLimits(limits: BankLedgerOutboxLimits, name: string): BankLedgerOutboxLimits {
  assertPositiveInteger(limits.maxRows, `${name}.maxRows`);
  assertPositiveInteger(limits.maxEncodedBytes, `${name}.maxEncodedBytes`);
  return Object.freeze({
    maxRows: limits.maxRows,
    maxEncodedBytes: limits.maxEncodedBytes,
  });
}

function checkedOwner(owner: BankLedgerOutboxOwner): BankLedgerOutboxOwner {
  if (typeof owner !== 'object' || owner === null) {
    throw new TypeError('bank ledger outbox owner must be an object');
  }
  checkedString(owner.realm, 'owner.realm');
  assertPositiveInteger(owner.characterId, 'owner.characterId');
  assertPositiveInteger(owner.accountId, 'owner.accountId');
  return Object.freeze({
    realm: owner.realm,
    characterId: owner.characterId,
    accountId: owner.accountId,
  });
}

function budgetState(budget: BankLedgerOutboxBudget): BudgetState {
  const state = budgetStates.get(budget);
  if (!state) throw new TypeError('unknown bank ledger outbox budget');
  return state;
}

function budgetCanAcquire(
  budget: BankLedgerOutboxBudget,
  rows: number,
  encodedBytes: number,
): boolean {
  const state = budgetState(budget);
  return (
    state.rows + rows <= budget.limits.maxRows &&
    state.encodedBytes + encodedBytes <= budget.limits.maxEncodedBytes
  );
}

function budgetAcquire(
  budget: BankLedgerOutboxBudget,
  rows: number,
  encodedBytes: number,
): boolean {
  if (!budgetCanAcquire(budget, rows, encodedBytes)) return false;
  const state = budgetState(budget);
  state.rows += rows;
  state.encodedBytes += encodedBytes;
  return true;
}

function budgetRelease(budget: BankLedgerOutboxBudget, rows: number, encodedBytes: number): void {
  assertNonNegativeInteger(rows, 'released rows');
  assertNonNegativeInteger(encodedBytes, 'released encoded bytes');
  const state = budgetState(budget);
  if (rows > state.rows || encodedBytes > state.encodedBytes) {
    throw new Error('bank ledger outbox budget accounting underflow');
  }
  state.rows -= rows;
  state.encodedBytes -= encodedBytes;
}

/**
 * The one budget shared by every live session outbox in a realm process.
 * Its counters are private to this module so callers cannot bypass reservation
 * accounting. Tests and isolated GameServer rigs can construct a smaller one.
 */
export class BankLedgerOutboxBudget {
  readonly limits: BankLedgerOutboxLimits;

  constructor(limits: BankLedgerOutboxLimits = BANK_LEDGER_OUTBOX_DEFAULT_GLOBAL_LIMITS) {
    this.limits = checkedLimits(limits, 'global limits');
    budgetStates.set(this, { rows: 0, encodedBytes: 0 });
  }

  get usage(): BankLedgerOutboxBudgetUsage {
    const state = budgetState(this);
    return Object.freeze({ rows: state.rows, encodedBytes: state.encodedBytes });
  }
}

/** The process-owned production budget. Unit tests should construct their own. */
export const bankLedgerOutboxProcessBudget = new BankLedgerOutboxBudget();

function checkedBatchKey(batchKey: unknown): string {
  if (
    typeof batchKey !== 'string' ||
    batchKey.length === 0 ||
    batchKey.length > BANK_LEDGER_OUTBOX_BATCH_KEY_MAX_LENGTH ||
    !BANK_LEDGER_OUTBOX_BATCH_KEY_SHAPE.test(batchKey)
  ) {
    throw new TypeError(
      `bank ledger batch key must be 1 to ${BANK_LEDGER_OUTBOX_BATCH_KEY_MAX_LENGTH} characters from [A-Za-z0-9_.:-]`,
    );
  }
  return batchKey;
}

function checkedString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
}

function checkedNullableString(value: unknown, name: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new TypeError(`${name} must be a string or null`);
  return value;
}

function serializedInstance(instance: unknown): string | null {
  // Match the existing db writer's `instance == null` boundary exactly: both
  // null and undefined bind as SQL NULL. Other unsupported top-level values
  // still stringify to undefined and fail below.
  if (instance === null || instance === undefined) return null;
  const json = JSON.stringify(instance);
  if (json === undefined) {
    throw new TypeError('bank ledger row instance is not JSON serializable');
  }
  return json;
}

function serializeRow(row: BankLedgerOutboxRowInput): SerializedBankLedgerOutboxRow {
  checkedString(row.realm, 'row.realm');
  assertPositiveInteger(row.characterId, 'row.characterId');
  assertPositiveInteger(row.accountId, 'row.accountId');
  checkedString(row.op, 'row.op');
  checkedNullableString(row.itemId, 'row.itemId');
  assertIntegerOrNull(row.count, 'row.count');
  if (!Number.isSafeInteger(row.copperDelta)) {
    throw new RangeError('row.copperDelta must be a safe integer');
  }
  assertNonNegativeInteger(row.purchasedSlotsAfter, 'row.purchasedSlotsAfter');
  if (row.container !== 'personal' && row.container !== 'guild' && row.container !== 'vault') {
    throw new TypeError('row.container must be personal, guild, or vault');
  }
  if (row.container === 'guild') {
    assertPositiveInteger(row.containerId as number, 'row.containerId');
  } else if (row.containerId !== null) {
    throw new TypeError(`row.containerId must be null for ${row.container}`);
  }
  assertIntegerOrNull(row.counterpartyCopperDelta ?? null, 'row.counterpartyCopperDelta');
  assertIntegerOrNull(row.counterpartyCount ?? null, 'row.counterpartyCount');

  return Object.freeze({
    realm: row.realm,
    characterId: row.characterId,
    accountId: row.accountId,
    op: row.op,
    itemId: row.itemId,
    count: row.count,
    instanceJson: serializedInstance(row.instance),
    copperDelta: row.copperDelta,
    purchasedSlotsAfter: row.purchasedSlotsAfter,
    container: row.container,
    containerId: row.containerId,
    counterpartyCopperDelta: row.counterpartyCopperDelta ?? null,
    counterpartyCount: row.counterpartyCount ?? null,
  });
}

const GUILD_BANK_DELTA_OPS = new Set<GuildBankOpDelta['op']>([
  'deposit_gold',
  'withdraw_gold',
  'deposit',
  'withdraw',
  'buy_slots',
  'open_bank',
  'admin_purge',
]);

const GUILD_LEDGER_ONLY_OPS = new Set(['create_fee', 'escrow_deficit', 'counterparty_orphan']);

function normalizeSerializedRow(row: SerializedBankLedgerOutboxRow): SerializedBankLedgerOutboxRow {
  if (typeof row !== 'object' || row === null) {
    throw new TypeError('bank ledger serialized row must be an object');
  }
  checkedNullableString(row.instanceJson, 'row.instanceJson');
  return serializeRow({
    ...row,
    instance: row.instanceJson === null ? null : JSON.parse(row.instanceJson),
  });
}

function serializeGuildDelta(delta: GuildBankOpDelta): SerializedBankLedgerGuildDelta {
  if (typeof delta !== 'object' || delta === null || !GUILD_BANK_DELTA_OPS.has(delta.op)) {
    throw new TypeError('bank ledger guild delta has an invalid op');
  }
  checkedNullableString(delta.itemId, 'guild delta.itemId');
  assertIntegerOrNull(delta.count, 'guild delta.count');
  checkedNullableString(delta.craftedRecipeId ?? null, 'guild delta.craftedRecipeId');
  if (!Number.isSafeInteger(delta.copperDelta)) {
    throw new RangeError('guild delta.copperDelta must be a safe integer');
  }
  assertNonNegativeInteger(delta.purchasedSlotsBefore, 'guild delta.purchasedSlotsBefore');
  assertNonNegativeInteger(delta.purchasedSlotsAfter, 'guild delta.purchasedSlotsAfter');
  return Object.freeze({
    op: delta.op,
    itemId: delta.itemId,
    count: delta.count,
    instanceJson: serializedInstance(delta.instance),
    craftedRecipeId: delta.craftedRecipeId ?? null,
    copperDelta: delta.copperDelta,
    purchasedSlotsBefore: delta.purchasedSlotsBefore,
    purchasedSlotsAfter: delta.purchasedSlotsAfter,
  });
}

/** Detach one guild effect into the same canonical shape the receipt hashes. */
export function serializeBankLedgerGuildEffect(
  effect: BankLedgerGuildEffectInput | SerializedBankLedgerGuildEffect,
): SerializedBankLedgerGuildEffect {
  if (typeof effect !== 'object' || effect === null) {
    throw new TypeError('bank ledger guild effect must be an object');
  }
  assertPositiveInteger(effect.guildId, 'guild effect.guildId');
  if (!Array.isArray(effect.deltas) || effect.deltas.length === 0) {
    throw new RangeError('bank ledger guild effect must contain at least one delta');
  }
  const deltas = Object.freeze(
    effect.deltas.map((delta) => {
      if ('instanceJson' in delta) {
        const serialized = delta as SerializedBankLedgerGuildDelta;
        checkedNullableString(serialized.instanceJson, 'guild delta.instanceJson');
        return serializeGuildDelta({
          op: serialized.op,
          itemId: serialized.itemId,
          count: serialized.count,
          instance: serialized.instanceJson === null ? null : JSON.parse(serialized.instanceJson),
          craftedRecipeId: serialized.craftedRecipeId,
          copperDelta: serialized.copperDelta,
          purchasedSlotsBefore: serialized.purchasedSlotsBefore,
          purchasedSlotsAfter: serialized.purchasedSlotsAfter,
        });
      }
      return serializeGuildDelta(delta as GuildBankOpDelta);
    }),
  );
  const actorAccountId = effect.actorAccountId ?? null;
  if (actorAccountId !== null && (!Number.isSafeInteger(actorAccountId) || actorAccountId <= 0)) {
    throw new RangeError('guild effect.actorAccountId must be a positive safe integer or null');
  }
  return Object.freeze({ guildId: effect.guildId, deltas, actorAccountId });
}

const utf8Encoder = new TextEncoder();
const preparedBatches = new WeakSet<PreparedBankLedgerCommandBatch>();

function batchCorrelation(rows: readonly SerializedBankLedgerOutboxRow[]): {
  guildIds: readonly number[];
  hasUnscopedRows: boolean;
} {
  const guildIds = new Set<number>();
  let hasUnscopedRows = false;
  for (const row of rows) {
    if (row.container === 'guild') {
      // serializeRow already proved a guild row has a positive id.
      guildIds.add(row.containerId as number);
    } else {
      hasUnscopedRows = true;
    }
  }
  if (guildIds.size > 1) {
    throw new Error('one bank ledger command batch cannot span multiple guilds');
  }
  return {
    guildIds: Object.freeze([...guildIds].sort((a, b) => a - b)),
    hasUnscopedRows,
  };
}

function assertGuildEffectCorrelation(
  rows: readonly SerializedBankLedgerOutboxRow[],
  guildEffect: SerializedBankLedgerGuildEffect | null,
): void {
  const ordinaryGuildRows = rows.filter(
    (row) => row.container === 'guild' && !GUILD_LEDGER_ONLY_OPS.has(row.op),
  );
  if (!guildEffect) {
    if (ordinaryGuildRows.length > 0) {
      throw new Error('a guild bank mutation row requires a matching guild effect');
    }
    return;
  }
  if (ordinaryGuildRows.length !== guildEffect.deltas.length) {
    throw new Error('bank ledger guild effect does not match its mutation rows');
  }
  for (let index = 0; index < guildEffect.deltas.length; index++) {
    const row = ordinaryGuildRows[index];
    const delta = guildEffect.deltas[index];
    if (
      row.containerId !== guildEffect.guildId ||
      row.op !== delta.op ||
      row.itemId !== delta.itemId ||
      row.count !== delta.count ||
      row.instanceJson !== delta.instanceJson ||
      row.copperDelta !== delta.copperDelta ||
      row.purchasedSlotsAfter !== delta.purchasedSlotsAfter
    ) {
      throw new Error(`bank ledger guild effect delta ${index} does not match its ledger row`);
    }
  }
}

/** Canonical receipt payload. This revalidates hand-built fixtures and makes
 *  object insertion order irrelevant without trusting encodedBytes. */
export function bankLedgerCommandBatchFingerprintJson(batch: BankLedgerCommandBatch): string {
  const batchKey = checkedBatchKey(batch.batchKey);
  if (!Array.isArray(batch.rows) || batch.rows.length === 0) {
    throw new RangeError(`bank ledger batch ${batchKey} must contain at least one row`);
  }
  const rows = Object.freeze(batch.rows.map(normalizeSerializedRow));
  const guildEffect = batch.guildEffect ? serializeBankLedgerGuildEffect(batch.guildEffect) : null;
  batchCorrelation(rows);
  assertGuildEffectCorrelation(rows, guildEffect);
  return JSON.stringify({ batchKey, rows, guildEffect });
}

/**
 * Detach one logical command from all caller-owned objects and measure the
 * exact UTF-8 JSON shape retained by this outbox. Array order is durable order.
 */
export function serializeBankLedgerCommandBatch(
  batchKey: string,
  rows: readonly BankLedgerOutboxRowInput[],
  guildEffect?: BankLedgerGuildEffectInput | null,
): PreparedBankLedgerCommandBatch {
  const checkedKey = checkedBatchKey(batchKey);
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new RangeError('bank ledger command batch must contain at least one row');
  }
  const serializedRows = Object.freeze(rows.map(serializeRow));
  const correlation = batchCorrelation(serializedRows);
  const serializedGuildEffect = guildEffect ? serializeBankLedgerGuildEffect(guildEffect) : null;
  assertGuildEffectCorrelation(serializedRows, serializedGuildEffect);
  const encodedBytes = utf8Encoder.encode(
    JSON.stringify({
      batchKey: checkedKey,
      rows: serializedRows,
      guildEffect: serializedGuildEffect,
    }),
  ).byteLength;
  const batch = Object.freeze({
    batchKey: checkedKey,
    rows: serializedRows,
    encodedBytes,
    guildEffect: serializedGuildEffect,
    guildIds: correlation.guildIds,
    hasUnscopedRows: correlation.hasUnscopedRows,
  });
  preparedBatches.add(batch);
  return batch;
}

interface ReservationState {
  readonly batchKey: string;
  readonly maxRows: number;
  readonly maxEncodedBytes: number;
  readonly preparedBatch?: PreparedBankLedgerCommandBatch;
}

interface SnapshotState {
  readonly batches: readonly PreparedBankLedgerCommandBatch[];
  consumed: boolean;
}

export interface BankLedgerOutboxOptions {
  readonly owner: BankLedgerOutboxOwner;
  readonly budget?: BankLedgerOutboxBudget;
  readonly limits?: BankLedgerOutboxLimits;
  /** No Date.now or randomness lives here. The host owns stable key allocation. */
  readonly nextBatchKey?: BankLedgerBatchKeyFactory;
}

export class BankLedgerOutbox {
  readonly owner: BankLedgerOutboxOwner;
  readonly limits: BankLedgerOutboxLimits;

  private readonly budget: BankLedgerOutboxBudget;
  private readonly nextBatchKey: BankLedgerBatchKeyFactory | undefined;
  private readonly reservations = new Map<BankLedgerOutboxReservation, ReservationState>();
  private readonly pendingKeys = new Set<string>();
  private readonly snapshotStates = new WeakMap<BankLedgerOutboxSnapshot, SnapshotState>();
  private readonly batches: PreparedBankLedgerCommandBatch[] = [];
  private queuedRows = 0;
  private queuedEncodedBytes = 0;
  private queuedGuildBatches = 0;
  private reservedRows = 0;
  private reservedEncodedBytes = 0;
  private closed = false;

  constructor(options: BankLedgerOutboxOptions) {
    this.owner = checkedOwner(options.owner);
    this.budget = options.budget ?? bankLedgerOutboxProcessBudget;
    this.limits = checkedLimits(
      options.limits ?? BANK_LEDGER_OUTBOX_DEFAULT_SESSION_LIMITS,
      'session limits',
    );
    this.nextBatchKey = options.nextBatchKey;
  }

  get usage(): BankLedgerOutboxUsage {
    return Object.freeze({
      queuedRows: this.queuedRows,
      queuedEncodedBytes: this.queuedEncodedBytes,
      reservedRows: this.reservedRows,
      reservedEncodedBytes: this.reservedEncodedBytes,
    });
  }

  get discarded(): boolean {
    return this.closed;
  }

  get hasPending(): boolean {
    return this.queuedRows > 0 || this.reservedRows > 0;
  }

  /** O(1) custody guard: a character-only save must not split any queued
   *  guild row from the matching guild-book transaction. */
  get hasQueuedGuildRows(): boolean {
    return this.queuedGuildBatches > 0;
  }

  /**
   * Acquire both the session and process budgets before a gameplay mutation.
   * A capacity refusal is null. Invalid arguments and broken key allocation are
   * programmer errors and throw without changing any counter.
   */
  tryReserve(request: BankLedgerOutboxReservationRequest): BankLedgerOutboxReservation | null {
    this.assertOpen();
    assertPositiveInteger(request.maxRows, 'reservation.maxRows');
    assertPositiveInteger(request.maxEncodedBytes, 'reservation.maxEncodedBytes');
    if (
      this.queuedRows + this.reservedRows + request.maxRows > this.limits.maxRows ||
      this.queuedEncodedBytes + this.reservedEncodedBytes + request.maxEncodedBytes >
        this.limits.maxEncodedBytes
    ) {
      return null;
    }
    if (!budgetCanAcquire(this.budget, request.maxRows, request.maxEncodedBytes)) return null;

    const generated = request.batchKey ?? this.nextBatchKey?.();
    if (generated === undefined) {
      throw new TypeError('bank ledger reservation needs a batch key or injected key factory');
    }
    const batchKey = checkedBatchKey(generated);
    if (this.pendingKeys.has(batchKey)) {
      throw new Error(`duplicate bank ledger batch key: ${batchKey}`);
    }
    // There is no await or user callback between the capacity probe and this
    // acquisition. Keeping the acquire fallible also protects future reuse.
    if (!budgetAcquire(this.budget, request.maxRows, request.maxEncodedBytes)) return null;

    const reservation = Object.freeze({
      batchKey,
      maxRows: request.maxRows,
      maxEncodedBytes: request.maxEncodedBytes,
    });
    this.reservations.set(reservation, reservation);
    this.pendingKeys.add(batchKey);
    this.reservedRows += request.maxRows;
    this.reservedEncodedBytes += request.maxEncodedBytes;
    return reservation;
  }

  /**
   * Reserve the exact cost of a module-prepared batch before gameplay changes.
   * All serialization, ownership, correlation, and size work finishes in this
   * call. commitPrepared is then an accounting-only post-mutation transition.
   */
  tryReservePrepared(
    batch: PreparedBankLedgerCommandBatch,
  ): BankLedgerOutboxPreparedReservation | null {
    this.assertOpen();
    if (!preparedBatches.has(batch)) {
      throw new TypeError('bank ledger batch must be module-prepared');
    }
    this.assertBatchOwner(batch);
    if (this.pendingKeys.has(batch.batchKey)) {
      throw new Error(`duplicate bank ledger batch key: ${batch.batchKey}`);
    }
    if (
      this.queuedRows + this.reservedRows + batch.rows.length > this.limits.maxRows ||
      this.queuedEncodedBytes + this.reservedEncodedBytes + batch.encodedBytes >
        this.limits.maxEncodedBytes
    ) {
      return null;
    }
    if (!budgetAcquire(this.budget, batch.rows.length, batch.encodedBytes)) return null;

    const reservation = Object.freeze({
      batchKey: batch.batchKey,
      maxRows: batch.rows.length,
      maxEncodedBytes: batch.encodedBytes,
      batch,
    });
    this.reservations.set(reservation, {
      batchKey: batch.batchKey,
      maxRows: batch.rows.length,
      maxEncodedBytes: batch.encodedBytes,
      preparedBatch: batch,
    });
    this.pendingKeys.add(batch.batchKey);
    this.reservedRows += batch.rows.length;
    this.reservedEncodedBytes += batch.encodedBytes;
    return reservation;
  }

  /** Release an unused reservation when the guarded mutation did not happen,
   *  or when its evidence committed through a separate direct transaction and
   *  must not also enter this outbox. Unknown durability must retain it. */
  cancel(reservation: BankLedgerOutboxReservation): boolean {
    if (this.closed) return false;
    const state = this.reservations.get(reservation);
    if (!state) return false;
    this.reservations.delete(reservation);
    this.pendingKeys.delete(state.batchKey);
    this.reservedRows -= state.maxRows;
    this.reservedEncodedBytes -= state.maxEncodedBytes;
    budgetRelease(this.budget, state.maxRows, state.maxEncodedBytes);
    return true;
  }

  /**
   * Convert one live reservation into one immutable all-rows-or-none command
   * batch. A failed validation leaves the reservation active so no capacity is
   * silently freed after a caller may already have mutated gameplay state.
   */
  commit(
    reservation: BankLedgerOutboxReservation,
    rows: readonly BankLedgerOutboxRowInput[],
    guildEffect?: BankLedgerGuildEffectInput | null,
  ): PreparedBankLedgerCommandBatch {
    this.assertOpen();
    const state = this.reservations.get(reservation);
    if (!state) throw new Error('inactive bank ledger outbox reservation');
    if (state.preparedBatch) {
      throw new Error('prepared bank ledger reservation must use commitPrepared');
    }
    const batch = serializeBankLedgerCommandBatch(state.batchKey, rows, guildEffect);
    this.assertBatchOwner(batch);
    if (batch.rows.length > state.maxRows) {
      throw new RangeError('bank ledger batch exceeds its reserved row limit');
    }
    if (batch.encodedBytes > state.maxEncodedBytes) {
      throw new RangeError('bank ledger batch exceeds its reserved byte limit');
    }

    return this.finishCommit(reservation, state, batch);
  }

  /** Commit an exact reservation without serialization or size validation. */
  commitPrepared(reservation: BankLedgerOutboxPreparedReservation): PreparedBankLedgerCommandBatch {
    this.assertOpen();
    const state = this.reservations.get(reservation);
    if (!state) throw new Error('inactive bank ledger outbox reservation');
    if (!state.preparedBatch || state.preparedBatch !== reservation.batch) {
      throw new Error('bank ledger reservation has no prepared batch');
    }
    return this.finishCommit(reservation, state, state.preparedBatch);
  }

  /** Capture all committed work currently queued, never live reservations. */
  snapshot(): BankLedgerOutboxSnapshot {
    this.assertOpen();
    const batches = Object.freeze(this.batches.slice());
    const guildIds = new Set<number>();
    let hasUnscopedRows = false;
    for (const batch of batches) {
      for (const guildId of batch.guildIds) guildIds.add(guildId);
      hasUnscopedRows ||= batch.hasUnscopedRows;
    }
    const snapshot = Object.freeze({
      owner: this.owner,
      batches,
      rowCount: this.queuedRows,
      encodedBytes: this.queuedEncodedBytes,
      guildIds: Object.freeze([...guildIds].sort((a, b) => a - b)),
      hasUnscopedRows,
    });
    this.snapshotStates.set(snapshot, { batches, consumed: false });
    return snapshot;
  }

  /**
   * Splice only the exact object prefix this outbox captured. Appends made while
   * a save was in flight remain queued. A stale, overlapping, forged, or already
   * acknowledged snapshot is a no-op.
   */
  acknowledge(snapshot: BankLedgerOutboxSnapshot): boolean {
    if (!this.canAcknowledge(snapshot)) return false;
    const state = this.snapshotStates.get(snapshot);
    if (!state) return false;
    state.consumed = true;

    this.spliceHead(state.batches);
    return true;
  }

  /** Advance only durable leading commands after a later transaction failure.
   *  The exact batch objects must be the head of both this live snapshot and
   *  the queue, so a copied or reordered claim cannot release capacity. */
  acknowledgeCommittedPrefix(
    snapshot: BankLedgerOutboxSnapshot,
    batches: readonly BankLedgerCommandBatch[],
  ): boolean {
    if (batches.length === 0 || this.closed) return false;
    const state = this.snapshotStates.get(snapshot);
    if (!state || state.consumed || batches.length > state.batches.length) return false;
    for (let index = 0; index < batches.length; index++) {
      if (batches[index] !== state.batches[index] || this.batches[index] !== batches[index]) {
        return false;
      }
    }
    state.consumed = true;
    this.spliceHead(batches as readonly PreparedBankLedgerCommandBatch[]);
    return true;
  }

  /** Query-only half of acknowledge, used when several committed effect
   *  queues must advance all-or-none. It accepts only an exact live snapshot
   *  object whose immutable batch prefix is still at the queue head. */
  canAcknowledge(snapshot: BankLedgerOutboxSnapshot): boolean {
    if (this.closed) return false;
    const state = this.snapshotStates.get(snapshot);
    if (!state || state.consumed || state.batches.length > this.batches.length) return false;
    for (let index = 0; index < state.batches.length; index++) {
      if (this.batches[index] !== state.batches[index]) return false;
    }
    return true;
  }

  /**
   * Session teardown abandons all unsaved work and every unused reservation.
   * The outbox closes permanently so stale callbacks cannot spend released
   * process capacity. Repeated discard calls are safe.
   */
  discard(): void {
    if (this.closed) return;
    const rows = this.queuedRows + this.reservedRows;
    const encodedBytes = this.queuedEncodedBytes + this.reservedEncodedBytes;
    this.closed = true;
    this.batches.length = 0;
    this.reservations.clear();
    this.pendingKeys.clear();
    this.queuedRows = 0;
    this.queuedEncodedBytes = 0;
    this.queuedGuildBatches = 0;
    this.reservedRows = 0;
    this.reservedEncodedBytes = 0;
    budgetRelease(this.budget, rows, encodedBytes);
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('bank ledger outbox was discarded');
  }

  private assertBatchOwner(batch: BankLedgerCommandBatch): void {
    if (!bankLedgerBatchMatchesOwner(this.owner, batch)) {
      throw new Error(`bank ledger batch ${batch.batchKey} does not match outbox owner`);
    }
  }

  private finishCommit(
    reservation: BankLedgerOutboxReservation,
    state: ReservationState,
    batch: PreparedBankLedgerCommandBatch,
  ): PreparedBankLedgerCommandBatch {
    this.reservations.delete(reservation);
    this.reservedRows -= state.maxRows;
    this.reservedEncodedBytes -= state.maxEncodedBytes;
    this.queuedRows += batch.rows.length;
    this.queuedEncodedBytes += batch.encodedBytes;
    if (batch.guildIds.length > 0) this.queuedGuildBatches += 1;
    this.batches.push(batch);

    // The full maximum was acquired by tryReserve. Only the unused tail is
    // released here, so the actual queued batch remains charged exactly once.
    budgetRelease(
      this.budget,
      state.maxRows - batch.rows.length,
      state.maxEncodedBytes - batch.encodedBytes,
    );
    return batch;
  }

  private spliceHead(batches: readonly PreparedBankLedgerCommandBatch[]): void {
    let rows = 0;
    let encodedBytes = 0;
    for (const batch of batches) {
      rows += batch.rows.length;
      encodedBytes += batch.encodedBytes;
      if (batch.guildIds.length > 0) this.queuedGuildBatches -= 1;
      this.pendingKeys.delete(batch.batchKey);
    }
    this.batches.splice(0, batches.length);
    this.queuedRows -= rows;
    this.queuedEncodedBytes -= encodedBytes;
    budgetRelease(this.budget, rows, encodedBytes);
  }
}
