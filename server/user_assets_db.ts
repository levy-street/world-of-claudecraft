// Postgres-backed UserAssetsDb plus the user_assets schema and the admin
// list/block queries. The schema is appended to the main ensureSchema() run in
// db.ts (idempotent, every boot, under the advisory lock). All SQL for
// uploaded GLB assets lives here; the rules live in user_assets.ts.

import type { Pool } from 'pg';
import type { AssetStatus, UserAssetRecord, UserAssetsDb } from './user_assets';

export const USER_ASSETS_SCHEMA = `
CREATE TABLE IF NOT EXISTS user_assets (
  id SERIAL PRIMARY KEY,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  sha256 TEXT UNIQUE NOT NULL,
  bytes BYTEA NOT NULL,
  byte_size INT NOT NULL,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_assets_account ON user_assets(account_id);
`;

// Every read path except the byte-serving GET selects this metadata subset;
// the (multi-MB) bytes column is only ever fetched by getActiveBytes.
const ASSET_COLS = 'id, account_id, sha256, byte_size, name, status, created_at';

interface UserAssetDbRow {
  id: number;
  account_id: number;
  sha256: string;
  byte_size: number;
  name: string | null;
  status: string;
  created_at: Date | string;
}

function isoString(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value ?? '');
}

function toRecord(row: UserAssetDbRow): UserAssetRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    sha256: row.sha256,
    byteSize: row.byte_size,
    name: row.name ?? null,
    status: row.status as AssetStatus,
    createdAt: isoString(row.created_at),
  };
}

export class PgUserAssetsDb implements UserAssetsDb {
  constructor(private readonly pool: Pool) {}

  async findBySha(sha256: string): Promise<UserAssetRecord | null> {
    const res = await this.pool.query(`SELECT ${ASSET_COLS} FROM user_assets WHERE sha256 = $1`, [
      sha256,
    ]);
    return res.rows[0] ? toRecord(res.rows[0]) : null;
  }

  // Same shape as createCharacterCapped (db.ts): lock the account row, then
  // check the per-account count AND total-byte caps, then insert, so two
  // concurrent uploads cannot both slip under a cap. A sha256 unique violation
  // (concurrent duplicate upload) propagates to the service's dedupe catch.
  async insertAssetCapped(
    input: { accountId: number; sha256: string; bytes: Buffer; name: string | null },
    maxCount: number,
    maxTotalBytes: number,
  ): Promise<UserAssetRecord | 'cap_count' | 'cap_bytes'> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const account = await client.query('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [
        input.accountId,
      ]);
      if ((account.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        return 'cap_count';
      }
      const totals = await client.query(
        `SELECT count(*)::int AS n, COALESCE(sum(byte_size), 0)::bigint AS total
           FROM user_assets WHERE account_id = $1`,
        [input.accountId],
      );
      if (Number(totals.rows[0]?.n ?? 0) >= maxCount) {
        await client.query('ROLLBACK');
        return 'cap_count';
      }
      if (Number(totals.rows[0]?.total ?? 0) + input.bytes.length > maxTotalBytes) {
        await client.query('ROLLBACK');
        return 'cap_bytes';
      }
      const res = await client.query(
        `INSERT INTO user_assets (account_id, sha256, bytes, byte_size, name)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${ASSET_COLS}`,
        [input.accountId, input.sha256, input.bytes, input.bytes.length, input.name],
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

  async getActiveBytes(sha256: string): Promise<Buffer | null> {
    const res = await this.pool.query(
      `SELECT bytes FROM user_assets WHERE sha256 = $1 AND status = 'active'`,
      [sha256],
    );
    const bytes = res.rows[0]?.bytes;
    return Buffer.isBuffer(bytes) ? bytes : null;
  }

  async listForAccount(accountId: number): Promise<UserAssetRecord[]> {
    const res = await this.pool.query(
      `SELECT ${ASSET_COLS} FROM user_assets WHERE account_id = $1 ORDER BY created_at DESC`,
      [accountId],
    );
    return res.rows.map(toRecord);
  }

  async deleteAsset(id: number, accountId: number): Promise<boolean> {
    const res = await this.pool.query(
      'DELETE FROM user_assets WHERE id = $1 AND account_id = $2 RETURNING id',
      [id, accountId],
    );
    return (res.rowCount ?? 0) > 0;
  }

  // Admin dashboard list: metadata only (never bytes), newest first, with
  // account_id so a moderator can trace an upload back to its account.
  async listAdmin(
    limit: number,
    offset: number,
  ): Promise<{ rows: UserAssetRecord[]; total: number }> {
    const [rows, total] = await Promise.all([
      this.pool.query(
        `SELECT ${ASSET_COLS} FROM user_assets ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
      this.pool.query('SELECT count(*)::int AS n FROM user_assets'),
    ]);
    return { rows: rows.rows.map(toRecord), total: Number(total.rows[0]?.n ?? 0) };
  }

  // Moderation flag: a blocked asset 404s on the public byte GET and rejects
  // re-uploads of the same hash, but stays listed for its owner and the admin.
  async setStatus(id: number, status: AssetStatus): Promise<boolean> {
    const res = await this.pool.query(
      'UPDATE user_assets SET status = $2 WHERE id = $1 RETURNING id',
      [id, status],
    );
    return (res.rowCount ?? 0) > 0;
  }
}
