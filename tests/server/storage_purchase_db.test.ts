// Bank Storage phase 11: text-level pins for server/storage_purchase_db.ts
// against a capturing fake pool. A fake pool cannot tell whether SQL parses
// (that executed proof is the TEST_DATABASE_URL-gated twin,
// storage_purchase_db.pg.test.ts), so these pins anchor the load-bearing
// CLAUSES: the unique-key upsert, monotone settlement and guarded deletion,
// the closed status vocabulary, and the DDL's recovery index. Each anchor is a
// contiguous clause with its occurrence pinned, never a lone keyword.
import { describe, expect, it, vi } from 'vitest';
import {
  BANK_LEDGER_GROWTH_LIMIT_CONSTRAINT,
  BANK_LEDGER_GROWTH_LIMIT_SQLSTATE,
  BankLedgerGrowthLimitExceeded,
} from '../../server/bank_ledger_growth_budget';
import type { DbTransactionDeadlineClient } from '../../server/db_transaction_deadline';
import {
  beginStoragePurchase,
  claimStoragePurchaseSpend,
  deletePendingStoragePurchaseWithoutDebit,
  lockStorageAppliedEffectAccountsOnClient,
  openStoragePurchaseForCharacter,
  pendingStoragePurchasesForCharacter,
  releaseStoragePurchaseSpendClaim,
  renewStoragePurchaseSpendClaim,
  STORAGE_PURCHASE_SCHEMA,
  STORAGE_PURCHASE_TRANSACTION_TIMEOUT_MS,
  settleStoragePurchase,
  storagePurchaseByKey,
  storagePurchaseSchema,
  writeStorageAppliedEffectsOnClient,
} from '../../server/storage_purchase_db';

interface Captured {
  text: string;
  values: unknown[] | undefined;
}

function makeCapture(results: { rows?: Record<string, unknown>[]; rowCount?: number }[] = []) {
  const calls: Captured[] = [];
  const query = async (text: string, values?: unknown[]) => {
    calls.push({ text, values });
    const control =
      text === 'BEGIN' ||
      text === 'COMMIT' ||
      text === 'ROLLBACK' ||
      text.startsWith('SET LOCAL ') ||
      text.includes('SELECT id FROM accounts WHERE id = $1 FOR KEY SHARE') ||
      text.includes('SELECT id FROM characters WHERE id = $1 FOR UPDATE') ||
      text.includes('pg_advisory_xact_lock');
    if (control) return { rows: [], rowCount: 0 };
    const next = results.shift() ?? {};
    return { rows: next.rows ?? [], rowCount: next.rowCount ?? 0 };
  };
  return {
    calls,
    db: {
      query,
      connect: async () =>
        ({
          query,
          release: () => {},
          on: () => {},
          removeListener: () => {},
        }) as unknown as DbTransactionDeadlineClient,
    },
  };
}

function dataCalls(calls: Captured[]): Captured[] {
  return calls.filter(
    ({ text }) =>
      text !== 'BEGIN' &&
      text !== 'COMMIT' &&
      text !== 'ROLLBACK' &&
      !text.startsWith('SET LOCAL ') &&
      !text.includes('SELECT id FROM accounts WHERE id = $1 FOR KEY SHARE') &&
      !text.includes('SELECT id FROM characters WHERE id = $1 FOR UPDATE') &&
      !text.includes('pg_advisory_xact_lock'),
  );
}

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;
// SQL comments are stripped before every source match (the
// tests/vault_craft_gate.test.ts idiom): a /* */ wrap or a -- line carrying
// the pinned text must never keep a pin green while the statement is dead
// (wrapping the search_path capture in a block comment did exactly that
// against the raw fold).
const codeOnly = (sql: string): string =>
  sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, '');
const CLAIM_TOKEN = '00000000-0000-4000-8000-000000000001';

describe('the DDL', () => {
  it('creates operational rows plus deletion-proof applied receipts', () => {
    const code = codeOnly(STORAGE_PURCHASE_SCHEMA);
    const folded = code.replace(/\s+/g, ' ');
    expect(folded).toContain('SET LOCAL search_path = "public", pg_catalog, pg_temp;');
    expect(count(folded, 'SET search_path = pg_catalog, "public", pg_temp')).toBe(3);
    // SET LOCAL survives to COMMIT, not statement end: the fragment must
    // capture the caller's in-flight search_path BEFORE its own SET LOCAL and
    // END by replaying that captured value, so the rest of the boot
    // transaction (ensureSchema runs later fragments on the same client) and
    // any caller-scoped SET LOCAL are unaffected. The behavioral half (a
    // callee-mutated search_path really is restored) lives in
    // storage_purchase_db.pg.test.ts.
    const capture = folded.indexOf(
      "set_config( 'woc.storage_purchase_prior_search_path', current_setting('search_path'), true )",
    );
    const takeover = folded.indexOf('SET LOCAL search_path = "public", pg_catalog, pg_temp;');
    expect(capture).toBeGreaterThanOrEqual(0);
    expect(capture).toBeLessThan(takeover);
    // The replay reads the capture with missing_ok and falls back to the
    // session default: a savepoint rollback that discarded the capture (or a
    // session that never registered the GUC) must degrade to the old TO
    // DEFAULT behavior, never SET search_path to empty (the pg suite drives
    // that path for real).
    expect(count(folded, "current_setting('woc.storage_purchase_prior_search_path', true)")).toBe(
      1,
    );
    expect(folded).toContain(
      "COALESCE( NULLIF(current_setting('woc.storage_purchase_prior_search_path', true), ''), " +
        "(SELECT reset_val FROM pg_settings WHERE name = 'search_path') )",
    );
    expect(
      STORAGE_PURCHASE_SCHEMA.trimEnd().endsWith(
        "SELECT set_config(\n  'search_path',\n  COALESCE(\n    NULLIF(current_setting('woc.storage_purchase_prior_search_path', true), ''),\n    (SELECT reset_val FROM pg_settings WHERE name = 'search_path')\n  ),\n  true\n);",
      ),
    ).toBe(true);
    expect(count(code, 'CREATE TABLE IF NOT EXISTS storage_purchases')).toBe(1);
    expect(count(code, 'CREATE TABLE IF NOT EXISTS storage_purchase_applied_receipts')).toBe(1);
    expect(count(code, 'CREATE TABLE IF NOT EXISTS storage_purchase_schema_migrations')).toBe(1);
    expect(count(code, 'idempotency_key TEXT NOT NULL UNIQUE')).toBe(1);
    expect(count(code, 'expected_cost_claudium INT NOT NULL')).toBe(2);
    expect(count(code, "status TEXT NOT NULL DEFAULT 'pending'")).toBe(1);
    expect(folded).toContain('spend_claim_token TEXT');
    expect(folded).toContain('spend_claim_expires_at TIMESTAMPTZ');
    expect(folded).toContain("spend_claim_token ~ '^[0-9a-f]{8}-");
    expect(folded).toContain("SELECT c.convalidated AND c.contype = 'c'");
    expect(folded).toContain('cardinality(c.conkey) = 2');
    expect(folded).toContain("pg_get_constraintdef(c.oid) LIKE '%spend_claim_token IS NOT NULL%'");
    // The FK indexes stay FULL for cascades. The partial unique index is the
    // paid-rail authority for both possibly and confirmed debited work.
    expect(
      count(
        code,
        'CREATE INDEX IF NOT EXISTS storage_purchases_character ON storage_purchases (character_id);',
      ),
    ).toBe(1);
    expect(
      count(
        code,
        'CREATE INDEX IF NOT EXISTS storage_purchases_account ON storage_purchases (account_id);',
      ),
    ).toBe(1);
    // Both delete cascades are pinned as text here and executed in the PG16 CI
    // shard. Keeping the fast structural assertion makes an accidental FK
    // change fail before the integration shard reaches its lifecycle cases.
    expect(code).toContain('account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE');
    expect(code).toContain('character_id INT NOT NULL REFERENCES characters(id) ON DELETE CASCADE');
    const receiptStart = folded.indexOf(
      'CREATE TABLE IF NOT EXISTS storage_purchase_applied_receipts',
    );
    const receiptClause = folded.slice(receiptStart, folded.indexOf(';', receiptStart));
    expect(receiptClause).toContain('character_id INT NOT NULL');
    expect(receiptClause).not.toContain('character_id INT NOT NULL REFERENCES characters');
    expect(receiptClause).toContain(
      'account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE',
    );
    expect(receiptClause).toContain('purchased_slots_after > purchased_slots_before');
    expect(folded).toContain(
      'CREATE INDEX IF NOT EXISTS storage_purchase_applied_receipts_account ON storage_purchase_applied_receipts (account_id);',
    );
    expect(folded).toContain("VALUES ('applied-receipts-v1') ON CONFLICT DO NOTHING");
    expect(folded).toContain("WHERE p.status = 'applied'");
    expect(folded).toContain(
      'CREATE TRIGGER storage_purchase_archive_applied AFTER INSERT OR UPDATE OF status ON storage_purchases',
    );
    expect(folded).toContain(
      'CREATE TRIGGER storage_purchase_guard_consumed_key BEFORE INSERT ON storage_purchases',
    );
    expect(folded).toContain('DROP INDEX IF EXISTS storage_purchases_character_pending;');
    expect(folded).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS storage_purchases_one_open_per_character ' +
        "ON storage_purchases USING btree (character_id) WHERE status IN ('pending', 'unresolved');",
    );
    expect(folded).toContain('DROP INDEX IF EXISTS storage_purchases_one_pending_per_character;');
    expect(folded).toContain("a.attname = 'character_id'");
    expect(folded).toContain("am.amname = 'btree'");
    expect(folded).toContain("opc.opcname = 'int4_ops'");
    expect(folded).toContain("opcnsp.nspname = 'pg_catalog'");
    expect(folded).toContain(
      "pg_get_expr(i.indpred, i.indrelid) = '(status = ANY (ARRAY[''pending''::text, ''unresolved''::text]))'",
    );
    expect(folded).toContain('i.indisunique AND i.indisvalid AND i.indisready');
    expect(folded).toContain('i.indnkeyatts = 1 AND i.indnatts = 1');
    const openGuard = folded.slice(
      folded.indexOf('DO $storage_purchase_open_unique_guard$'),
      folded.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS storage_purchases_one_open_per_character'),
    );
    expect(openGuard).toContain(
      'IF NOT COALESCE(open_index_ready, false) THEN SELECT character_id INTO duplicate_character_id FROM "public".storage_purchases',
    );
    expect(openGuard).toContain("WHERE status IN ('pending', 'unresolved')");
    expect(openGuard.indexOf('IF NOT COALESCE(open_index_ready, false)')).toBeLessThan(
      openGuard.indexOf('GROUP BY character_id'),
    );
    expect(count(openGuard, 'GROUP BY character_id')).toBe(1);
    expect(folded).toContain('DROP INDEX IF EXISTS storage_purchases_refused;');
    expect(count(folded, "DELETE FROM storage_purchases WHERE status = 'refused';")).toBe(1);
    expect(folded).toContain(
      "IF status_constraint IS NULL OR status_constraint LIKE '%refused%' THEN DELETE FROM storage_purchases WHERE status = 'refused';",
    );
    // The dev-only converge announces what it removed: the DELETE is needed
    // (the ADD CONSTRAINT below it validates existing rows and would abort
    // boot on legacy refused rows) but must never be silent.
    expect(folded).toContain('GET DIAGNOSTICS removed_refused = ROW_COUNT;');
    expect(folded).toContain(
      "RAISE NOTICE 'storage_purchases: removed % legacy refused row(s) before installing the closed status constraint', removed_refused;",
    );
    expect(folded).toContain("CHECK (status IN ('pending', 'applied', 'unresolved'))");
    expect(folded).toContain(
      'CREATE OR REPLACE FUNCTION guard_pending_storage_purchase_parent_delete()',
    );
    expect(folded).toContain("WHERE character_id = OLD.id AND status IN ('pending', 'unresolved')");
    expect(folded).toContain("WHERE account_id = OLD.id AND status IN ('pending', 'unresolved')");
    expect(folded).toContain("ERRCODE = '55006'");
    expect(folded).toContain("MESSAGE = 'storage_purchase_open'");
    expect(folded).toContain("CONSTRAINT = 'storage_purchases_open_delete_guard'");
    expect(folded).toContain(
      'CREATE TRIGGER storage_purchase_guard_character_delete BEFORE DELETE ON characters',
    );
    expect(folded).toContain(
      'CREATE TRIGGER storage_purchase_guard_account_delete BEFORE DELETE ON accounts',
    );
    const consumedGuard = folded.slice(
      folded.indexOf('CREATE OR REPLACE FUNCTION guard_storage_purchase_consumed_key()'),
      folded.indexOf(
        '$storage_purchase_guard$;',
        folded.indexOf('guard_storage_purchase_consumed_key'),
      ),
    );
    expect(consumedGuard.indexOf('FOR KEY SHARE')).toBeLessThan(
      consumedGuard.indexOf('FOR UPDATE'),
    );
    expect(consumedGuard.indexOf('FOR UPDATE')).toBeLessThan(
      consumedGuard.indexOf('PERFORM pg_catalog.pg_advisory_xact_lock'),
    );
    expect(consumedGuard.indexOf('PERFORM pg_catalog.pg_advisory_xact_lock')).toBeLessThan(
      consumedGuard.indexOf('IF EXISTS'),
    );
    const archiveGuard = folded.slice(
      folded.indexOf('CREATE OR REPLACE FUNCTION archive_storage_purchase_applied_receipt()'),
      folded.indexOf('$storage_purchase_receipt$;', folded.indexOf('archive_storage_purchase')),
    );
    expect(archiveGuard.indexOf('PERFORM pg_catalog.pg_advisory_xact_lock')).toBeLessThan(
      archiveGuard.indexOf('INSERT INTO "public".storage_purchase_applied_receipts'),
    );
    expect(folded).toContain('pg_catalog.hashtextextended(NEW.idempotency_key, 0)');
    expect(archiveGuard).toContain("IF NEW.status <> 'applied' THEN RETURN NEW; END IF;");
    const triggerGuard = folded.slice(folded.indexOf('DO $storage_purchase_trigger_guard$'));
    expect(triggerGuard).toContain('t.tgtype = 11');
    expect(triggerGuard).toContain('t.tgtype = 7');
    expect(triggerGuard).toContain('t.tgtype = 21');
    expect(triggerGuard).toContain("t.tgenabled = 'O'");
    expect(triggerGuard).toContain('NOT t.tgisinternal');
    expect(triggerGuard).toContain('t.tgnargs = 0');
    expect(count(triggerGuard, 't.tgqual IS NULL')).toBe(4);
    expect(folded.indexOf('DO $storage_purchase_trigger_guard$')).toBeGreaterThan(
      folded.indexOf('CREATE OR REPLACE FUNCTION guard_storage_purchase_consumed_key()'),
    );
    expect(count(folded, 'DROP TRIGGER IF EXISTS')).toBe(4);
    expect(count(triggerGuard, 'IF NOT COALESCE(trigger_ready, false) THEN')).toBe(4);
    // Both FK indexes stay FULL: a partial index cannot serve a delete cascade.
    expect(folded).not.toContain(
      'storage_purchases_character ON storage_purchases (character_id) WHERE',
    );
    expect(folded).not.toContain(
      'storage_purchases_account ON storage_purchases (account_id) WHERE',
    );
    // Every CREATE remains idempotent; the deliberate DROP/DELETE migration
    // above removes only the feature branch's abandoned refusal artifacts.
    expect(count(code, 'CREATE TABLE')).toBe(count(code, 'CREATE TABLE IF NOT EXISTS'));
    expect(count(code, 'CREATE INDEX')).toBe(count(code, 'CREATE INDEX IF NOT EXISTS'));
  });

  it('qualifies fixed-path trigger authority for private schemas', () => {
    const privateSchema = storagePurchaseSchema('isolated_storage');
    const folded = codeOnly(privateSchema).replace(/\s+/g, ' ');
    expect(folded).toContain('SET LOCAL search_path = "isolated_storage", pg_catalog, pg_temp;');
    expect(count(folded, 'SET search_path = pg_catalog, "isolated_storage", pg_temp')).toBe(3);
    expect(folded).toContain('pg_catalog.pg_advisory_xact_lock(');
    expect(folded).toContain('pg_catalog.hashtextextended(NEW.idempotency_key, 0)');
    expect(folded).toContain('FROM "isolated_storage".storage_purchases');
    expect(folded).toContain('INSERT INTO "isolated_storage".storage_purchase_applied_receipts');
    expect(folded).toContain('PERFORM 1 FROM "isolated_storage".accounts');
    expect(folded).toContain('PERFORM 1 FROM "isolated_storage".characters');
    expect(folded).toContain('FROM "isolated_storage".storage_purchase_applied_receipts');
    expect(() => storagePurchaseSchema('public; DROP SCHEMA public')).toThrow(
      /simple lowercase identifier/,
    );
  });
});

describe('cross-process spend claims', () => {
  it('acquires after absence/expiry, renews only the owner, and releases by token', async () => {
    const acquired = makeCapture([{ rows: [{ id: 1 }], rowCount: 1 }]);
    expect(await claimStoragePurchaseSpend(acquired.db, 'k-claim', CLAIM_TOKEN)).toBe(true);
    expect(acquired.calls[0].text).toContain('spend_claim_expires_at <= now()');
    expect(acquired.calls[0].text).toContain('spend_claim_token = $2');
    expect(acquired.calls[0].values).toEqual(['k-claim', CLAIM_TOKEN, 15_000]);

    const renewed = makeCapture([{ rows: [{ id: 1 }], rowCount: 1 }]);
    expect(await renewStoragePurchaseSpendClaim(renewed.db, 'k-claim', CLAIM_TOKEN)).toBe(true);
    expect(renewed.calls[0].text).not.toContain('spend_claim_expires_at <= now()');
    expect(renewed.calls[0].text).toContain('AND spend_claim_token = $2');

    const released = makeCapture([{ rowCount: 1 }]);
    expect(await releaseStoragePurchaseSpendClaim(released.db, 'k-claim', CLAIM_TOKEN)).toBe(true);
    expect(released.calls[0].text).toContain('AND spend_claim_token = $2');
  });
});

describe('beginStoragePurchase', () => {
  const ROW = {
    realm: 'r1',
    accountId: 7,
    characterId: 42,
    itemId: 'strongbox_rung_01',
    expectedCostClaudium: 100,
    idempotencyKey: 'k-1',
    claimToken: CLAIM_TOKEN,
  };

  it('upserts under the unique key and returns the inserted row', async () => {
    const cap = makeCapture([
      {
        rows: [
          {
            id: 5,
            realm: 'r1',
            account_id: 7,
            character_id: 42,
            item_id: 'strongbox_rung_01',
            expected_cost_claudium: 100,
            idempotency_key: 'k-1',
            status: 'pending',
          },
        ],
      },
    ]);
    const res = await beginStoragePurchase(cap.db, ROW);
    const data = dataCalls(cap.calls);
    expect(data).toHaveLength(1);
    expect(count(data[0].text, 'INSERT INTO storage_purchases')).toBe(1);
    expect(count(data[0].text, 'VALUES ($1, $2, $3, $4, $5, $6, $7,')).toBe(1);
    expect(count(data[0].text, 'ON CONFLICT DO NOTHING')).toBe(1);
    expect(count(data[0].text, 'RETURNING')).toBe(1);
    expect(data[0].values).toEqual([
      'r1',
      7,
      42,
      'strongbox_rung_01',
      100,
      'k-1',
      ROW.claimToken,
      15_000,
    ]);
    expect(cap.calls.map(({ text }) => text.trim())).toEqual(
      expect.arrayContaining([
        'BEGIN',
        'SET LOCAL statement_timeout = 15000; SET LOCAL lock_timeout = 2000; SET LOCAL idle_in_transaction_session_timeout = 2000',
        'SELECT id FROM accounts WHERE id = $1 FOR KEY SHARE',
        'SELECT id FROM characters WHERE id = $1 FOR UPDATE',
        'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))',
        'COMMIT',
      ]),
    );
    expect(res).toEqual({
      inserted: true,
      existing: {
        id: 5,
        realm: 'r1',
        accountId: 7,
        characterId: 42,
        itemId: 'strongbox_rung_01',
        expectedCostClaudium: 100,
        idempotencyKey: 'k-1',
        status: 'pending',
      },
    });
  });

  it('on conflict re-reads the existing row instead of inserting', async () => {
    const cap = makeCapture([
      { rows: [] },
      {
        rows: [
          {
            id: 4,
            realm: 'r1',
            account_id: 8,
            character_id: 43,
            item_id: 'strongbox_charter_1',
            expected_cost_claudium: 500,
            idempotency_key: 'k-1',
            status: 'applied',
          },
        ],
      },
    ]);
    const res = await beginStoragePurchase(cap.db, ROW);
    const data = dataCalls(cap.calls);
    expect(data).toHaveLength(2);
    expect(count(data[1].text, 'storage_purchase_applied_receipts')).toBe(1);
    expect(count(data[1].text, 'storage_purchases')).toBe(2);
    expect(count(data[1].text, 'ORDER BY source_rank')).toBe(1);
    expect(data[1].values).toEqual(['k-1', 42]);
    expect(res.inserted).toBe(false);
    expect(res.existing?.status).toBe('applied');
    expect(res.existing?.accountId).toBe(8);
  });

  it('distinguishes a different unresolved key holding the same character rail', async () => {
    const cap = makeCapture([
      { rows: [] },
      {
        rows: [
          {
            id: 9,
            realm: 'r1',
            account_id: 7,
            character_id: 42,
            item_id: 'strongbox_rung_01',
            expected_cost_claudium: 100,
            idempotency_key: 'older-open-key',
            status: 'unresolved',
            conflict_kind: 'character_open',
          },
        ],
      },
    ]);

    const res = await beginStoragePurchase(cap.db, { ...ROW, idempotencyKey: 'new-key' });
    const data = dataCalls(cap.calls);
    expect(data).toHaveLength(2);
    expect(data[0].text).toContain('ON CONFLICT DO NOTHING');
    expect(data[0].text).not.toContain('ON CONFLICT (idempotency_key)');
    expect(data[1].text.replace(/\s+/g, ' ')).toContain(
      "character_id = $2 AND status IN ('pending', 'unresolved')",
    );
    expect(data[1].values).toEqual(['new-key', 42]);
    expect(res).toEqual({
      inserted: false,
      existing: null,
      blockedByOpen: expect.objectContaining({
        characterId: 42,
        idempotencyKey: 'older-open-key',
        status: 'unresolved',
      }),
    });
  });

  it('destroys a checked-out begin client when its whole transaction deadline expires', async () => {
    vi.useFakeTimers();
    let rejectActiveQuery: ((error: unknown) => void) | undefined;
    const release = vi.fn((error?: Error | boolean) => {
      if (error instanceof Error) rejectActiveQuery?.(error);
    });
    const query = vi.fn<(text: string, values?: unknown[]) => Promise<never>>(
      () =>
        new Promise<never>((_resolve, reject) => {
          rejectActiveQuery = reject;
        }),
    );
    const client = {
      query,
      release,
      on: vi.fn(),
      removeListener: vi.fn(),
    } as unknown as DbTransactionDeadlineClient;
    try {
      const begun = beginStoragePurchase({ query, connect: async () => client }, ROW);
      const rejection = expect(begun).rejects.toMatchObject({
        name: 'DbTransactionDeadlineExceeded',
        commitMayHaveSucceeded: false,
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(query).toHaveBeenCalledWith('BEGIN', undefined);
      await vi.advanceTimersByTimeAsync(STORAGE_PURCHASE_TRANSACTION_TIMEOUT_MS);
      await rejection;
      expect(release).toHaveBeenCalledTimes(1);
      expect(release.mock.calls[0][0]).toMatchObject({
        name: 'DbTransactionDeadlineExceeded',
      });
      expect(query.mock.calls.some(([text]) => text === 'ROLLBACK')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('storagePurchaseByKey', () => {
  it('reads a durable receipt before an operational row with the same key', async () => {
    const cap = makeCapture([{ rows: [] }]);
    const res = await storagePurchaseByKey(cap.db, 'k-2');
    expect(cap.calls).toHaveLength(1);
    expect(count(cap.calls[0].text, 'INSERT')).toBe(0);
    expect(count(cap.calls[0].text, 'storage_purchase_applied_receipts')).toBe(1);
    expect(count(cap.calls[0].text, 'storage_purchases')).toBe(1);
    expect(count(cap.calls[0].text, "'applied'::text AS status")).toBe(1);
    expect(count(cap.calls[0].text, 'ORDER BY source_rank')).toBe(1);
    expect(count(cap.calls[0].text, 'LIMIT 1')).toBe(1);
    expect(cap.calls[0].values).toEqual(['k-2']);
    expect(res).toBeNull();
  });
});

describe('writeStorageAppliedEffectsOnClient', () => {
  it('rejects more than one staged storage effect before issuing SQL', async () => {
    const cap = makeCapture();
    await expect(
      writeStorageAppliedEffectsOnClient(cap.db, [
        EFFECT,
        {
          ...EFFECT,
          idempotencyKey: 'k-second',
          spendClaimToken: '00000000-0000-4000-8000-000000000003',
        },
      ]),
    ).rejects.toThrow(/exceeds one pending purchase/);
    expect(cap.calls).toHaveLength(0);
  });

  const EFFECT = {
    realm: 'r1',
    accountId: 7,
    characterId: 42,
    itemId: 'strongbox_rung_01',
    expectedCostClaudium: 100,
    idempotencyKey: 'k-applied',
    spendClaimToken: '00000000-0000-4000-8000-000000000002',
    purchasedSlotsBefore: 0,
    purchasedSlotsAfter: 6,
  };

  it('locks distinct parent accounts in lifecycle order before character writes', async () => {
    const cap = makeCapture([{ rows: [{ id: 3 }, { id: 7 }] }]);
    await lockStorageAppliedEffectAccountsOnClient(cap.db, [
      EFFECT,
      { ...EFFECT, accountId: 3, characterId: 99, idempotencyKey: 'k-other' },
      { ...EFFECT, idempotencyKey: 'k-same-account' },
    ]);
    expect(cap.calls).toHaveLength(1);
    expect(cap.calls[0].text).toContain('WHERE id = ANY($1::int[])');
    expect(cap.calls[0].text).toContain('ORDER BY id');
    expect(cap.calls[0].text).toContain('FOR KEY SHARE');
    expect(cap.calls[0].values).toEqual([[3, 7]]);
  });

  it('fails the save when a parent account cannot be locked', async () => {
    const cap = makeCapture([{ rows: [] }]);
    await expect(lockStorageAppliedEffectAccountsOnClient(cap.db, [EFFECT])).rejects.toThrow(
      /account disappeared/,
    );
  });

  it('does not query when there are no staged effects', async () => {
    const cap = makeCapture();
    await lockStorageAppliedEffectAccountsOnClient(cap.db, []);
    expect(cap.calls).toHaveLength(0);
  });

  it('archives, audits, and removes a pending row in one caller-owned transaction', async () => {
    const cap = makeCapture([
      { rows: [] },
      {
        rows: [
          {
            id: 9,
            realm: 'r1',
            account_id: 7,
            character_id: 42,
            item_id: 'strongbox_rung_01',
            expected_cost_claudium: 100,
            idempotency_key: 'k-applied',
            spend_claim_token: EFFECT.spendClaimToken,
            status: 'pending',
          },
        ],
      },
      { rows: [{ source_purchase_id: 9 }] },
      { rowCount: 1 },
      { rowCount: 1 },
    ]);

    await writeStorageAppliedEffectsOnClient(cap.db, [EFFECT]);
    expect(cap.calls).toHaveLength(6);
    expect(cap.calls[0].text).toContain('pg_advisory_xact_lock');
    expect(cap.calls[0].values).toEqual([['k-applied']]);
    expect(cap.calls[1].text).toContain('storage_purchase_applied_receipts');
    expect(cap.calls[2].text).toContain('FOR UPDATE');
    expect(cap.calls[3].text).toContain('INSERT INTO storage_purchase_applied_receipts');
    expect(cap.calls[3].text).toContain('RETURNING source_purchase_id');
    expect(cap.calls[4].text).toContain('INSERT INTO bank_ledger');
    expect(cap.calls[4].values).toEqual([
      'r1',
      42,
      7,
      'strongbox_rung_01',
      JSON.stringify({ paidWith: 'claudium' }),
      6,
    ]);
    expect(cap.calls[5].text).toContain('DELETE FROM storage_purchases');
    expect(cap.calls[5].text).toContain('AND spend_claim_token = $3');
    expect(cap.calls[5].values).toEqual([9, 'k-applied', EFFECT.spendClaimToken]);
  });

  it('translates the raw storage-ledger trigger refusal for caller rollback', async () => {
    const pgError = {
      code: BANK_LEDGER_GROWTH_LIMIT_SQLSTATE,
      constraint: BANK_LEDGER_GROWTH_LIMIT_CONSTRAINT,
      detail: JSON.stringify({
        committed_rows: 10_000_000,
        attempted_rows: 1,
        hard_limit_rows: 10_000_000,
      }),
    };
    const db = {
      async query(text: string): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
        if (text.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 0 };
        if (text.includes('FROM storage_purchase_applied_receipts')) {
          return { rows: [], rowCount: 0 };
        }
        if (text.includes('FROM storage_purchases') && text.includes('FOR UPDATE')) {
          return {
            rows: [
              {
                id: 9,
                realm: 'r1',
                account_id: 7,
                character_id: 42,
                item_id: 'strongbox_rung_01',
                expected_cost_claudium: 100,
                idempotency_key: 'k-applied',
                spend_claim_token: EFFECT.spendClaimToken,
                status: 'pending',
              },
            ],
            rowCount: 1,
          };
        }
        if (text.includes('INSERT INTO storage_purchase_applied_receipts')) {
          return { rows: [{ source_purchase_id: 9 }], rowCount: 1 };
        }
        if (text.includes('INSERT INTO bank_ledger')) throw pgError;
        throw new Error(`unexpected SQL: ${text}`);
      },
    };

    await expect(writeStorageAppliedEffectsOnClient(db, [EFFECT])).rejects.toBeInstanceOf(
      BankLedgerGrowthLimitExceeded,
    );
  });

  it('rejects a staged save after recovery rotates its spend claim', async () => {
    const cap = makeCapture([
      { rows: [] },
      {
        rows: [
          {
            id: 9,
            realm: 'r1',
            account_id: 7,
            character_id: 42,
            item_id: 'strongbox_rung_01',
            expected_cost_claudium: 100,
            idempotency_key: 'k-applied',
            spend_claim_token: '00000000-0000-4000-8000-000000000099',
            status: 'pending',
          },
        ],
      },
    ]);

    await expect(writeStorageAppliedEffectsOnClient(cap.db, [EFFECT])).rejects.toThrow(
      /pending fingerprint conflict/,
    );
    expect(cap.calls).toHaveLength(3);
    expect(cap.calls.some((call) => call.text.includes('INSERT INTO bank_ledger'))).toBe(false);
    expect(cap.calls.some((call) => call.text.includes('DELETE FROM storage_purchases'))).toBe(
      false,
    );
  });

  it('treats an existing matching receipt as a lost-commit replay without a second ledger row', async () => {
    const cap = makeCapture([
      {
        rows: [
          {
            source_purchase_id: 9,
            realm: 'r1',
            account_id: 7,
            character_id: 42,
            item_id: 'strongbox_rung_01',
            expected_cost_claudium: 100,
            idempotency_key: 'k-applied',
            purchased_slots_before: 0,
            purchased_slots_after: 6,
          },
        ],
      },
      { rowCount: 0 },
    ]);

    await writeStorageAppliedEffectsOnClient(cap.db, [EFFECT]);
    expect(cap.calls).toHaveLength(3);
    expect(cap.calls[2].text).toContain('WHERE idempotency_key = $1');
    expect(cap.calls[2].text).toContain('AND spend_claim_token = $2');
    expect(cap.calls[2].text).not.toContain('source_purchase_id');
    expect(cap.calls.some((call) => call.text.includes('INSERT INTO bank_ledger'))).toBe(false);
  });

  it('cleans a token-owned post-receipt residue by key and validates its fingerprint', async () => {
    const cap = makeCapture([
      {
        rows: [
          {
            source_purchase_id: 9,
            realm: 'r1',
            account_id: 7,
            character_id: 42,
            item_id: 'strongbox_rung_01',
            expected_cost_claudium: 100,
            idempotency_key: 'k-applied',
            purchased_slots_before: 0,
            purchased_slots_after: 6,
          },
        ],
      },
      {
        rows: [
          {
            id: 99,
            realm: 'r1',
            account_id: 7,
            character_id: 42,
            item_id: 'strongbox_rung_01',
            expected_cost_claudium: 100,
            idempotency_key: 'k-applied',
            spend_claim_token: EFFECT.spendClaimToken,
            status: 'pending',
          },
        ],
        rowCount: 1,
      },
    ]);

    await writeStorageAppliedEffectsOnClient(cap.db, [EFFECT]);
    expect(cap.calls).toHaveLength(3);
    expect(cap.calls[2].text).toContain('DELETE FROM storage_purchases');
    expect(cap.calls[2].text).toContain('RETURNING');
    expect(cap.calls[2].values).toEqual(['k-applied', EFFECT.spendClaimToken]);
  });

  it('rolls back a consumed-key residue cleanup when its fingerprint is unexpected', async () => {
    const cap = makeCapture([
      {
        rows: [
          {
            source_purchase_id: 9,
            realm: 'r1',
            account_id: 7,
            character_id: 42,
            item_id: 'strongbox_rung_01',
            expected_cost_claudium: 100,
            idempotency_key: 'k-applied',
            purchased_slots_before: 0,
            purchased_slots_after: 6,
          },
        ],
      },
      {
        rows: [
          {
            id: 99,
            realm: 'r1',
            account_id: 7,
            character_id: 99,
            item_id: 'strongbox_rung_01',
            expected_cost_claudium: 100,
            idempotency_key: 'k-applied',
            spend_claim_token: EFFECT.spendClaimToken,
            status: 'pending',
          },
        ],
        rowCount: 1,
      },
    ]);

    await expect(writeStorageAppliedEffectsOnClient(cap.db, [EFFECT])).rejects.toThrow(
      /pending fingerprint conflict/,
    );
    expect(cap.calls).toHaveLength(3);
    expect(cap.calls.some((call) => call.text.includes('INSERT INTO bank_ledger'))).toBe(false);
  });

  it('throws on a consumed-key fingerprint mismatch before writing audit data', async () => {
    const cap = makeCapture([
      {
        rows: [
          {
            source_purchase_id: 9,
            realm: 'r1',
            account_id: 7,
            character_id: 99,
            item_id: 'strongbox_rung_01',
            expected_cost_claudium: 100,
            idempotency_key: 'k-applied',
            purchased_slots_before: 0,
            purchased_slots_after: 6,
          },
        ],
      },
    ]);

    await expect(writeStorageAppliedEffectsOnClient(cap.db, [EFFECT])).rejects.toThrow(
      /fingerprint conflict/,
    );
    expect(cap.calls).toHaveLength(2);
  });
});

describe('terminal writes stay monotone through pending guards', () => {
  it('settle moves ONLY a pending row and stamps resolved_at', async () => {
    const cap = makeCapture([{ rowCount: 1 }]);
    expect(await settleStoragePurchase(cap.db, 'k-3', 'applied', CLAIM_TOKEN)).toBe(true);
    expect(count(cap.calls[0].text, 'SET status = $2')).toBe(1);
    expect(count(cap.calls[0].text, 'resolved_at = now()')).toBe(1);
    expect(cap.calls[0].text).toContain('spend_claim_token = NULL');
    expect(cap.calls[0].text).toContain('spend_claim_expires_at = NULL');
    expect(count(cap.calls[0].text, "AND status = 'pending'")).toBe(1);
    expect(cap.calls[0].text).toContain('AND spend_claim_token = $3');
    expect(cap.calls[0].values).toEqual(['k-3', 'applied', CLAIM_TOKEN]);
    const missed = makeCapture([{ rowCount: 0 }]);
    expect(await settleStoragePurchase(missed.db, 'k-3', 'unresolved', CLAIM_TOKEN)).toBe(false);
  });

  it('a definitive no-debit outcome deletes ONLY a pending row', async () => {
    const cap = makeCapture([{ rowCount: 1 }]);
    expect(await deletePendingStoragePurchaseWithoutDebit(cap.db, 'k-4', CLAIM_TOKEN)).toBe(true);
    expect(count(cap.calls[0].text, 'DELETE FROM storage_purchases')).toBe(1);
    expect(count(cap.calls[0].text, "AND status = 'pending'")).toBe(1);
    expect(cap.calls[0].text).toContain('AND spend_claim_token = $2');
    expect(cap.calls[0].values).toEqual(['k-4', CLAIM_TOKEN]);
    const missed = makeCapture([{ rowCount: 0 }]);
    expect(await deletePendingStoragePurchaseWithoutDebit(missed.db, 'k-4', CLAIM_TOKEN)).toBe(
      false,
    );
  });
});

describe('pendingStoragePurchasesForCharacter', () => {
  it('scans exactly one oldest pending row for one character', async () => {
    const cap = makeCapture([{ rows: [] }]);
    await pendingStoragePurchasesForCharacter(cap.db, 42);
    expect(count(cap.calls[0].text, 'WHERE character_id = $1')).toBe(1);
    expect(count(cap.calls[0].text, "status = 'pending'")).toBe(1);
    expect(count(cap.calls[0].text, 'ORDER BY created_at, id')).toBe(1);
    expect(count(cap.calls[0].text, 'LIMIT 1')).toBe(1);
    expect(cap.calls[0].values).toEqual([42]);
  });

  it('reads the one pending-or-unresolved row through the open-rail seam', async () => {
    const cap = makeCapture([{ rows: [] }]);
    await openStoragePurchaseForCharacter(cap.db, 42);
    expect(cap.calls[0].text).toContain("status IN ('pending', 'unresolved')");
    expect(cap.calls[0].text).toContain('ORDER BY created_at, id');
    expect(cap.calls[0].text).toContain('LIMIT 1');
    expect(cap.calls[0].values).toEqual([42]);
  });
});
