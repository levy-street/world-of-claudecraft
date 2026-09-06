// Opt-in REAL-Postgres MECHANISM proof for the material-source writer
// capability guard (server/material_source_writer.ts).
//
// SCOPE, read this before trusting it: this suite proves only that the DDL
// behaves the way the guard claims (a capability-less connection is refused, a
// capability-carrying one is not, the refusal aborts its transaction, the
// startup option survives a session reset, the DDL re-applies cleanly). It is
// NOT proof of real save/bootstrap integration: no ensureSchema, no GameServer,
// no character save, no realm boot runs here, and no lock-strength or
// per-write-overhead claim is measured. The parent owns that measurement after
// wiring the option into the pool and the boot Clients.
//
// Isolation: everything happens inside one disposable schema whose name is
// generated locally from hex (a trusted identifier, shape-asserted before it is
// ever interpolated) and dropped in `finally`. The tables here are MINIMAL
// stand-ins carrying only the guarded NAMES; no real public table is created,
// replaced, or dropped, and every write below is schema-qualified so a reset
// search_path can never reach one. That guarantee is proven against a BASELINE
// of public's guard triggers taken before anything is applied, so a public
// schema that legitimately carries these guards after real integration reads as
// unchanged rather than as a failure.
//
// Gated on TEST_DATABASE_URL like every other *_pg_integration.test.ts:
// without it the file skips green and CI's DB-free floor is unchanged.

import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MATERIAL_SOURCE_GUARDED_TABLES,
  MATERIAL_SOURCE_WRITER_CAPABILITY,
  MATERIAL_SOURCE_WRITER_GUARD_SQL,
  MATERIAL_SOURCE_WRITER_SQLSTATE,
  MATERIAL_SOURCE_WRITER_STARTUP_OPTION,
  MATERIAL_SOURCE_WRITER_VERSION,
  materialSourceGuardTriggerName,
  withMaterialSourceWriterOption,
} from '../server/material_source_writer';

const TEST_URL = process.env.TEST_DATABASE_URL;
const describeDb = TEST_URL ? describe : describe.skip;

/** Generated locally, never caller-supplied; the shape is asserted before use. */
const SCHEMA = `woc_msw_test_${randomBytes(8).toString('hex')}`;
const SCRATCH = 'msw_unguarded_scratch';

function qualified(table: string): string {
  return `${SCHEMA}.${table}`;
}

/** The three write shapes, all schema-qualified and all trivially cheap. */
function writeSql(table: string, event: string, id: number): string {
  if (event === 'INSERT') return `INSERT INTO ${qualified(table)} (id) VALUES (${id})`;
  if (event === 'UPDATE') return `UPDATE ${qualified(table)} SET id = id WHERE id = ${id}`;
  return `DELETE FROM ${qualified(table)} WHERE id = ${id}`;
}

interface Refusal {
  readonly code?: string;
  readonly message: string;
}

async function refusalFor(client: Client, sql: string): Promise<Refusal | null> {
  try {
    await client.query(sql);
    return null;
  } catch (err) {
    const e = err as { code?: string; message?: string };
    return { code: e.code, message: String(e.message ?? err) };
  }
}

const GUARD_TRIGGER_NAMES = MATERIAL_SOURCE_GUARDED_TABLES.map((row) =>
  materialSourceGuardTriggerName(row.table),
);

const GUARD_TRIGGER_SQL = `SELECT c.relname AS table_name, t.tgname AS trigger_name
     FROM pg_trigger t
     JOIN pg_class c ON c.oid = t.tgrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE t.tgname = ANY($1::text[]) AND n.nspname = $2`;

interface SessionSettings {
  readonly capability: string | null;
  readonly appName: string | null;
}

/** Opens a throwaway connection with `options` and reads back what took effect. */
async function settingsWithOptions(options: string): Promise<SessionSettings> {
  const client = new Client({ connectionString: TEST_URL, options });
  try {
    await client.connect();
    const read = await client.query(
      `SELECT current_setting('${MATERIAL_SOURCE_WRITER_CAPABILITY}', true) AS capability,
              current_setting('application_name', true) AS app_name`,
    );
    return { capability: read.rows[0].capability, appName: read.rows[0].app_name };
  } finally {
    await client.end().catch(() => {});
  }
}

/** Sorted `table.trigger` identity of this guard's triggers within one schema. */
async function guardTriggersIn(client: Client, schema: string): Promise<string[]> {
  const rows = await client.query(GUARD_TRIGGER_SQL, [GUARD_TRIGGER_NAMES, schema]);
  return rows.rows.map((row) => `${row.table_name}.${row.trigger_name}`).sort();
}

describeDb('material source writer guard (REAL Postgres)', () => {
  // Both clients point at the SAME dedicated test database. Only `updated`
  // carries the capability, and only as a STARTUP option: nothing below ever
  // sets the GUC over SQL on `legacy`, because that would simulate a
  // capability an old binary cannot actually have.
  let updated: Client;
  let legacy: Client;
  let admin: Client;
  // Only a schema THIS run minted is ever dropped.
  let minted = false;
  // Identity of any guard trigger ALREADY present in public, captured before
  // this suite applies anything. Real integration may legitimately install
  // these guards in public, so the invariant is that this suite leaves that set
  // exactly as it found it, not that the set is empty.
  let publicBaseline: string[] = [];

  beforeAll(async () => {
    expect(SCHEMA).toMatch(/^woc_msw_test_[0-9a-f]{16}$/);

    admin = new Client({ connectionString: TEST_URL });
    await admin.connect();
    publicBaseline = await guardTriggersIn(admin, 'public');
    // A collision would mean reusing someone else's schema; refuse rather than
    // adopt it, and never touch a schema we did not just mint.
    const existing = await admin.query('SELECT 1 FROM pg_namespace WHERE nspname = $1', [SCHEMA]);
    expect(existing.rowCount).toBe(0);
    await admin.query(`CREATE SCHEMA ${SCHEMA}`);
    minted = true;

    const tables = [...MATERIAL_SOURCE_GUARDED_TABLES.map((row) => row.table), SCRATCH];
    for (const table of tables) {
      await admin.query(`CREATE TABLE ${qualified(table)} (id bigint PRIMARY KEY)`);
    }

    // search_path is what makes the DDL's unqualified table names resolve to
    // the disposable schema instead of public. It is set on the APPLYING
    // connection only, and the writes below stay qualified regardless.
    await admin.query(`SET search_path = ${SCHEMA}`);
    await admin.query(MATERIAL_SOURCE_WRITER_GUARD_SQL);

    updated = new Client({
      connectionString: TEST_URL,
      options: MATERIAL_SOURCE_WRITER_STARTUP_OPTION,
    });
    await updated.connect();
    legacy = new Client({ connectionString: TEST_URL });
    await legacy.connect();
  }, 120_000);

  afterAll(async () => {
    await updated?.end().catch(() => {});
    await legacy?.end().catch(() => {});
    try {
      if (minted) await admin?.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    } finally {
      await admin?.end().catch(() => {});
    }
  }, 60_000);

  it('installs its triggers in the disposable schema, on the right tables', async () => {
    const expected = MATERIAL_SOURCE_GUARDED_TABLES.map(
      (row) => `${row.table}.${materialSourceGuardTriggerName(row.table)}`,
    ).sort();
    expect(await guardTriggersIn(admin, SCHEMA)).toEqual(expected);
  });

  it('leaves the public schema exactly as it found it', async () => {
    expect(await guardTriggersIn(admin, 'public')).toEqual(publicBaseline);
  });

  it('lets an updated connection seed and write every guarded table and event', async () => {
    let id = 1000;
    for (const row of MATERIAL_SOURCE_GUARDED_TABLES) {
      for (const event of row.events) {
        id++;
        if (event !== 'INSERT') {
          await updated.query(writeSql(row.table, 'INSERT', id));
        }
        const refusal = await refusalFor(updated, writeSql(row.table, event, id));
        expect(refusal, `${event} on ${row.table} must be permitted`).toBeNull();
      }
    }
  });

  it('refuses every guarded table and event on a legacy connection', async () => {
    let id = 5000;
    for (const row of MATERIAL_SOURCE_GUARDED_TABLES) {
      for (const event of row.events) {
        id++;
        if (event !== 'INSERT') await updated.query(writeSql(row.table, 'INSERT', id));
        const refusal = await refusalFor(legacy, writeSql(row.table, event, id));
        expect(refusal, `${event} on ${row.table} must be refused`).not.toBeNull();
        expect(refusal?.code, `${event} on ${row.table} SQLSTATE`).toBe(
          MATERIAL_SOURCE_WRITER_SQLSTATE,
        );
        expect(refusal?.message).toContain('material source writer capability required');
      }
    }
  });

  it('refuses a legacy write that matches no row at all', async () => {
    // BEFORE ... FOR EACH STATEMENT fires on a zero-row statement too, which is
    // what keeps a speculative legacy DELETE from passing unnoticed.
    const refusal = await refusalFor(legacy, `DELETE FROM ${qualified('bank_ledger')} WHERE false`);
    expect(refusal?.code).toBe(MATERIAL_SOURCE_WRITER_SQLSTATE);
  });

  it('still permits the unguarded lease DELETE on a legacy connection', async () => {
    await updated.query(writeSql('character_leases', 'INSERT', 7001));
    const refusal = await refusalFor(legacy, writeSql('character_leases', 'DELETE', 7001));
    expect(refusal).toBeNull();
    const leases = qualified('character_leases');
    const left = await admin.query(`SELECT id FROM ${leases} WHERE id = 7001`);
    expect(left.rowCount).toBe(0);
    // The zero-row form of the same cleanup is permitted too.
    expect(await refusalFor(legacy, `DELETE FROM ${leases} WHERE false`)).toBeNull();
  });

  it('rolls back the earlier unguarded effect when a later write is denied', async () => {
    await legacy.query('BEGIN');
    await legacy.query(`INSERT INTO ${qualified(SCRATCH)} (id) VALUES (8001)`);
    const refusal = await refusalFor(legacy, writeSql('world_state', 'INSERT', 8002));
    expect(refusal?.code).toBe(MATERIAL_SOURCE_WRITER_SQLSTATE);
    await legacy.query('ROLLBACK');

    const scratch = await admin.query(`SELECT id FROM ${qualified(SCRATCH)} WHERE id = 8001`);
    expect(scratch.rowCount).toBe(0);
    const denied = await admin.query(`SELECT id FROM ${qualified('world_state')} WHERE id = 8002`);
    expect(denied.rowCount).toBe(0);
  });

  it('refuses a wrong or malformed capability value set at startup', async () => {
    // A RAW space in an option value would be split off as a second server
    // argument and the connection would never open, so the value with a space
    // is escaped the way PostgreSQL's options syntax requires.
    const values = ['0', '2', 'true', String.raw`yes\ please`];
    for (const value of values) {
      const wrong = new Client({
        connectionString: TEST_URL,
        options: `-c ${MATERIAL_SOURCE_WRITER_CAPABILITY}=${value}`,
      });
      try {
        // Inside the try so a failed connect still reaches end() below.
        await wrong.connect();
        const refusal = await refusalFor(wrong, writeSql('characters', 'INSERT', 9100));
        expect(refusal?.code, `capability value ${JSON.stringify(value)}`).toBe(
          MATERIAL_SOURCE_WRITER_SQLSTATE,
        );
      } finally {
        await wrong.end().catch(() => {});
      }
    }
  });

  it('announces the capability while preserving composed option values', async () => {
    // The composed string is what a wired caller would hand pg. Each case
    // proves BOTH halves survive pg_split_opts: the capability really arrives
    // as 1, and the caller's own value is unchanged.
    const cases = [
      { option: 'woc_msw_plain', expected: 'woc_msw_plain' },
      // An escaped space stays one value rather than splitting.
      { option: String.raw`woc\ msw\ spaced`, expected: 'woc msw spaced' },
      // A PAIR of terminal backslashes is one literal backslash in the value,
      // and is exactly the input the composer accepts rather than refusing.
      { option: String.raw`woc_msw_tail\\`, expected: 'woc_msw_tail\\' },
    ];
    for (const one of cases) {
      const combined = withMaterialSourceWriterOption(`-c application_name=${one.option}`);
      expect(combined.endsWith(MATERIAL_SOURCE_WRITER_STARTUP_OPTION)).toBe(true);
      const seen = await settingsWithOptions(combined);
      expect(seen.capability, `capability for ${one.expected}`).toBe(
        MATERIAL_SOURCE_WRITER_VERSION,
      );
      expect(seen.appName, `application_name for ${one.expected}`).toBe(one.expected);
    }
  });

  it('keeps the startup capability across RESET ALL and DISCARD ALL', async () => {
    // The capability arrives as a startup option, so a session reset restores
    // it rather than clearing it. search_path is NOT startup-set here, so it is
    // deliberately re-established afterwards; the writes stay qualified anyway.
    await updated.query('RESET ALL');
    expect(await refusalFor(updated, writeSql('characters', 'INSERT', 9201))).toBeNull();
    await updated.query('DISCARD ALL');
    expect(await refusalFor(updated, writeSql('characters', 'INSERT', 9202))).toBeNull();
    const read = `SELECT current_setting('${MATERIAL_SOURCE_WRITER_CAPABILITY}', true) AS value`;
    const setting = await updated.query(read);
    expect(setting.rows[0].value).toBe('1');
    await updated.query(`SET search_path = ${SCHEMA}`);
  });

  it('re-applies the DDL idempotently without duplicating a trigger', async () => {
    await admin.query(`SET search_path = ${SCHEMA}`);
    await admin.query(MATERIAL_SOURCE_WRITER_GUARD_SQL);
    await admin.query(MATERIAL_SOURCE_WRITER_GUARD_SQL);

    const count = await admin.query(
      `SELECT count(*)::int AS n
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND NOT t.tgisinternal`,
      [SCHEMA],
    );
    expect(count.rows[0].n).toBe(MATERIAL_SOURCE_GUARDED_TABLES.length);
    // The repeat apply reached no further than the first one did.
    expect(await guardTriggersIn(admin, 'public')).toEqual(publicBaseline);

    // Still guarding, and still permitting, after the repeat apply.
    expect((await refusalFor(legacy, writeSql('guild_banks', 'INSERT', 9301)))?.code).toBe(
      MATERIAL_SOURCE_WRITER_SQLSTATE,
    );
    expect(await refusalFor(updated, writeSql('guild_banks', 'INSERT', 9302))).toBeNull();
  });
});
