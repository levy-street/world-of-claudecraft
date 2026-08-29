import { EventEmitter } from 'node:events';
import type { QueryResult, QueryResultRow } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bankLedgerCommandBatchPayloadSha256 } from '../../server/bank_ledger_batch_db';
import {
  BANK_LEDGER_GROWTH_LIMIT_CONSTRAINT,
  BANK_LEDGER_GROWTH_LIMIT_SQLSTATE,
  BankLedgerGrowthLimitExceeded,
} from '../../server/bank_ledger_growth_budget';
import {
  type PreparedBankLedgerCommandBatch,
  serializeBankLedgerCommandBatch,
} from '../../server/bank_ledger_outbox';
import type { BankLedgerSaveEffects } from '../../server/bank_ledger_save_effects_db';
import { REALM } from '../../server/realm';
import type { StorageAppliedEffect } from '../../server/storage_purchase_db';
import type { CharacterState } from '../../src/sim/character_state';
import { GUILD_CREATION_FEE_COPPER } from '../../src/sim/guild_bank';

const mocks = vi.hoisted(() => ({
  events: [] as string[],
  saveCharacterStateOnClient: vi.fn(),
  bustAdminGuildListReads: vi.fn(),
}));

vi.mock('../../server/db', () => ({
  saveCharacterStateOnClient: mocks.saveCharacterStateOnClient,
}));

vi.mock('../../server/admin_guilds_read', () => ({
  bustAdminGuildListReads: mocks.bustAdminGuildListReads,
}));

import { DbTransactionAborted } from '../../server/db_transaction_deadline';
import {
  configurePaidGuildCreateBackgroundGate,
  createPaidGuildWithLeaderAtomic,
  PAID_GUILD_BACKGROUND_PERMIT_WAIT_MS,
  PAID_GUILD_RECEIPT_CLEANUP_MARGIN_MS,
  PAID_GUILD_RECEIPT_MIN_BUDGET_MS,
  PAID_GUILD_RECEIPT_SERVER_TIMEOUT_MAX_MS,
  type PaidGuildCreateArgs,
  type PaidGuildCreateDbClient,
  PaidGuildCreateFeeInvariantError,
} from '../../server/guild_create_db';

const CHARACTER_ID = 41;
const ACCOUNT_ID = 7;
const GUILD_ID = 913;

function state(): CharacterState {
  return {
    level: 23,
    xp: 100,
    copper: 90_000,
    hp: 100,
    resource: 100,
    pos: { x: 1, z: 2 },
    facing: 0,
    equipment: {},
    inventory: [],
    questLog: [],
    questsDone: [],
  } as CharacterState;
}

function existingLedgerBatch(): PreparedBankLedgerCommandBatch {
  return serializeBankLedgerCommandBatch('ledger:existing', [
    {
      realm: REALM,
      characterId: CHARACTER_ID,
      accountId: ACCOUNT_ID,
      op: 'deposit_gold',
      itemId: null,
      count: null,
      instance: null,
      copperDelta: 500,
      purchasedSlotsAfter: 0,
      container: 'personal',
      containerId: null,
      counterpartyCopperDelta: -500,
      counterpartyCount: 0,
    },
  ]);
}

interface FakeClientOptions {
  collision?: boolean;
  guildInsertError?: unknown;
  memberInserted?: boolean;
  failAt?: string;
  failError?: unknown;
  failures?: Readonly<Record<string, unknown>>;
  commitError?: unknown;
  receipt?: Readonly<Record<string, unknown>> | null;
  advanceClockAfterBeginMs?: number;
}

function queryKind(text: string): string {
  if (text === 'BEGIN' || text === 'BEGIN READ ONLY') return 'begin';
  if (text.startsWith('SET LOCAL statement_timeout')) return 'bounds';
  if (text.includes('pg_advisory_xact_lock')) return 'name_lock';
  if (text.includes('FROM guilds') && text.includes('lower(name)')) return 'name_collision';
  if (text.includes('FROM accounts') && text.includes('FOR KEY SHARE')) return 'account_lock';
  if (text.startsWith('INSERT INTO guilds')) return 'guild_insert';
  if (text.startsWith('INSERT INTO guild_members')) return 'leader_insert';
  if (text.startsWith('INSERT INTO guild_banks')) return 'bank_insert';
  if (text.includes('FROM bank_ledger_batch_receipts')) return 'receipt_lookup';
  if (text === 'COMMIT') return 'commit';
  if (text === 'ROLLBACK') return 'rollback';
  return 'other';
}

class FakeClient extends EventEmitter implements PaidGuildCreateDbClient {
  readonly queries: Array<{ kind: string; text: string; values?: unknown[] }> = [];
  readonly release = vi.fn<(error?: Error | boolean) => void>();

  constructor(private readonly options: FakeClientOptions = {}) {
    super();
  }

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>> {
    const result = (rows: QueryResultRow[], rowCount: number): QueryResult<Row> =>
      ({ rows, rowCount }) as unknown as QueryResult<Row>;
    const kind = queryKind(text);
    this.queries.push({ kind, text, values });
    mocks.events.push(kind);
    if (kind === 'begin' && this.options.advanceClockAfterBeginMs !== undefined) {
      vi.setSystemTime(Date.now() + this.options.advanceClockAfterBeginMs);
    }
    if (this.options.failures && kind in this.options.failures) {
      throw this.options.failures[kind];
    }
    if (kind === this.options.failAt) throw this.options.failError ?? new Error(`failed ${kind}`);
    if (kind === 'commit' && this.options.commitError) throw this.options.commitError;
    if (kind === 'name_collision') {
      return result(this.options.collision ? [{ '?column?': 1 }] : [], 0);
    }
    if (kind === 'account_lock') return result([{ id: ACCOUNT_ID }], 1);
    if (kind === 'guild_insert') {
      if (this.options.guildInsertError) throw this.options.guildInsertError;
      return result([{ id: GUILD_ID }], 1);
    }
    if (kind === 'leader_insert') {
      return result([], this.options.memberInserted === false ? 0 : 1);
    }
    if (kind === 'receipt_lookup') {
      return result(
        this.options.receipt ? [this.options.receipt] : [],
        this.options.receipt ? 1 : 0,
      );
    }
    return result([], 1);
  }
}

/** Receipt client whose query stays in flight until destructive release
 *  cancels the underlying connection, matching node-postgres' release(error)
 *  behavior without needing a real socket in the timer-bound unit suite. */
class BlockingReceiptClient extends FakeClient {
  readonly receiptStarted = vi.fn();
  private rejectReceipt: ((error: Error) => void) | null = null;

  constructor() {
    super();
    this.release.mockImplementation((error?: Error | boolean) => {
      if (!(error instanceof Error)) return;
      const reject = this.rejectReceipt;
      this.rejectReceipt = null;
      reject?.(error);
    });
  }

  override async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>> {
    const kind = queryKind(text);
    if (kind !== 'receipt_lookup') return super.query<Row>(text, values);
    this.queries.push({ kind, text, values });
    mocks.events.push(kind);
    this.receiptStarted();
    return new Promise<QueryResult<Row>>((_resolve, reject) => {
      this.rejectReceipt = reject;
    });
  }
}

function feeReceipt(
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  const batch = serializeBankLedgerCommandBatch('ledger:guild-create', [
    {
      realm: REALM,
      characterId: CHARACTER_ID,
      accountId: ACCOUNT_ID,
      op: 'create_fee',
      itemId: null,
      count: null,
      instance: null,
      copperDelta: -GUILD_CREATION_FEE_COPPER,
      purchasedSlotsAfter: 0,
      container: 'guild',
      containerId: GUILD_ID,
      counterpartyCopperDelta: -GUILD_CREATION_FEE_COPPER,
      counterpartyCount: 0,
    },
  ]);
  return {
    realm: REALM,
    character_id: CHARACTER_ID,
    account_id: ACCOUNT_ID,
    row_count: 1,
    payload_sha256: bankLedgerCommandBatchPayloadSha256(batch),
    ...overrides,
  };
}

function args(overrides: Partial<PaidGuildCreateArgs> = {}): PaidGuildCreateArgs {
  const existingBatch = existingLedgerBatch();
  const ledgerEffects: BankLedgerSaveEffects = Object.freeze({
    owner: Object.freeze({ realm: REALM, characterId: CHARACTER_ID, accountId: ACCOUNT_ID }),
    batches: Object.freeze([existingBatch]),
  });
  return {
    name: 'Iron Vanguard',
    characterId: CHARACTER_ID,
    accountId: ACCOUNT_ID,
    level: 23,
    state: state(),
    leaseNonce: 'lease-nonce',
    storageEffects: Object.freeze([
      {
        realm: REALM,
        characterId: CHARACTER_ID,
        accountId: ACCOUNT_ID,
        itemId: 'bank_bag_1',
        expectedCostClaudium: 100,
        idempotencyKey: 'storage:existing',
        spendClaimToken: 'claim',
        purchasedSlotsBefore: 0,
        purchasedSlotsAfter: 1,
      } as StorageAppliedEffect,
    ]),
    ledgerEffects,
    fee: {
      batchKey: 'ledger:guild-create',
      chargedCopper: 10_000,
      purseCopperDelta: -10_000,
    },
    ...overrides,
  };
}

function harness(client: FakeClient, receiptClients: FakeClient[] = []) {
  const checkedOut = [client];
  let checkoutCount = 0;
  const connect = vi.fn(async () => {
    if (checkoutCount++ === 0) return client;
    const receiptClient = receiptClients.shift() ?? new FakeClient();
    checkedOut.push(receiptClient);
    return receiptClient;
  });
  const bustGuildRoster = vi.fn((guildId: number) => {
    mocks.events.push(`roster_bust:${guildId}`);
  });
  return {
    deps: { pool: { connect }, bustGuildRoster },
    connect,
    bustGuildRoster,
    checkedOut,
  };
}

beforeEach(() => {
  mocks.events.length = 0;
  mocks.saveCharacterStateOnClient.mockReset().mockImplementation(async () => {
    mocks.events.push('save');
    return true;
  });
  mocks.bustAdminGuildListReads.mockReset().mockImplementation(() => {
    mocks.events.push('admin_bust');
  });
});

describe('createPaidGuildWithLeaderAtomic', () => {
  it('pins the receipt server ceiling and cleanup margin', () => {
    expect(PAID_GUILD_RECEIPT_SERVER_TIMEOUT_MAX_MS).toBe(400);
    expect(PAID_GUILD_RECEIPT_CLEANUP_MARGIN_MS).toBe(25);
  });

  it('delegates one bounded transaction with the exact fee batch and carried snapshots', async () => {
    const client = new FakeClient();
    const { deps, connect, bustGuildRoster } = harness(client);
    const input = args();
    const existingBatch = input.ledgerEffects?.batches[0];

    const result = await createPaidGuildWithLeaderAtomic(deps, input);

    expect(result).toEqual({
      durability: 'committed',
      guildId: GUILD_ID,
      feeBatchKey: input.fee.batchKey,
    });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(mocks.events).toEqual([
      'begin',
      'bounds',
      'name_lock',
      'name_collision',
      'account_lock',
      'guild_insert',
      'leader_insert',
      'save',
      'bank_insert',
      'commit',
      'admin_bust',
      `roster_bust:${GUILD_ID}`,
    ]);
    expect(mocks.saveCharacterStateOnClient).toHaveBeenCalledTimes(1);
    const saveCall = mocks.saveCharacterStateOnClient.mock.calls[0];
    expect(saveCall[1]).toBe(CHARACTER_ID);
    expect(saveCall[2]).toBe(input.level);
    expect(saveCall[3]).toEqual(input.state);
    expect(saveCall[3]).not.toBe(input.state);
    expect(saveCall[4]).toBe(input.leaseNonce);
    expect(saveCall[5]).toEqual(input.storageEffects);
    expect(saveCall[5]).not.toBe(input.storageEffects);
    const savedLedger = saveCall[6] as BankLedgerSaveEffects;
    expect(savedLedger.owner).toEqual({
      realm: REALM,
      characterId: CHARACTER_ID,
      accountId: ACCOUNT_ID,
    });
    expect(savedLedger.batches).toHaveLength(2);
    expect(savedLedger.batches[0]).toBe(existingBatch);
    expect(savedLedger.batches[1]).toMatchObject({ batchKey: input.fee.batchKey });
    expect(savedLedger.batches[1]?.rows).toEqual([
      {
        realm: REALM,
        characterId: CHARACTER_ID,
        accountId: ACCOUNT_ID,
        op: 'create_fee',
        itemId: null,
        count: null,
        instanceJson: null,
        copperDelta: -10_000,
        purchasedSlotsAfter: 0,
        container: 'guild',
        containerId: GUILD_ID,
        counterpartyCopperDelta: -10_000,
        counterpartyCount: 0,
      },
    ]);
    expect(saveCall[7]).toMatchObject({ accountId: ACCOUNT_ID });
    const accountLock = client.queries.find((query) => query.kind === 'account_lock');
    expect(accountLock?.text).toContain('FOR KEY SHARE');
    expect(accountLock?.text).not.toContain('FOR NO KEY UPDATE');
    const bankInsert = client.queries.find((query) => query.kind === 'bank_insert');
    expect(bankInsert?.values).toEqual([
      GUILD_ID,
      REALM,
      JSON.stringify({ treasury: 0, inventory: [], purchasedSlots: 0 }),
    ]);
    expect(client.release).toHaveBeenCalledWith();
    expect(bustGuildRoster).toHaveBeenCalledWith(GUILD_ID);
  });

  it('returns a known refusal on a case-insensitive name collision without locking the account', async () => {
    const client = new FakeClient({ collision: true });
    const { deps } = harness(client);

    await expect(createPaidGuildWithLeaderAtomic(deps, args())).resolves.toEqual({
      durability: 'not_committed',
      reason: 'name_taken',
    });

    expect(client.queries.map((query) => query.kind)).toEqual([
      'begin',
      'bounds',
      'name_lock',
      'name_collision',
      'rollback',
    ]);
    expect(mocks.saveCharacterStateOnClient).not.toHaveBeenCalled();
    expect(mocks.bustAdminGuildListReads).not.toHaveBeenCalled();
  });

  it('preserves a known refusal when its best-effort rollback fails', async () => {
    const rollbackFailure = Object.assign(new Error('rollback connection loss'), {
      code: '57P01',
    });
    const client = new FakeClient({ collision: true, failures: { rollback: rollbackFailure } });
    const cleanupErrors: unknown[] = [];
    const { deps } = harness(client);

    await expect(
      createPaidGuildWithLeaderAtomic(
        { ...deps, onCleanupError: (error) => cleanupErrors.push(error) },
        args(),
      ),
    ).resolves.toEqual({ durability: 'not_committed', reason: 'name_taken' });
    expect(client.release).toHaveBeenCalledWith(rollbackFailure);
    // DbTransactionDeadline absorbs the rollback error after destroying the
    // client, so no cleanup callback is needed and the refusal stays typed.
    expect(cleanupErrors).toEqual([]);
  });

  it('rejects a duplicate direct fee receipt before checking out a client', async () => {
    const client = new FakeClient();
    const { deps, connect } = harness(client);
    const existing = existingLedgerBatch();
    const input = args({
      ledgerEffects: {
        owner: { realm: REALM, characterId: CHARACTER_ID, accountId: ACCOUNT_ID },
        batches: Object.freeze([existing]),
      },
      fee: {
        batchKey: existing.batchKey,
        chargedCopper: 10_000,
        purseCopperDelta: -10_000,
      },
    });

    await expect(createPaidGuildWithLeaderAtomic(deps, input)).rejects.toThrow(
      'duplicate bank ledger batch key',
    );
    expect(connect).not.toHaveBeenCalled();
  });

  it.each([
    ['realm', { realm: `${REALM}-other`, characterId: CHARACTER_ID, accountId: ACCOUNT_ID }],
    ['character', { realm: REALM, characterId: CHARACTER_ID + 1, accountId: ACCOUNT_ID }],
    ['account', { realm: REALM, characterId: CHARACTER_ID, accountId: ACCOUNT_ID + 1 }],
  ] as const)(
    'rejects a ledger owner with a mismatched %s before checkout',
    async (_label, owner) => {
      const client = new FakeClient();
      const { deps, connect } = harness(client);
      const input = args();

      await expect(
        createPaidGuildWithLeaderAtomic(
          deps,
          args({
            ledgerEffects: Object.freeze({
              owner: Object.freeze(owner),
              batches: input.ledgerEffects?.batches ?? Object.freeze([]),
            }),
          }),
        ),
      ).rejects.toThrow('paid guild ledger owner does not match the founder');
      expect(connect).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      label: 'zero charge',
      fee: { batchKey: 'ledger:guild-create', chargedCopper: 0, purseCopperDelta: 0 },
    },
    {
      label: 'discounted charge',
      fee: {
        batchKey: 'ledger:guild-create',
        chargedCopper: GUILD_CREATION_FEE_COPPER - 1,
        purseCopperDelta: -(GUILD_CREATION_FEE_COPPER - 1),
      },
    },
    {
      label: 'overcharge',
      fee: {
        batchKey: 'ledger:guild-create',
        chargedCopper: GUILD_CREATION_FEE_COPPER + 1,
        purseCopperDelta: -(GUILD_CREATION_FEE_COPPER + 1),
      },
    },
    {
      label: 'mismatched purse movement',
      fee: {
        batchKey: 'ledger:guild-create',
        chargedCopper: GUILD_CREATION_FEE_COPPER,
        purseCopperDelta: -(GUILD_CREATION_FEE_COPPER - 1),
      },
    },
  ])('rejects $label before pool checkout', async ({ fee }) => {
    const client = new FakeClient();
    const { deps, connect } = harness(client);

    const refusal = createPaidGuildWithLeaderAtomic(deps, args({ fee }));
    await expect(refusal).rejects.toBeInstanceOf(PaidGuildCreateFeeInvariantError);
    await expect(refusal).rejects.toThrow(/paid guild (charge|purse delta) must be exactly/);
    expect(connect).not.toHaveBeenCalled();
  });

  it('detaches mutable character and storage snapshots before the first await', async () => {
    const client = new FakeClient();
    const { deps } = harness(client);
    const input = args();
    const originalCopper = input.state.copper;
    const originalSlots = input.storageEffects[0]?.purchasedSlotsAfter;

    const pending = createPaidGuildWithLeaderAtomic(deps, input);
    input.state.copper = 1;
    const mutableEffect = input.storageEffects[0] as StorageAppliedEffect;
    mutableEffect.purchasedSlotsAfter = 99;
    (input.fee as { purseCopperDelta: number }).purseCopperDelta = -1;
    await pending;

    const saveCall = mocks.saveCharacterStateOnClient.mock.calls[0];
    expect((saveCall[3] as CharacterState).copper).toBe(originalCopper);
    expect((saveCall[5] as readonly StorageAppliedEffect[])[0]?.purchasedSlotsAfter).toBe(
      originalSlots,
    );
    expect((saveCall[6] as BankLedgerSaveEffects).batches.at(-1)?.rows[0]).toMatchObject({
      counterpartyCopperDelta: -GUILD_CREATION_FEE_COPPER,
    });
  });

  it('maps the guild insert unique race to name_taken and rolls back', async () => {
    const unique = Object.assign(new Error('duplicate'), {
      code: '23505',
      constraint: 'guilds_realm_lower_name_guard',
    });
    const client = new FakeClient({ guildInsertError: unique });
    const { deps } = harness(client);

    await expect(createPaidGuildWithLeaderAtomic(deps, args())).resolves.toEqual({
      durability: 'not_committed',
      reason: 'name_taken',
    });
    expect(client.queries.at(-1)?.kind).toBe('rollback');
    expect(mocks.saveCharacterStateOnClient).not.toHaveBeenCalled();
  });

  it('does not disguise an unrelated unique violation as a taken name', async () => {
    const unique = Object.assign(new Error('sequence collision'), {
      code: '23505',
      constraint: 'guilds_pkey',
    });
    const client = new FakeClient({ guildInsertError: unique });
    const { deps } = harness(client);

    await expect(createPaidGuildWithLeaderAtomic(deps, args())).resolves.toEqual({
      durability: 'not_committed',
      reason: 'database_error',
      error: unique,
    });
    expect(client.queries.at(-1)?.kind).toBe('rollback');
  });

  it('rolls back a leader conflict so no leaderless guild or bank survives', async () => {
    const client = new FakeClient({ memberInserted: false });
    const { deps } = harness(client);

    await expect(createPaidGuildWithLeaderAtomic(deps, args())).resolves.toEqual({
      durability: 'not_committed',
      reason: 'already_in_guild',
    });
    expect(client.queries.map((query) => query.kind)).not.toContain('bank_insert');
    expect(client.queries.at(-1)?.kind).toBe('rollback');
    expect(mocks.saveCharacterStateOnClient).not.toHaveBeenCalled();
  });

  it('rolls the guild back when the character lease fence misses', async () => {
    mocks.saveCharacterStateOnClient.mockImplementationOnce(async () => {
      mocks.events.push('save');
      return false;
    });
    const client = new FakeClient();
    const { deps } = harness(client);

    await expect(createPaidGuildWithLeaderAtomic(deps, args())).resolves.toEqual({
      durability: 'not_committed',
      reason: 'lease_lost',
    });
    expect(client.queries.map((query) => query.kind)).not.toContain('bank_insert');
    expect(client.queries.at(-1)?.kind).toBe('rollback');
    expect(mocks.bustAdminGuildListReads).not.toHaveBeenCalled();
  });

  it('types a codeless failure before COMMIT as known not committed and never retries', async () => {
    const failure = new Error('socket lost during bank insert');
    const client = new FakeClient({ failAt: 'bank_insert', failError: failure });
    const { deps, connect } = harness(client);

    const result = await createPaidGuildWithLeaderAtomic(deps, args());

    expect(result).toEqual({
      durability: 'not_committed',
      reason: 'database_error',
      error: failure,
    });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(client.queries.filter((query) => query.kind === 'begin')).toHaveLength(1);
    expect(client.release).toHaveBeenCalledWith(failure);
    expect(mocks.bustAdminGuildListReads).not.toHaveBeenCalled();
  });

  it('preserves the pre-COMMIT error when the following rollback also fails', async () => {
    const primary = Object.assign(new Error('bank row rejected'), { code: '23503' });
    const rollbackFailure = Object.assign(new Error('rollback backend stopped'), {
      code: '57P01',
    });
    const client = new FakeClient({
      failures: { bank_insert: primary, rollback: rollbackFailure },
    });
    const { deps } = harness(client);

    await expect(createPaidGuildWithLeaderAtomic(deps, args())).resolves.toEqual({
      durability: 'not_committed',
      reason: 'database_error',
      error: primary,
    });
    expect(client.release).toHaveBeenCalledWith(rollbackFailure);
  });

  it('honors an already-aborted signal without retrying or issuing guild SQL', async () => {
    const controller = new AbortController();
    controller.abort();
    const client = new FakeClient();
    const { deps, connect } = harness(client);

    const result = await createPaidGuildWithLeaderAtomic(deps, args({ signal: controller.signal }));

    expect(result).toMatchObject({
      durability: 'not_committed',
      reason: 'database_error',
      error: { code: 'DB_TRANSACTION_ABORTED', commitMayHaveSucceeded: false },
    });
    expect(connect).not.toHaveBeenCalled();
    expect(client.queries).toEqual([]);
    expect(client.release).not.toHaveBeenCalled();
  });

  it('returns promptly on abort during pool checkout and destroys the eventual client', async () => {
    const controller = new AbortController();
    const client = new FakeClient();
    let finishCheckout: ((client: PaidGuildCreateDbClient) => void) | undefined;
    const checkout = new Promise<PaidGuildCreateDbClient>((resolve) => {
      finishCheckout = resolve;
    });
    const connect = vi.fn(() => checkout);
    const deps = { pool: { connect }, bustGuildRoster: vi.fn() };

    const pending = createPaidGuildWithLeaderAtomic(deps, args({ signal: controller.signal }));
    controller.abort();

    const result = await pending;
    expect(result).toMatchObject({
      durability: 'not_committed',
      reason: 'database_error',
      error: { code: 'DB_TRANSACTION_ABORTED', commitMayHaveSucceeded: false },
    });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(client.queries).toEqual([]);

    finishCheckout?.(client);
    await Promise.resolve();
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release.mock.calls[0]?.[0]).toMatchObject({
      code: 'DB_TRANSACTION_ABORTED',
      commitMayHaveSucceeded: false,
    });
  });

  it('types a failed pool checkout as known not committed', async () => {
    const failure = new Error('pool checkout timed out');
    const connect = vi.fn(async () => {
      throw failure;
    });
    const deps = { pool: { connect }, bustGuildRoster: vi.fn() };

    await expect(createPaidGuildWithLeaderAtomic(deps, args())).resolves.toEqual({
      durability: 'not_committed',
      reason: 'database_error',
      error: failure,
    });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(mocks.bustAdminGuildListReads).not.toHaveBeenCalled();
  });

  it('types a proven rollback returned by COMMIT as known not committed', async () => {
    const failure = Object.assign(new Error('serialization failure'), { code: '40001' });
    const client = new FakeClient({ commitError: failure });
    const { deps } = harness(client);

    await expect(createPaidGuildWithLeaderAtomic(deps, args())).resolves.toEqual({
      durability: 'not_committed',
      reason: 'database_error',
      error: failure,
    });
    expect(client.queries.map((query) => query.kind).slice(-2)).toEqual(['commit', 'rollback']);
    expect(mocks.bustAdminGuildListReads).not.toHaveBeenCalled();
  });

  it('does not call a pre-COMMIT abort ambiguous when COMMIT never started', async () => {
    const failure = new DbTransactionAborted('paid guild create', false);
    const client = new FakeClient({ commitError: failure });
    const { deps } = harness(client);

    await expect(createPaidGuildWithLeaderAtomic(deps, args())).resolves.toEqual({
      durability: 'not_committed',
      reason: 'database_error',
      error: failure,
    });
    expect(client.queries.map((query) => query.kind).slice(-2)).toEqual(['commit', 'rollback']);
    expect(mocks.bustAdminGuildListReads).not.toHaveBeenCalled();
  });

  it('decodes a deferred ledger growth refusal at COMMIT as a proved rollback', async () => {
    const failure = Object.assign(new Error('bank ledger growth limit exceeded'), {
      code: BANK_LEDGER_GROWTH_LIMIT_SQLSTATE,
      constraint: BANK_LEDGER_GROWTH_LIMIT_CONSTRAINT,
      detail: JSON.stringify({
        committed_rows: 999,
        attempted_rows: 2,
        hard_limit_rows: 1_000,
      }),
    });
    const client = new FakeClient({ commitError: failure });
    const { deps, connect } = harness(client);

    const result = await createPaidGuildWithLeaderAtomic(deps, args());
    expect(result).toMatchObject({
      durability: 'not_committed',
      reason: 'database_error',
      error: {
        name: BankLedgerGrowthLimitExceeded.name,
        committedRows: 999,
        attemptedRows: 2,
        hardLimitRows: 1_000,
      },
    });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(client.queries.map((query) => query.kind).slice(-2)).toEqual(['commit', 'rollback']);
    expect(mocks.bustAdminGuildListReads).not.toHaveBeenCalled();
  });

  it('upgrades a lost COMMIT response when the exact fee receipt is visible', async () => {
    const failure = new Error('socket lost after COMMIT write');
    const client = new FakeClient({ commitError: failure });
    const receiptClient = new FakeClient({ receipt: feeReceipt() });
    const { deps, connect, bustGuildRoster } = harness(client, [receiptClient]);
    const input = args();

    await expect(createPaidGuildWithLeaderAtomic(deps, input)).resolves.toEqual({
      durability: 'committed',
      guildId: GUILD_ID,
      feeBatchKey: input.fee.batchKey,
    });
    expect(connect).toHaveBeenCalledTimes(2);
    expect(receiptClient.queries.map((query) => query.kind)).toEqual([
      'begin',
      'bounds',
      'receipt_lookup',
      'rollback',
    ]);
    expect(receiptClient.queries[2]).toMatchObject({
      values: [input.fee.batchKey],
    });
    expect(receiptClient.queries[1]?.text).toBe(
      'SET LOCAL statement_timeout = 400; SET LOCAL lock_timeout = 400; ' +
        'SET LOCAL idle_in_transaction_session_timeout = 400',
    );
    expect(receiptClient.release).toHaveBeenCalledWith();
    expect(mocks.bustAdminGuildListReads).toHaveBeenCalledTimes(1);
    expect(bustGuildRoster).toHaveBeenCalledWith(GUILD_ID);
  });

  it('refuses a receipt SELECT when only the cleanup margin remains after BEGIN', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const failure = new Error('completion unknown');
    const transactionClient = new FakeClient({ commitError: failure });
    const marginOnly = new FakeClient({ advanceClockAfterBeginMs: 475 });
    const provingReceipt = new FakeClient({ receipt: feeReceipt() });
    const { deps } = harness(transactionClient, [marginOnly, provingReceipt]);

    try {
      const outcome = createPaidGuildWithLeaderAtomic(deps, args());
      await vi.advanceTimersByTimeAsync(25);
      await expect(outcome).resolves.toMatchObject({ durability: 'committed' });
      expect(marginOnly.queries.map((query) => query.kind)).toEqual(['begin']);
      expect(provingReceipt.queries.map((query) => query.kind)).toEqual([
        'begin',
        'bounds',
        'receipt_lookup',
        'rollback',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses the one remaining query millisecond when BEGIN leaves 26ms', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const failure = new Error('completion unknown');
    const transactionClient = new FakeClient({ commitError: failure });
    const receiptClient = new FakeClient({
      receipt: feeReceipt(),
      advanceClockAfterBeginMs: 474,
    });
    const { deps } = harness(transactionClient, [receiptClient]);

    try {
      await expect(createPaidGuildWithLeaderAtomic(deps, args())).resolves.toMatchObject({
        durability: 'committed',
      });
      expect(receiptClient.queries.find((query) => query.kind === 'bounds')?.text).toBe(
        'SET LOCAL statement_timeout = 1; SET LOCAL lock_timeout = 1; ' +
          'SET LOCAL idle_in_transaction_session_timeout = 1',
      );
      expect(receiptClient.queries.filter((query) => query.kind === 'receipt_lookup')).toHaveLength(
        1,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a proved receipt authoritative when its ROLLBACK cleanup fails', async () => {
    const failure = new Error('completion unknown');
    const rollbackFailure = new Error('receipt rollback failed');
    const transactionClient = new FakeClient({ commitError: failure });
    const receiptClient = new FakeClient({
      receipt: feeReceipt(),
      failures: { rollback: rollbackFailure },
    });
    const cleanupErrors: unknown[] = [];
    const { deps } = harness(transactionClient, [receiptClient]);

    await expect(
      createPaidGuildWithLeaderAtomic(
        { ...deps, onCleanupError: (error) => cleanupErrors.push(error) },
        args(),
      ),
    ).resolves.toMatchObject({ durability: 'committed' });
    expect(receiptClient.release).toHaveBeenCalledWith(rollbackFailure);
    expect(cleanupErrors).toEqual([]);
  });

  it('keeps a proved receipt authoritative when releasing its client throws', async () => {
    const failure = new Error('completion unknown');
    const releaseFailure = new Error('receipt release failed');
    const transactionClient = new FakeClient({ commitError: failure });
    const receiptClient = new FakeClient({ receipt: feeReceipt() });
    receiptClient.release.mockImplementationOnce(() => {
      throw releaseFailure;
    });
    const cleanupErrors: unknown[] = [];
    const { deps } = harness(transactionClient, [receiptClient]);

    await expect(
      createPaidGuildWithLeaderAtomic(
        { ...deps, onCleanupError: (error) => cleanupErrors.push(error) },
        args(),
      ),
    ).resolves.toMatchObject({ durability: 'committed' });
    expect(cleanupErrors).toContain(releaseFailure);
  });

  it('keeps a lost COMMIT response ambiguous after bounded absent-receipt reads', async () => {
    const failure = new Error('socket lost after COMMIT write');
    const client = new FakeClient({ commitError: failure });
    const { deps, connect, bustGuildRoster, checkedOut } = harness(client);
    const input = args();

    const result = await createPaidGuildWithLeaderAtomic(deps, input);

    expect(result).toEqual({
      durability: 'commit_ambiguous',
      guildId: GUILD_ID,
      feeBatchKey: input.fee.batchKey,
      error: failure,
    });
    expect(connect).toHaveBeenCalledTimes(4);
    expect(client.queries.filter((query) => query.kind === 'commit')).toHaveLength(1);
    expect(client.release).toHaveBeenCalledWith(failure);
    expect(
      checkedOut
        .slice(1)
        .flatMap((checkedClient) =>
          checkedClient.queries.filter((query) => query.kind === 'receipt_lookup'),
        ),
    ).toHaveLength(3);
    expect(mocks.bustAdminGuildListReads).toHaveBeenCalledTimes(1);
    expect(bustGuildRoster).toHaveBeenCalledWith(GUILD_ID);
  });

  it('keeps a mismatched fee receipt ambiguous without accepting another command', async () => {
    const failure = new Error('completion unknown');
    const client = new FakeClient({ commitError: failure });
    const receiptClient = new FakeClient({
      receipt: feeReceipt({ payload_sha256: '0'.repeat(64) }),
    });
    const { deps, connect } = harness(client, [receiptClient]);

    await expect(createPaidGuildWithLeaderAtomic(deps, args())).resolves.toEqual({
      durability: 'commit_ambiguous',
      guildId: GUILD_ID,
      feeBatchKey: 'ledger:guild-create',
      error: failure,
    });
    expect(connect).toHaveBeenCalledTimes(2);
    expect(receiptClient.queries.filter((query) => query.kind === 'receipt_lookup')).toHaveLength(
      1,
    );
  });

  it.each([
    ['realm', { realm: `${REALM}-other` }],
    ['character id', { character_id: CHARACTER_ID + 1 }],
    ['account id', { account_id: ACCOUNT_ID + 1 }],
    ['row count', { row_count: 2 }],
  ] as const)('keeps a fee receipt with a mismatched %s ambiguous', async (_label, mismatch) => {
    const failure = new Error('completion unknown');
    const client = new FakeClient({ commitError: failure });
    const receiptClient = new FakeClient({ receipt: feeReceipt(mismatch) });
    const { deps, connect } = harness(client, [receiptClient]);

    await expect(createPaidGuildWithLeaderAtomic(deps, args())).resolves.toEqual({
      durability: 'commit_ambiguous',
      guildId: GUILD_ID,
      feeBatchKey: 'ledger:guild-create',
      error: failure,
    });
    expect(connect).toHaveBeenCalledTimes(2);
    expect(receiptClient.queries.filter((query) => query.kind === 'receipt_lookup')).toHaveLength(
      1,
    );
  });

  it('bounds receipt checkout at 500ms and destroys a client that arrives after abort', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    let resolveLateCheckout!: (client: PaidGuildCreateDbClient) => void;
    const lateCheckout = new Promise<PaidGuildCreateDbClient>((resolve) => {
      resolveLateCheckout = resolve;
    });
    const failure = new Error('completion unknown');
    const transactionClient = new FakeClient({ commitError: failure });
    const mismatchClient = new FakeClient({
      receipt: feeReceipt({ account_id: ACCOUNT_ID + 1 }),
    });
    const lateClient = new FakeClient();
    let checkout = 0;
    const connect = vi.fn(async (): Promise<PaidGuildCreateDbClient> => {
      checkout++;
      if (checkout === 1) return transactionClient;
      if (checkout === 2) return lateCheckout;
      return mismatchClient;
    });
    const bustGuildRoster = vi.fn();

    try {
      const outcome = createPaidGuildWithLeaderAtomic(
        { pool: { connect }, bustGuildRoster },
        args(),
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(connect).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(499);
      expect(connect).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(25);

      await expect(outcome).resolves.toEqual({
        durability: 'commit_ambiguous',
        guildId: GUILD_ID,
        feeBatchKey: 'ledger:guild-create',
        error: failure,
      });
      expect(connect).toHaveBeenCalledTimes(3);
      resolveLateCheckout(lateClient);
      await vi.advanceTimersByTimeAsync(0);
      expect(lateClient.release).toHaveBeenCalledTimes(1);
      expect(lateClient.release.mock.calls[0]?.[0]).toMatchObject({
        name: 'DbTransactionAborted',
        commitMayHaveSucceeded: false,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('bounds an in-flight receipt query at 500ms and lets the next proof attempt succeed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const failure = new Error('completion unknown');
    const transactionClient = new FakeClient({ commitError: failure });
    const blockedReceipt = new BlockingReceiptClient();
    const provingReceipt = new FakeClient({ receipt: feeReceipt() });
    const { deps, connect } = harness(transactionClient, [blockedReceipt, provingReceipt]);

    try {
      let settled = false;
      const outcome = createPaidGuildWithLeaderAtomic(deps, args()).finally(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(blockedReceipt.receiptStarted).toHaveBeenCalledTimes(1);
      expect(connect).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(499);
      expect(settled).toBe(false);
      expect(blockedReceipt.release).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(blockedReceipt.release).toHaveBeenCalledTimes(1);
      const releaseError = blockedReceipt.release.mock.calls[0]?.[0] as
        | { name?: string; commitMayHaveSucceeded?: boolean }
        | undefined;
      expect(['DbTransactionAborted', 'DbTransactionDeadlineExceeded']).toContain(
        releaseError?.name,
      );
      expect(releaseError?.commitMayHaveSucceeded).toBe(false);
      expect(blockedReceipt.listenerCount('error')).toBe(0);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(25);
      await expect(outcome).resolves.toEqual({
        durability: 'committed',
        guildId: GUILD_ID,
        feeBatchKey: 'ledger:guild-create',
      });
      expect(connect).toHaveBeenCalledTimes(3);
      expect(
        provingReceipt.queries.filter((query) => query.kind === 'receipt_lookup'),
      ).toHaveLength(1);
      expect(provingReceipt.release).toHaveBeenCalledWith();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps query outages ambiguous and contains late-client cleanup failures', async () => {
    const commitFailure = new Error('completion unknown');
    const lookupFailure = new Error('receipt connection lost');
    const cleanupFailure = new Error('receipt client release failed');
    const client = new FakeClient({ commitError: commitFailure });
    const receiptClients = Array.from(
      { length: 3 },
      () => new FakeClient({ failures: { receipt_lookup: lookupFailure } }),
    );
    receiptClients[0]?.release.mockImplementationOnce(() => {
      throw cleanupFailure;
    });
    const cleanupErrors: unknown[] = [];
    const { deps, connect } = harness(client, [...receiptClients]);

    await expect(
      createPaidGuildWithLeaderAtomic(
        { ...deps, onCleanupError: (error) => cleanupErrors.push(error) },
        args(),
      ),
    ).resolves.toEqual({
      durability: 'commit_ambiguous',
      guildId: GUILD_ID,
      feeBatchKey: 'ledger:guild-create',
      error: commitFailure,
    });
    expect(connect).toHaveBeenCalledTimes(4);
    expect(cleanupErrors).toContain(cleanupFailure);
    for (const receiptClient of receiptClients) {
      expect(receiptClient.release).toHaveBeenCalledWith(lookupFailure);
    }
  });

  it('preserves COMMIT ambiguity when its best-effort rollback fails', async () => {
    const commitFailure = Object.assign(new Error('completion unknown'), { code: '40003' });
    const rollbackFailure = Object.assign(new Error('rollback backend stopped'), {
      code: '57P01',
    });
    const client = new FakeClient({
      commitError: commitFailure,
      failures: { rollback: rollbackFailure },
    });
    const { deps } = harness(client);

    await expect(createPaidGuildWithLeaderAtomic(deps, args())).resolves.toEqual({
      durability: 'commit_ambiguous',
      guildId: GUILD_ID,
      feeBatchKey: 'ledger:guild-create',
      error: commitFailure,
    });
    expect(client.release).toHaveBeenCalledWith(rollbackFailure);
    expect(mocks.bustAdminGuildListReads).toHaveBeenCalledTimes(1);
  });

  it('does not let cache-bust failures replace a known commit', async () => {
    const client = new FakeClient();
    const errors: unknown[] = [];
    const adminFailure = new Error('admin cache failed');
    const rosterFailure = new Error('roster cache failed');
    mocks.bustAdminGuildListReads.mockImplementationOnce(() => {
      throw adminFailure;
    });
    const deps = {
      pool: { connect: vi.fn(async () => client) },
      bustGuildRoster: vi.fn(() => {
        throw rosterFailure;
      }),
      onCacheBustError: vi.fn((error: unknown) => errors.push(error)),
    };

    await expect(createPaidGuildWithLeaderAtomic(deps, args())).resolves.toMatchObject({
      durability: 'committed',
      guildId: GUILD_ID,
    });
    expect(errors).toEqual([adminFailure, rosterFailure]);
  });

  it('does not demote a returned COMMIT when client release reports a cleanup error', async () => {
    const cleanupFailure = new Error('pool release failed');
    const client = new FakeClient();
    client.release.mockImplementationOnce(() => {
      throw cleanupFailure;
    });
    const cleanupErrors: unknown[] = [];
    const { deps } = harness(client);

    await expect(
      createPaidGuildWithLeaderAtomic(
        { ...deps, onCleanupError: (error) => cleanupErrors.push(error) },
        args(),
      ),
    ).resolves.toMatchObject({ durability: 'committed', guildId: GUILD_ID });
    expect(cleanupErrors).toEqual([cleanupFailure]);
    expect(mocks.bustAdminGuildListReads).toHaveBeenCalledTimes(1);
  });

  it('routes every pool checkout through one background permit, released with the client', async () => {
    // The lost-COMMIT-plus-receipt shape exercises BOTH checkout sites: the
    // atomic transaction and the reconcile read each acquire their own permit
    // BEFORE pool.connect and free it when their client is released (the
    // destructive COMMIT-failure release included).
    const failure = new Error('socket lost after COMMIT write');
    const client = new FakeClient({ commitError: failure });
    const receiptClient = new FakeClient({ receipt: feeReceipt() });
    const clients: FakeClient[] = [client, receiptClient];
    const connect = vi.fn(async (): Promise<PaidGuildCreateDbClient> => {
      mocks.events.push('connect');
      return clients.shift() ?? new FakeClient();
    });
    const acquireBackgroundPermit = vi.fn(async () => {
      mocks.events.push('permit_acquire');
      return {
        release: () => {
          mocks.events.push('permit_release');
        },
      };
    });

    await expect(
      createPaidGuildWithLeaderAtomic(
        { pool: { connect }, bustGuildRoster: vi.fn(), acquireBackgroundPermit },
        args(),
      ),
    ).resolves.toMatchObject({ durability: 'committed', guildId: GUILD_ID });

    expect(acquireBackgroundPermit).toHaveBeenCalledTimes(2);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(
      mocks.events.filter((event) => event === 'connect' || event.startsWith('permit_')),
    ).toEqual([
      'permit_acquire',
      'connect',
      'permit_release',
      'permit_acquire',
      'connect',
      'permit_release',
    ]);
  });

  it('refuses without a pool checkout when the background gate answers null', async () => {
    const connect = vi.fn(async (): Promise<PaidGuildCreateDbClient> => new FakeClient());
    const acquireBackgroundPermit = vi.fn(async () => null);

    await expect(
      createPaidGuildWithLeaderAtomic(
        { pool: { connect }, bustGuildRoster: vi.fn(), acquireBackgroundPermit },
        args(),
      ),
    ).resolves.toMatchObject({
      durability: 'not_committed',
      reason: 'database_error',
      error: expect.objectContaining({
        name: 'DbTransactionAborted',
        commitMayHaveSucceeded: false,
      }),
    });
    expect(connect).not.toHaveBeenCalled();
  });

  it('refuses at the bounded permit wait instead of pinning the save-FIFO slot forever', async () => {
    // The queued create job clears its own FIFO queue timeout the moment it
    // starts, so a gate that never answers must be cut off by the module's own
    // bound rather than waiting on a caller signal that will never fire.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    expect(PAID_GUILD_BACKGROUND_PERMIT_WAIT_MS).toBe(15_000);
    const connect = vi.fn(async (): Promise<PaidGuildCreateDbClient> => new FakeClient());
    // A saturated gate: a permit is granted only if the composed signal never
    // fires, and a fired signal resolves null (the acquirer contract).
    const acquireBackgroundPermit = vi.fn(
      (signal?: AbortSignal) =>
        new Promise<null>((resolve) => {
          signal?.addEventListener('abort', () => resolve(null), { once: true });
        }),
    );

    try {
      let settled = false;
      const outcome = createPaidGuildWithLeaderAtomic(
        { pool: { connect }, bustGuildRoster: vi.fn(), acquireBackgroundPermit },
        args(),
      ).then((result) => {
        settled = true;
        return result;
      });

      await vi.advanceTimersByTimeAsync(PAID_GUILD_BACKGROUND_PERMIT_WAIT_MS - 1);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await expect(outcome).resolves.toMatchObject({
        durability: 'not_committed',
        reason: 'database_error',
        error: expect.objectContaining({
          name: 'DbTransactionAborted',
          commitMayHaveSucceeded: false,
        }),
      });
      expect(connect).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to the module-registered gate acquirer when deps omit one', async () => {
    // The production shape: game.ts builds { pool, bustGuildRoster } and
    // main.ts registers the realm gate at boot.
    const client = new FakeClient();
    const { deps, connect } = harness(client);
    const release = vi.fn();
    const acquire = vi.fn(async () => ({ release }));
    configurePaidGuildCreateBackgroundGate(acquire);
    try {
      await expect(createPaidGuildWithLeaderAtomic(deps, args())).resolves.toMatchObject({
        durability: 'committed',
      });
      expect(acquire).toHaveBeenCalledTimes(1);
      expect(connect).toHaveBeenCalledTimes(1);
      expect(release).toHaveBeenCalled();
    } finally {
      configurePaidGuildCreateBackgroundGate(null);
    }
  });

  it('retries a receipt attempt whose checkout consumed the budget instead of opening a doomed transaction', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    expect(PAID_GUILD_RECEIPT_MIN_BUDGET_MS).toBe(50);
    const failure = new Error('completion unknown');
    const transactionClient = new FakeClient({ commitError: failure });
    const slowCheckoutReceipt = new FakeClient({ receipt: feeReceipt() });
    const provingReceipt = new FakeClient({ receipt: feeReceipt() });
    let checkout = 0;
    const connect = vi.fn(async (): Promise<PaidGuildCreateDbClient> => {
      checkout++;
      if (checkout === 1) return transactionClient;
      if (checkout === 2) {
        // Pool contention eats 460 of the 500ms reconcile deadline BEFORE the
        // client arrives, leaving 40ms: under the 50ms minimum useful budget.
        vi.setSystemTime(Date.now() + 460);
        return slowCheckoutReceipt;
      }
      return provingReceipt;
    });

    try {
      const outcome = createPaidGuildWithLeaderAtomic(
        { pool: { connect }, bustGuildRoster: vi.fn() },
        args(),
      );
      // Attempt 1 refuses at checkout; the 25ms attempt-1 backoff then admits
      // attempt 2, whose receipt read proves the lost COMMIT landed. A
      // load-induced slow checkout is therefore never converted into a
      // definitive no-receipt answer for a founder who was already charged.
      await vi.advanceTimersByTimeAsync(25);
      await expect(outcome).resolves.toEqual({
        durability: 'committed',
        guildId: GUILD_ID,
        feeBatchKey: 'ledger:guild-create',
      });
      // No transaction was opened on the budgetless client: no BEGIN, no
      // bounds, no SELECT. It was released promptly as a retryable abort, and
      // released PLAIN: nothing ran on the client, only the checkout was
      // slow, so a truthy release would make pg-pool destroy a healthy
      // connection and force a fresh TCP+auth handshake into the already
      // contended pool, once per starved attempt.
      expect(slowCheckoutReceipt.queries).toEqual([]);
      expect(slowCheckoutReceipt.release).toHaveBeenCalledTimes(1);
      expect(slowCheckoutReceipt.release).toHaveBeenCalledWith();
      expect(provingReceipt.queries.map((query) => query.kind)).toEqual([
        'begin',
        'bounds',
        'receipt_lookup',
        'rollback',
      ]);
      expect(connect).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('backend cancel wiring (source pins)', () => {
  it('wires pg_cancel into both paid-guild transaction deadlines', async () => {
    const { readFileSync } = await import('node:fs');
    const { stripComments } = await import('../helpers/strip_comments');
    const src = stripComments(
      readFileSync(new URL('../../server/guild_create_db.ts', import.meta.url), 'utf8'),
    );
    // The receipt-reconcile deadline and the create transaction both cancel the
    // backend when the deadline destroys the socket, so held locks drop early.
    // Production supplies deps.cancelBackend (db.ts's dedicated side-pool
    // hook, wired in game.ts, so an expiry cancel never rides the saturated
    // main pool); the pool-derived form is the guarded fallback for narrow
    // connect-only test worlds.
    expect(src.split('deps.cancelBackend ??').length - 1).toBe(2);
    expect(src).toContain('backendCancelViaPool({ query: deps.pool.query.bind(deps.pool) })');
    const gameSrc = stripComments(
      readFileSync(new URL('../../server/game.ts', import.meta.url), 'utf8'),
    );
    expect(gameSrc).toContain('cancelBackend: cancelDetachedBackend,');
    expect(src).toMatch(
      /beginCharacterSaveTx\(\s*client,\s*'paid guild create',\s*input\.signal,\s*cancelBackend,?\s*\)/,
    );
  });
});
