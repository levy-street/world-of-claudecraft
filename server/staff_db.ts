import { pool } from './db';

// SQL for the staff-role model: accounts.admin_roles + the admin_role_changes
// audit trail. Business rules (self-edit refusal, superadmin protection, role
// validation) live in the admin.ts handlers; this module only reads/writes.

export interface StaffRow {
  accountId: number;
  username: string;
  roles: string[];
  lastLogin: string | null;
}

export interface RoleChangeRow {
  id: number;
  accountId: number;
  username: string | null;
  adminUsername: string | null;
  rolesBefore: string[];
  rolesAfter: string[];
  createdAt: string;
}

// admin_roles is the single source of truth for what an operator may do;
// permissions are NEVER derived from is_admin. is_admin is only the derived
// "is staff" flag and the kill switch: FALSE forces zero roles whatever
// admin_roles says, so the documented manual-SQL revoke ("UPDATE accounts SET
// is_admin = FALSE") always works. A stale is_admin TRUE with empty roles
// therefore reads as zero permissions (fail closed), not superadmin; legacy
// pre-permission accounts are migrated to the `admin` role once by the SCHEMA
// backfill, never resurrected at read time.
export function effectiveAdminRoles(isAdmin: boolean, roles: readonly string[]): string[] {
  if (!isAdmin) return [];
  return [...roles];
}

// Staff identity (username + roles) for an account, or null when the account
// is missing or not staff.
export async function adminRolesForAccount(
  accountId: number,
): Promise<{ username: string; roles: string[] } | null> {
  const res = await pool.query(
    'SELECT username, is_admin, admin_roles FROM accounts WHERE id = $1',
    [accountId],
  );
  const row = res.rows[0];
  if (!row) return null;
  const roles = effectiveAdminRoles(row.is_admin === true, row.admin_roles ?? []);
  return roles.length > 0 ? { username: row.username, roles } : null;
}

export async function listStaff(): Promise<StaffRow[]> {
  const res = await pool.query(
    `SELECT id, username, is_admin, admin_roles, last_login
       FROM accounts
      WHERE is_admin
      ORDER BY username ASC`,
  );
  return res.rows.map((row) => ({
    accountId: row.id,
    username: row.username,
    roles: effectiveAdminRoles(row.is_admin === true, row.admin_roles ?? []),
    lastLogin: row.last_login ? new Date(row.last_login).toISOString() : null,
  }));
}

// Writes the role set, keeps is_admin in sync, and appends an audit row, in
// one transaction. Returns the before/after pair, or null when the account
// does not exist. A no-op write (same effective roles) skips the audit row.
export async function setAccountAdminRoles(input: {
  accountId: number;
  roles: readonly string[];
  actorAccountId: number | null;
}): Promise<{ before: string[]; after: string[] } | null> {
  const after = [...input.roles];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(
      'SELECT is_admin, admin_roles FROM accounts WHERE id = $1 FOR UPDATE',
      [input.accountId],
    );
    const row = current.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return null;
    }
    const before = effectiveAdminRoles(row.is_admin === true, row.admin_roles ?? []);
    await client.query('UPDATE accounts SET admin_roles = $2, is_admin = $3 WHERE id = $1', [
      input.accountId,
      after,
      after.length > 0,
    ]);
    if (before.join(',') !== after.join(',')) {
      await client.query(
        `INSERT INTO admin_role_changes (account_id, admin_account_id, roles_before, roles_after)
         VALUES ($1, $2, $3, $4)`,
        [input.accountId, input.actorAccountId, before, after],
      );
    }
    await client.query('COMMIT');
    return { before, after };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function roleChangeHistory(limit: number): Promise<RoleChangeRow[]> {
  const res = await pool.query(
    `SELECT c.id, c.account_id, a.username, admin.username AS admin_username,
            c.roles_before, c.roles_after, c.created_at
       FROM admin_role_changes c
       LEFT JOIN accounts a ON a.id = c.account_id
       LEFT JOIN accounts admin ON admin.id = c.admin_account_id
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT $1`,
    [limit],
  );
  return res.rows.map((row) => ({
    id: Number(row.id),
    accountId: row.account_id,
    username: row.username ?? null,
    adminUsername: row.admin_username ?? null,
    rolesBefore: row.roles_before ?? [],
    rolesAfter: row.roles_after ?? [],
    createdAt: new Date(row.created_at).toISOString(),
  }));
}
