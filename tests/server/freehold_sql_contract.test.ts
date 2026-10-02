// Guards: the housing boundary's SQL and input contract as LITERALS, read
// without a database: the hook's write fence and the renewer's still-held read
// (each predicate a mutant could drop), the chunk, cap and copy-ref bounds, the
// export allowlists (no holder, generation, token, fingerprint or fence ever
// leaves the server), the advisory-lock class census the touch-set manifest
// promises (every two-key advisory call site, its class distinct), the intent
// bounds one dimension at a time against a passing maximal control, the
// prepare's account binding, the read-fence lock's input checks, the guard's
// raise identity and the DDL's search path. The nearest suite,
// tests/server/freehold_mutation.test.ts, compares most of these statements
// only to the same imported constants, which no mutant of their text can fail.
//
// Cost: 52 ms
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { freeholdAccountExport } from '../../server/freehold_account_export';
import {
  FREEHOLD_CLAIM_EXPORT_SQL,
  FREEHOLD_CLAIM_FENCE_SQL,
  FREEHOLD_CLAIM_STILL_HELD_SQL,
  lockFreeholdClaimFenceOnClient,
} from '../../server/freehold_claim_db';
import { FREEHOLD_CLAIM_RENEW_CHUNK } from '../../server/freehold_claim_registry';
import { FREEHOLD_PLOT_EXPORT_SQL } from '../../server/freehold_db';
import { FREEHOLD_HEARTH_EXPORT_SQL } from '../../server/freehold_hearth_db';
import {
  FREEHOLD_ADVISORY_ACCOUNT_CLASS,
  FREEHOLD_ADVISORY_OPERATION_CLASS,
  FREEHOLD_OPERATION_EXPORT_INTENTS_SQL,
  FREEHOLD_OPERATION_EXPORT_RECEIPT_LIMIT,
  FREEHOLD_OPERATION_EXPORT_RECEIPTS_SQL,
  FREEHOLD_OPERATION_MAX_COPY_REFS,
  FREEHOLD_OPERATION_OPEN_CONSTRAINT,
  FREEHOLD_OPERATION_OPEN_MESSAGE,
  FREEHOLD_OPERATION_OPEN_PER_ACCOUNT,
  FREEHOLD_OPERATION_SCHEMA,
  type FreeholdOperationIntent,
  freeholdOperationSchema,
  prepareFreeholdOperation,
} from '../../server/freehold_operation_db';
import type { FreeholdTxPool } from '../../server/freehold_tx';
import { GENERAL_CHAT_QUOTA_ADVISORY_NAMESPACE } from '../../server/general_chat_quota_config';
import { WOC_MARKET_SWEEP_ADVISORY_LOCK_KEY } from '../../server/woc_market_sweep';
import { sourceFilesUnder } from '../helpers/source_files_under';
import { stripComments } from '../helpers/strip_comments';

describe('the claim statements a mutant of their text must fail', () => {
  it('pins the hook write fence: plot, holder AND generation, stamping the attempt token', () => {
    expect(FREEHOLD_CLAIM_FENCE_SQL).toBe(`UPDATE freehold_plot_claims
   SET write_token = $4
 WHERE plot_id = $1 AND holder = $2 AND generation = $3::bigint
RETURNING plot_id`);
  });

  it("pins the renewer's still-held read to this holder's own rows", () => {
    expect(FREEHOLD_CLAIM_STILL_HELD_SQL).toBe(`SELECT plot_id FROM freehold_plot_claims
 WHERE holder = $1 AND plot_id = ANY($2::text[])`);
  });

  it('pins the bounds the renewer, the cap, the export and the intent rows run under', () => {
    expect(FREEHOLD_CLAIM_RENEW_CHUNK).toBe(256);
    expect(FREEHOLD_OPERATION_OPEN_PER_ACCOUNT).toBe(8);
    expect(FREEHOLD_OPERATION_EXPORT_RECEIPT_LIMIT).toBe(200);
    expect(FREEHOLD_OPERATION_MAX_COPY_REFS).toBe(64);
  });
});

describe('the account export allowlists', () => {
  const INTERNAL = ['holder', 'generation', 'write_token', 'advance_token', 'fingerprint', 'fence'];

  it('exports exactly these columns, and none of the server internals', () => {
    expect(
      FREEHOLD_CLAIM_EXPORT_SQL,
    ).toBe(`SELECT plot_id, realm, acquired_at, heartbeat_at, expires_at
  FROM freehold_plot_claims WHERE account_id = $1 ORDER BY plot_id`);
    expect(
      FREEHOLD_OPERATION_EXPORT_INTENTS_SQL,
    ).toBe(`SELECT operation_id, kind, character_id, plot_id,
       copy_refs, expected_durable_rev::text AS expected_durable_rev, created_at
  FROM freehold_operations WHERE account_id = $1 ORDER BY created_at, operation_id`);
    expect(
      FREEHOLD_OPERATION_EXPORT_RECEIPTS_SQL,
    ).toBe(`SELECT operation_id, kind, outcome, plot_id,
       applied_durable_rev::text AS applied_durable_rev, closed_at
  FROM freehold_operation_receipts WHERE account_id = $1
 ORDER BY closed_at DESC, operation_id DESC
 LIMIT $2`);
    expect(
      FREEHOLD_HEARTH_EXPORT_SQL,
    ).toBe(`SELECT ready_at_ms::text AS ready_at_ms, revision::text AS revision, updated_at
  FROM account_freehold_hearth
 WHERE account_id = $1`);
    for (const sql of [
      FREEHOLD_CLAIM_EXPORT_SQL,
      FREEHOLD_OPERATION_EXPORT_INTENTS_SQL,
      FREEHOLD_OPERATION_EXPORT_RECEIPTS_SQL,
      FREEHOLD_HEARTH_EXPORT_SQL,
      FREEHOLD_PLOT_EXPORT_SQL,
    ]) {
      const selected = sql.slice(0, sql.indexOf('FROM'));
      for (const internal of INTERNAL) expect(selected, internal).not.toContain(internal);
    }
  });

  it("names the plot export's columns: the row, its shape, and the two bounded content columns", () => {
    // The plot statement carries its byte gates inline, so its column list is
    // pinned by name rather than as one literal: the top-level SELECT list,
    // comments and the gate expressions taken out, is exactly these.
    const head = FREEHOLD_PLOT_EXPORT_SQL.slice(
      0,
      FREEHOLD_PLOT_EXPORT_SQL.indexOf('FROM account_freeholds f'),
    )
      .replace(/--[^\n]*/g, '')
      .replace(/CASE WHEN[\s\S]*?END AS (\w+)/g, '$1');
    const columns = head
      .replace(/^\s*SELECT\s+/, '')
      .split(',')
      .map((column) => column.trim())
      .filter((column) => column !== '');
    expect(columns).toEqual([
      'plot_index',
      'plot_id',
      'schema_version',
      'durable_rev',
      'wire_rev',
      'tier',
      'condition',
      'visit_policy',
      'upkeep_binding',
      'upkeep_checkpoint',
      'upkeep_credit',
      'created_at',
      'updated_at',
      'b.disk_bytes',
      'b.owned_bytes',
      'layout',
      'trophies',
    ]);
  });
});

describe('the housing account export', () => {
  it('reads on ONE client and releases it once, on a throwing read as on success', async () => {
    const sent: string[] = [];
    const run = async (failAt: number | null) => {
      let reads = 0;
      sent.length = 0;
      const release = vi.fn();
      const client = {
        query: vi.fn(async (text: string) => {
          sent.push(text);
          reads += 1;
          if (reads === failAt) throw new Error('the read failed');
          return { rows: [], rowCount: 0 };
        }),
        release,
      };
      const connect = vi.fn(async () => client);
      const out = await freeholdAccountExport({ connect } as never, 7).then(
        () => 'ok',
        (error: unknown) => (error as Error).message,
      );
      return { out, connects: connect.mock.calls.length, releases: release.mock.calls.length };
    };
    expect(await run(null)).toEqual({ out: 'ok', connects: 1, releases: 1 });
    // And what it SENDS is exactly the pinned statements, in order, so a loader
    // that went back to inline SQL (an internal column included) fails here.
    expect(sent).toEqual([
      FREEHOLD_PLOT_EXPORT_SQL,
      FREEHOLD_HEARTH_EXPORT_SQL,
      FREEHOLD_CLAIM_EXPORT_SQL,
      FREEHOLD_OPERATION_EXPORT_INTENTS_SQL,
      FREEHOLD_OPERATION_EXPORT_RECEIPTS_SQL,
    ]);
    // A read that throws mid-export (a lock or statement timeout, a lost
    // socket) still hands the client back, once.
    expect(await run(2)).toEqual({ out: 'the read failed', connects: 1, releases: 1 });
  });
});

describe('the advisory-lock class census', () => {
  /** Every advisory-lock call in the text, with its top-level arguments. */
  const callsIn = (source: string): string[][] => {
    const calls: string[][] = [];
    const re = /\bpg_(?:try_)?advisory_(?:xact_)?(?:un)?lock(?:_shared)?\(/g;
    for (const match of source.matchAll(re)) {
      let depth = 1;
      let at = (match.index ?? 0) + match[0].length;
      const args: string[] = [''];
      for (; at < source.length && depth > 0; at++) {
        const ch = source[at];
        if (ch === '(') depth++;
        if (ch === ')') depth--;
        if (depth === 0) break;
        if (ch === ',' && depth === 1) args.push('');
        else args[args.length - 1] += ch;
      }
      calls.push(args.map((arg) => arg.replace(/\s+/g, ' ').trim()));
    }
    return calls;
  };

  it('finds every TWO-KEY advisory call site in server/, each reviewed, each class distinct', () => {
    const twoKey: string[] = [];
    let singleKey = 0;
    for (const { full, file } of sourceFilesUnder('server')) {
      for (const args of callsIn(readFileSync(full, 'utf8'))) {
        if (args.length === 2) twoKey.push(`server/${file}: ${args[0]}`);
        else singleKey++;
      }
    }
    // The single-key form is its own keyspace in PostgreSQL (one bigint), so a
    // two-key class can never collide with it; the census is the two-key set.
    expect(singleKey).toBeGreaterThan(5);
    expect(twoKey.sort()).toEqual(
      [
        // The housing classes (bound from FREEHOLD_ADVISORY_*_CLASS).
        'server/freehold_operation_db.ts: $1::int',
        'server/freehold_operation_db.ts: $1::int',
        // The general chat quota (GENERAL_CHAT_QUOTA_ADVISORY_NAMESPACE).
        'server/general_chat_quota_db.ts: $1::int',
        'server/general_chat_quota_schema.ts: ${GENERAL_CHAT_QUOTA_ADVISORY_NAMESPACE}',
        // The $WOC market sweep, lock and unlock (WOC_MARKET_SWEEP_ADVISORY_LOCK_KEY).
        'server/woc_market_sweep.ts: $1',
        'server/woc_market_sweep.ts: $1',
      ].sort(),
    );
    const classes = [
      FREEHOLD_ADVISORY_ACCOUNT_CLASS,
      FREEHOLD_ADVISORY_OPERATION_CLASS,
      GENERAL_CHAT_QUOTA_ADVISORY_NAMESPACE,
      WOC_MARKET_SWEEP_ADVISORY_LOCK_KEY,
    ];
    expect(new Set(classes).size).toBe(classes.length);
    expect(FREEHOLD_ADVISORY_ACCOUNT_CLASS).toBe(0x46_48_41_01);
    expect(FREEHOLD_ADVISORY_OPERATION_CLASS).toBe(0x46_48_4f_01);
  });

  it('reads a call split across lines and a nested comma as ONE argument (the census reader control)', () => {
    expect(callsIn('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))')).toEqual([
      ['hashtextextended($1::text, 0)'],
    ]);
    expect(callsIn('PERFORM pg_catalog.pg_advisory_xact_lock(\n  42,\n  p_id\n);')).toEqual([
      ['42', 'p_id'],
    ]);
  });
});

/** A pool whose checkout means validation passed: no statement may run. */
const reachedPool = (): FreeholdTxPool =>
  ({
    async connect() {
      throw new Error('reached the pool');
    },
  }) as unknown as FreeholdTxPool;

const MAXIMAL: FreeholdOperationIntent = {
  operationId: `fop:${'a'.repeat(92)}`,
  accountId: 7,
  characterId: 9,
  plotId: `plot:${'b'.repeat(59)}`,
  kind: `k${'x'.repeat(47)}`,
  fingerprint: 'f'.repeat(64),
  copyRefs: Array.from({ length: 64 }, (_, i) => `c${String(i).padStart(127, '0')}`),
  expectedDurableRev: '9223372036854775807',
  fenceGeneration: '9223372036854775807',
};

describe('the intent bounds, one dimension at a time', () => {
  it('admits the maximal intent: 96-char id, 48-char kind, 64 copy refs of 128 chars', async () => {
    expect(MAXIMAL.operationId).toHaveLength(96);
    expect(MAXIMAL.kind).toHaveLength(48);
    expect(MAXIMAL.copyRefs).toHaveLength(64);
    expect(MAXIMAL.copyRefs.every((ref) => ref.length === 128)).toBe(true);
    await expect(prepareFreeholdOperation(reachedPool(), MAXIMAL)).rejects.toThrow(
      'reached the pool',
    );
  });

  it.each<[string, Partial<FreeholdOperationIntent>]>([
    ['an empty id', { operationId: '' }],
    ['a 97-char id', { operationId: `${MAXIMAL.operationId}a` }],
    ['an id with a slash', { operationId: 'fop:a/b' }],
    ['a zero account', { accountId: 0 }],
    ['a fractional account', { accountId: 1.5 }],
    ['a zero character', { characterId: 0 }],
    ['a plot id with a dot', { plotId: 'plot:a.b' }],
    ['a 65-char plot id', { plotId: `plot:${'b'.repeat(60)}` }],
    ['an uppercase kind', { kind: 'Kind' }],
    ['a 49-char kind', { kind: `${MAXIMAL.kind}x` }],
    ['a 63-hex fingerprint', { fingerprint: 'f'.repeat(63) }],
    ['an uppercase fingerprint', { fingerprint: 'F'.repeat(64) }],
    ['65 copy refs', { copyRefs: [...MAXIMAL.copyRefs, 'extra'] }],
    ['a 129-char copy ref', { copyRefs: [`${MAXIMAL.copyRefs[0]}x`] }],
    ['an empty copy ref', { copyRefs: [''] }],
    ['a duplicate copy ref', { copyRefs: ['a', 'a'] }],
    ['a non-string copy ref', { copyRefs: [7 as unknown as string] }],
    ['a zero expected revision', { expectedDurableRev: '0' }],
    ['a 20-digit expected revision', { expectedDurableRev: '12345678901234567890' }],
    ['a revision past the bigint range', { expectedDurableRev: '9223372036854775808' }],
    ['a fence past the bigint range', { fenceGeneration: '9999999999999999999' }],
    ['a zero fence', { fenceGeneration: '0' }],
    ['a plot without a fence', { fenceGeneration: null }],
    ['a fence without a plot', { plotId: null, expectedDurableRev: null }],
    ['a plot-less intent expecting a revision', { plotId: null, fenceGeneration: null }],
  ])('refuses %s before any statement', async (_name, over) => {
    await expect(prepareFreeholdOperation(reachedPool(), { ...MAXIMAL, ...over })).rejects.toThrow(
      RangeError,
    );
  });

  it('admits a plot-less intent (no plot, no fence, no revision): the coupling control', async () => {
    await expect(
      prepareFreeholdOperation(reachedPool(), {
        ...MAXIMAL,
        plotId: null,
        fenceGeneration: null,
        expectedDurableRev: null,
      }),
    ).rejects.toThrow('reached the pool');
  });
});

describe("the prepare's existing-id answers are bound to the asking account", () => {
  /** A scripted transaction: the parents exist, the given receipt or intent
   *  row (if any) answers its read, every other statement answers nothing. */
  const prepareOn = (rows: {
    receipt?: Record<string, unknown>;
    intent?: Record<string, unknown>;
  }) => {
    const client = {
      async query(text: string) {
        if (text.startsWith('BEGIN') || text === 'ROLLBACK')
          return { rows: [], rowCount: 0, command: 'BEGIN' };
        if (text === 'COMMIT') return { rows: [], rowCount: 0, command: 'COMMIT' };
        if (
          text.startsWith('SELECT id FROM accounts') ||
          text.startsWith('SELECT id FROM characters')
        )
          return { rows: [{ id: 7 }], rowCount: 1, command: 'SELECT' };
        if (text.includes('FROM freehold_operation_receipts') && rows.receipt)
          return { rows: [rows.receipt], rowCount: 1, command: 'SELECT' };
        if (
          text.startsWith('SELECT fingerprint, account_id FROM freehold_operations') &&
          rows.intent
        )
          return { rows: [rows.intent], rowCount: 1, command: 'SELECT' };
        return { rows: [], rowCount: 0, command: 'SELECT' };
      },
      release() {},
      on: () => client,
      removeListener: () => client,
    };
    const pool = {
      async connect() {
        return client;
      },
    } as unknown as FreeholdTxPool;
    return prepareFreeholdOperation(pool, { ...MAXIMAL, accountId: 7 });
  };
  const F = MAXIMAL.fingerprint;

  it('reports a closed outcome only to its own account, a foreign or erased one is a conflict', async () => {
    await expect(
      prepareOn({ receipt: { outcome: 'applied', fingerprint: F, account_id: 7 } }),
    ).resolves.toEqual({
      kind: 'closed',
      outcome: 'applied',
    });
    await expect(
      prepareOn({ receipt: { outcome: 'applied', fingerprint: F, account_id: 99 } }),
    ).resolves.toEqual({
      kind: 'conflict',
    });
    await expect(
      prepareOn({ receipt: { outcome: 'applied', fingerprint: null, account_id: null } }),
    ).resolves.toEqual({
      kind: 'conflict',
    });
  });

  it('reports an open intent as a duplicate only to its own account', async () => {
    await expect(prepareOn({ intent: { fingerprint: F, account_id: 7 } })).resolves.toEqual({
      kind: 'duplicate',
    });
    await expect(prepareOn({ intent: { fingerprint: F, account_id: 99 } })).resolves.toEqual({
      kind: 'conflict',
    });
    // Control: another fingerprint on the asker's own id is a conflict too.
    await expect(
      prepareOn({ intent: { fingerprint: 'e'.repeat(64), account_id: 7 } }),
    ).resolves.toEqual({
      kind: 'conflict',
    });
  });
});

describe('the read-fence lock refuses a malformed fence before any statement', () => {
  it('checks the plot, the holder and the generation, and reads the row count', async () => {
    const seen: string[] = [];
    const tx = {
      async query(text: string) {
        seen.push(text);
        return { rowCount: 1 };
      },
    };
    const good = { plotId: 'plot:a', holder: 'realm#h', generation: '2' };
    for (const bad of [
      { ...good, plotId: 'plot:a.b' },
      { ...good, holder: '' },
      { ...good, generation: '0' },
      { ...good, generation: 'x' },
    ]) {
      await expect(lockFreeholdClaimFenceOnClient(tx, bad)).rejects.toThrow(RangeError);
    }
    expect(seen).toEqual([]);
    // Control: a good fence issues the one statement and reads rowCount when
    // the driver hands no rows array.
    await expect(lockFreeholdClaimFenceOnClient(tx, good)).resolves.toBe(true);
    expect(seen).toHaveLength(1);
    // And it READS the count: no row locked (the fence missed) answers false.
    const missed = { query: async () => ({ rowCount: 0 }) };
    await expect(lockFreeholdClaimFenceOnClient(missed, good)).resolves.toBe(false);
  });
});

describe('the operation DDL', () => {
  it('raises the guard with the exported identity, interpolated, so the two can never drift', () => {
    expect(FREEHOLD_OPERATION_OPEN_MESSAGE).toBe('freehold_operation_open');
    expect(FREEHOLD_OPERATION_OPEN_CONSTRAINT).toBe('freehold_operations_open_delete_guard');
    expect(FREEHOLD_OPERATION_SCHEMA).toContain("MESSAGE = 'freehold_operation_open',");
    expect(FREEHOLD_OPERATION_SCHEMA).toContain(
      "CONSTRAINT = 'freehold_operations_open_delete_guard';",
    );
  });

  it('never names pg_catalog in its own search path, so no decoy built-in can bind into a CHECK', () => {
    expect(FREEHOLD_OPERATION_SCHEMA).toContain('SET LOCAL search_path = "public", pg_temp;');
    expect(freeholdOperationSchema('fhqa')).toContain('SET LOCAL search_path = "fhqa", pg_temp;');
    expect(FREEHOLD_OPERATION_SCHEMA).not.toMatch(/SET LOCAL search_path = "public", pg_catalog/);
  });
});

describe('the boot identity leaf', () => {
  it('is what the index runner imports, never db.ts (no import cycle)', () => {
    // Comment-stripped: a commented-out import is no importer.
    const runner = stripComments(readFileSync('server/concurrent_index_runner.ts', 'utf8'));
    expect(runner).toContain(
      "import { SCHEMA_ADVISORY_LOCK_KEY, SOURCE_WRITER_CONNECTION } from './db_boot_connection';",
    );
    expect(runner).not.toMatch(/^import [^;]* from '\.\/db';$/m);
  });

  it('hands the writer-capability connection to exactly the two boot clients', () => {
    // SOURCE_WRITER_CONNECTION carries the material-source writer capability:
    // only db.ts (the pool and the boot schema client) and the concurrent
    // index runner may take it. Any other importer is a new writer.
    const importers = sourceFilesUnder('server')
      .filter(({ full }) =>
        /\bSOURCE_WRITER_CONNECTION\b/.test(stripComments(readFileSync(full, 'utf8'))),
      )
      .map(({ file }) => `server/${file}`)
      .sort();
    expect(importers).toEqual([
      'server/concurrent_index_runner.ts',
      'server/db.ts',
      'server/db_boot_connection.ts',
    ]);
  });
});
