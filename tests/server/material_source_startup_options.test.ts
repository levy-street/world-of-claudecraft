// The startup-options wiring, proven where it actually happens: the three
// connections server/db.ts opens (the pool and BOTH boot Clients) must each
// carry the code-owned writer capability, and must carry the OPERATOR'S OWN
// options with it.
//
// This is not a restatement of the composer's unit test. The failure it exists
// to catch is a wiring one: a connection built with `connectionString` alone
// (or with the capability composed but the operator's `options` dropped, or
// left in the string for node-postgres to re-parse OVER the property). Every
// assertion here reads the config object a pg constructor was really handed.
import { describe, expect, it, vi } from 'vitest';

// A connection string that carries BOTH a plain parameter and its own options:
// the shape where the driver's re-parse would otherwise win over the property.
const OPERATOR_URL =
  'postgres://woc:secret@db.internal:5432/woc?sslmode=require&options=-c%20search_path%3Dwoc';

const h = vi.hoisted(() => {
  process.env.DATABASE_URL =
    'postgres://woc:secret@db.internal:5432/woc?sslmode=require&options=-c%20search_path%3Dwoc';
  const poolConfigs: Record<string, unknown>[] = [];
  const clientConfigs: Record<string, unknown>[] = [];
  const query = vi.fn((sql: string) => {
    const text = String(sql);
    // The boot refuses unless every connection announces the capability.
    if (text.includes('woc.material_source_writer')) {
      return Promise.resolve({ rows: [{ capability: '1' }], rowCount: 1 });
    }
    if (text.includes('to_regclass')) {
      return Promise.resolve({ rows: [{ reg: 'public.rate_limits' }], rowCount: 1 });
    }
    if (text.includes('SELECT committed_rows')) {
      return Promise.resolve({
        rows: [{ committed_rows: '0', hard_limit_rows: '10000000' }],
        rowCount: 1,
      });
    }
    // node-postgres answers a multi-statement simple query with an ARRAY.
    const stripped = text.replace(/\$([A-Za-z_][A-Za-z0-9_]*)?\$[\s\S]*?\$\1\$/g, "''");
    const statements = stripped.split(';').filter((part) => part.trim().length > 0);
    if (statements.length > 1) {
      return Promise.resolve(statements.map(() => ({ rows: [], rowCount: 0 })));
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
  return { poolConfigs, clientConfigs, query };
});

vi.mock('pg', () => ({
  Pool: vi.fn(function Pool(config: Record<string, unknown>) {
    h.poolConfigs.push(config);
    return { query: h.query, connect: vi.fn(), on: vi.fn() };
  }),
  Client: vi.fn(function Client(config: Record<string, unknown>) {
    h.clientConfigs.push(config);
    return {
      connect: vi.fn(() => Promise.resolve()),
      query: h.query,
      end: vi.fn(() => Promise.resolve()),
      on: vi.fn(),
    };
  }),
}));

import { ensureSchema, runConcurrentIndexMigrations } from '../../server/db';
import { materialSourceConnection } from '../../server/material_source_connection';
import { MATERIAL_SOURCE_WRITER_STARTUP_OPTION } from '../../server/material_source_writer';

/** What every db.ts connection must be handed, composed once here so the three
 *  assertions below compare against ONE expectation. */
const EXPECTED = materialSourceConnection(OPERATOR_URL);

function expectAnnouncing(config: Record<string, unknown>, label: string): void {
  // The operator's own options survive, byte for byte, with the capability
  // appended LAST so it wins a repeated GUC.
  expect(config.options, `${label} options`).toBe(
    '-c search_path=woc -c woc.material_source_writer=1',
  );
  expect(config.options).toBe(EXPECTED.options);
  expect(String(config.options)).toContain(MATERIAL_SOURCE_WRITER_STARTUP_OPTION);
  // ...and the pair is GONE from the string, so the driver's own parse of the
  // connection string cannot put the operator's value back over the property.
  expect(config.connectionString, `${label} connectionString`).toBe(EXPECTED.connectionString);
  expect(String(config.connectionString)).not.toContain('options=');
  // Everything else in the string is untouched, credentials and all.
  expect(String(config.connectionString)).toContain('sslmode=require');
  expect(String(config.connectionString)).toContain('db.internal:5432/woc');
}

describe('every db.ts connection announces the writer capability', () => {
  it('drives db.ts with the operator string this file reasons about', () => {
    // The hoisted assignment cannot reference the const below (it runs first),
    // so the two are pinned against each other rather than assumed equal.
    expect(process.env.DATABASE_URL).toBe(OPERATOR_URL);
  });

  it('the pool, built at module load, carries the composed options', () => {
    expect(h.poolConfigs).toHaveLength(1);
    expectAnnouncing(h.poolConfigs[0], 'pool');
    // The pool keeps its own timeout ladder: composing options must not have
    // replaced the config, only added to it.
    expect(typeof h.poolConfigs[0].max).toBe('number');
    expect(typeof h.poolConfigs[0].statement_timeout).toBe('number');
  });

  it('BOTH boot clients carry it too (schema boot and the concurrent-index pass)', async () => {
    h.clientConfigs.length = 0;
    await ensureSchema();
    await runConcurrentIndexMigrations();
    expect(h.clientConfigs).toHaveLength(2);
    expectAnnouncing(h.clientConfigs[0], 'schema boot client');
    expectAnnouncing(h.clientConfigs[1], 'concurrent index client');
    // The boot clients still carry NO pool deadline (the db.ts contract they
    // exist for); adding options must not have added one.
    for (const config of h.clientConfigs) {
      expect('query_timeout' in config).toBe(false);
      expect('statement_timeout' in config).toBe(false);
    }
  });

  it('probes the capability on the pool as well as the boot client', async () => {
    // The pool is a different connection from the boot client, and it is the
    // one production writes ride, so boot asks IT too.
    h.query.mockClear();
    await ensureSchema();
    const probes = h.query.mock.calls.filter((call) =>
      String(call[0]).includes('woc.material_source_writer'),
    );
    expect(probes).toHaveLength(2);
  });
});
