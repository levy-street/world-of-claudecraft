// The transactional bank-ledger batch writer is exercised against a capturing
// Queryable. These tests pin the one-round-trip SQL shape and the exact column
// arrays; the caller owns the real transaction and rolls it back on a rejected
// receipt verification.
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  BANK_LEDGER_BATCH_RECEIPTS_SCHEMA,
  BANK_LEDGER_BATCH_RECEIPTS_VALIDATE_LOCK_TIMEOUT_MS,
  BANK_LEDGER_BATCH_RECEIPTS_VALIDATE_SQL,
  BANK_LEDGER_BATCH_RECEIPTS_VALIDATE_TIMEOUT_MS,
  type BankLedgerBatchOwner,
  bankLedgerCommandBatchPayloadSha256,
  validateBankLedgerBatchReceiptsKeyShape,
  writeBankLedgerCommandBatches,
} from '../../server/bank_ledger_batch_db';
import {
  BANK_LEDGER_GROWTH_LIMIT_CONSTRAINT,
  BANK_LEDGER_GROWTH_LIMIT_SQLSTATE,
  type BankLedgerGrowthLimitExceeded,
} from '../../server/bank_ledger_growth_budget';
import type {
  BankLedgerCommandBatch,
  SerializedBankLedgerGuildEffect,
  SerializedBankLedgerOutboxRow,
} from '../../server/bank_ledger_outbox';
import { BANK_LEDGER_OUTBOX_DEFAULT_SESSION_LIMITS } from '../../server/bank_ledger_outbox';

interface CapturedQuery {
  text: string;
  values: unknown[] | undefined;
}

const OWNER: BankLedgerBatchOwner = {
  realm: 'moonbrook',
  characterId: 42,
  accountId: 7,
};

function row(
  overrides: Partial<SerializedBankLedgerOutboxRow> = {},
): SerializedBankLedgerOutboxRow {
  return {
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
    ...overrides,
  };
}

function batch(
  batchKey: string,
  rows: readonly SerializedBankLedgerOutboxRow[],
  guildEffect: SerializedBankLedgerGuildEffect | null = null,
): BankLedgerCommandBatch {
  return { batchKey, rows, encodedBytes: 1, guildEffect };
}

function fingerprint(value: BankLedgerCommandBatch): string {
  // Independent re-implementation of the canonical fingerprint json: the
  // serialized guild effect carries {guildId, deltas, actorAccountId} in that
  // key order, actorAccountId normalized to null when the input omits it.
  const effect = value.guildEffect
    ? {
        guildId: value.guildEffect.guildId,
        deltas: value.guildEffect.deltas,
        actorAccountId: value.guildEffect.actorAccountId ?? null,
      }
    : null;
  return createHash('sha256')
    .update(JSON.stringify({ batchKey: value.batchKey, rows: value.rows, guildEffect: effect }))
    .digest('hex');
}

function guildEffect(
  guildId: number,
  rows: readonly SerializedBankLedgerOutboxRow[],
): SerializedBankLedgerGuildEffect {
  return {
    guildId,
    deltas: rows.map((value) => ({
      op: value.op as 'deposit' | 'withdraw' | 'deposit_gold',
      itemId: value.itemId,
      count: value.count,
      instanceJson: value.instanceJson,
      craftedRecipeId: value.itemId === 'crafted_blade' ? 'recipe.blade' : null,
      copperDelta: value.copperDelta,
      purchasedSlotsBefore: 0,
      purchasedSlotsAfter: value.purchasedSlotsAfter,
    })),
  };
}

function successfulVerification(
  batches: readonly BankLedgerCommandBatch[],
  newlyClaimed: readonly boolean[] = batches.map(() => true),
): Record<string, unknown>[] {
  const insertedRowCount = batches.reduce(
    (total, value, index) => total + (newlyClaimed[index] ? value.rows.length : 0),
    0,
  );
  return batches.map((value, index) => ({
    batch_ordinal: index,
    batch_key: value.batchKey,
    newly_claimed: newlyClaimed[index],
    stored_batch_key: value.batchKey,
    stored_realm: OWNER.realm,
    stored_character_id: OWNER.characterId,
    stored_account_id: OWNER.accountId,
    stored_row_count: value.rows.length,
    stored_payload_sha256: fingerprint(value),
    inserted_row_count: insertedRowCount,
  }));
}

function captureWith(rowsFor: (values: unknown[]) => Record<string, unknown>[]): {
  calls: CapturedQuery[];
  db: {
    query(
      text: string,
      values?: unknown[],
    ): Promise<{ rows: Record<string, unknown>[]; rowCount: number }>;
  };
} {
  const calls: CapturedQuery[] = [];
  return {
    calls,
    db: {
      async query(text: string, values?: unknown[]) {
        calls.push({ text, values });
        const rows = rowsFor(values ?? []);
        return { rows, rowCount: rows.length };
      },
    },
  };
}

describe('bank ledger batch receipt DDL', () => {
  it('creates an append-only receipt with both cascade FKs fully indexed', () => {
    const folded = BANK_LEDGER_BATCH_RECEIPTS_SCHEMA.replace(/\s+/g, ' ');

    expect(folded).toContain(
      'CREATE TABLE IF NOT EXISTS bank_ledger_batch_receipts ( batch_key TEXT PRIMARY KEY',
    );
    expect(folded).toContain(
      'character_id INT NOT NULL REFERENCES characters(id) ON DELETE CASCADE',
    );
    expect(folded).toContain('account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE');
    expect(folded).toContain('row_count INT NOT NULL');
    expect(folded).toContain('payload_sha256 TEXT NOT NULL');
    expect(folded).toContain('created_at TIMESTAMPTZ NOT NULL DEFAULT now()');
    expect(folded).toContain(
      'CREATE INDEX IF NOT EXISTS bank_ledger_batch_receipts_character ON bank_ledger_batch_receipts (character_id);',
    );
    expect(folded).toContain(
      'CREATE INDEX IF NOT EXISTS bank_ledger_batch_receipts_account ON bank_ledger_batch_receipts (account_id);',
    );
    expect(folded).not.toMatch(/bank_ledger_batch_receipts_(?:character|account)[^;]+WHERE/i);
  });

  it('converges the key-shape CHECK bound on existing databases', () => {
    // CREATE TABLE IF NOT EXISTS never revisits the inline constraint, so a
    // changed BANK_LEDGER_OUTBOX_BATCH_KEY_MAX_LENGTH would silently keep the
    // old bound without the DO-block converge. Literal pins (200, not the
    // constant), so a bound change is a conscious edit here too.
    const folded = BANK_LEDGER_BATCH_RECEIPTS_SCHEMA.replace(/\s+/g, ' ');
    expect(folded).toContain("c.conname = 'bank_ledger_batch_receipts_key_shape'");
    expect(folded).toContain("c.conrelid = 'bank_ledger_batch_receipts'::regclass");
    // The probe compares the deployed definition against the compiled bound
    // (pg_get_constraintdef normalizes BETWEEN into >= / <= comparisons) and
    // the exact key regexp.
    expect(folded).toContain("pg_get_constraintdef(c.oid) LIKE '%char_length(batch_key)%'");
    expect(folded).toContain("pg_get_constraintdef(c.oid) LIKE '%<= 200)%'");
    expect(folded).toContain("position('^[A-Za-z0-9_.:-]+$' in pg_get_constraintdef(c.oid)) > 0");
    expect(folded).toContain(
      'ALTER TABLE bank_ledger_batch_receipts DROP CONSTRAINT bank_ledger_batch_receipts_key_shape;',
    );
    // The re-install is NOT VALID: enforcement of new writes starts at once,
    // but boot never pays the full-table validation scan of the keep-forever
    // table (a constant edit or a pg_get_constraintdef rendering change would
    // otherwise re-fire an unbounded ACCESS EXCLUSIVE scan at boot).
    expect(folded).toContain(
      'ALTER TABLE bank_ledger_batch_receipts ADD CONSTRAINT bank_ledger_batch_receipts_key_shape CHECK ( ' +
        "char_length(batch_key) BETWEEN 1 AND 200 AND batch_key ~ '^[A-Za-z0-9_.:-]+$' ) NOT VALID;",
    );
    // The probe must match on the DEFINITION alone: keying it on convalidated
    // would re-fire the drop/add every boot for as long as the constraint sits
    // in its NOT VALID window. Comments are stripped first so an explanatory
    // mention cannot red the absence pin for the wrong reason.
    const code = BANK_LEDGER_BATCH_RECEIPTS_SCHEMA.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');
    expect(code).not.toContain('convalidated');
    // Both the inline CREATE TABLE constraint and the converge re-install must
    // carry the same bound: two occurrences of the full BETWEEN clause.
    expect(folded.split('char_length(batch_key) BETWEEN 1 AND 200').length - 1).toBe(2);
  });

  it('validates a NOT VALID key shape out of boot, and only then', () => {
    const folded = BANK_LEDGER_BATCH_RECEIPTS_VALIDATE_SQL.replace(/\s+/g, ' ');
    // Gated on an existing unvalidated constraint, so the steady-state
    // post-listen pass reads only the catalog.
    expect(folded).toContain("conname = 'bank_ledger_batch_receipts_key_shape'");
    expect(folded).toContain('AND NOT convalidated');
    expect(folded).toContain(
      'ALTER TABLE bank_ledger_batch_receipts VALIDATE CONSTRAINT bank_ledger_batch_receipts_key_shape;',
    );
    // VALIDATE must never appear in the boot-transaction fragment (comments
    // stripped, so prose naming the post-listen half stays legal).
    expect(BANK_LEDGER_BATCH_RECEIPTS_SCHEMA.replace(/--[^\n]*/g, '')).not.toContain(
      'VALIDATE CONSTRAINT',
    );
  });
});

describe('writeBankLedgerCommandBatches', () => {
  it('uses one statement and flattens receipt and ledger columns in command order', async () => {
    const firstRows = [
      row(),
      row({
        op: 'withdraw',
        itemId: 'crafted_blade',
        count: 1,
        instanceJson: '{"durability":17}',
        copperDelta: -25,
        purchasedSlotsAfter: 2,
        container: 'guild',
        containerId: 99,
        counterpartyCopperDelta: 25,
        counterpartyCount: 1,
      }),
    ];
    const first = batch('session.1', firstRows, guildEffect(99, [firstRows[1]]));
    const secondRows = [
      row({
        op: 'deposit_gold',
        itemId: null,
        count: null,
        copperDelta: 50,
        purchasedSlotsAfter: 4,
        container: 'guild',
        containerId: 15,
        counterpartyCopperDelta: -50,
      }),
    ];
    const second = batch('session.2', secondRows, guildEffect(15, secondRows));
    const batches = [first, second];
    const cap = captureWith(() => successfulVerification(batches));

    const result = await writeBankLedgerCommandBatches(cap.db, OWNER, batches);

    expect(cap.calls).toHaveLength(1);
    expect(bankLedgerCommandBatchPayloadSha256(first)).toBe(fingerprint(first));
    const call = cap.calls[0];
    expect(call.text).toContain('WITH receipt_input AS');
    expect(call.text).toContain('row_input AS');
    expect(call.text).toContain('ON CONFLICT (batch_key) DO NOTHING');
    expect(call.text).toContain('JOIN claimed AS c ON c.batch_key = ri.batch_key');
    expect(call.text).toContain('ORDER BY ri.batch_ordinal, ri.row_ordinal');
    expect(call.text).toContain('FROM bank_ledger_batch_receipts AS existing');
    expect(call.text).toContain('FROM inserted');
    expect(call.values).toEqual([
      // Receipt input.
      [0, 1],
      ['session.1', 'session.2'],
      [OWNER.realm, OWNER.realm],
      [OWNER.characterId, OWNER.characterId],
      [OWNER.accountId, OWNER.accountId],
      [2, 1],
      [fingerprint(first), fingerprint(second)],
      // Row input. Both rows of the first command stay adjacent and ordered.
      [0, 0, 1],
      [0, 1, 0],
      ['session.1', 'session.1', 'session.2'],
      [OWNER.realm, OWNER.realm, OWNER.realm],
      [OWNER.characterId, OWNER.characterId, OWNER.characterId],
      [OWNER.accountId, OWNER.accountId, OWNER.accountId],
      ['deposit', 'withdraw', 'deposit_gold'],
      ['linen_cloth', 'crafted_blade', null],
      [3, 1, null],
      [null, '{"durability":17}', null],
      [0, -25, 50],
      [0, 2, 4],
      ['personal', 'guild', 'guild'],
      [null, 99, 15],
      [null, 25, -50],
      [null, 1, null],
    ]);
    expect(result.batches.map((claim) => claim.batch)).toEqual(batches);
    expect(result.batches.every((claim) => claim.newlyClaimed)).toBe(true);
    expect(result.alreadyCommittedPrefix).toEqual([]);
    expect(Object.isFrozen(result.batches)).toBe(true);
  });

  it('accepts a matching lost-COMMIT retry and requires zero new ledger rows', async () => {
    const rows = [row({ container: 'guild', containerId: 81 })];
    const value = batch('storage:already-committed', rows, guildEffect(81, rows));
    const cap = captureWith(() => successfulVerification([value], [false]));

    await expect(writeBankLedgerCommandBatches(cap.db, OWNER, [value])).resolves.toMatchObject({
      batches: [{ batch: value, newlyClaimed: false }],
      alreadyCommittedPrefix: [value],
    });
    expect(cap.calls).toHaveLength(1);
  });

  it('translates the database trigger refusal without retrying the statement', async () => {
    const value = batch('session.growth-limit', [row(), row()]);
    let calls = 0;
    const pgError = {
      code: BANK_LEDGER_GROWTH_LIMIT_SQLSTATE,
      constraint: BANK_LEDGER_GROWTH_LIMIT_CONSTRAINT,
      detail: JSON.stringify({
        committed_rows: 9_999_999,
        attempted_rows: 2,
        hard_limit_rows: 10_000_000,
      }),
    };
    const db = {
      async query(): Promise<{ rows: Record<string, unknown>[] }> {
        calls++;
        throw pgError;
      },
    };

    await expect(writeBankLedgerCommandBatches(db, OWNER, [value])).rejects.toMatchObject({
      name: 'BankLedgerGrowthLimitExceeded',
      committedRows: 9_999_999,
      attemptedRows: 2,
      hardLimitRows: 10_000_000,
    } satisfies Partial<BankLedgerGrowthLimitExceeded>);
    expect(calls).toBe(1);
  });

  it.each([
    ['owner', { stored_account_id: OWNER.accountId + 1 }],
    ['count', { stored_row_count: 99 }],
    ['fingerprint', { stored_payload_sha256: 'f'.repeat(64) }],
    [
      'missing',
      {
        stored_batch_key: null,
        stored_realm: null,
        stored_character_id: null,
        stored_account_id: null,
        stored_row_count: null,
        stored_payload_sha256: null,
      },
    ],
  ])('rejects a %s receipt mismatch', async (_kind, override) => {
    const value = batch('session.mismatch', [row()]);
    const result = { ...successfulVerification([value], [false])[0], ...override };
    const cap = captureWith(() => [result]);

    await expect(writeBankLedgerCommandBatches(cap.db, OWNER, [value])).rejects.toThrow(
      /receipt verification failed.*session\.mismatch/,
    );
    expect(cap.calls).toHaveLength(1);
  });

  it('rejects an inserted-row count mismatch', async () => {
    const value = batch('session.short-insert', [row(), row()]);
    const result = { ...successfulVerification([value])[0], inserted_row_count: 1 };
    const cap = captureWith(() => [result]);

    await expect(writeBankLedgerCommandBatches(cap.db, OWNER, [value])).rejects.toThrow(
      /inserted row count mismatch/,
    );
  });

  it('accepts only an existing prefix followed by a new suffix', async () => {
    const values = [
      batch('session.existing.1', [row()]),
      batch('session.existing.2', [row()]),
      batch('session.new.1', [row()]),
      batch('session.new.2', [row()]),
    ];
    const cap = captureWith(() => successfulVerification(values, [false, false, true, true]));

    const result = await writeBankLedgerCommandBatches(cap.db, OWNER, values);
    expect(result.batches.map((claim) => claim.newlyClaimed)).toEqual([false, false, true, true]);
    expect(result.alreadyCommittedPrefix).toEqual(values.slice(0, 2));

    const invalid = captureWith(() => successfulVerification(values, [false, true, false, true]));
    await expect(writeBankLedgerCommandBatches(invalid.db, OWNER, values)).rejects.toThrow(
      /existing batch .* follows a new batch/,
    );
    expect(invalid.calls).toHaveLength(1);
  });

  it('binds crafted provenance and both ladder witnesses into the receipt fingerprint', async () => {
    const rows = [row({ container: 'guild', containerId: 19 })];
    const base = batch('session.guild.fingerprint', rows, guildEffect(19, rows));
    const changedRecipe = batch('session.guild.fingerprint', rows, {
      ...guildEffect(19, rows),
      deltas: [{ ...guildEffect(19, rows).deltas[0], craftedRecipeId: 'recipe.other' }],
    });
    const changedBefore = batch('session.guild.fingerprint', rows, {
      ...guildEffect(19, rows),
      deltas: [{ ...guildEffect(19, rows).deltas[0], purchasedSlotsBefore: 24 }],
    });
    const changedAfterRows = [{ ...rows[0], purchasedSlotsAfter: 30 }];
    const changedAfter = batch(
      'session.guild.fingerprint',
      changedAfterRows,
      guildEffect(19, changedAfterRows),
    );

    const expectedHash = fingerprint(base);
    for (const changed of [changedRecipe, changedBefore, changedAfter]) {
      expect(fingerprint(changed)).not.toBe(expectedHash);
      const cap = captureWith(() => [
        { ...successfulVerification([changed], [false])[0], stored_payload_sha256: expectedHash },
      ]);
      await expect(writeBankLedgerCommandBatches(cap.db, OWNER, [changed])).rejects.toThrow(
        /receipt verification failed/,
      );
    }
  });

  it('refuses a lost-COMMIT retry against a receipt hashed with the PRE-attribution shape', async () => {
    // The guild-effect fingerprint gained actorAccountId in this same release,
    // and the receipts table ships first in this release, so no production
    // receipt with the OLD canonical json exists to collide (the DEPLOY.md
    // batch-receipts note documents that empty window). If one ever did (a
    // hand-applied preview install), the deliberate outcome is this refusal,
    // never a silent acceptance of a batch the stored hash does not cover.
    const rows = [row({ container: 'guild', containerId: 7 })];
    const value = batch('guild:pre-attribution', rows, guildEffect(7, rows));
    // The pre-change canonical json: identical except the guild effect ends at
    // deltas (no actorAccountId key existed to serialize).
    const preChangeSha = createHash('sha256')
      .update(
        JSON.stringify({
          batchKey: value.batchKey,
          rows: value.rows,
          guildEffect: { guildId: 7, deltas: value.guildEffect?.deltas },
        }),
      )
      .digest('hex');
    expect(preChangeSha).not.toBe(fingerprint(value));

    const cap = captureWith(() => [
      { ...successfulVerification([value], [false])[0], stored_payload_sha256: preChangeSha },
    ]);
    await expect(writeBankLedgerCommandBatches(cap.db, OWNER, [value])).rejects.toThrow(
      /receipt verification failed for batch guild:pre-attribution/,
    );
    expect(cap.calls).toHaveLength(1);
  });

  it('validates owner, keys, nonempty rows, and row ownership before querying', () => {
    const cap = captureWith(() => []);
    const mismatch = batch('session.owner', [row({ characterId: OWNER.characterId + 1 })]);
    const empty = batch('session.empty', []);
    const duplicate = [batch('session.dupe', [row()]), batch('session.dupe', [row()])];

    expect(() => writeBankLedgerCommandBatches(cap.db, { ...OWNER, realm: '' }, [])).toThrow(
      /owner\.realm/,
    );
    expect(() => writeBankLedgerCommandBatches(cap.db, OWNER, [mismatch])).toThrow(
      /does not match owner/,
    );
    expect(() => writeBankLedgerCommandBatches(cap.db, OWNER, [empty])).toThrow(
      /must contain at least one row/,
    );
    expect(() => writeBankLedgerCommandBatches(cap.db, OWNER, duplicate)).toThrow(
      /duplicate bank ledger batch key/,
    );
    expect(() =>
      writeBankLedgerCommandBatches(cap.db, OWNER, [batch('unsafe key', [row()])]),
    ).toThrow(/batch key/);
    expect(cap.calls).toHaveLength(0);
  });

  it('does no query for a valid empty snapshot', async () => {
    const cap = captureWith(() => []);
    await expect(writeBankLedgerCommandBatches(cap.db, OWNER, [])).resolves.toEqual({
      batches: [],
      alreadyCommittedPrefix: [],
    });
    expect(cap.calls).toHaveLength(0);
  });

  it('keeps the row-saturated outbox prefix to one classification query', async () => {
    const batches = Array.from(
      { length: BANK_LEDGER_OUTBOX_DEFAULT_SESSION_LIMITS.maxRows },
      (_, index) => batch(`session.max.${index}`, [row({ itemId: `material_${index}` })]),
    );
    const cap = captureWith(() => successfulVerification(batches));

    const result = await writeBankLedgerCommandBatches(cap.db, OWNER, batches);
    expect(cap.calls).toHaveLength(1);
    expect(result.batches).toHaveLength(BANK_LEDGER_OUTBOX_DEFAULT_SESSION_LIMITS.maxRows);
    expect(cap.calls[0].text.match(/WITH receipt_input AS/g)).toHaveLength(1);
  });
});

describe('validateBankLedgerBatchReceiptsKeyShape', () => {
  const SET_LOCAL_BOUNDS =
    `SET LOCAL statement_timeout = ${BANK_LEDGER_BATCH_RECEIPTS_VALIDATE_TIMEOUT_MS}; ` +
    `SET LOCAL lock_timeout = ${BANK_LEDGER_BATCH_RECEIPTS_VALIDATE_LOCK_TIMEOUT_MS}`;

  it('runs the VALIDATE inside its own transaction with SET LOCAL bounds, in order', async () => {
    const calls: string[] = [];
    const ok = await validateBankLedgerBatchReceiptsKeyShape({
      query: (text) => {
        calls.push(text);
        return Promise.resolve({ rows: [] });
      },
    });
    expect(ok).toBe(true);
    expect(calls).toEqual([
      'BEGIN',
      SET_LOCAL_BOUNDS,
      BANK_LEDGER_BATCH_RECEIPTS_VALIDATE_SQL,
      'COMMIT',
    ]);
    // Real bounds, not re-disables: the concurrent-index phase runs this
    // session at statement_timeout 0. SET LOCAL (never session SET) is what
    // keeps the 60s allowance from leaking to a future pooled caller of the
    // exported helper; the values are by-value pins so a constant edit is a
    // conscious decision here too.
    expect(BANK_LEDGER_BATCH_RECEIPTS_VALIDATE_TIMEOUT_MS).toBe(60_000);
    expect(BANK_LEDGER_BATCH_RECEIPTS_VALIDATE_LOCK_TIMEOUT_MS).toBe(5_000);
  });

  it('swallows a VALIDATE failure loudly: rolls back, resolves false, never throws', async () => {
    // A shape-violating survivor row (23514) or a deadline expiry (57014)
    // must leave boot green; the constraint stays NOT VALID for the next
    // boot to retry while new writes keep enforcing.
    const calls: string[] = [];
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const ok = await validateBankLedgerBatchReceiptsKeyShape({
        query: (text) => {
          calls.push(text);
          return text.includes('VALIDATE CONSTRAINT')
            ? Promise.reject(Object.assign(new Error('violated by some row'), { code: '23514' }))
            : Promise.resolve({ rows: [] });
        },
      });
      expect(ok).toBe(false);
      // The failed transaction is rolled back, never left open on the client.
      expect(calls).toEqual([
        'BEGIN',
        SET_LOCAL_BOUNDS,
        BANK_LEDGER_BATCH_RECEIPTS_VALIDATE_SQL,
        'ROLLBACK',
      ]);
      expect(errors).toHaveBeenCalledTimes(1);
      expect(String(errors.mock.calls[0][0])).toContain('key-shape VALIDATE failed');
      expect(String(errors.mock.calls[0][0])).toContain('NOT VALID');
    } finally {
      errors.mockRestore();
    }
  });

  it('a failed SET LOCAL is contained the same way: the fragment is never issued unbounded', async () => {
    const calls: string[] = [];
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const ok = await validateBankLedgerBatchReceiptsKeyShape({
        query: (text) => {
          calls.push(text);
          return text.startsWith('SET LOCAL ')
            ? Promise.reject(new Error('connection lost'))
            : Promise.resolve({ rows: [] });
        },
      });
      expect(ok).toBe(false);
      // The rejection came from the SET LOCAL, so the VALIDATE fragment must
      // not have been sent in a transaction whose bounds are unknown, and the
      // rollback attempt still closes the transaction out.
      expect(calls).toEqual(['BEGIN', SET_LOCAL_BOUNDS, 'ROLLBACK']);
    } finally {
      errors.mockRestore();
    }
  });
});
