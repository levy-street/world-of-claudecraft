// Always-on text and behavior pins for server/freehold_hearth_db.ts against a
// capturing fake client. A fake cannot tell whether the SQL parses, whether the
// participant lock really serializes two entries, or whether GREATEST really
// clamps a regressed clock: that executed proof is the TEST_DATABASE_URL-gated
// twin, freehold_hearth_db.pg.test.ts. What lives HERE is everything a fake can
// decide honestly: the DDL's load-bearing clauses, the exact statement ORDER of
// an accepted entry, the refusal arm writing no SQL at all, and the BigInt
// comparison that a Number would get wrong past 2^53.
//
// Every anchor is a contiguous clause with its occurrence pinned, never a lone
// keyword, and SQL comments are stripped before any source match so a commented
// out statement can never keep a pin green.
import { readFileSync } from 'node:fs';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  ABSENT_FREEHOLD_HEARTH,
  advanceFreeholdHearthOnClient,
  FREEHOLD_HEARTH_ACCOUNT_LOCK_SQL,
  FREEHOLD_HEARTH_ADVANCE_SQL,
  FREEHOLD_HEARTH_INIT_SQL,
  FREEHOLD_HEARTH_READ_FOR_UPDATE_SQL,
  FREEHOLD_HEARTH_SCHEMA,
  FREEHOLD_HEARTH_VERIFY_SQL,
  freeholdHearthAdvanceLandedOnClient,
  freeholdHearthForExport,
  freeholdHearthSchema,
  loadFreeholdHearth,
} from '../../server/freehold_hearth_db';
import { HEARTH_KEY_COOLDOWN_MS } from '../../src/sim/freehold/gate_rules';

interface Captured {
  text: string;
  values: unknown[] | undefined;
}

interface Reply {
  rows?: Record<string, unknown>[];
  rowCount?: number | null;
}

/** The recorder: every statement the module issues, in issue order, with its
 *  bound values. Replies are positional, so a test that expects four statements
 *  and gets three fails on the reply it never consumed. */
function makeClient(replies: readonly Reply[] = []) {
  const calls: Captured[] = [];
  const queue: Reply[] = [...replies];
  return {
    calls,
    client: {
      query: async (text: string, values?: unknown[]) => {
        calls.push({ text, values });
        return queue.shift() ?? { rows: [], rowCount: 0 };
      },
    },
  };
}

const at = (calls: readonly Captured[], fragment: string): number =>
  calls.findIndex((call) => call.text.includes(fragment));

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

// The vault_craft_gate.test.ts idiom: a block comment or a leading -- carrying
// the pinned text must never keep a pin green while the statement is dead.
const codeOnly = (sql: string): string =>
  sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, '');

const ACCOUNT_ID = 7;
const COOLDOWN_MS = 900_000;
const OK_ROW = { ready_at_ms: '1000', revision: '4' };
const READY_READ = { ready_at_ms: '1000', revision: '4', now_ms: '5000', clock_ms: '5000' };
/** One attempt's token, the shape the advance stamps (16 bytes as hex). */
const TOKEN = '0123456789abcdef0123456789abcdef';
const OTHER_TOKEN = 'fedcba9876543210fedcba9876543210';

/** The four replies of an accepted entry: participant lock, conflict-safe
 *  insert, locking read, monotone update. */
const acceptedReplies = (
  read: Record<string, unknown> = READY_READ,
  updated: Record<string, unknown> = { ready_at_ms: '905000', revision: '5' },
): Reply[] => [{ rows: [{ id: ACCOUNT_ID }] }, { rows: [] }, { rows: [read] }, { rows: [updated] }];

describe('the fake client recorder', () => {
  // Anti-vacuity positive control. Every "issued no update" assertion below is
  // an ABSENCE claim, and an absence claim against a recorder that records
  // nothing is worthless. This proves the recorder captures text and values,
  // in order, and that a fragment which is genuinely missing reports missing.
  it('captures the exact text and values it is handed, and reports a missing fragment', async () => {
    const { calls, client } = makeClient([{ rows: [{ probe: 1 }] }]);
    const first = await client.query('SELECT probe', ['bound']);
    await client.query('UPDATE account_freehold_hearth SET revision = revision + 1');
    expect(first.rows?.[0]).toEqual({ probe: 1 });
    expect(calls.map((call) => call.text)).toEqual([
      'SELECT probe',
      'UPDATE account_freehold_hearth SET revision = revision + 1',
    ]);
    expect(calls[0].values).toEqual(['bound']);
    expect(calls[1].values).toBeUndefined();
    expect(at(calls, 'UPDATE account_freehold_hearth')).toBe(1);
    expect(at(calls, 'INSERT INTO account_freehold_hearth')).toBe(-1);
  });
});

describe('the DDL', () => {
  it('keys the cooldown on the account, with both named non-negative checks', () => {
    const code = codeOnly(FREEHOLD_HEARTH_SCHEMA);
    expect(count(code, 'CREATE TABLE IF NOT EXISTS "public".account_freehold_hearth')).toBe(1);
    // The primary key IS the foreign key column, which is what makes the
    // account delete cascade index-backed with no second index.
    expect(
      count(code, 'account_id INT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE'),
    ).toBe(1);
    expect(count(code, 'ready_at_ms BIGINT NOT NULL DEFAULT 0')).toBe(1);
    expect(count(code, 'revision BIGINT NOT NULL DEFAULT 0')).toBe(1);
    expect(count(code, 'updated_at TIMESTAMPTZ NOT NULL DEFAULT now()')).toBe(1);
    expect(
      count(code, 'CONSTRAINT account_freehold_hearth_ready_nonnegative CHECK (ready_at_ms >= 0)'),
    ).toBe(1);
    expect(
      count(code, 'CONSTRAINT account_freehold_hearth_revision_nonnegative CHECK (revision >= 0)'),
    ).toBe(1);
    // Exactly one table, and no second index on the primary-key column.
    expect(count(code, 'CREATE TABLE')).toBe(1);
    expect(count(code, 'CREATE INDEX')).toBe(0);
    expect(count(code, 'CREATE UNIQUE INDEX')).toBe(0);
  });

  it('declares the advance token column with its one named shape check, in the table', () => {
    const code = codeOnly(FREEHOLD_HEARTH_SCHEMA);
    const table = code.slice(
      code.indexOf('CREATE TABLE IF NOT EXISTS "public".account_freehold_hearth'),
      code.indexOf('DO $freehold_hearth_advance_token$'),
    );
    // A fresh database gets the column from the CREATE TABLE itself, nullable
    // (no NOT NULL, no DEFAULT): a row never advanced carries no token.
    expect(
      count(
        table,
        'advance_token TEXT\n    CONSTRAINT account_freehold_hearth_advance_token_shape',
      ),
    ).toBe(1);
    expect(count(table, "CHECK (advance_token IS NULL OR advance_token ~ '^[0-9a-f]{32}$')")).toBe(
      1,
    );
    expect(table).not.toContain('advance_token TEXT NOT NULL');
    // The constraint is NAMED, exactly three times in the whole fragment (the
    // table, the column probe's ALTER, and the constraint repair's ALTER),
    // never an anonymous copy: the check text appears once per named site.
    expect(count(code, 'CONSTRAINT account_freehold_hearth_advance_token_shape')).toBe(3);
    expect(count(code, "CHECK (advance_token IS NULL OR advance_token ~ '^[0-9a-f]{32}$')")).toBe(
      3,
    );
  });

  it('adds the column to an older table only behind a catalog probe, so a reboot issues no ALTER', () => {
    const code = codeOnly(FREEHOLD_HEARTH_SCHEMA);
    // The positive pin the probe exists for: the column ALTER is present once,
    // and the only other ALTER is the constraint repair behind its own probe.
    expect(count(code, 'ADD COLUMN IF NOT EXISTS advance_token TEXT')).toBe(1);
    expect(count(code, 'ALTER TABLE')).toBe(2);
    expect(count(code, 'ADD CONSTRAINT account_freehold_hearth_advance_token_shape')).toBe(1);
    expect(count(code, 'DO $freehold_hearth_advance_token$')).toBe(1);
    expect(count(code, '$freehold_hearth_advance_token$;')).toBe(1);
    // The probe reads pg_attribute for THIS table's live column, by the
    // schema-qualified name the placeholder became.
    const probe =
      "IF NOT EXISTS (\n    SELECT 1 FROM pg_catalog.pg_attribute\n     WHERE attrelid = to_regclass('\"public\".account_freehold_hearth')\n       AND attname = 'advance_token'\n       AND NOT attisdropped\n  ) THEN";
    expect(count(code, probe)).toBe(1);
    // ORDER: the probe, then the ALTER, then END IF. An ALTER outside the IF
    // would take ACCESS EXCLUSIVE at every boot, probe or no probe.
    const probeAt = code.indexOf(probe);
    const alterAt = code.indexOf('ALTER TABLE "public".account_freehold_hearth');
    // The constraint repair's own probe reads pg_constraint by NAME ONLY for
    // THIS table (any constraint of that name counts, so a same-named one of
    // another type can never fail a boot with 42710), and its ALTER adds the
    // check NOT VALID (no boot scans old rows).
    const constraintProbe =
      "ELSIF NOT EXISTS (\n    SELECT 1 FROM pg_catalog.pg_constraint\n     WHERE conrelid = to_regclass('\"public\".account_freehold_hearth')\n       AND conname = 'account_freehold_hearth_advance_token_shape'\n  ) THEN";
    expect(count(code, constraintProbe)).toBe(1);
    const constraintProbeAt = code.indexOf(constraintProbe);
    const repairAt = code.indexOf('ADD CONSTRAINT account_freehold_hearth_advance_token_shape');
    expect(code.slice(repairAt).indexOf('NOT VALID;')).toBeGreaterThan(0);
    // The last arm only WARNS, for a same-named constraint that is not a CHECK.
    const notCheckAt = code.indexOf("AND contype <> 'c'");
    expect(notCheckAt).toBeGreaterThan(repairAt);
    expect(code.indexOf('RAISE WARNING', notCheckAt)).toBeGreaterThan(notCheckAt);
    const endIfAt = code.indexOf('END IF;');
    expect(endIfAt).toBeGreaterThan(notCheckAt);
    expect(probeAt).toBeGreaterThan(code.indexOf('DO $freehold_hearth_advance_token$'));
    expect(alterAt).toBeGreaterThan(probeAt);
    expect(constraintProbeAt).toBeGreaterThan(alterAt);
    expect(repairAt).toBeGreaterThan(constraintProbeAt);
    expect(endIfAt).toBeGreaterThan(repairAt);
    // And the CREATE TABLE comes first, so a fresh database never needs the ALTER.
    expect(
      code.indexOf('CREATE TABLE IF NOT EXISTS "public".account_freehold_hearth'),
    ).toBeLessThan(probeAt);
  });

  it('documents the keep-forever retention exemption and WHY, at the table', () => {
    // The comment is the record of a DELIBERATE retention decision, so it is
    // pinned on the RAW fragment (codeOnly strips exactly this text).
    expect(FREEHOLD_HEARTH_SCHEMA).toContain('-- KEEP FOREVER');
    expect(FREEHOLD_HEARTH_SCHEMA).toContain('EXEMPT from the retention sweep');
    expect(FREEHOLD_HEARTH_SCHEMA).toContain(
      'handing every character\n-- on that account a free ready key',
    );
    // The reason lands ABOVE the table it explains, not stranded at the top.
    const reason = FREEHOLD_HEARTH_SCHEMA.indexOf('-- KEEP FOREVER');
    const table = FREEHOLD_HEARTH_SCHEMA.indexOf(
      'CREATE TABLE IF NOT EXISTS "public".account_freehold_hearth',
    );
    expect(reason).toBeGreaterThanOrEqual(0);
    expect(reason).toBeLessThan(table);
  });

  it('qualifies its own table and never touches search_path', () => {
    // ensureSchema runs every fragment on ONE client inside ONE transaction, so
    // a SET LOCAL search_path here would leak into every LATER fragment until
    // explicitly replayed back. This fragment defines no function and no
    // trigger, so it needs no fixed execution path: it qualifies the object it
    // creates and leaves the GUC alone, which is server/freehold_db.ts's call
    // and the smaller blast radius. storage_purchase_db.ts keeps the ceremony
    // because it installs a function with its own SET search_path.
    const code = codeOnly(FREEHOLD_HEARTH_SCHEMA);
    expect(code).not.toContain('search_path');
    expect(code).not.toContain('set_config');
    expect(code).toContain('CREATE TABLE IF NOT EXISTS "public".account_freehold_hearth');
    // accounts stays UNqualified on purpose: the foreign key must resolve
    // through the applying connection's own path, the maps_db.ts rule.
    expect(code).toContain('REFERENCES accounts(id) ON DELETE CASCADE');
    expect(code).not.toContain('REFERENCES "public".accounts');
  });

  it('substitutes the private schema everywhere and leaves no placeholder behind', () => {
    const isolated = freeholdHearthSchema('freehold_hearth_pg_test');
    expect(isolated).toContain(
      'CREATE TABLE IF NOT EXISTS "freehold_hearth_pg_test".account_freehold_hearth',
    );
    // The probe and its ALTER follow the same substitution: a probe left on
    // "public" would read the wrong table and ALTER the private one every boot.
    expect(isolated).toContain(
      'to_regclass(\'"freehold_hearth_pg_test".account_freehold_hearth\')',
    );
    expect(isolated).toContain('ALTER TABLE "freehold_hearth_pg_test".account_freehold_hearth');
    expect(isolated).not.toContain('__woc_freehold_hearth_schema__');
    expect(isolated).not.toContain('"public"');
    expect(FREEHOLD_HEARTH_SCHEMA).toContain(
      'CREATE TABLE IF NOT EXISTS "public".account_freehold_hearth',
    );
  });

  it('refuses any schema name that is not a simple lowercase identifier', () => {
    for (const bad of ['Public', 'public;DROP', 'pg catalog', '1schema', 'public"', '']) {
      expect(() => freeholdHearthSchema(bad)).toThrow(
        'freehold hearth schema must be a simple lowercase identifier',
      );
    }
    expect(() => freeholdHearthSchema('freehold_hearth_pg_test')).not.toThrow();
  });
});

describe('the pinned statements', () => {
  it('locks the account participant with FOR KEY SHARE, never FOR UPDATE', () => {
    expect(FREEHOLD_HEARTH_ACCOUNT_LOCK_SQL).toBe(
      'SELECT id FROM accounts WHERE id = $1 FOR KEY SHARE',
    );
    expect(FREEHOLD_HEARTH_ACCOUNT_LOCK_SQL).not.toContain('FOR UPDATE');
  });

  it('initializes lazily and conflict-safely, and touches no counter', () => {
    expect(FREEHOLD_HEARTH_INIT_SQL).toContain(
      'INSERT INTO account_freehold_hearth (account_id) VALUES ($1)',
    );
    expect(FREEHOLD_HEARTH_INIT_SQL).toContain('ON CONFLICT (account_id) DO NOTHING');
    // DO NOTHING, never DO UPDATE: a first-use insert must not disturb a row
    // another entry already advanced.
    expect(FREEHOLD_HEARTH_INIT_SQL).not.toContain('DO UPDATE');
    expect(FREEHOLD_HEARTH_INIT_SQL).not.toContain('ready_at_ms');
  });

  it('reads both counters and ONE database epoch under the row lock', () => {
    expect(FREEHOLD_HEARTH_READ_FOR_UPDATE_SQL).toContain('ready_at_ms::text AS ready_at_ms');
    expect(FREEHOLD_HEARTH_READ_FOR_UPDATE_SQL).toContain('revision::text AS revision');
    expect(FREEHOLD_HEARTH_READ_FOR_UPDATE_SQL).toContain(
      '(EXTRACT(EPOCH FROM now()) * 1000)::bigint::text AS now_ms',
    );
    expect(FREEHOLD_HEARTH_READ_FOR_UPDATE_SQL).toContain('FOR UPDATE');
    // ONE observation of the clock, not one per comparison.
    expect(count(FREEHOLD_HEARTH_READ_FOR_UPDATE_SQL, 'EXTRACT(EPOCH FROM now())')).toBe(1);
  });

  it('also reads the wall clock AT the read, the epoch the corrupt test is judged against', () => {
    // clock_timestamp(), never a second now(): now() is the transaction START,
    // and a concurrent advance that committed while this read waited for the
    // row lock legitimately wrote past now() plus the cooldown.
    expect(FREEHOLD_HEARTH_READ_FOR_UPDATE_SQL).toContain(
      '(EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint::text AS clock_ms',
    );
    expect(count(FREEHOLD_HEARTH_READ_FOR_UPDATE_SQL, 'clock_timestamp()')).toBe(1);
    expect(count(FREEHOLD_HEARTH_READ_FOR_UPDATE_SQL, 'now()')).toBe(1);
    // Both epochs ride the SAME locked statement, so clock_ms is read after the wait.
    expect(FREEHOLD_HEARTH_READ_FOR_UPDATE_SQL.indexOf('AS clock_ms')).toBeLessThan(
      FREEHOLD_HEARTH_READ_FOR_UPDATE_SQL.indexOf('FOR UPDATE'),
    );
  });

  it('advances monotonically: GREATEST forward, revision by a bare increment', () => {
    expect(FREEHOLD_HEARTH_ADVANCE_SQL).toContain(
      'SET ready_at_ms = GREATEST(ready_at_ms, $2::bigint + $3::bigint)',
    );
    expect(FREEHOLD_HEARTH_ADVANCE_SQL).toContain('revision = revision + 1');
    // The attempt's token is stamped by the SAME statement that writes the
    // effect, so a verify can never see the token without the advance.
    expect(FREEHOLD_HEARTH_ADVANCE_SQL).toContain('advance_token = $4,');
    expect(FREEHOLD_HEARTH_ADVANCE_SQL).toContain('updated_at = now()');
    expect(FREEHOLD_HEARTH_ADVANCE_SQL).toContain('WHERE account_id = $1');
    expect(FREEHOLD_HEARTH_ADVANCE_SQL).toContain(
      'RETURNING ready_at_ms::text AS ready_at_ms, revision::text AS revision',
    );
    // LEAST would let a regressed clock pull the key forward; a revision reset
    // would let a stale caller replay. Neither may appear.
    expect(FREEHOLD_HEARTH_ADVANCE_SQL).not.toContain('LEAST');
    expect(FREEHOLD_HEARTH_ADVANCE_SQL).not.toContain('revision = $');
    // THE SET LIST EXACTLY, the way the plot compare-and-swap pins its own. A
    // contains-plus-two-negatives shape is satisfied by an ADDED column, and
    // this statement is the one an accepted entry commits inside someone else's
    // transaction, so a column that arrived here without its writer's consent
    // would ride out with it.
    const setClause = FREEHOLD_HEARTH_ADVANCE_SQL.slice(
      FREEHOLD_HEARTH_ADVANCE_SQL.indexOf('SET '),
      FREEHOLD_HEARTH_ADVANCE_SQL.indexOf('WHERE '),
    );
    const assigned = [...setClause.matchAll(/(\w+)\s*=/g)]
      .map((match) => match[1])
      .filter((name) => name !== 'GREATEST');
    expect(assigned).toEqual(['ready_at_ms', 'revision', 'advance_token', 'updated_at']);
  });
});

describe('loadFreeholdHearth', () => {
  it('reads absence as absent, and NEVER writes a row to get there', async () => {
    const { calls, client } = makeClient([{ rows: [] }]);
    expect(await loadFreeholdHearth(client, ACCOUNT_ID)).toEqual({ kind: 'absent' });
    expect(calls).toHaveLength(1);
    expect(calls[0].values).toEqual([ACCOUNT_ID]);
    expect(calls[0].text).toContain('SELECT ready_at_ms::text AS ready_at_ms');
    expect(calls[0].text).toContain('revision::text AS revision');
    expect(calls[0].text).toContain('FROM account_freehold_hearth');
    expect(calls[0].text).toContain('WHERE account_id = $1');
    expect(at(calls, 'INSERT')).toBe(-1);
    expect(at(calls, 'UPDATE')).toBe(-1);
    expect(at(calls, 'FOR UPDATE')).toBe(-1);
  });

  it('treats absence as ready at revision zero', () => {
    expect(ABSENT_FREEHOLD_HEARTH).toEqual({ readyAtMs: '0', revision: '0' });
  });

  it('returns both counters as text, verbatim, past Number.MAX_SAFE_INTEGER', async () => {
    const { client } = makeClient([
      { rows: [{ ready_at_ms: '9007199254740993', revision: '9007199254740995' }] },
    ]);
    expect(await loadFreeholdHearth(client, ACCOUNT_ID)).toEqual({
      kind: 'state',
      state: { readyAtMs: '9007199254740993', revision: '9007199254740995' },
    });
    // The exact value a Number round trip would destroy.
    expect(String(Number('9007199254740993'))).toBe('9007199254740992');
  });

  // One field corrupted per case, the other left valid: a guard that only
  // checked one column would pass half of these.
  const badRows: readonly [string, Record<string, unknown>][] = [
    ['a negative ready_at_ms', { ready_at_ms: '-1', revision: '4' }],
    ['a leading-zero ready_at_ms', { ready_at_ms: '01', revision: '4' }],
    ['a float ready_at_ms', { ready_at_ms: '1000.5', revision: '4' }],
    ['a numeric ready_at_ms', { ready_at_ms: 1000, revision: '4' }],
    ['a null ready_at_ms', { ready_at_ms: null, revision: '4' }],
    ['a negative revision', { ready_at_ms: '1000', revision: '-4' }],
    ['a leading-zero revision', { ready_at_ms: '1000', revision: '04' }],
    ['a non-numeric revision', { ready_at_ms: '1000', revision: 'four' }],
    ['a numeric revision', { ready_at_ms: '1000', revision: 4 }],
    ['a null revision', { ready_at_ms: '1000', revision: null }],
  ];
  for (const [label, row] of badRows) {
    it(`answers unsupported, never absent, for ${label}`, async () => {
      const { client } = makeClient([{ rows: [row] }]);
      const load = await loadFreeholdHearth(client, ACCOUNT_ID);
      expect(load.kind).toBe('unsupported');
      // Absence means READY. A damaged row must never be reported as one.
      expect(load.kind).not.toBe('absent');
    });
  }

  it('accepts the exact row the negatives corrupt', async () => {
    const { client } = makeClient([{ rows: [{ ...OK_ROW }] }]);
    expect(await loadFreeholdHearth(client, ACCOUNT_ID)).toEqual({
      kind: 'state',
      state: { readyAtMs: '1000', revision: '4' },
    });
  });
});

describe('advanceFreeholdHearthOnClient', () => {
  it('issues the account lock, then the insert, then the locking read, then the update', async () => {
    const { calls, client } = makeClient(acceptedReplies());
    const result = await advanceFreeholdHearthOnClient(client, ACCOUNT_ID, COOLDOWN_MS);
    expect(result).toEqual({
      kind: 'advanced',
      readyAtMs: '905000',
      revision: '5',
      nowMs: '5000',
    });
    expect(calls).toHaveLength(4);
    const lock = at(calls, 'FROM accounts WHERE id = $1 FOR KEY SHARE');
    const init = at(calls, 'INSERT INTO account_freehold_hearth (account_id) VALUES ($1)');
    const read = at(calls, '(EXTRACT(EPOCH FROM now()) * 1000)::bigint::text AS now_ms');
    const update = at(calls, 'UPDATE account_freehold_hearth');
    expect(lock).toBe(0);
    expect(init).toBe(1);
    expect(read).toBe(2);
    expect(update).toBe(3);
    expect(lock).toBeLessThan(init);
    expect(init).toBeLessThan(read);
    expect(read).toBeLessThan(update);
    // The epoch is read AFTER the participant lock, which is the whole point
    // of taking the lock first.
    expect(at(calls, 'EXTRACT(EPOCH FROM now())')).toBeGreaterThan(lock);
    // The caller owns the transaction: this function opens and closes none.
    for (const control of ['BEGIN', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'SET LOCAL']) {
      expect(at(calls, control)).toBe(-1);
    }
  });

  it('issues the exact pinned statement texts, with the read epoch as the update arm', async () => {
    const { calls, client } = makeClient(acceptedReplies());
    await advanceFreeholdHearthOnClient(client, ACCOUNT_ID, COOLDOWN_MS);
    expect(calls[0].text).toBe(FREEHOLD_HEARTH_ACCOUNT_LOCK_SQL);
    expect(calls[1].text).toBe(FREEHOLD_HEARTH_INIT_SQL);
    expect(calls[2].text).toBe(FREEHOLD_HEARTH_READ_FOR_UPDATE_SQL);
    expect(calls[3].text).toBe(FREEHOLD_HEARTH_ADVANCE_SQL);
    expect(calls[0].values).toEqual([ACCOUNT_ID]);
    expect(calls[1].values).toEqual([ACCOUNT_ID]);
    expect(calls[2].values).toEqual([ACCOUNT_ID]);
    // $2 is the database's own epoch, echoed back as text; $3 is the cooldown
    // as text. Neither is a locally computed sum, so GREATEST sees the exact
    // arms the reviewed statement promises. $4 is the attempt's token, null
    // when the caller passed none.
    expect(calls[3].values).toEqual([ACCOUNT_ID, '5000', '900000', null]);
  });

  it("stamps the caller's token as $4 of the advance, verbatim", async () => {
    const { calls, client } = makeClient(acceptedReplies());
    expect(await advanceFreeholdHearthOnClient(client, ACCOUNT_ID, COOLDOWN_MS, TOKEN)).toEqual({
      kind: 'advanced',
      readyAtMs: '905000',
      revision: '5',
      nowMs: '5000',
    });
    expect(calls).toHaveLength(4);
    expect(calls[3].text).toBe(FREEHOLD_HEARTH_ADVANCE_SQL);
    expect(calls[3].values).toEqual([
      ACCOUNT_ID,
      '5000',
      '900000',
      '0123456789abcdef0123456789abcdef',
    ]);
    // The three statements before the advance never carry the token.
    for (const call of calls.slice(0, 3)) expect(call.values).toEqual([ACCOUNT_ID]);
  });

  it('never sends the token when the entry refuses', async () => {
    const { calls, client } = makeClient([
      { rows: [{ id: ACCOUNT_ID }] },
      { rows: [] },
      { rows: [{ ready_at_ms: '9000', revision: '4', now_ms: '5000', clock_ms: '5000' }] },
    ]);
    expect(
      await advanceFreeholdHearthOnClient(client, ACCOUNT_ID, COOLDOWN_MS, TOKEN),
    ).toMatchObject({ kind: 'cooldown' });
    expect(calls).toHaveLength(3);
    expect(calls.some((call) => (call.values ?? []).includes(TOKEN))).toBe(false);
  });

  const badTokens: readonly [string, string][] = [
    ['uppercase hex', '0123456789ABCDEF0123456789ABCDEF'],
    ['31 characters', '0123456789abcdef0123456789abcde'],
    ['33 characters', '0123456789abcdef0123456789abcdef0'],
    ['a non-hex character', '0123456789abcdef0123456789abcdeg'],
    ['the empty string', ''],
  ];
  for (const [label, token] of badTokens) {
    it(`refuses a token that is ${label} before issuing any statement`, async () => {
      const { calls, client } = makeClient(acceptedReplies());
      await expect(
        advanceFreeholdHearthOnClient(client, ACCOUNT_ID, COOLDOWN_MS, token),
      ).rejects.toThrow('hearth advance token must be 32 lowercase hex characters');
      // Refused locally: a value the column CHECK would reject must never abort
      // the caller's transaction with a 23514.
      expect(calls).toEqual([]);
    });
  }

  it('reports the value the database RETURNED, never a locally recomputed sum', async () => {
    // GREATEST's left arm winning is what a lagging clock looks like from the
    // client: the stored ready_at_ms already leads $2 + $3. The executed drive
    // of GREATEST itself lives in freehold_hearth_db.pg.test.ts; what a fake
    // can decide is that the module never substitutes its own arithmetic.
    const { client } = makeClient(
      acceptedReplies(
        { ready_at_ms: '4000000', revision: '9', now_ms: '4000000', clock_ms: '4000000' },
        {
          ready_at_ms: '9000000',
          revision: '10',
        },
      ),
    );
    const result = await advanceFreeholdHearthOnClient(client, ACCOUNT_ID, 1);
    expect(result).toEqual({
      kind: 'advanced',
      readyAtMs: '9000000',
      revision: '10',
      nowMs: '4000000',
    });
    // A client-side nowMs + cooldownMs would have answered 4000001 and LOWERED
    // the durable value.
    expect(result).not.toMatchObject({ readyAtMs: '4000001' });
  });

  it('refuses while unready and issues NO update statement at all', async () => {
    const { calls, client } = makeClient([
      { rows: [{ id: ACCOUNT_ID }] },
      { rows: [] },
      { rows: [{ ready_at_ms: '9000', revision: '4', now_ms: '5000', clock_ms: '5000' }] },
    ]);
    const result = await advanceFreeholdHearthOnClient(client, ACCOUNT_ID, COOLDOWN_MS);
    expect(result).toEqual({
      kind: 'cooldown',
      readyAtMs: '9000',
      revision: '4',
      nowMs: '5000',
    });
    // The absence of SQL, not an empty result set: three statements, none of
    // them a write against the counters.
    expect(calls).toHaveLength(3);
    expect(at(calls, 'UPDATE account_freehold_hearth')).toBe(-1);
    expect(at(calls, 'GREATEST')).toBe(-1);
    expect(at(calls, 'revision = revision + 1')).toBe(-1);
  });

  it('refuses a regressed database clock, and accepts the exact boundary', async () => {
    // now_ms BELOW ready_at_ms: the row says the key is not ready yet, and a
    // clock that went backwards must not make it eligible.
    const regressed = makeClient([
      { rows: [{ id: ACCOUNT_ID }] },
      { rows: [] },
      { rows: [{ ready_at_ms: '5000', revision: '4', now_ms: '4999', clock_ms: '4999' }] },
    ]);
    expect(
      await advanceFreeholdHearthOnClient(regressed.client, ACCOUNT_ID, COOLDOWN_MS),
    ).toMatchObject({ kind: 'cooldown', nowMs: '4999' });
    expect(at(regressed.calls, 'UPDATE account_freehold_hearth')).toBe(-1);

    // now_ms EXACTLY at ready_at_ms is ready: the refusal is strictly less-than.
    const boundary = makeClient(
      acceptedReplies(
        { ready_at_ms: '5000', revision: '4', now_ms: '5000', clock_ms: '5000' },
        {
          ready_at_ms: '905000',
          revision: '5',
        },
      ),
    );
    expect(
      await advanceFreeholdHearthOnClient(boundary.client, ACCOUNT_ID, COOLDOWN_MS),
    ).toMatchObject({ kind: 'advanced', readyAtMs: '905000', revision: '5' });
    expect(at(boundary.calls, 'UPDATE account_freehold_hearth')).toBe(3);
  });

  it('compares with BigInt: a Number comparison would grant this trip', async () => {
    // 9007199254740993 and 9007199254740992 are the SAME IEEE double, so a
    // Number-based `now < readyAt` reads false and advances an unready key.
    expect(Number('9007199254740992') < Number('9007199254740993')).toBe(false);
    expect(BigInt('9007199254740992') < BigInt('9007199254740993')).toBe(true);
    const { calls, client } = makeClient([
      { rows: [{ id: ACCOUNT_ID }] },
      { rows: [] },
      {
        rows: [
          {
            ready_at_ms: '9007199254740993',
            revision: '4',
            now_ms: '9007199254740992',
            clock_ms: '9007199254740992',
          },
        ],
      },
    ]);
    expect(await advanceFreeholdHearthOnClient(client, ACCOUNT_ID, COOLDOWN_MS)).toEqual({
      kind: 'cooldown',
      readyAtMs: '9007199254740993',
      revision: '4',
      nowMs: '9007199254740992',
    });
    expect(at(calls, 'UPDATE account_freehold_hearth')).toBe(-1);
  });

  /** The three statements of a refused entry, the read carrying `read`. */
  const refusedReplies = (read: Record<string, unknown>): Reply[] => [
    { rows: [{ id: ACCOUNT_ID }] },
    { rows: [] },
    { rows: [read] },
  ];

  it('answers corrupt for a ready time one millisecond past the clock plus the cooldown', async () => {
    const { calls, client } = makeClient(
      refusedReplies({ ready_at_ms: '905001', revision: '4', now_ms: '5000', clock_ms: '5000' }),
    );
    expect(await advanceFreeholdHearthOnClient(client, ACCOUNT_ID, COOLDOWN_MS, TOKEN)).toEqual({
      kind: 'corrupt',
      readyAtMs: '905001',
      revision: '4',
      nowMs: '5000',
    });
    // Refused, never trusted and never repaired: three statements, no write,
    // and the attempt's token is never sent.
    expect(calls).toHaveLength(3);
    expect(at(calls, 'UPDATE account_freehold_hearth')).toBe(-1);
    expect(calls.some((call) => (call.values ?? []).includes(TOKEN))).toBe(false);
  });

  it('answers cooldown, not corrupt, exactly AT the clock plus the cooldown (the control)', async () => {
    // A ready time an accepted advance writes is now plus the cooldown, so the
    // boundary itself is legitimate: the corrupt test is strictly greater-than.
    const { calls, client } = makeClient(
      refusedReplies({ ready_at_ms: '905000', revision: '4', now_ms: '5000', clock_ms: '5000' }),
    );
    expect(await advanceFreeholdHearthOnClient(client, ACCOUNT_ID, COOLDOWN_MS)).toEqual({
      kind: 'cooldown',
      readyAtMs: '905000',
      revision: '4',
      nowMs: '5000',
    });
    expect(calls).toHaveLength(3);
    expect(at(calls, 'UPDATE account_freehold_hearth')).toBe(-1);
  });

  it("judges corrupt against the CALLER's cooldown, not a constant", async () => {
    // cooldown 1000: 1001 past the clock is corrupt, 1000 past it is not. A
    // guard hard-coded to the shipped 900000 ms would call both cooldown.
    const over = makeClient(
      refusedReplies({ ready_at_ms: '6001', revision: '4', now_ms: '5000', clock_ms: '5000' }),
    );
    expect(await advanceFreeholdHearthOnClient(over.client, ACCOUNT_ID, 1000)).toMatchObject({
      kind: 'corrupt',
      readyAtMs: '6001',
    });
    const at1000 = makeClient(
      refusedReplies({ ready_at_ms: '6000', revision: '4', now_ms: '5000', clock_ms: '5000' }),
    );
    expect(await advanceFreeholdHearthOnClient(at1000.client, ACCOUNT_ID, 1000)).toMatchObject({
      kind: 'cooldown',
      readyAtMs: '6000',
    });
  });

  it('judges corrupt against clock_ms, not now_ms: a lock wait behind a later advance is cooldown', async () => {
    // The ordinary race: this transaction started at 5000, waited for the row
    // lock, and a concurrent advance that started at 5500 wrote 905500. Against
    // now_ms that is 900500 past (would read corrupt); against the clock after
    // the wait (6000) it is 899500 past, an ordinary cooldown.
    const { client } = makeClient(
      refusedReplies({ ready_at_ms: '905500', revision: '5', now_ms: '5000', clock_ms: '6000' }),
    );
    expect(await advanceFreeholdHearthOnClient(client, ACCOUNT_ID, COOLDOWN_MS)).toEqual({
      kind: 'cooldown',
      readyAtMs: '905500',
      revision: '5',
      nowMs: '5000',
    });
  });

  it('judges corrupt against clock_ms, not now_ms: a backward clock step is corrupt', async () => {
    // The converse operand check: the wall clock stepped back to 4000 after the
    // transaction started at 5000. 904500 is 899500 past now_ms (would read
    // cooldown) but 900500 past the clock, beyond anything an advance writes.
    const { calls, client } = makeClient(
      refusedReplies({ ready_at_ms: '904500', revision: '4', now_ms: '5000', clock_ms: '4000' }),
    );
    expect(await advanceFreeholdHearthOnClient(client, ACCOUNT_ID, COOLDOWN_MS)).toEqual({
      kind: 'corrupt',
      readyAtMs: '904500',
      revision: '4',
      nowMs: '5000',
    });
    expect(at(calls, 'UPDATE account_freehold_hearth')).toBe(-1);
  });

  it('subtracts with BigInt: Number arithmetic would call this corrupt row a cooldown', async () => {
    // 9007199255640993 - 9007199254740992 is 900001, one past the cooldown, but
    // the first operand rounds to 9007199255640992 as a double, so Number
    // subtraction answers exactly 900000 and the guard would pass it.
    expect(Number('9007199255640993') - Number('9007199254740992')).toBe(900000);
    expect(BigInt('9007199255640993') - BigInt('9007199254740992')).toBe(900001n);
    const { client } = makeClient(
      refusedReplies({
        ready_at_ms: '9007199255640993',
        revision: '4',
        now_ms: '9007199254740992',
        clock_ms: '9007199254740992',
      }),
    );
    expect(await advanceFreeholdHearthOnClient(client, ACCOUNT_ID, COOLDOWN_MS)).toEqual({
      kind: 'corrupt',
      readyAtMs: '9007199255640993',
      revision: '4',
      nowMs: '9007199254740992',
    });
  });

  it('never judges a READY row corrupt: the corrupt test runs only on the refusal arm', async () => {
    // clock_ms far below ready_at_ms would read corrupt if the check ran first,
    // but now_ms says the key is ready, so the entry advances.
    const { calls, client } = makeClient(
      acceptedReplies({ ready_at_ms: '5000', revision: '4', now_ms: '5000', clock_ms: '0' }),
    );
    expect(await advanceFreeholdHearthOnClient(client, ACCOUNT_ID, 1)).toMatchObject({
      kind: 'advanced',
    });
    expect(at(calls, 'UPDATE account_freehold_hearth')).toBe(3);
  });

  it('carries an advanced counter past 2^53 back as exact text', async () => {
    const { client } = makeClient(
      acceptedReplies(
        {
          ready_at_ms: '9007199254740000',
          revision: '4',
          now_ms: '9007199254740993',
          clock_ms: '9007199254740993',
        },
        { ready_at_ms: '9007199254741993', revision: '9007199254740995' },
      ),
    );
    const result = await advanceFreeholdHearthOnClient(client, ACCOUNT_ID, 1000);
    expect(result).toEqual({
      kind: 'advanced',
      readyAtMs: '9007199254741993',
      revision: '9007199254740995',
      nowMs: '9007199254740993',
    });
  });

  const badCooldowns: readonly [string, number][] = [
    ['negative', -1],
    ['fractional', 1.5],
    ['NaN', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
    ['beyond the safe integer range', Number.MAX_SAFE_INTEGER + 2],
  ];
  for (const [label, cooldown] of badCooldowns) {
    it(`refuses a ${label} cooldown before issuing any statement`, async () => {
      const { calls, client } = makeClient(acceptedReplies());
      const result = await advanceFreeholdHearthOnClient(client, ACCOUNT_ID, cooldown);
      expect(result.kind).toBe('unsupported');
      expect(calls).toHaveLength(0);
    });
  }

  it('accepts a zero cooldown, the boundary the refusals sit next to', async () => {
    const { calls, client } = makeClient(acceptedReplies());
    expect(await advanceFreeholdHearthOnClient(client, ACCOUNT_ID, 0)).toMatchObject({
      kind: 'advanced',
    });
    expect(calls[3].values).toEqual([ACCOUNT_ID, '5000', '0', null]);
  });

  it('refuses an absent account after the lock, and writes nothing', async () => {
    const { calls, client } = makeClient([{ rows: [] }]);
    const result = await advanceFreeholdHearthOnClient(client, ACCOUNT_ID, COOLDOWN_MS);
    expect(result.kind).toBe('unsupported');
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toBe(FREEHOLD_HEARTH_ACCOUNT_LOCK_SQL);
    expect(at(calls, 'INSERT INTO account_freehold_hearth')).toBe(-1);
  });

  it('refuses when the row vanishes under the lock', async () => {
    const { calls, client } = makeClient([
      { rows: [{ id: ACCOUNT_ID }] },
      { rows: [] },
      { rows: [] },
    ]);
    const result = await advanceFreeholdHearthOnClient(client, ACCOUNT_ID, COOLDOWN_MS);
    expect(result.kind).toBe('unsupported');
    expect(calls).toHaveLength(3);
    expect(at(calls, 'UPDATE account_freehold_hearth')).toBe(-1);
  });

  // Exactly one of the four read fields corrupted per case.
  const badReads: readonly [string, Record<string, unknown>][] = [
    ['ready_at_ms', { ready_at_ms: '-1', revision: '4', now_ms: '5000', clock_ms: '5000' }],
    ['revision', { ready_at_ms: '1000', revision: 'four', now_ms: '5000', clock_ms: '5000' }],
    ['now_ms', { ready_at_ms: '1000', revision: '4', now_ms: null, clock_ms: '5000' }],
    ['clock_ms', { ready_at_ms: '1000', revision: '4', now_ms: '5000', clock_ms: null }],
    [
      'clock_ms as a float',
      { ready_at_ms: '1000', revision: '4', now_ms: '5000', clock_ms: '5000.5' },
    ],
  ];
  for (const [field, row] of badReads) {
    it(`refuses and writes nothing when ${field} is not bigint text`, async () => {
      const { calls, client } = makeClient([
        { rows: [{ id: ACCOUNT_ID }] },
        { rows: [] },
        { rows: [row] },
      ]);
      const result = await advanceFreeholdHearthOnClient(client, ACCOUNT_ID, COOLDOWN_MS);
      expect(result.kind).toBe('unsupported');
      expect(calls).toHaveLength(3);
      expect(at(calls, 'UPDATE account_freehold_hearth')).toBe(-1);
    });
  }

  it('accepts the exact read the field negatives corrupt', async () => {
    const { client } = makeClient(acceptedReplies({ ...READY_READ }));
    expect(await advanceFreeholdHearthOnClient(client, ACCOUNT_ID, COOLDOWN_MS)).toMatchObject({
      kind: 'advanced',
    });
  });

  // One RETURNING field corrupted per case, the other left valid.
  const badReturns: readonly [string, Record<string, unknown> | undefined][] = [
    ['no row at all', undefined],
    ['a bad ready_at_ms', { ready_at_ms: 'later', revision: '5' }],
    ['a bad revision', { ready_at_ms: '905000', revision: -5 }],
  ];
  for (const [label, updated] of badReturns) {
    it(`refuses when the advance returns ${label}`, async () => {
      const { client } = makeClient([
        { rows: [{ id: ACCOUNT_ID }] },
        { rows: [] },
        { rows: [{ ...READY_READ }] },
        { rows: updated === undefined ? [] : [updated] },
      ]);
      const result = await advanceFreeholdHearthOnClient(client, ACCOUNT_ID, COOLDOWN_MS);
      expect(result.kind).toBe('unsupported');
    });
  }
});

describe('the ambiguous-COMMIT verify read', () => {
  it('is a plain read of the token and revision, by account, with no lock', () => {
    expect(FREEHOLD_HEARTH_VERIFY_SQL).toBe(
      'SELECT advance_token, revision::text AS revision\n  FROM account_freehold_hearth WHERE account_id = $1',
    );
    // A locked read could not wait for an uncommitted first-advance INSERT; the
    // verify waits on the character row first and then reads plainly.
    expect(FREEHOLD_HEARTH_VERIFY_SQL).not.toContain('FOR UPDATE');
    expect(FREEHOLD_HEARTH_VERIFY_SQL).not.toContain('FOR SHARE');
  });

  it('answers true only when the row carries THIS attempt token', async () => {
    const landed = makeClient([{ rows: [{ advance_token: TOKEN, revision: '5' }] }]);
    expect(await freeholdHearthAdvanceLandedOnClient(landed.client, ACCOUNT_ID, TOKEN)).toBe(true);
    expect(landed.calls).toEqual([{ text: FREEHOLD_HEARTH_VERIFY_SQL, values: [ACCOUNT_ID] }]);

    // Another attempt's token on the row: this attempt did not land.
    const other = makeClient([{ rows: [{ advance_token: OTHER_TOKEN, revision: '5' }] }]);
    expect(await freeholdHearthAdvanceLandedOnClient(other.client, ACCOUNT_ID, TOKEN)).toBe(false);
  });

  it('answers false for a NULL token and for an absent row', async () => {
    const nullToken = makeClient([{ rows: [{ advance_token: null, revision: '5' }] }]);
    expect(await freeholdHearthAdvanceLandedOnClient(nullToken.client, ACCOUNT_ID, TOKEN)).toBe(
      false,
    );
    // An account's first advance rolled back leaves no row at all.
    const absent = makeClient([{ rows: [] }]);
    expect(await freeholdHearthAdvanceLandedOnClient(absent.client, ACCOUNT_ID, TOKEN)).toBe(false);
    expect(absent.calls).toHaveLength(1);
  });

  it('refuses a malformed account id before a byte reaches the database', async () => {
    for (const bad of [0, -1, 1.5]) {
      const { calls, client } = makeClient([]);
      await expect(freeholdHearthAdvanceLandedOnClient(client, bad, TOKEN)).rejects.toThrow(
        /positive safe integer/,
      );
      expect(calls).toEqual([]);
    }
  });
});

describe('freeholdHearthForExport', () => {
  it('returns the single row for the subject-access bundle', async () => {
    const row = { ready_at_ms: '905000', revision: '5', updated_at: new Date(0) };
    const { calls, client } = makeClient([{ rows: [row] }]);
    expect(await freeholdHearthForExport(client as unknown as Pool, ACCOUNT_ID)).toEqual(row);
    expect(calls).toHaveLength(1);
    expect(calls[0].values).toEqual([ACCOUNT_ID]);
    expect(calls[0].text).toContain('ready_at_ms::text AS ready_at_ms');
    expect(calls[0].text).toContain('revision::text AS revision');
    expect(calls[0].text).toContain('updated_at');
    expect(calls[0].text).toContain('FROM account_freehold_hearth');
  });

  it('returns null for an account that has never travelled', async () => {
    const { client } = makeClient([{ rows: [] }]);
    expect(await freeholdHearthForExport(client as unknown as Pool, ACCOUNT_ID)).toBeNull();
  });
});

describe('the account id is refused before a byte reaches the database', () => {
  // The same structural refusal the plot module runs on every entry point, and
  // the reason it matters here: a malformed value sent anyway raises 22P02 and
  // aborts the CALLER's whole transaction, and the 07a admission participant
  // will call the advance from inside one. Untested, both guards could be
  // deleted with the whole suite still green.
  for (const bad of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    it(`refuses ${String(bad)} on the read`, async () => {
      const { client, calls } = makeClient([]);
      await expect(loadFreeholdHearth(client, bad)).rejects.toThrow(/positive safe integer/);
      // Nothing was sent, which is the whole point of refusing here.
      expect(calls).toEqual([]);
    });

    it(`refuses ${String(bad)} on the advance`, async () => {
      const { client, calls } = makeClient([]);
      await expect(advanceFreeholdHearthOnClient(client, bad, COOLDOWN_MS)).rejects.toThrow(
        /positive safe integer/,
      );
      expect(calls).toEqual([]);
    });
  }

  it('still admits a legitimate account id (the contrast arm)', async () => {
    const { client } = makeClient([{ rows: [] }]);
    expect(await loadFreeholdHearth(client, ACCOUNT_ID)).toEqual({ kind: 'absent' });
  });
});

describe("the operator's corrupt-row repair (DEPLOY.md)", () => {
  it('clamps by the real cooldown, only rows past it, idempotently', () => {
    // The repair hand-writes the cooldown in milliseconds; it must be the sim's.
    const deploy = readFileSync('DEPLOY.md', 'utf8');
    const start = deploy.indexOf('- A CORRUPT Hearth row');
    expect(start).toBeGreaterThan(-1);
    const bullet = deploy.slice(start, deploy.indexOf('\n- ', start + 1)).replace(/\s+/g, ' ');
    expect(HEARTH_KEY_COOLDOWN_MS).toBe(3_600_000);
    const clock = '(EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint';
    // SET and WHERE both use the clock plus the one cooldown, so a re-run or a
    // late run touches no healthy row.
    expect(bullet).toContain(`SET ready_at_ms = ${clock} + ${HEARTH_KEY_COOLDOWN_MS}`);
    expect(bullet).toContain(`WHERE ready_at_ms > ${clock} + ${HEARTH_KEY_COOLDOWN_MS}`);
    expect(bullet).not.toContain('$1');
    // A read finds them first, and the repair is refused during a clock step,
    // when healthy rows read as corrupt and clamping them would shorten them.
    expect(bullet).toContain(
      `SELECT account_id, ready_at_ms FROM account_freehold_hearth WHERE ready_at_ms > ${clock} + ${HEARTH_KEY_COOLDOWN_MS}`,
    );
    expect(bullet).toContain('NEVER repair during a clock step');
  });
});
