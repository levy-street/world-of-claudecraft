// server/material_source_host.ts: the boot steps that make this process a
// source-aware writer's host.
//
// Two claims are load-bearing here and neither can be read off db.ts. The guard
// has NO switch: it installs on every boot, because this binary writes material
// compositions and an un-migrated writer on the same rows is exactly what it
// prevents. And it never installs without first PROVING this process announces
// the capability on both the boot client and the pool, so a process that could
// not satisfy its own guard refuses to boot rather than failing at its first save.
import { describe, expect, it, vi } from 'vitest';
import {
  applyMaterialSourceSchema,
  applyMaterialSourceWriterGuard,
  assertMaterialSourceWriterCapability,
  MATERIAL_SOURCE_CAPABILITY_PROBE_SQL,
  MATERIAL_SOURCE_CAPABILITY_REFUSAL,
} from '../../server/material_source_host';
import {
  MATERIAL_SOURCE_CONTAINERS_TABLE,
  MATERIAL_SOURCE_JOURNAL_TABLE,
} from '../../server/material_source_journal_db';
import {
  MATERIAL_SOURCE_WRITER_CAPABILITY,
  MATERIAL_SOURCE_WRITER_GUARD_FUNCTION,
  MATERIAL_SOURCE_WRITER_VERSION,
} from '../../server/material_source_writer';

/** A connection that announces `capability` (null = an un-migrated writer). */
function connection(capability: string | null = MATERIAL_SOURCE_WRITER_VERSION) {
  const query = vi.fn(async (text: string) =>
    text === MATERIAL_SOURCE_CAPABILITY_PROBE_SQL
      ? { rows: [{ capability }], rowCount: 1 }
      : { rows: [], rowCount: 0 },
  );
  return { query };
}

describe('applyMaterialSourceSchema', () => {
  it('applies the additive anchor + journal DDL on the boot client it is handed', async () => {
    const client = connection();
    await applyMaterialSourceSchema(client);
    expect(client.query).toHaveBeenCalledTimes(1);
    const ddl = String(client.query.mock.calls[0][0]);
    expect(ddl).toContain(`CREATE TABLE IF NOT EXISTS ${MATERIAL_SOURCE_CONTAINERS_TABLE}`);
    expect(ddl).toContain(`CREATE TABLE IF NOT EXISTS ${MATERIAL_SOURCE_JOURNAL_TABLE}`);
    // Additive only: no ALTER of an existing table, no data migration.
    expect(ddl).not.toContain('ALTER TABLE');
    expect(ddl).not.toContain('DROP ');
  });
});

describe('assertMaterialSourceWriterCapability', () => {
  it('asks each connection what IT announces, with the null-safe probe', () => {
    // `true` as the second argument is what makes an unset GUC answer NULL
    // instead of raising: the un-migrated case is the one being asked about.
    expect(MATERIAL_SOURCE_CAPABILITY_PROBE_SQL).toBe(
      `SELECT current_setting('${MATERIAL_SOURCE_WRITER_CAPABILITY}', true) AS capability`,
    );
    expect(MATERIAL_SOURCE_CAPABILITY_PROBE_SQL).toContain(', true)');
  });

  it('passes when every connection announces the version this binary writes', async () => {
    const boot = connection();
    const pool = connection();
    await expect(
      assertMaterialSourceWriterCapability([
        { label: 'schema boot client', client: boot },
        { label: 'pool', client: pool },
      ]),
    ).resolves.toBeUndefined();
    expect(boot.query).toHaveBeenCalledWith(MATERIAL_SOURCE_CAPABILITY_PROBE_SQL);
    expect(pool.query).toHaveBeenCalledWith(MATERIAL_SOURCE_CAPABILITY_PROBE_SQL);
  });

  it('REFUSES when a connection announces nothing, naming which one', async () => {
    const boot = connection();
    const pool = connection(null);
    const refusal = assertMaterialSourceWriterCapability([
      { label: 'schema boot client', client: boot },
      { label: 'pool', client: pool },
    ]);
    await expect(refusal).rejects.toThrow(MATERIAL_SOURCE_CAPABILITY_REFUSAL);
    await expect(refusal).rejects.toThrow('pool reports nothing');
  });

  it('REFUSES a connection announcing a DIFFERENT writer version', async () => {
    // An older binary's pool, or a rolled-back deploy: announcing something is
    // not announcing THIS composition format.
    const stale = connection('0');
    await expect(
      assertMaterialSourceWriterCapability([{ label: 'pool', client: stale }]),
    ).rejects.toThrow(`pool reports version 0, expected ${MATERIAL_SOURCE_WRITER_VERSION}`);
  });

  it('REFUSES a result that answers no capability column at all', async () => {
    const mute = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await expect(
      assertMaterialSourceWriterCapability([{ label: 'pool', client: mute }]),
    ).rejects.toThrow(MATERIAL_SOURCE_CAPABILITY_REFUSAL);
  });
});

describe('applyMaterialSourceWriterGuard: unconditional, and never before the probe', () => {
  it('probes BOTH connections and then applies the guard DDL', async () => {
    const boot = connection();
    const pool = connection();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await applyMaterialSourceWriterGuard(boot, pool);
      // The pool is probed but never written to: the DDL is the boot client's.
      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(pool.query).toHaveBeenCalledWith(MATERIAL_SOURCE_CAPABILITY_PROBE_SQL);
      const texts = boot.query.mock.calls.map((call) => String(call[0]));
      expect(texts[0]).toBe(MATERIAL_SOURCE_CAPABILITY_PROBE_SQL);
      expect(texts).toHaveLength(2);
      expect(texts[1]).toContain(
        `CREATE OR REPLACE FUNCTION ${MATERIAL_SOURCE_WRITER_GUARD_FUNCTION}`,
      );
      expect(texts[1]).toContain('CREATE OR REPLACE TRIGGER woc_msw_guard_characters');
      expect(log).toHaveBeenCalledTimes(1);
    } finally {
      log.mockRestore();
    }
  });

  it('installs NOTHING when a connection fails the probe', async () => {
    // The ordering claim as a real absence: a guard this process cannot satisfy
    // must never reach the database.
    const boot = connection();
    const pool = connection(null);
    await expect(applyMaterialSourceWriterGuard(boot, pool)).rejects.toThrow(
      MATERIAL_SOURCE_CAPABILITY_REFUSAL,
    );
    const texts = boot.query.mock.calls.map((call) => String(call[0]));
    expect(texts).toEqual([MATERIAL_SOURCE_CAPABILITY_PROBE_SQL]);
  });

  it('takes no switch: there is no argument or env that can skip it', () => {
    // Two arguments, both connections. A third (an `armed` flag) is exactly the
    // shape this deliberately does not have, and the module reads no env at all.
    expect(applyMaterialSourceWriterGuard).toHaveLength(2);
  });
});
