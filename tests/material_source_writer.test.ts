// DB-free pins for the material-source writer capability guard
// (server/material_source_writer.ts). This suite owns the SHAPE of the guard:
// the capability name/version/startup option, the stable SQLSTATE, the exact
// table-and-event coverage, and the absence of anything that would read rows.
//
// The expected coverage below is written out LITERALLY on purpose. Deriving it
// from the module's own export would make the pin vacuous: it would agree with
// whatever the production list happens to say. Changing the guarded set means
// changing this table by hand, in the same change.
//
// The real Postgres behavior (a refused write, a permitted lease cleanup, the
// transaction abort) is proven separately in
// tests/material_source_writer_pg_integration.test.ts.

import { describe, expect, it } from 'vitest';
import {
  MATERIAL_SOURCE_GUARDED_TABLES,
  MATERIAL_SOURCE_WRITER_CAPABILITY,
  MATERIAL_SOURCE_WRITER_ERROR_PREFIX,
  MATERIAL_SOURCE_WRITER_GUARD_FUNCTION,
  MATERIAL_SOURCE_WRITER_GUARD_SQL,
  MATERIAL_SOURCE_WRITER_SQLSTATE,
  MATERIAL_SOURCE_WRITER_STARTUP_OPTION,
  MATERIAL_SOURCE_WRITER_VERSION,
  materialSourceGuardTriggerName,
  withMaterialSourceWriterOption,
} from '../server/material_source_writer';

/**
 * The coverage contract, hand-written. `characters` is guarded on UPDATE as a
 * WHOLE TABLE deliberately: a rename and a state write are separate old
 * writers, so narrowing to the state column would miss one of them.
 * `character_leases` DELETE is deliberately absent: lease cleanup must keep
 * working on an un-migrated binary.
 */
const EXPECTED_COVERAGE: Record<string, readonly string[]> = {
  characters: ['INSERT', 'UPDATE', 'DELETE'],
  guild_banks: ['INSERT', 'UPDATE', 'DELETE'],
  world_state: ['INSERT', 'UPDATE', 'DELETE'],
  mail_custody_parcels: ['INSERT', 'UPDATE', 'DELETE'],
  mail_custody_watermark: ['INSERT', 'UPDATE', 'DELETE'],
  woc_market_listings: ['INSERT', 'UPDATE', 'DELETE'],
  woc_market_custody_claims: ['INSERT', 'UPDATE', 'DELETE'],
  woc_market_settlements: ['INSERT', 'UPDATE', 'DELETE'],
  woc_market_directed_offers: ['INSERT', 'UPDATE', 'DELETE'],
  bank_ledger: ['INSERT', 'UPDATE', 'DELETE'],
  material_source_containers: ['INSERT', 'UPDATE', 'DELETE'],
  material_source_journal: ['INSERT', 'UPDATE', 'DELETE'],
  character_leases: ['INSERT', 'UPDATE'],
};

const sql = MATERIAL_SOURCE_WRITER_GUARD_SQL;

/** Count of non-overlapping occurrences of a plain substring. */
function occurrences(haystack: string, needle: string): number {
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    count++;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return count;
}

describe('material source writer capability constants', () => {
  it('names one fixed capability at version 1', () => {
    expect(MATERIAL_SOURCE_WRITER_CAPABILITY).toBe('woc.material_source_writer');
    expect(MATERIAL_SOURCE_WRITER_VERSION).toBe('1');
  });

  it('builds the startup option from the capability and version', () => {
    expect(MATERIAL_SOURCE_WRITER_STARTUP_OPTION).toBe('-c woc.material_source_writer=1');
    expect(MATERIAL_SOURCE_WRITER_STARTUP_OPTION).toBe(
      `-c ${MATERIAL_SOURCE_WRITER_CAPABILITY}=${MATERIAL_SOURCE_WRITER_VERSION}`,
    );
  });

  it('refuses with a stable SQLSTATE and a stable message prefix', () => {
    expect(MATERIAL_SOURCE_WRITER_SQLSTATE).toBe('55000');
    expect(MATERIAL_SOURCE_WRITER_ERROR_PREFIX).toBe('material source writer capability required');
    expect(sql).toContain(`ERRCODE = '${MATERIAL_SOURCE_WRITER_SQLSTATE}'`);
    expect(sql).toContain(MATERIAL_SOURCE_WRITER_ERROR_PREFIX);
  });
});

describe('material source guarded table coverage', () => {
  it('guards exactly the expected tables, with no duplicates', () => {
    const listed = MATERIAL_SOURCE_GUARDED_TABLES.map((row) => row.table);
    expect([...listed].sort()).toEqual(Object.keys(EXPECTED_COVERAGE).sort());
    expect(new Set(listed).size).toBe(listed.length);
  });

  it('guards exactly the expected events per table', () => {
    for (const row of MATERIAL_SOURCE_GUARDED_TABLES) {
      expect(EXPECTED_COVERAGE[row.table], `unexpected guarded table ${row.table}`).toBeDefined();
      expect([...row.events], `events for ${row.table}`).toEqual([...EXPECTED_COVERAGE[row.table]]);
    }
  });

  it('leaves character_leases DELETE unguarded so lease cleanup survives', () => {
    const leases = MATERIAL_SOURCE_GUARDED_TABLES.find((row) => row.table === 'character_leases');
    expect(leases?.events).not.toContain('DELETE');
    expect(sql).not.toContain('OR DELETE ON character_leases');
  });

  it('emits one statement-level BEFORE trigger per guarded table', () => {
    for (const row of MATERIAL_SOURCE_GUARDED_TABLES) {
      const name = materialSourceGuardTriggerName(row.table);
      expect(name.length).toBeLessThanOrEqual(63);
      const clause = `CREATE OR REPLACE TRIGGER ${name}\n  BEFORE ${row.events.join(' OR ')} ON ${row.table}\n  FOR EACH STATEMENT`;
      expect(sql, `trigger clause for ${row.table}`).toContain(clause);
    }
    expect(occurrences(sql, 'CREATE OR REPLACE TRIGGER ')).toBe(
      MATERIAL_SOURCE_GUARDED_TABLES.length,
    );
    expect(occurrences(sql, 'FOR EACH STATEMENT')).toBe(MATERIAL_SOURCE_GUARDED_TABLES.length);
  });

  it('names no table outside the guarded list', () => {
    const onClauses = [...sql.matchAll(/ ON ([a-z_]+)\n/g)].map((match) => match[1]);
    expect(onClauses.length).toBe(MATERIAL_SOURCE_GUARDED_TABLES.length);
    for (const table of onClauses) {
      expect(EXPECTED_COVERAGE[table], `trigger on unlisted table ${table}`).toBeDefined();
    }
  });
});

describe('material source guard DDL safety', () => {
  it('reads the capability once, tolerating an unset setting', () => {
    expect(occurrences(sql, 'current_setting(')).toBe(1);
    expect(sql).toContain(`current_setting('${MATERIAL_SOURCE_WRITER_CAPABILITY}', true)`);
    expect(sql).toContain(`IS DISTINCT FROM '${MATERIAL_SOURCE_WRITER_VERSION}'`);
  });

  it('scans no rows and no table data', () => {
    // A per-row trigger, a row payload read, or a probe query would put the
    // guard's cost on the write path. It has none of those.
    expect(sql).not.toContain('FOR EACH ROW');
    expect(sql).not.toContain('NEW.');
    expect(sql).not.toContain('OLD.');
    expect(sql).not.toContain('REFERENCING');
    expect(sql).not.toMatch(/\bSELECT\b/);
    expect(sql).not.toMatch(/\bPERFORM\b/);
    // The only FROM in the guard is the null-safe comparison operator.
    expect(sql.replace(/IS DISTINCT FROM/g, '')).not.toMatch(/\bFROM\b/);
    // PG16 permits a WHEN clause on a statement-level trigger (it just cannot
    // reference NEW/OLD there). None is used: every write is guarded.
    expect(sql).not.toMatch(/\bWHEN\b/);
  });

  it('creates no index, queue, or retention machinery', () => {
    expect(sql).not.toMatch(/\bCREATE\s+(UNIQUE\s+)?INDEX\b/);
    expect(sql).not.toMatch(/\bCREATE\s+TABLE\b/);
    expect(sql).not.toMatch(/\bINSERT\s+INTO\b/);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/);
    expect(sql).not.toMatch(/\bUPDATE\s+[a-z_]+\s+SET\b/);
  });

  it('builds no dynamic SQL and interpolates no caller input', () => {
    expect(sql).not.toMatch(/\bEXECUTE\s+(format|'|")/);
    expect(sql).not.toContain('quote_ident');
    expect(sql).not.toContain('quote_literal');
    expect(sql).not.toContain('||');
    expect(sql).not.toContain('$1');
  });

  it('is idempotent: every object is CREATE OR REPLACE', () => {
    expect(occurrences(sql, 'CREATE OR REPLACE FUNCTION ')).toBe(1);
    expect(sql).toContain(`CREATE OR REPLACE FUNCTION ${MATERIAL_SOURCE_WRITER_GUARD_FUNCTION}()`);
    // A bare CREATE TRIGGER / CREATE FUNCTION would fail the second apply.
    expect(sql).not.toMatch(/(^|\n)CREATE TRIGGER\b/);
    expect(sql).not.toMatch(/(^|\n)CREATE FUNCTION\b/);
    expect(sql).not.toContain('DROP ');
  });

  it('every trigger runs the one shared guard function', () => {
    expect(occurrences(sql, `EXECUTE FUNCTION ${MATERIAL_SOURCE_WRITER_GUARD_FUNCTION}()`)).toBe(
      MATERIAL_SOURCE_GUARDED_TABLES.length,
    );
  });
});

describe('material source writer startup option combining', () => {
  it('returns the bare option for empty caller options', () => {
    expect(withMaterialSourceWriterOption(undefined)).toBe(MATERIAL_SOURCE_WRITER_STARTUP_OPTION);
    expect(withMaterialSourceWriterOption(null)).toBe(MATERIAL_SOURCE_WRITER_STARTUP_OPTION);
    expect(withMaterialSourceWriterOption('')).toBe(MATERIAL_SOURCE_WRITER_STARTUP_OPTION);
  });

  it('appends the capability after the caller options', () => {
    expect(withMaterialSourceWriterOption('-c statement_timeout=15000')).toBe(
      '-c statement_timeout=15000 -c woc.material_source_writer=1',
    );
  });

  it('carries the caller string through byte for byte', () => {
    // Backslash-escaped whitespace is meaningful INSIDE a PostgreSQL option
    // value; tokenizing and re-joining would silently rewrite it.
    const escaped = String.raw`-c search_path=one\ two`;
    expect(withMaterialSourceWriterOption(escaped)).toBe(
      `${escaped} ${MATERIAL_SOURCE_WRITER_STARTUP_OPTION}`,
    );
    expect(withMaterialSourceWriterOption(escaped).startsWith(escaped)).toBe(true);

    // Runs of whitespace, tabs and surrounding padding are the caller's too.
    const padded = '  -c  application_name=woc\t-c statement_timeout=15000  ';
    expect(withMaterialSourceWriterOption(padded)).toBe(
      `${padded} ${MATERIAL_SOURCE_WRITER_STARTUP_OPTION}`,
    );
    const whitespaceOnly = '   ';
    expect(withMaterialSourceWriterOption(whitespaceOnly)).toBe(
      `${whitespaceOnly} ${MATERIAL_SOURCE_WRITER_STARTUP_OPTION}`,
    );
  });

  it('appends last so the code-owned value wins over a conflicting one', () => {
    const conflicting = '-c woc.material_source_writer=0';
    expect(withMaterialSourceWriterOption(conflicting)).toBe(
      `${conflicting} ${MATERIAL_SOURCE_WRITER_STARTUP_OPTION}`,
    );
    const joined = '-cwoc.material_source_writer=99 -c statement_timeout=15000';
    const combined = withMaterialSourceWriterOption(joined);
    expect(combined).toBe(`${joined} ${MATERIAL_SOURCE_WRITER_STARTUP_OPTION}`);
    expect(combined.endsWith(MATERIAL_SOURCE_WRITER_STARTUP_OPTION)).toBe(true);
  });

  it('refuses an odd-length run of terminal backslashes', () => {
    // pg_split_opts consumes an unpaired terminal backslash, so the appended
    // separator would be escaped and the `-c` after it swallowed into the
    // previous value: the capability would silently not be announced.
    const one = '-c application_name=woc\\';
    const three = '-c application_name=woc\\\\\\';
    expect(one.endsWith('\\')).toBe(true);
    expect(() => withMaterialSourceWriterOption(one)).toThrow(/unpaired backslash/);
    expect(() => withMaterialSourceWriterOption(three)).toThrow(/unpaired backslash/);
  });

  it('accepts an even-length run of terminal backslashes unchanged', () => {
    // Each pair is one literal backslash in the value, so the separator that
    // follows is a real separator.
    const two = '-c application_name=woc\\\\';
    const four = '-c application_name=woc\\\\\\\\';
    expect(withMaterialSourceWriterOption(two)).toBe(
      `${two} ${MATERIAL_SOURCE_WRITER_STARTUP_OPTION}`,
    );
    expect(withMaterialSourceWriterOption(four)).toBe(
      `${four} ${MATERIAL_SOURCE_WRITER_STARTUP_OPTION}`,
    );
  });

  it('refuses with a static diagnostic that never echoes the options', () => {
    const messageFor = (options: string): string => {
      try {
        withMaterialSourceWriterOption(options);
      } catch (err) {
        return String((err as Error).message);
      }
      return '';
    };
    const first = messageFor('-c application_name=operator_detail_abc\\');
    const second = messageFor('-c search_path=other\\');
    // Same message for different inputs, and neither input appears in it.
    expect(first).not.toBe('');
    expect(first).toBe(second);
    expect(first).not.toContain('operator_detail_abc');
    expect(first).not.toContain('search_path');
  });

  it('appends again when already present, rather than deduplicating', () => {
    // The string is built once at connection creation, so there is no caller
    // that needs idempotence, and the repeated value is the same one anyway.
    const already = '-c woc.material_source_writer=1';
    expect(withMaterialSourceWriterOption(already)).toBe(
      `${already} ${MATERIAL_SOURCE_WRITER_STARTUP_OPTION}`,
    );
  });
});
