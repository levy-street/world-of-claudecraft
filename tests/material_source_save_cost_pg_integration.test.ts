// OPT-IN PostgreSQL evidence fixture for the material-source review. It runs
// only with TEST_DATABASE_URL set (the tests/CLAUDE.md opt-in DB gate) and
// skips green otherwise.
//
// Isolation contract, held strictly: everything lives in ONE schema whose name
// is unique to this process, reached through the connection's own
// `options: -c search_path=<schema>` rather than a qualified name in every
// statement, and dropped in afterAll. It creates NO table in public, touches no
// shared table, and reads nothing it did not write.
//
// What it measures, and what it is allowed to assert:
//   * EXPLAIN (ANALYZE, BUFFERS, TIMING OFF) for the pre-image row lock the
//     production statement builder emits versus the `SELECT 1` shape it
//     replaced, over a MAXIMAL character row. TIMING OFF is deliberate: this
//     plan assertions use structural buffer and row counts, not durations.
//     A separate helper exercise reports serialization, projection and journal
//     timings as observations; they do not establish an escrow acceptance bound.
//   * The lock-mode claim in production's own docblock: FOR NO KEY UPDATE does
//     not block the FOR KEY SHARE an FK-child insert takes, while FOR UPDATE
//     does. Proven as a deterministic lock CONFLICT (a bounded lock_timeout
//     firing), never as a duration.
//   * The cascade reach and its index fit: a character delete removes the
//     anchor and its journal rows, and the journal's FK lookup is served by its
//     primary key rather than a sequential scan.
//
// It tunes nothing, changes no timeout, and asserts no acceptance verdict on
// the escrow ladder; that stays with tests/server/tunables.test.ts.
//
// The maximal-row builder is a deliberate small duplicate of the one in
// tests/material_source_storage_cost.test.ts, which owns the canonical
// byte measurement. This fixture uses gatherer-only buckets to isolate the
// preimage query; escrow scenarios use helpers/material_source_save_fixture.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  journalCharacterSaveSources,
  readCharacterMaterialContainers,
} from '../server/character_material_sources_db';
import { CHARACTER_SAVE_ROW_LOCK_SQL } from '../server/character_save_statement';
import { MATERIAL_SOURCE_JOURNAL_SCHEMA } from '../server/material_source_journal_db';
import { stackSizeOf } from '../src/sim/bags';
import {
  BANK_BAG_SOCKETS,
  BANK_BASE_SLOTS,
  BANK_MAX_BONUS_SLOTS,
  BANK_PURCHASED_SLOTS_MAX,
} from '../src/sim/bank';
import { ITEMS } from '../src/sim/data';
import { materialItemIds } from '../src/sim/material_ids';
import type { MaterialComposition } from '../src/sim/material_sources';
import { MAX_CRAFTED_BY_LENGTH } from '../src/sim/professions/tools';

const url = process.env.TEST_DATABASE_URL ?? '';
const d = url === '' ? describe.skip : describe;

/** Unique per process AND per run: a crashed earlier run can never collide with
 *  this one, and the defensive DROP below covers a crash of this one. */
const SCHEMA = `material_source_cost_pg_${process.pid}_${Date.now().toString(36)}`;

const MATERIAL_IDS = [...materialItemIds()].sort();
const WIDEST_STACK = MATERIAL_IDS.reduce(
  (widest, itemId) => Math.max(widest, stackSizeOf(ITEMS[itemId])),
  1,
);
const BANK_SLOTS = BANK_BASE_SLOTS + BANK_PURCHASED_SLOTS_MAX + BANK_MAX_BONUS_SLOTS;
const BAG_SLOTS = 16 + 4 * 24;
const FULL_BANK_SLOTS = BANK_SLOTS + BANK_BAG_SOCKETS * 24;
const MAX_NAME = 'W'.repeat(MAX_CRAFTED_BY_LENGTH);

/** One bucket per unit at the real INT id bound. The ONLINE shape (a gatherer,
 *  no signer) is enough here: this row only has to be large enough to be stored
 *  out of line, and the premium-shape byte comparison is owned by the DB-free
 *  fixture. */
function maxComposition(units: number): MaterialComposition {
  return Array.from({ length: units }, (_, i) => ({
    source: { gatherer: { kind: 'character' as const, id: 2_147_483_647 - i, name: MAX_NAME } },
    count: 1,
  }));
}

/** A character state with the relevant source-bearing material containers at
 *  their live ceilings. Each physical unit appears in one persisted row. */
function maximalState(): Record<string, unknown> {
  const stack = (index: number, units: number) => ({
    itemId: MATERIAL_IDS[index % MATERIAL_IDS.length],
    count: units,
    materialSources: maxComposition(units),
  });
  return {
    inventory: Array.from({ length: BAG_SLOTS }, (_, index) => stack(index, WIDEST_STACK)),
    equipment: {},
    questLog: [],
    questsDone: [],
    bank: {
      inventory: Array.from({ length: FULL_BANK_SLOTS }, (_, index) => stack(index, WIDEST_STACK)),
    },
    vault: {
      stock: {},
      special: MATERIAL_IDS.map((id, index) => ({
        itemId: id,
        count: 200,
        materialSources: maxComposition(200),
      })),
      upgrades: 0,
    },
  };
}

interface PlanAggregate {
  readonly rows: number;
  readonly sharedHit: number;
  readonly sharedRead: number;
  readonly buffers: number;
  readonly nodes: readonly string[];
}

/**
 * Read the ROOT node's buffer counters, which PostgreSQL already reports
 * INCLUSIVE of every child node. Summing the tree (an earlier version of this
 * helper did) double-counts every nested plan and inflates the figure. The node
 * list is collected separately, for the shape, and contributes no arithmetic.
 * Timing fields are never read: the EXPLAIN runs with TIMING OFF.
 */
function aggregatePlan(explained: unknown): PlanAggregate {
  const root = (explained as { Plan?: Record<string, unknown> }[])[0]?.Plan;
  const nodes: string[] = [];
  const walk = (node: Record<string, unknown> | undefined): void => {
    if (!node) return;
    const type = String(node['Node Type'] ?? '');
    const index = node['Index Name'] === undefined ? '' : `:${String(node['Index Name'])}`;
    nodes.push(`${type}${index}`);
    for (const child of (node.Plans as Record<string, unknown>[] | undefined) ?? []) walk(child);
  };
  walk(root);
  const sharedHit = Number(root?.['Shared Hit Blocks'] ?? 0);
  const sharedRead = Number(root?.['Shared Read Blocks'] ?? 0);
  return {
    rows: Number(root?.['Actual Rows'] ?? 0),
    sharedHit,
    sharedRead,
    buffers: sharedHit + sharedRead,
    nodes,
  };
}

function report(label: string, measurement: Record<string, unknown>): void {
  process.stdout.write(`[material-source-pg] ${JSON.stringify({ label, ...measurement })}\n`);
}

d('material source save cost against real PostgreSQL', () => {
  let pool: import('pg').Pool;

  beforeAll(async () => {
    const { Pool } = await import('pg');
    const admin = new Pool({ connectionString: url, max: 1 });
    try {
      await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await admin.query(`CREATE SCHEMA "${SCHEMA}"`);
    } finally {
      await admin.end();
    }

    // The isolation is the CONNECTION's, not a per-statement qualification:
    // every statement below resolves through this search_path alone, so a
    // missing table fails loudly instead of finding a public one.
    pool = new Pool({
      connectionString: url,
      max: 4,
      options: `-c search_path=${SCHEMA}`,
      application_name: SCHEMA,
    });

    await pool.query(`CREATE TABLE characters (
      id INT PRIMARY KEY,
      realm TEXT NOT NULL,
      level INT NOT NULL,
      state JSONB NOT NULL
    )`);
    // An FK child of characters, the KEY SHARE taker the lock-mode claim is
    // about (chat_logs / character_deeds / play_sessions in production).
    await pool.query(`CREATE TABLE character_children (
      id BIGSERIAL PRIMARY KEY,
      character_id INT NOT NULL REFERENCES characters(id) ON DELETE CASCADE
    )`);
    // The PRODUCTION DDL, applied verbatim. An earlier revision of this fixture
    // hand-wrote a minimal proxy shape, which meant the index measured was one
    // this file invented rather than one the game ships. The real fragment uses
    // unqualified names resolved through the connection search_path, so it
    // lands inside this schema, and `characters` above satisfies its FK.
    await pool.query(MATERIAL_SOURCE_JOURNAL_SCHEMA);

    await pool.query('INSERT INTO characters (id, realm, level, state) VALUES ($1, $2, $3, $4)', [
      1,
      'evidence',
      60,
      JSON.stringify(maximalState()),
    ]);
    // A second, ordinary row so the plans are not measured over a one-row table
    // the planner treats as degenerate.
    await pool.query('INSERT INTO characters (id, realm, level, state) VALUES ($1, $2, $3, $4)', [
      2,
      'evidence',
      60,
      JSON.stringify({ inventory: [], bank: { inventory: [] } }),
    ]);
    // Shaped for the REAL constraints (kind allowlist, positive revision,
    // owner_character_id = owner_id on a character-owned container).
    await pool.query(
      `INSERT INTO material_source_containers
         (realm, container, owner_id, owner_character_id, opening, current_revision)
       VALUES ('evidence', 'personal', 1, 1, '{"entries":[]}'::jsonb, 25),
              ('evidence', 'vault', 1, 1, '{"entries":[]}'::jsonb, 1)`,
    );
    await pool.query(
      `INSERT INTO material_source_journal (realm, container, owner_id, revision, movements)
       SELECT 'evidence', 'personal', 1, generate_series, '[]'::jsonb
         FROM generate_series(1, 25)`,
    );
    await pool.query('ANALYZE characters');
    await pool.query('ANALYZE material_source_journal');
  }, 60_000);

  afterAll(async () => {
    if (pool) await pool.end();
    if (url === '') return;
    const { Pool } = await import('pg');
    const admin = new Pool({ connectionString: url, max: 1 });
    try {
      await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    } finally {
      await admin.end();
    }
  }, 60_000);

  it('stores the maximal row out of line, which is what the pre-image read pays for', async () => {
    const sizes = await pool.query(
      `SELECT pg_column_size(state) AS stored_bytes,
              octet_length(state::text) AS text_bytes,
              pg_column_size(state->'bank') AS bank_bytes
         FROM characters WHERE id = 1`,
    );
    const stored = Number(sizes.rows[0].stored_bytes);
    const text = Number(sizes.rows[0].text_bytes);

    // Hard fact, not a timing: the datum is stored OUT OF LINE, so
    // `state->'bank'` cannot be answered without fetching the TOAST chunks.
    // Without this the buffer comparison in the next case would be measuring
    // nothing. The toast relation is this schema's own (we created the table),
    // and only the maximal row is large enough to have chunks in it.
    const toastRelation = await pool.query(
      `SELECT reltoastrelid::regclass::text AS toast_table
         FROM pg_catalog.pg_class WHERE oid = 'characters'::pg_catalog.regclass`,
    );
    const toastTable = String(toastRelation.rows[0].toast_table);
    expect(toastTable).not.toBe('-');
    const chunks = await pool.query(`SELECT count(*)::int AS chunks FROM ${toastTable}`);

    expect(Number(chunks.rows[0].chunks)).toBeGreaterThan(0);
    expect(text).toBeGreaterThan(stored);

    report('maximal-row', {
      bankSlots: BANK_SLOTS,
      bankSlotsWithSockets: FULL_BANK_SLOTS,
      bagSlots: BAG_SLOTS,
      vaultSpecialRows: MATERIAL_IDS.length,
      unitsPerSlot: WIDEST_STACK,
      storedBytes: stored,
      textBytes: text,
      bankSubtreeBytes: Number(sizes.rows[0].bank_bytes),
      toastChunks: Number(chunks.rows[0].chunks),
    });
  });

  it('reports node serialization and projection plus one update and journal transaction', async () => {
    const before = maximalState();
    const after = structuredClone(before) as Record<string, any>;
    const first = (after.bank.inventory as Record<string, unknown>[])[0];
    first.itemId = MATERIAL_IDS[1] ?? MATERIAL_IDS[0];
    const serializeStart = performance.now();
    const stateJson = JSON.stringify(after);
    const serializeMs = performance.now() - serializeStart;
    const projectionStart = performance.now();
    const projected = readCharacterMaterialContainers(before.bank, before.vault);
    const projectionMs = performance.now() - projectionStart;
    expect(projected.ok).toBe(true);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const update = await client.query('UPDATE characters SET state = $1::jsonb WHERE id = $2', [
        stateJson,
        1,
      ]);
      const journalStart = performance.now();
      const journal = await journalCharacterSaveSources(
        client,
        1,
        { bank: before.bank, vault: before.vault },
        update,
        { bank: after.bank, vault: after.vault } as any,
      );
      const journalMs = performance.now() - journalStart;
      expect(update.rowCount).toBe(1);
      expect(journal).not.toBeNull();
      await client.query('ROLLBACK');
      report('node-serialization-projection-update-journal', {
        stateBytes: Buffer.byteLength(stateJson, 'utf8'),
        serializeMs,
        projectionMs,
        journalMs,
        journalWrites: journal?.writes.length ?? 0,
        transaction: 'same connection and transaction; timings are observational',
      });
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
  });

  it('compares the pre-image lock plan with the SELECT 1 shape it replaced', async () => {
    const client = await pool.connect();
    const explain = async (sql: string, values: unknown[]): Promise<PlanAggregate> => {
      const res = await client.query(
        `EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, SUMMARY OFF, FORMAT JSON) ${sql}`,
        values,
      );
      return aggregatePlan(res.rows[0]['QUERY PLAN']);
    };
    try {
      // Both inside ONE transaction, rolled back: a row lock needs a
      // transaction, and neither statement may leave anything behind.
      await client.query('BEGIN');
      const bare = await explain(
        'SELECT 1 FROM characters WHERE id = $1 AND realm = $2 FOR NO KEY UPDATE',
        [1, 'evidence'],
      );
      // The PRODUCTION statement, imported rather than retyped.
      const preimage = await explain(CHARACTER_SAVE_ROW_LOCK_SQL, [1, 'evidence']);
      await client.query('ROLLBACK');

      // Structural assertions only. Both address exactly one row, and the
      // pre-image form cannot touch fewer buffers than the projection-free one
      // because it must fetch the TOASTed datum the other never reads.
      expect(bare.rows).toBe(1);
      expect(preimage.rows).toBe(1);
      expect(preimage.buffers).toBeGreaterThan(bare.buffers);

      report('preimage-vs-select1', {
        bareBuffers: bare.buffers,
        bareSharedHit: bare.sharedHit,
        bareSharedRead: bare.sharedRead,
        bareNodes: bare.nodes,
        preimageBuffers: preimage.buffers,
        preimageSharedHit: preimage.sharedHit,
        preimageSharedRead: preimage.sharedRead,
        preimageNodes: preimage.nodes,
        extraBuffersPerSave: preimage.buffers - bare.buffers,
      });
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
  });

  it('FOR NO KEY UPDATE admits an FK-child insert that FOR UPDATE blocks', async () => {
    const holder = await pool.connect();
    const child = await pool.connect();
    try {
      // A bounded wait makes the CONFLICT deterministic: a conflicting mode
      // fails with 55P03 rather than hanging, a compatible one commits. No
      // duration is asserted either way.
      await child.query('SET lock_timeout = 1000');

      await holder.query('BEGIN');
      await holder.query(CHARACTER_SAVE_ROW_LOCK_SQL, [1, 'evidence']);
      await expect(
        child.query('INSERT INTO character_children (character_id) VALUES ($1)', [1]),
      ).resolves.toMatchObject({ rowCount: 1 });
      await holder.query('ROLLBACK');

      await holder.query('BEGIN');
      await holder.query('SELECT 1 FROM characters WHERE id = $1 AND realm = $2 FOR UPDATE', [
        1,
        'evidence',
      ]);
      await expect(
        child.query('INSERT INTO character_children (character_id) VALUES ($1)', [1]),
      ).rejects.toMatchObject({ code: '55P03' });
      await holder.query('ROLLBACK');

      report('lock-mode', {
        preimageLockMode: 'FOR NO KEY UPDATE',
        fkChildInsertUnderPreimageLock: 'committed',
        fkChildInsertUnderForUpdate: '55P03',
      });
    } finally {
      await holder.query('ROLLBACK').catch(() => {});
      holder.release();
      await child.query('RESET lock_timeout').catch(() => {});
      child.release();
    }
  });

  // Cascade REACH is already owned by
  // tests/material_source_journal_pg_integration.test.ts, and the index DDL
  // text by tests/material_source_journal_db.test.ts. This case adds only
  // FEASIBILITY: that the real indexes CAN serve the cascade's two reverse
  // lookups.
  //
  // What it explicitly does NOT claim: that the planner CHOOSES them. The
  // fixture holds a handful of rows, where a sequential scan is the rational
  // plan, so the measurement runs with `enable_seqscan = off` and is labelled
  // feasibility. A selection claim needs production-like cardinality, which is
  // recorded below as the row counts these plans actually saw.
  it('the cascade reverse lookups CAN be served by the shipped indexes', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL enable_seqscan = off');
      const anchorLookup = aggregatePlan(
        (
          await client.query(
            `EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, SUMMARY OFF, FORMAT JSON)
             SELECT 1 FROM material_source_containers WHERE owner_character_id = $1`,
            [1],
          )
        ).rows[0]['QUERY PLAN'],
      );
      const journalLookup = aggregatePlan(
        (
          await client.query(
            `EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, SUMMARY OFF, FORMAT JSON)
             SELECT 1 FROM material_source_journal
              WHERE realm = $1 AND container = $2 AND owner_id = $3`,
            ['evidence', 'personal', 1],
          )
        ).rows[0]['QUERY PLAN'],
      );
      await client.query('ROLLBACK');

      // Feasibility, under enable_seqscan = off: each reverse lookup has an
      // index that CAN serve it (the partial index on the anchor, and the
      // journal's own primary key, whose leading columns are exactly the
      // foreign key). No claim is made about what the planner picks at any
      // cardinality.
      expect(anchorLookup.nodes.join(' ')).toContain('material_source_containers_character');
      expect(journalLookup.nodes.join(' ')).toContain('material_source_journal_pkey');

      const tableRows = await client.query(
        `SELECT (SELECT count(*) FROM material_source_containers) AS anchors,
                (SELECT count(*) FROM material_source_journal) AS journal`,
      );
      report('cascade-index-feasibility', {
        claim: 'index CAN serve the lookup; not a planner-selection claim',
        seqscanDisabled: true,
        ddlSource: 'MATERIAL_SOURCE_JOURNAL_SCHEMA (production, applied verbatim)',
        anchorNodes: anchorLookup.nodes,
        journalNodes: journalLookup.nodes,
        journalRowsForOneContainer: journalLookup.rows,
        fixtureAnchorRows: Number(tableRows.rows[0].anchors),
        fixtureJournalRows: Number(tableRows.rows[0].journal),
      });
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
  });
  it('chooses both full-key anchor probes at ten thousand anchors', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO characters (id, realm, level, state)
        SELECT id, 'evidence', 1, '{}'::jsonb FROM generate_series(1001, 6000) AS id`);
      await client.query(`INSERT INTO material_source_containers
          (realm, container, owner_id, owner_character_id, opening, current_revision)
        SELECT 'evidence', kind, id, id, '{"entries":[]}'::jsonb, 1
          FROM generate_series(1001, 6000) AS id
          CROSS JOIN (VALUES ('personal'), ('vault')) AS kinds(kind)`);
      await client.query('ANALYZE characters');
      await client.query('ANALYZE material_source_containers');
      const plan = aggregatePlan(
        (
          await client.query(
            `EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, SUMMARY OFF, FORMAT JSON) ${CHARACTER_SAVE_ROW_LOCK_SQL}`,
            [1, 'evidence'],
          )
        ).rows[0]['QUERY PLAN'],
      );
      expect(plan.rows).toBe(1);
      const probes = plan.nodes.filter((node) => node.includes(':material_source_containers_pkey'));
      expect(probes).toHaveLength(2);
      report('anchor-probe-selection', {
        fixtureAddedAnchors: 10000,
        seqscanDisabled: false,
        rows: plan.rows,
        buffers: plan.buffers,
        nodes: plan.nodes,
      });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
