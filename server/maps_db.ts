// Postgres-backed MapsDb plus the maps schema and the admin list/unpublish
// queries. The schema is appended to the main ensureSchema() run in db.ts
// (idempotent CREATE/ALTER only, applied at every boot under the advisory
// lock). All SQL for the maps feature lives here; the rules live in maps.ts.

import type { Pool } from 'pg';
import type { MapDoc } from '../src/sim/map_doc';
import type { MapRecord, MapStatus, MapSummary, MapsDb } from './maps';

export const MAPS_SCHEMA = `
CREATE TABLE IF NOT EXISTS maps (
  id SERIAL PRIMARY KEY,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  doc JSONB NOT NULL,
  version INT NOT NULL DEFAULT 1,
  parent_map_id INT REFERENCES maps(id) ON DELETE SET NULL,
  forked_from_version INT,
  status TEXT NOT NULL DEFAULT 'private',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS maps_account ON maps(account_id);
-- Serves the public browse (status filter + newest-first paging).
CREATE INDEX IF NOT EXISTS maps_status_updated ON maps(status, updated_at DESC);
-- Postgres does not auto-index the referencing side of an FK: without this,
-- every parent-map delete (and account CASCADE) sequentially scans maps to
-- null out children.
CREATE INDEX IF NOT EXISTS maps_parent ON maps(parent_map_id);
`;

const MAP_SUMMARY_COLS =
  'id, account_id, name, slug, version, parent_map_id, forked_from_version, status, created_at, updated_at';
const MAP_COLS = `${MAP_SUMMARY_COLS}, doc`;

function isoString(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value ?? '');
}

interface MapDbRow {
  id: number;
  account_id: number;
  name: string;
  slug: string;
  version: number;
  parent_map_id: number | null;
  forked_from_version: number | null;
  status: string;
  created_at: Date | string;
  updated_at: Date | string;
  doc?: unknown;
}

function toSummary(row: MapDbRow): MapSummary {
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    slug: row.slug,
    version: row.version,
    parentMapId: row.parent_map_id ?? null,
    forkedFromVersion: row.forked_from_version ?? null,
    status: row.status as MapStatus,
    createdAt: isoString(row.created_at),
    updatedAt: isoString(row.updated_at),
  };
}

function toRecord(row: MapDbRow): MapRecord {
  return { ...toSummary(row), doc: row.doc as MapDoc };
}

export class PgMapsDb implements MapsDb {
  constructor(private readonly pool: Pool) {}

  // Same shape as createCharacterCapped (db.ts): lock the account row, count,
  // then insert, so two concurrent creates cannot both slip under the cap. A
  // slug unique violation propagates to the caller's retry loop.
  async insertMapCapped(
    input: { accountId: number; name: string; slug: string; doc: MapDoc },
    cap: number,
  ): Promise<MapRecord | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const account = await client.query('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [
        input.accountId,
      ]);
      if ((account.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        return null;
      }
      const count = await client.query(
        'SELECT count(*)::int AS n FROM maps WHERE account_id = $1',
        [input.accountId],
      );
      if (Number(count.rows[0]?.n ?? 0) >= cap) {
        await client.query('ROLLBACK');
        return null;
      }
      const res = await client.query(
        `INSERT INTO maps (account_id, name, slug, doc)
         VALUES ($1, $2, $3, $4::jsonb)
         RETURNING ${MAP_COLS}`,
        [input.accountId, input.name, input.slug, JSON.stringify(input.doc)],
      );
      await client.query('COMMIT');
      return toRecord(res.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  // INSERT ... SELECT so the copied document, the parent id, and the
  // forked-from version are all read from the source row atomically; the WHERE
  // re-checks accessibility so a fork can never copy a just-unpublished
  // private map. The stored doc's meta.name/meta.parentId/meta.id are
  // rewritten in SQL so the JSONB always matches the row's lineage columns and
  // the fork gets its own document identity (the editor client keys its local
  // server-links by meta.id; inheriting the source's id would silently repoint
  // the original map's link and cross-write the wrong row on later saves).
  async insertForkCapped(
    input: { sourceId: number; accountId: number; name: string; slug: string; newDocId: string },
    cap: number,
  ): Promise<MapRecord | 'cap_reached' | 'source_unavailable'> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const account = await client.query('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [
        input.accountId,
      ]);
      if ((account.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        return 'cap_reached';
      }
      const count = await client.query(
        'SELECT count(*)::int AS n FROM maps WHERE account_id = $1',
        [input.accountId],
      );
      if (Number(count.rows[0]?.n ?? 0) >= cap) {
        await client.query('ROLLBACK');
        return 'cap_reached';
      }
      // The jsonb_set chains here and in updateMapIfVersion rely on doc.meta
      // already being an object: jsonb_set only creates the FINAL path element,
      // so a missing meta would silently no-op the rewrite. Every stored doc is
      // sanitizeMapDoc output, whose sanitizeMeta always emits a meta object.
      const res = await client.query(
        `INSERT INTO maps (account_id, name, slug, doc, version, parent_map_id, forked_from_version, status)
         SELECT $1, $2, $3,
                jsonb_set(
                  jsonb_set(
                    jsonb_set(s.doc, '{meta,name}', to_jsonb($2::text)),
                    '{meta,parentId}', to_jsonb(s.id::text)
                  ),
                  '{meta,id}', to_jsonb($5::text)
                ),
                1, s.id, s.version, 'private'
           FROM maps s
          WHERE s.id = $4 AND (s.status = 'public' OR s.account_id = $1)
         RETURNING ${MAP_COLS}`,
        [input.accountId, input.name, input.slug, input.sourceId, input.newDocId],
      );
      if ((res.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        return 'source_unavailable';
      }
      await client.query('COMMIT');
      return toRecord(res.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async getMap(id: number): Promise<MapRecord | null> {
    const res = await this.pool.query(`SELECT ${MAP_COLS} FROM maps WHERE id = $1`, [id]);
    return res.rows[0] ? toRecord(res.rows[0]) : null;
  }

  async listForAccount(accountId: number): Promise<MapSummary[]> {
    const res = await this.pool.query(
      `SELECT ${MAP_SUMMARY_COLS} FROM maps WHERE account_id = $1 ORDER BY updated_at DESC`,
      [accountId],
    );
    return res.rows.map(toSummary);
  }

  async listPublic(limit: number, offset: number): Promise<{ rows: MapSummary[]; total: number }> {
    const [rows, total] = await Promise.all([
      this.pool.query(
        `SELECT ${MAP_SUMMARY_COLS} FROM maps WHERE status = 'public'
          ORDER BY updated_at DESC LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
      this.pool.query(`SELECT count(*)::int AS n FROM maps WHERE status = 'public'`),
    ]);
    return { rows: rows.rows.map(toSummary), total: Number(total.rows[0]?.n ?? 0) };
  }

  // Optimistic concurrency: the WHERE pins owner AND expected version, so a
  // stale editor tab can never clobber a newer save. The stored doc's
  // meta.name is kept in lockstep with the name column (old value when the
  // save does not rename), and meta.parentId is overwritten from the row's
  // parent_map_id column (empty string when null) so the JSONB lineage can
  // never be spoofed by a client-supplied document.
  async updateMapIfVersion(
    id: number,
    accountId: number,
    expectedVersion: number,
    doc: MapDoc,
    name: string | null,
  ): Promise<MapRecord | null> {
    const res = await this.pool.query(
      `UPDATE maps
          SET doc = jsonb_set(
                jsonb_set($4::jsonb, '{meta,name}', to_jsonb(COALESCE($5::text, maps.name))),
                '{meta,parentId}', to_jsonb(COALESCE(maps.parent_map_id::text, ''))
              ),
              name = COALESCE($5::text, maps.name),
              version = version + 1,
              updated_at = now()
        WHERE id = $1 AND account_id = $2 AND version = $3
        RETURNING ${MAP_COLS}`,
      [id, accountId, expectedVersion, JSON.stringify(doc), name],
    );
    return res.rows[0] ? toRecord(res.rows[0]) : null;
  }

  async setStatus(id: number, accountId: number | null, status: MapStatus): Promise<boolean> {
    const res = await this.pool.query(
      `UPDATE maps SET status = $2, updated_at = now()
        WHERE id = $1 AND ($3::int IS NULL OR account_id = $3)
        RETURNING id`,
      [id, status, accountId],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async deleteMap(id: number, accountId: number): Promise<boolean> {
    const res = await this.pool.query(
      'DELETE FROM maps WHERE id = $1 AND account_id = $2 RETURNING id',
      [id, accountId],
    );
    return (res.rowCount ?? 0) > 0;
  }

  // Admin dashboard list: every map regardless of status, newest first,
  // including account_id for moderation. Never the (potentially 2 MB) doc.
  async listAdmin(
    limit: number,
    offset: number,
  ): Promise<{ rows: (MapSummary & { accountId: number })[]; total: number }> {
    const [rows, total] = await Promise.all([
      this.pool.query(
        `SELECT ${MAP_SUMMARY_COLS} FROM maps ORDER BY updated_at DESC LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
      this.pool.query('SELECT count(*)::int AS n FROM maps'),
    ]);
    return { rows: rows.rows.map(toSummary), total: Number(total.rows[0]?.n ?? 0) };
  }
}
