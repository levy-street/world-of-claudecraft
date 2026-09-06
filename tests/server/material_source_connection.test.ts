// server/material_source_connection.ts: composing the source-writer capability
// onto a real connection string.
//
// The load-bearing claim is NOT "an options string is produced" but "the
// operator's own options survive AND cannot override the capability", which is
// exactly the failure node-postgres's connection-string re-parse would cause
// silently. So every case asserts BOTH halves: what the options value becomes,
// and what is left in the string for the driver to re-parse.
import { describe, expect, it } from 'vitest';
import { materialSourceConnection } from '../../server/material_source_connection';
import {
  MATERIAL_SOURCE_WRITER_STARTUP_OPTION,
  withMaterialSourceWriterOption,
} from '../../server/material_source_writer';

const BASE = 'postgres://woc:secret@db.internal:5432/woc';

describe('materialSourceConnection: a string with no options parameter', () => {
  it('returns the string byte-identical and announces the capability alone', () => {
    for (const raw of [
      BASE,
      `${BASE}?sslmode=require`,
      `${BASE}?sslmode=require&application_name=woc`,
      'host=db.internal port=5432 dbname=woc',
      '',
    ]) {
      const resolved = materialSourceConnection(raw);
      expect(resolved.connectionString).toBe(raw);
      expect(resolved.options).toBe(MATERIAL_SOURCE_WRITER_STARTUP_OPTION);
      // Written out once, so this file pins the real startup value rather than
      // comparing the constant with itself.
      expect(resolved.options).toBe('-c woc.material_source_writer=1');
    }
  });

  it('leaves a query parameter that merely CONTAINS "options" alone', () => {
    const raw = `${BASE}?my_options=-c%20x%3D1`;
    const resolved = materialSourceConnection(raw);
    expect(resolved.connectionString).toBe(raw);
    expect(resolved.options).toBe(MATERIAL_SOURCE_WRITER_STARTUP_OPTION);
  });
});

describe('materialSourceConnection: a string that carries its own options', () => {
  it('lifts the decoded value, appends the capability, and REMOVES the pair', () => {
    const resolved = materialSourceConnection(`${BASE}?options=-c%20search_path%3Dwoc`);
    // The LITERAL startup packet value, operator options first and the
    // code-owned capability appended last, so it wins a repeated GUC.
    expect(resolved.options).toBe('-c search_path=woc -c woc.material_source_writer=1');
    expect(resolved.options).toBe(withMaterialSourceWriterOption('-c search_path=woc'));
    // The pair is gone, so the driver's own parse cannot put it back and win.
    expect(resolved.connectionString).toBe(BASE);
    expect(resolved.connectionString).not.toContain('options=');
  });

  it('decodes a + as a space, the way both driver parsers do', () => {
    const resolved = materialSourceConnection(`${BASE}?options=-c+search_path%3Dwoc`);
    expect(resolved.options).toBe(withMaterialSourceWriterOption('-c search_path=woc'));
  });

  it('keeps every OTHER parameter, in place and byte-identical', () => {
    const resolved = materialSourceConnection(
      `${BASE}?sslmode=require&options=-c%20x%3D1&application_name=woc%2Bmain`,
    );
    expect(resolved.connectionString).toBe(`${BASE}?sslmode=require&application_name=woc%2Bmain`);
    expect(resolved.options).toBe(withMaterialSourceWriterOption('-c x=1'));
  });

  it('drops the ? entirely when options was the only parameter', () => {
    expect(materialSourceConnection(`${BASE}?options=-c%20x%3D1`).connectionString).toBe(BASE);
  });

  it('reads an empty options value as empty, not as absent', () => {
    const resolved = materialSourceConnection(`${BASE}?options=`);
    expect(resolved.connectionString).toBe(BASE);
    expect(resolved.options).toBe(MATERIAL_SOURCE_WRITER_STARTUP_OPTION);
  });

  it('takes the FIRST of duplicate options pairs and removes them all', () => {
    const resolved = materialSourceConnection(`${BASE}?options=-c%20a%3D1&options=-c%20b%3D2`);
    expect(resolved.options).toBe(withMaterialSourceWriterOption('-c a=1'));
    // A survivor would be re-parsed by the driver and override the composed
    // value, which is the whole failure this module exists to prevent.
    expect(resolved.connectionString).toBe(BASE);
  });

  it('preserves a fragment tail unchanged', () => {
    const resolved = materialSourceConnection(`${BASE}?options=-c%20x%3D1#tail`);
    expect(resolved.connectionString).toBe(`${BASE}#tail`);
    expect(resolved.options).toBe(withMaterialSourceWriterOption('-c x=1'));
  });
});

describe('materialSourceConnection: refusals', () => {
  it('refuses an options value with a malformed percent escape, without echoing it', () => {
    let thrown: unknown;
    try {
      materialSourceConnection(`${BASE}?options=%zz`);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(String(thrown)).toContain('malformed percent escape');
    // The message is a credential-free operator diagnostic.
    expect(String(thrown)).not.toContain('secret');
    expect(String(thrown)).not.toContain(BASE);
  });

  it('propagates the composer refusal for options ending in an unpaired backslash', () => {
    expect(() => materialSourceConnection(`${BASE}?options=-c%20x%3D1%5C`)).toThrow(
      'unpaired backslash',
    );
  });
});
