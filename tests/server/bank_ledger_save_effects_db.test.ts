// Transaction wiring for the bounded bank-ledger outbox. The pg pool and boot
// client are recording fakes, while the real receipt writer runs so ordering,
// lost-COMMIT verification, fencing, and boot DDL stay pinned end to end.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgres://test/test';
  const pool = { query: vi.fn(), connect: vi.fn() };
  const bootCalls: string[] = [];
  const bootQuery = vi.fn((sql: string, values?: unknown[]) => {
    bootCalls.push(String(sql));
    if (String(sql).includes("to_regclass('public.rate_limits')")) {
      return Promise.resolve({ rows: [{ reg: 'public.rate_limits' }], rowCount: 1 });
    }
    if (
      String(sql).includes('SELECT data FROM world_state WHERE key = $1') &&
      values?.[0] === 'market_backfill_done'
    ) {
      return Promise.resolve({ rows: [{ data: {} }], rowCount: 1 });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
  return { pool, bootCalls, bootQuery };
});

vi.mock('pg', () => ({
  Pool: vi.fn(function Pool() {
    return h.pool;
  }),
  Client: vi.fn(function Client() {
    return {
      connect: vi.fn(() => Promise.resolve()),
      query: h.bootQuery,
      end: vi.fn(() => Promise.resolve()),
    };
  }),
}));

import { BANK_LEDGER_BATCH_RECEIPTS_SCHEMA } from '../../server/bank_ledger_batch_db';
import {
  BANK_LEDGER_GROWTH_BUDGET_SCHEMA,
  BANK_LEDGER_GROWTH_LIMIT_CONSTRAINT,
  BANK_LEDGER_GROWTH_LIMIT_SQLSTATE,
  BankLedgerGrowthLimitExceeded,
  bankLedgerGrowthBudgetReadbackSql,
} from '../../server/bank_ledger_growth_budget';
import type { SerializedBankLedgerOutboxRow } from '../../server/bank_ledger_outbox';
import {
  bankLedgerCommittedPrefixForError,
  type CharacterSaveAccountLockProof,
  lockCharacterSaveAccountParentOnClient,
  lockCharacterSaveEffectAccountsOnClient,
  prepareBankLedgerSaveEffects,
} from '../../server/bank_ledger_save_effects_db';
import {
  type BankLedgerSaveEffects,
  ensureSchema,
  openMailPartitionWriteGate,
  openMarketWriteGate,
  saveCharacterAndGuildBankState,
  saveCharacterAndMarketState,
  saveCharacterState,
  saveCharacterStateOnClient,
} from '../../server/db';
import { DbTransactionAborted } from '../../server/db_transaction_deadline';
import { REALM } from '../../server/realm';
import {
  STORAGE_PURCHASE_SCHEMA,
  type StorageAppliedEffect,
} from '../../server/storage_purchase_db';
import type { CharacterState, MailSave, MarketSave } from '../../src/sim/sim';

const OWNER = { realm: REALM, characterId: 42, accountId: 7 } as const;
const ROW: SerializedBankLedgerOutboxRow = {
  realm: OWNER.realm,
  characterId: OWNER.characterId,
  accountId: OWNER.accountId,
  op: 'deposit',
  itemId: 'linen_cloth',
  count: 3,
  instanceJson: null,
  copperDelta: 0,
  purchasedSlotsAfter: 0,
  container: 'personal',
  containerId: null,
  counterpartyCopperDelta: null,
  counterpartyCount: null,
};
const EFFECTS: BankLedgerSaveEffects = {
  owner: OWNER,
  batches: [{ batchKey: 'save.session.1', rows: [ROW], encodedBytes: 256 }],
};
const GUILD_EFFECTS: BankLedgerSaveEffects = {
  owner: OWNER,
  batches: [
    {
      batchKey: 'save.guild.1',
      rows: [{ ...ROW, container: 'guild', containerId: 19 }],
      encodedBytes: 256,
      guildEffect: {
        guildId: 19,
        deltas: [
          {
            op: 'deposit',
            itemId: 'linen_cloth',
            count: 3,
            instanceJson: null,
            craftedRecipeId: null,
            copperDelta: 0,
            purchasedSlotsBefore: 0,
            purchasedSlotsAfter: 0,
          },
        ],
      },
    },
  ],
};
const ADMIN_PURGE_EFFECTS: BankLedgerSaveEffects = {
  owner: OWNER,
  batches: [
    {
      batchKey: 'save.guild.admin-purge',
      rows: [
        {
          ...ROW,
          accountId: 99,
          op: 'admin_purge',
          itemId: 'linen_cloth',
          count: 3,
          container: 'guild',
          containerId: 19,
        },
      ],
      encodedBytes: 256,
      guildEffect: {
        guildId: 19,
        // The DECLARED staff attribution (PR #3670): the owner check
        // validates rows against this value, never against rows[0].
        actorAccountId: 99,
        deltas: [
          {
            op: 'admin_purge',
            itemId: 'linen_cloth',
            count: 3,
            instanceJson: null,
            craftedRecipeId: null,
            copperDelta: 0,
            purchasedSlotsBefore: 0,
            purchasedSlotsAfter: 0,
          },
        ],
      },
    },
  ],
};
const STORAGE_EFFECT: StorageAppliedEffect = {
  realm: REALM,
  accountId: OWNER.accountId,
  characterId: OWNER.characterId,
  itemId: 'strongbox_rung_01',
  expectedCostClaudium: 100,
  idempotencyKey: 'storage-and-ledger-save',
  spendClaimToken: '00000000-0000-4000-8000-000000000001',
  purchasedSlotsBefore: 0,
  purchasedSlotsAfter: 6,
};
const STATE = {
  level: 7,
  questLog: [],
  questsDone: [],
  inventory: [],
} as unknown as CharacterState;
const MARKET = { listings: [], collections: [], nextListingId: 1 } as MarketSave;
// One non-empty recipient partition: these tests assert BOTH escrow
// world_state writes land (market + mail), and writeMailPartitions issues no
// SQL at all for an empty array, which would silently drop that half.
const MAIL_PARTITIONS: { recipientKey: string; letters: MailSave['mail'] }[] = [
  {
    recipientKey: 'char-42',
    letters: [
      {
        id: 1,
        recipientKey: 'char-42',
        recipientName: 'Testchar',
        senderName: 'System',
        kind: 'system',
        subject: 'Welcome',
        body: '',
        copper: 0,
        items: [],
        deliverIn: 0,
        secondsLeft: -1,
        read: false,
      },
    ],
  },
];

function guildGoldBatch(batchKey: string, copperDelta: number) {
  const op = copperDelta >= 0 ? ('deposit_gold' as const) : ('withdraw_gold' as const);
  return {
    batchKey,
    encodedBytes: 512,
    rows: [
      {
        ...ROW,
        op,
        itemId: null,
        count: null,
        copperDelta,
        container: 'guild' as const,
        containerId: 19,
      },
    ],
    guildEffect: {
      guildId: 19,
      deltas: [
        {
          op,
          itemId: null,
          count: null,
          instanceJson: null,
          craftedRecipeId: null,
          copperDelta,
          purchasedSlotsBefore: 0,
          purchasedSlotsAfter: 0,
        },
      ],
    },
  };
}

interface ClientOptions {
  characterRows?: number;
  lostCommit?: boolean;
  claims?: readonly boolean[];
  abortOnCommit?: AbortController;
  commitError?: unknown;
}

function clientStub(options: ClientOptions = {}) {
  const characterRows = options.characterRows ?? 1;
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (/^COMMIT/.test(sql) && options.abortOnCommit) options.abortOnCommit.abort();
    if (/^COMMIT/.test(sql) && options.commitError) throw options.commitError;
    if (/SELECT id FROM accounts/i.test(sql)) {
      const requested = Array.isArray(values?.[0])
        ? (values[0] as number[])
        : [Number(values?.[0])];
      return { rows: requested.map((id) => ({ id })), rowCount: requested.length };
    }
    if (/UPDATE characters/i.test(sql)) return { rows: [], rowCount: characterRows };
    if (/FROM storage_purchase_applied_receipts/i.test(sql)) {
      return { rows: [], rowCount: 0 };
    }
    if (/FROM storage_purchases[\s\S]*FOR UPDATE/i.test(sql)) {
      return {
        rows: [
          {
            id: 81,
            realm: STORAGE_EFFECT.realm,
            account_id: STORAGE_EFFECT.accountId,
            character_id: STORAGE_EFFECT.characterId,
            item_id: STORAGE_EFFECT.itemId,
            expected_cost_claudium: STORAGE_EFFECT.expectedCostClaudium,
            idempotency_key: STORAGE_EFFECT.idempotencyKey,
            spend_claim_token: STORAGE_EFFECT.spendClaimToken,
            status: 'pending',
          },
        ],
        rowCount: 1,
      };
    }
    if (/INSERT INTO storage_purchase_applied_receipts/i.test(sql)) {
      return { rows: [{ source_purchase_id: 81 }], rowCount: 1 };
    }
    if (/WITH receipt_input AS/i.test(sql)) {
      const params = values as unknown[];
      const ordinals = params[0] as number[];
      const keys = params[1] as string[];
      const realms = params[2] as string[];
      const characterIds = params[3] as number[];
      const accountIds = params[4] as number[];
      const rowCounts = params[5] as number[];
      const hashes = params[6] as string[];
      const claims = options.claims ?? ordinals.map(() => !options.lostCommit);
      const inserted = rowCounts.reduce(
        (sum, count, index) => sum + (claims[index] ? count : 0),
        0,
      );
      return {
        rows: ordinals.map((ordinal, index) => ({
          batch_ordinal: ordinal,
          batch_key: keys[index],
          newly_claimed: claims[index],
          stored_batch_key: keys[index],
          stored_realm: realms[index],
          stored_character_id: characterIds[index],
          stored_account_id: accountIds[index],
          stored_row_count: rowCounts[index],
          stored_payload_sha256: hashes[index],
          inserted_row_count: inserted,
        })),
        rowCount: ordinals.length,
      };
    }
    return { rows: [], rowCount: 1 };
  });
  return { query, release: vi.fn(), on: vi.fn(), removeListener: vi.fn() };
}

function sqlCalls(client: ReturnType<typeof clientStub>): string[] {
  return client.query.mock.calls.map((call) => String(call[0]));
}

function indexOf(sql: readonly string[], pattern: RegExp): number {
  return sql.findIndex((statement) => pattern.test(statement));
}

beforeEach(() => {
  h.pool.query.mockReset();
  h.pool.connect.mockReset();
  h.bootCalls.length = 0;
  h.bootQuery.mockClear();
  openMarketWriteGate();
  // The fenced leave-path save now persists mail PARTITIONS, whose write is
  // gated on the boot backfill marker exactly like the market row.
  openMailPartitionWriteGate();
});

describe('fenced character save ledger effects', () => {
  it('bounds an ordinary save in four database round trips', async () => {
    const client = clientStub();
    h.pool.connect.mockResolvedValueOnce(client);

    await expect(saveCharacterState(OWNER.characterId, 7, STATE)).resolves.toBe(true);

    const sql = sqlCalls(client);
    expect(sql).toHaveLength(4);
    expect(sql[0]).toBe('BEGIN');
    expect(sql[1]).toContain('statement_timeout = 60000');
    expect(sql[1]).toContain("lock_timeout = '2s'");
    expect(sql[1]).toContain("idle_in_transaction_session_timeout = '10s'");
    expect(sql[2]).toMatch(/UPDATE characters/);
    expect(sql[3]).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('forces a plain save through one transaction and locks the parent before the child', async () => {
    const client = clientStub();
    h.pool.connect.mockResolvedValueOnce(client);

    await expect(
      saveCharacterState(OWNER.characterId, 7, STATE, undefined, [], EFFECTS),
    ).resolves.toBe(true);

    const sql = sqlCalls(client);
    expect(sql[0]).toBe('BEGIN');
    expect(indexOf(sql, /SELECT id FROM accounts/)).toBeLessThan(indexOf(sql, /UPDATE characters/));
    expect(indexOf(sql, /UPDATE characters/)).toBeLessThan(indexOf(sql, /WITH receipt_input AS/));
    expect(indexOf(sql, /WITH receipt_input AS/)).toBeLessThan(indexOf(sql, /^COMMIT/));
    expect(sql.at(-1)).toBe('COMMIT');
    expect(h.pool.query).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('translates the deferred growth ceiling refusal raised by COMMIT', async () => {
    const raw = {
      code: BANK_LEDGER_GROWTH_LIMIT_SQLSTATE,
      constraint: BANK_LEDGER_GROWTH_LIMIT_CONSTRAINT,
      detail: JSON.stringify({
        committed_rows: 10_000_000,
        attempted_rows: 1,
        hard_limit_rows: 10_000_000,
      }),
    };
    const client = clientStub({ commitError: raw });
    h.pool.connect.mockResolvedValueOnce(client);

    await expect(
      saveCharacterState(OWNER.characterId, 7, STATE, 'nonce-1', [], EFFECTS),
    ).rejects.toMatchObject({
      name: BankLedgerGrowthLimitExceeded.name,
      committedRows: 10_000_000,
      attemptedRows: 1,
      hardLimitRows: 10_000_000,
      cause: raw,
    });
    expect(sqlCalls(client)).toContain('ROLLBACK');
  });

  it('classifies a lost-COMMIT receipt before market/mail rows and COMMIT', async () => {
    const client = clientStub({ lostCommit: true });
    h.pool.connect.mockResolvedValueOnce(client);

    await expect(
      saveCharacterAndMarketState(
        OWNER.characterId,
        7,
        STATE,
        MARKET,
        MAIL_PARTITIONS,
        'nonce-1',
        undefined,
        undefined,
        [],
        EFFECTS,
      ),
    ).resolves.toBe(true);

    const sql = sqlCalls(client);
    const worlds = sql.flatMap((statement, at) =>
      /INSERT INTO world_state/.test(statement) ? [at] : [],
    );
    const ledger = indexOf(sql, /WITH receipt_input AS/);
    expect(worlds).toHaveLength(2);
    expect(indexOf(sql, /UPDATE characters/)).toBeLessThan(ledger);
    expect(ledger).toBeLessThan(worlds[0]);
    expect(worlds.at(-1)).toBeLessThan(indexOf(sql, /^COMMIT/));
    const ledgerCall = client.query.mock.calls.find((call) =>
      /WITH receipt_input AS/.test(call[0]),
    );
    expect(ledgerCall?.[0]).toContain('FROM bank_ledger_batch_receipts AS existing');
    expect(ledgerCall?.[0]).toContain('JOIN claimed AS c');
    expect(ledgerCall?.[1]?.[1]).toEqual(['save.session.1']);
  });

  it('classifies the ledger receipt before writing a successful guild book', async () => {
    const client = clientStub();
    h.pool.connect.mockResolvedValueOnce(client);
    const guildSave = {
      guildId: 19,
      deltas: [
        {
          op: 'deposit' as const,
          itemId: 'linen_cloth',
          count: 3,
          instance: null,
          craftedRecipeId: null,
          copperDelta: 0,
          purchasedSlotsBefore: 0,
          purchasedSlotsAfter: 0,
        },
      ],
    };

    await expect(
      saveCharacterAndGuildBankState(
        OWNER.characterId,
        7,
        STATE,
        [guildSave],
        'nonce-1',
        undefined,
        [],
        GUILD_EFFECTS,
      ),
    ).resolves.toBe(true);

    const sql = sqlCalls(client);
    const book = sql.reduce(
      (last, statement, at) => (/INSERT INTO guild_banks/.test(statement) ? at : last),
      -1,
    );
    expect(indexOf(sql, /UPDATE characters/)).toBeLessThan(indexOf(sql, /WITH receipt_input AS/));
    expect(indexOf(sql, /WITH receipt_input AS/)).toBeLessThan(book);
    expect(book).toBeLessThan(indexOf(sql, /^COMMIT/));
  });

  it('uses all-existing receipts as committed results without any guild query', async () => {
    const client = clientStub({ claims: [false] });
    h.pool.connect.mockResolvedValueOnce(client);
    const results: Array<{ guildId: number; written: boolean }> = [];
    const guildSave = {
      guildId: 19,
      deltas: [
        {
          op: 'deposit' as const,
          itemId: 'linen_cloth',
          count: 3,
          instance: null,
          craftedRecipeId: null,
          copperDelta: 0,
          purchasedSlotsBefore: 0,
          purchasedSlotsAfter: 0,
        },
      ],
    };

    await expect(
      saveCharacterAndGuildBankState(
        OWNER.characterId,
        7,
        STATE,
        [guildSave],
        'nonce-1',
        results as never,
        [],
        GUILD_EFFECTS,
      ),
    ).resolves.toBe(true);
    expect(sqlCalls(client).some((sql) => /guild_banks/.test(sql))).toBe(false);
    expect(results).toEqual([{ guildId: 19, written: true, deficit: null, rowUnusable: false }]);
  });

  it('replays only the new suffix when duplicate-guild commands share one captured save', async () => {
    const first = guildGoldBatch('save.guild.existing', 10);
    const second = guildGoldBatch('save.guild.new', 20);
    const effects: BankLedgerSaveEffects = { owner: OWNER, batches: [first, second] };
    const client = clientStub({ claims: [false, true] });
    h.pool.connect.mockResolvedValueOnce(client);

    await expect(
      saveCharacterAndGuildBankState(
        OWNER.characterId,
        7,
        STATE,
        [
          {
            guildId: 19,
            deltas: [
              { ...first.guildEffect.deltas[0], instance: null },
              { ...second.guildEffect.deltas[0], instance: null },
            ],
          },
        ],
        'nonce-1',
        undefined,
        [],
        effects,
      ),
    ).resolves.toBe(true);

    const upsert = client.query.mock.calls.find((call) =>
      /INSERT INTO guild_banks[\s\S]*DO UPDATE/.test(String(call[0])),
    );
    expect(JSON.parse(String(upsert?.[1]?.[2]))).toMatchObject({ treasury: 20 });
  });

  it('preserves only the exact existing prefix when a new guild replay later refuses', async () => {
    const first = guildGoldBatch('save.guild.durable', 10);
    const second = guildGoldBatch('save.guild.refused', -50);
    const effects: BankLedgerSaveEffects = { owner: OWNER, batches: [first, second] };
    const client = clientStub({ claims: [false, true] });
    h.pool.connect.mockResolvedValueOnce(client);

    let thrown: unknown;
    await saveCharacterAndGuildBankState(
      OWNER.characterId,
      7,
      STATE,
      [
        {
          guildId: 19,
          deltas: [
            { ...first.guildEffect.deltas[0], instance: null },
            { ...second.guildEffect.deltas[0], instance: null },
          ],
        },
      ],
      'nonce-1',
      undefined,
      [],
      effects,
    ).catch((error) => {
      thrown = error;
    });

    const evidence = bankLedgerCommittedPrefixForError(thrown);
    expect(evidence?.batches).toEqual([first]);
    expect(evidence?.batches[0]).toBe(first);
    expect(evidence?.batches).not.toContain(second);
    expect(sqlCalls(client)).toContain('ROLLBACK');
  });

  it('preserves COMMIT ambiguity and the verified ledger prefix when shutdown aborts', async () => {
    const abort = new AbortController();
    const client = clientStub({ claims: [false], abortOnCommit: abort });
    h.pool.connect.mockResolvedValueOnce(client);

    let thrown: unknown;
    await saveCharacterState(
      OWNER.characterId,
      7,
      STATE,
      'nonce-1',
      [],
      EFFECTS,
      abort.signal,
    ).catch((error) => {
      thrown = error;
    });

    expect(thrown).toBeInstanceOf(DbTransactionAborted);
    expect(thrown).toMatchObject({ commitMayHaveSucceeded: true });
    expect(bankLedgerCommittedPrefixForError(thrown)?.batches).toEqual(EFFECTS.batches);
    expect(sqlCalls(client)).not.toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalledOnce();
    expect(client.release.mock.calls[0]?.[0]).toBe(thrown);
  });

  it('rejects a new-before-existing classification before any guild query', async () => {
    const first = guildGoldBatch('save.guild.new.first', 10);
    const second = guildGoldBatch('save.guild.existing.later', 20);
    const effects: BankLedgerSaveEffects = { owner: OWNER, batches: [first, second] };
    const client = clientStub({ claims: [true, false] });
    h.pool.connect.mockResolvedValueOnce(client);

    await expect(
      saveCharacterAndGuildBankState(
        OWNER.characterId,
        7,
        STATE,
        [
          {
            guildId: 19,
            deltas: [
              { ...first.guildEffect.deltas[0], instance: null },
              { ...second.guildEffect.deltas[0], instance: null },
            ],
          },
        ],
        'nonce-1',
        undefined,
        [],
        effects,
      ),
    ).rejects.toThrow(/existing batch .* follows a new batch/);
    expect(sqlCalls(client).some((sql) => /guild_banks/.test(sql))).toBe(false);
    expect(sqlCalls(client)).toContain('ROLLBACK');
  });

  it('rejects nonempty unreceipted guild deltas before pool checkout', async () => {
    await expect(
      saveCharacterAndGuildBankState(
        OWNER.characterId,
        7,
        STATE,
        [
          {
            guildId: 19,
            deltas: [
              {
                op: 'deposit_gold',
                itemId: null,
                count: null,
                instance: null,
                craftedRecipeId: null,
                copperDelta: 1,
                purchasedSlotsBefore: 0,
                purchasedSlotsAfter: 0,
              },
            ],
          },
        ],
        'nonce-1',
      ),
    ).rejects.toThrow(/nonempty unreceipted deltas/);
    expect(h.pool.connect).not.toHaveBeenCalled();
  });

  it('rejects a guild ledger prefix unless the same transaction carries its book', async () => {
    const guildSave = {
      guildId: 20,
      deltas: [],
    };

    await expect(
      saveCharacterState(OWNER.characterId, 7, STATE, 'nonce-1', [], GUILD_EFFECTS),
    ).rejects.toThrow(/matching guild bank save/);
    await expect(
      saveCharacterAndGuildBankState(
        OWNER.characterId,
        7,
        STATE,
        [guildSave],
        'nonce-1',
        undefined,
        [],
        GUILD_EFFECTS,
      ),
    ).rejects.toThrow(/matching guild bank save/);
    await expect(
      saveCharacterAndMarketState(
        OWNER.characterId,
        7,
        STATE,
        MARKET,
        MAIL_PARTITIONS,
        'nonce-1',
        undefined,
        undefined,
        [],
        GUILD_EFFECTS,
      ),
    ).rejects.toThrow(/matching guild bank save/);

    expect(h.pool.connect).not.toHaveBeenCalled();
    expect(h.pool.query).not.toHaveBeenCalled();
  });

  it('reuses the storage parent lock and writes ledger before storage receipts', async () => {
    const client = clientStub();
    h.pool.connect.mockResolvedValueOnce(client);

    await expect(
      saveCharacterState(OWNER.characterId, 7, STATE, 'nonce-1', [STORAGE_EFFECT], EFFECTS),
    ).resolves.toBe(true);

    const sql = sqlCalls(client);
    expect(sql.filter((statement) => /SELECT id FROM accounts/.test(statement))).toHaveLength(1);
    expect(indexOf(sql, /SELECT id FROM accounts/)).toBeLessThan(indexOf(sql, /UPDATE characters/));
    expect(indexOf(sql, /WITH receipt_input AS/)).toBeLessThan(
      indexOf(sql, /INSERT INTO storage_purchase_applied_receipts/),
    );
    expect(indexOf(sql, /INSERT INTO storage_purchase_applied_receipts/)).toBeLessThan(
      indexOf(sql, /^COMMIT/),
    );
  });

  it('rolls a guild save fence miss back before books or ledger receipts', async () => {
    const client = clientStub({ characterRows: 0 });
    h.pool.connect.mockResolvedValueOnce(client);

    await expect(
      saveCharacterAndGuildBankState(
        OWNER.characterId,
        7,
        STATE,
        [],
        'stale-nonce',
        undefined,
        [],
        EFFECTS,
      ),
    ).resolves.toBe(false);

    const sql = sqlCalls(client);
    expect(sql).toContain('ROLLBACK');
    expect(sql.some((statement) => /guild_banks/.test(statement))).toBe(false);
    expect(sql.some((statement) => /receipt_input/.test(statement))).toBe(false);
    expect(sql.some((statement) => /^COMMIT/.test(statement))).toBe(false);
  });

  it('rejects owner and storage identity mismatches before any database query', async () => {
    await expect(saveCharacterState(41, 7, STATE, undefined, [], EFFECTS)).rejects.toThrow(
      /owner does not match/,
    );

    const mismatchedStorage: StorageAppliedEffect = {
      realm: REALM,
      accountId: OWNER.accountId + 1,
      characterId: OWNER.characterId,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'storage-owner-mismatch',
      spendClaimToken: '00000000-0000-4000-8000-000000000099',
      purchasedSlotsBefore: 0,
      purchasedSlotsAfter: 6,
    };
    await expect(
      saveCharacterState(OWNER.characterId, 7, STATE, undefined, [mismatchedStorage], EFFECTS),
    ).rejects.toThrow(/storage save owners do not match/);

    expect(h.pool.connect).not.toHaveBeenCalled();
    expect(h.pool.query).not.toHaveBeenCalled();
  });

  it('accepts only attributed admin purges across accounts and locks every parent in order', async () => {
    const prepared = prepareBankLedgerSaveEffects(OWNER.characterId, [], ADMIN_PURGE_EFFECTS, [19]);
    const client = clientStub();

    await lockCharacterSaveEffectAccountsOnClient(client, [], prepared);

    const lock = client.query.mock.calls.find((call) => /id = ANY/.test(String(call[0])));
    expect(lock?.[1]).toEqual([[OWNER.accountId, 99]]);

    const ordinaryCrossOwner: BankLedgerSaveEffects = {
      owner: OWNER,
      batches: [
        {
          ...GUILD_EFFECTS.batches[0],
          rows: [{ ...GUILD_EFFECTS.batches[0].rows[0], accountId: 99 }],
        },
      ],
    };
    expect(() =>
      prepareBankLedgerSaveEffects(OWNER.characterId, [], ordinaryCrossOwner, [19]),
    ).toThrow(/does not match the character save owner/);

    const purgeBatch = ADMIN_PURGE_EFFECTS.batches[0];
    const purgeRow = purgeBatch.rows[0];
    const purgeEffect = purgeBatch.guildEffect;
    if (!purgeRow || !purgeEffect) throw new Error('missing admin-purge fixture');
    const mixedActors: BankLedgerSaveEffects = {
      owner: OWNER,
      batches: [
        {
          ...purgeBatch,
          rows: [purgeRow, { ...purgeRow, accountId: 100 }],
          guildEffect: {
            ...purgeEffect,
            deltas: [purgeEffect.deltas[0], purgeEffect.deltas[0]],
          },
        },
      ],
    };
    expect(() => prepareBankLedgerSaveEffects(OWNER.characterId, [], mixedActors, [19])).toThrow(
      /does not match the character save owner/,
    );
  });

  it('refuses a single-owner lock proof for a cross-account admin purge', async () => {
    const client = clientStub();
    const proof = await lockCharacterSaveAccountParentOnClient(client as never, OWNER.accountId);
    const prepared = prepareBankLedgerSaveEffects(OWNER.characterId, [], ADMIN_PURGE_EFFECTS, [19]);

    await expect(
      lockCharacterSaveEffectAccountsOnClient(client, [], prepared, proof),
    ).rejects.toThrow(/does not match save effects/);
  });

  it('rejects oversized no-ledger storage effects before every save family touches SQL', async () => {
    const overflow = [
      STORAGE_EFFECT,
      {
        ...STORAGE_EFFECT,
        idempotencyKey: 'storage-overflow-second',
        spendClaimToken: '00000000-0000-4000-8000-000000000002',
      },
    ];
    const callerOwned = clientStub();

    await expect(
      saveCharacterState(OWNER.characterId, 7, STATE, undefined, overflow),
    ).rejects.toThrow(/exceeds one pending purchase/);
    await expect(
      saveCharacterAndMarketState(
        OWNER.characterId,
        7,
        STATE,
        MARKET,
        MAIL_PARTITIONS,
        undefined,
        undefined,
        undefined,
        overflow,
      ),
    ).rejects.toThrow(/exceeds one pending purchase/);
    await expect(
      saveCharacterAndGuildBankState(
        OWNER.characterId,
        7,
        STATE,
        [],
        undefined,
        undefined,
        overflow,
      ),
    ).rejects.toThrow(/exceeds one pending purchase/);
    await expect(
      saveCharacterStateOnClient(
        callerOwned as never,
        OWNER.characterId,
        7,
        STATE,
        undefined,
        overflow,
      ),
    ).rejects.toThrow(/exceeds one pending purchase/);

    expect(h.pool.connect).not.toHaveBeenCalled();
    expect(h.pool.query).not.toHaveBeenCalled();
    expect(callerOwned.query).not.toHaveBeenCalled();
  });

  it('rejects standalone storage owner mismatches before every save family touches SQL', async () => {
    const mismatched = [{ ...STORAGE_EFFECT, realm: 'other-realm' }];
    const callerOwned = clientStub();

    await expect(
      saveCharacterState(OWNER.characterId, 7, STATE, undefined, mismatched),
    ).rejects.toThrow(/does not match the character save/);
    await expect(
      saveCharacterAndMarketState(
        OWNER.characterId,
        7,
        STATE,
        MARKET,
        MAIL_PARTITIONS,
        undefined,
        undefined,
        undefined,
        mismatched,
      ),
    ).rejects.toThrow(/does not match the character save/);
    await expect(
      saveCharacterAndGuildBankState(
        OWNER.characterId,
        7,
        STATE,
        [],
        undefined,
        undefined,
        mismatched,
      ),
    ).rejects.toThrow(/does not match the character save/);
    await expect(
      saveCharacterStateOnClient(
        callerOwned as never,
        OWNER.characterId,
        7,
        STATE,
        undefined,
        mismatched,
      ),
    ).rejects.toThrow(/does not match the character save/);

    expect(h.pool.connect).not.toHaveBeenCalled();
    expect(h.pool.query).not.toHaveBeenCalled();
    expect(callerOwned.query).not.toHaveBeenCalled();
  });

  it('writes the same locked and fenced prefix on a caller-owned client', async () => {
    const client = clientStub();

    await expect(
      saveCharacterStateOnClient(
        client as never,
        OWNER.characterId,
        7,
        STATE,
        'nonce-1',
        [],
        EFFECTS,
      ),
    ).resolves.toBe(true);

    const sql = sqlCalls(client);
    expect(indexOf(sql, /SELECT id FROM accounts/)).toBeLessThan(indexOf(sql, /UPDATE characters/));
    expect(indexOf(sql, /UPDATE characters/)).toBeLessThan(indexOf(sql, /WITH receipt_input AS/));
    expect(sql.some((statement) => /^(?:BEGIN|COMMIT|ROLLBACK)/.test(statement))).toBe(false);
  });

  it('consumes a matching same-client parent-lock proof without a redundant KEY SHARE', async () => {
    const client = clientStub();
    const proof = await lockCharacterSaveAccountParentOnClient(client as never, OWNER.accountId);

    await expect(
      saveCharacterStateOnClient(
        client as never,
        OWNER.characterId,
        7,
        STATE,
        'nonce-1',
        [STORAGE_EFFECT],
        EFFECTS,
        proof,
      ),
    ).resolves.toBe(true);

    const accountLocks = sqlCalls(client).filter((sql) => /SELECT id FROM accounts/.test(sql));
    expect(accountLocks).toHaveLength(1);
    expect(accountLocks[0]).toContain('FOR NO KEY UPDATE');
    expect(accountLocks[0]).not.toContain('FOR KEY SHARE');
  });

  it('rejects forged, cross-client, mismatched, and consumed parent-lock proofs', async () => {
    const ownerClient = clientStub();
    const otherClient = clientStub();
    const proof = await lockCharacterSaveAccountParentOnClient(
      ownerClient as never,
      OWNER.accountId,
    );
    const saveWith = (
      client: ReturnType<typeof clientStub>,
      candidate: CharacterSaveAccountLockProof,
    ) =>
      saveCharacterStateOnClient(
        client as never,
        OWNER.characterId,
        7,
        STATE,
        'nonce-1',
        [],
        EFFECTS,
        candidate,
      );

    await expect(saveWith(otherClient, proof)).rejects.toThrow(/invalid or consumed/);
    await expect(
      saveWith(
        ownerClient,
        Object.freeze({ accountId: OWNER.accountId }) as CharacterSaveAccountLockProof,
      ),
    ).rejects.toThrow(/invalid or consumed/);

    const wrongAccountProof = await lockCharacterSaveAccountParentOnClient(
      ownerClient as never,
      OWNER.accountId + 1,
    );
    await expect(saveWith(ownerClient, wrongAccountProof)).rejects.toThrow(/does not match/);

    await expect(saveWith(ownerClient, proof)).resolves.toBe(true);
    await expect(saveWith(ownerClient, proof)).rejects.toThrow(/invalid or consumed/);
  });
});

describe('bank ledger receipt schema boot wiring', () => {
  it('applies the receipt DDL after core identities under the boot transaction', async () => {
    await ensureSchema();

    const core = h.bootCalls.findIndex((sql) =>
      sql.includes('CREATE TABLE IF NOT EXISTS accounts'),
    );
    const receipts = h.bootCalls.indexOf(BANK_LEDGER_BATCH_RECEIPTS_SCHEMA);
    const growthBudget = h.bootCalls.indexOf(BANK_LEDGER_GROWTH_BUDGET_SCHEMA);
    const commit = h.bootCalls.indexOf('COMMIT');
    expect(core).toBeGreaterThanOrEqual(0);
    expect(core).toBeLessThan(receipts);
    expect(receipts).toBeLessThan(growthBudget);
    expect(growthBudget).toBeLessThan(commit);
    expect(h.bootCalls.indexOf(STORAGE_PURCHASE_SCHEMA)).toBe(growthBudget - 1);
    // The growth fragment is followed by ONE single-statement counter readback
    // (multi-statement queries return an ARRAY of results, so db.ts reads the
    // counters back separately), then COMMIT. Pin both so a fragment inserted
    // between the growth DDL and COMMIT cannot ride in unnoticed. The readback
    // is matched through the SAME exported builder db.ts issues, so the two
    // cannot drift (the point of exporting it beside the schema builder).
    const readback = h.bootCalls.indexOf(bankLedgerGrowthBudgetReadbackSql());
    expect(readback).toBe(growthBudget + 1);
    expect(growthBudget).toBe(commit - 2);
  });
});

describe('storage effect identity guard, one negative per dimension', () => {
  // The guard at prepareBankLedgerSaveEffects is a 19-clause OR (the nullish
  // arm included); realm was the only dimension with a negative, so deleting
  // any other clause stayed green. Each row breaks exactly one clause against
  // an otherwise valid effect.
  const breakOne: Array<[string, Partial<Record<keyof StorageAppliedEffect, unknown>>]> = [
    ['realm mismatch', { realm: 'other-realm' }],
    ['characterId mismatch', { characterId: OWNER.characterId + 1 }],
    ['accountId not a safe integer', { accountId: 1.5 }],
    ['accountId not positive', { accountId: 0 }],
    ['itemId not a string', { itemId: 7 }],
    ['itemId empty', { itemId: '' }],
    ['cost not a safe integer', { expectedCostClaudium: 1.5 }],
    ['cost not positive', { expectedCostClaudium: 0 }],
    ['idempotency key not a string', { idempotencyKey: 7 }],
    ['idempotency key empty', { idempotencyKey: '' }],
    ['spend claim token not a string', { spendClaimToken: 7 }],
    ['spend claim token empty', { spendClaimToken: '' }],
    ['purchasedSlotsBefore not a safe integer', { purchasedSlotsBefore: 0.5 }],
    ['purchasedSlotsBefore negative', { purchasedSlotsBefore: -6 }],
    // 6.5 is above before (0), so only the safe-integer clause catches it.
    ['purchasedSlotsAfter not a safe integer', { purchasedSlotsAfter: 6.5 }],
    ['purchasedSlotsAfter not above before', { purchasedSlotsAfter: 0 }],
    [
      'purchasedSlotsAfter equal to before',
      { purchasedSlotsAfter: STORAGE_EFFECT.purchasedSlotsBefore },
    ],
  ];
  it.each(breakOne)('refuses a storage effect with %s', (_label, patch) => {
    const effect = { ...STORAGE_EFFECT, ...patch } as StorageAppliedEffect;
    expect(() => prepareBankLedgerSaveEffects(OWNER.characterId, [effect], undefined, [])).toThrow(
      /does not match the character save/,
    );
  });
  it('refuses a nullish effect row and the two unreachable characterId shapes', () => {
    expect(() =>
      prepareBankLedgerSaveEffects(
        OWNER.characterId,
        [undefined as unknown as StorageAppliedEffect],
        undefined,
        [],
      ),
    ).toThrow(/does not match the character save/);
    // The non-safe-integer and non-positive characterId clauses can only fire
    // when the SAVE's own characterId is malformed the same way (the mismatch
    // clause fires first otherwise); drive both anyway so the clauses are hot.
    expect(() =>
      prepareBankLedgerSaveEffects(1.5, [{ ...STORAGE_EFFECT, characterId: 1.5 }], undefined, []),
    ).toThrow(/does not match the character save/);
    expect(() =>
      prepareBankLedgerSaveEffects(0, [{ ...STORAGE_EFFECT, characterId: 0 }], undefined, []),
    ).toThrow(/does not match the character save/);
  });
  it('accepts the unmodified control effect', () => {
    expect(
      prepareBankLedgerSaveEffects(OWNER.characterId, [STORAGE_EFFECT], undefined, []),
    ).toBeUndefined();
  });
});
