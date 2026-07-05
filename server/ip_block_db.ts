import { pool } from './db';
import { cleanIp, parseBlockExpiry, type IpBlockEntry } from './ip_block';

export { cleanIp } from './ip_block';

const REASON_MAX = 500;

export interface BlockedIpRow {
  id: number;
  ip: string;
  reason: string;
  createdAt: string;
  expiresAt: string | null;
  createdByUsername: string | null;
}

export async function loadActiveBlockedIps(): Promise<IpBlockEntry[]> {
  const res = await pool.query(
    `SELECT ip, expires_at FROM blocked_ips
     WHERE expires_at IS NULL OR expires_at > now()`,
  );
  return res.rows.map((r) => ({
    ip: r.ip,
    expiresAtMs: r.expires_at ? new Date(r.expires_at).getTime() : null,
  }));
}

export async function listBlockedIps(): Promise<BlockedIpRow[]> {
  const res = await pool.query(
    `SELECT b.id, b.ip, b.reason, b.created_at, b.expires_at, a.username AS created_by_username
     FROM blocked_ips b
     LEFT JOIN accounts a ON a.id = b.created_by_account_id
     ORDER BY b.created_at DESC`,
  );
  return res.rows.map((r) => ({
    id: Number(r.id),
    ip: r.ip,
    reason: r.reason ?? '',
    createdAt: new Date(r.created_at).toISOString(),
    expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
    createdByUsername: r.created_by_username ?? null,
  }));
}

export async function addBlockedIp(input: {
  ip: unknown;
  reason: unknown;
  createdByAccountId: number;
  expiresAt?: unknown;
}): Promise<string | null> {
  const ip = cleanIp(input.ip);
  if (!ip) return null;
  const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, REASON_MAX) : '';
  const expiresAt = parseBlockExpiry(input.expiresAt);
  // Block + audit row land together so the audit log can't drift from the table.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO blocked_ips (ip, reason, created_by_account_id, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (ip) DO UPDATE
         SET reason = EXCLUDED.reason,
             created_by_account_id = EXCLUDED.created_by_account_id,
             created_at = now(),
             expires_at = EXCLUDED.expires_at`,
      [ip, reason, input.createdByAccountId, expiresAt ? expiresAt.toISOString() : null],
    );
    await client.query(
      `INSERT INTO blocked_ip_actions (ip, action, admin_account_id, reason)
       VALUES ($1, 'block', $2, $3)`,
      [ip, input.createdByAccountId, reason],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return ip;
}

export async function removeBlockedIp(ipInput: unknown, adminAccountId: number): Promise<boolean> {
  const ip = cleanIp(ipInput);
  if (!ip) return false;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query(`DELETE FROM blocked_ips WHERE ip = $1`, [ip]);
    const removed = (res.rowCount ?? 0) > 0;
    if (removed) {
      await client.query(
        `INSERT INTO blocked_ip_actions (ip, action, admin_account_id)
         VALUES ($1, 'unblock', $2)`,
        [ip, adminAccountId],
      );
    }
    await client.query('COMMIT');
    return removed;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function pruneExpiredBlockedIps(): Promise<number> {
  const res = await pool.query(`DELETE FROM blocked_ips WHERE expires_at IS NOT NULL AND expires_at <= now()`);
  return res.rowCount ?? 0;
}
