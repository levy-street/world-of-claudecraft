#!/usr/bin/env node
// Grant (or revoke) admin-dashboard access for an account.
//
//   node scripts/grant_admin.mjs <username>                     grant superadmin
//   node scripts/grant_admin.mjs <username> --roles moderator,viewer grant an explicit role set
//   node scripts/grant_admin.mjs <username> --revoke            revoke all roles
//
// Roles (see server/admin_permissions.ts): superadmin, admin, moderator,
// viewer. superadmin (the only role with staff.manage) is
// grantable ONLY here (or via SQL), never from the dashboard staff page.
//
// Uses DATABASE_URL. For local dev, copy .env.example to .env first.
// On the EC2 box (where this script isn't in the runtime image), grant via
// the db container instead. admin_roles is the source of truth, so set it
// directly (setting is_admin alone no longer confers any permission):
//   sudo docker exec eastbrook-db psql -U eastbrook eastbrook \
//     -c "UPDATE accounts SET admin_roles = '{superadmin}', is_admin = TRUE WHERE username = 'name';"
// Manual revoke: is_admin is the kill switch (is_admin = FALSE always revokes,
// whatever admin_roles says); clear both to keep the row tidy:
//   ... -c "UPDATE accounts SET is_admin = FALSE, admin_roles = '{}' WHERE username = 'name';"
import pg from 'pg';

try {
  process.loadEnvFile?.();
} catch {
  // .env is optional; production operators may pass DATABASE_URL directly.
}

// Keep in sync with ADMIN_ROLES in server/admin_permissions.ts (this script is
// plain Node and never imports TS sources; see scripts/CLAUDE.md).
const KNOWN_ROLES = ['superadmin', 'admin', 'moderator', 'viewer'];

const args = process.argv.slice(2);
const username = args[0];
const revoke = args.includes('--revoke');
const rolesFlagIndex = args.indexOf('--roles');
const rolesArg = rolesFlagIndex >= 0 ? args[rolesFlagIndex + 1] : null;

if (!username || username.startsWith('--') || (rolesFlagIndex >= 0 && !rolesArg)) {
  console.error('usage: node scripts/grant_admin.mjs <username> [--roles a,b] [--revoke]');
  process.exit(1);
}

let roles;
if (revoke) {
  roles = [];
} else if (rolesArg) {
  const requested = new Set(
    rolesArg
      .split(',')
      .map((role) => role.trim())
      .filter(Boolean),
  );
  const unknown = [...requested].filter((role) => !KNOWN_ROLES.includes(role));
  if (requested.size === 0 || unknown.length > 0) {
    console.error(
      `unknown role(s): ${unknown.join(', ') || '(none given)'}; valid: ${KNOWN_ROLES.join(', ')}`,
    );
    process.exit(1);
  }
  // Vocabulary order, matching sanitizeRoles server-side, so a later dashboard
  // edit of the same set is a no-op instead of an order-only audit row.
  roles = KNOWN_ROLES.filter((role) => requested.has(role));
} else {
  roles = ['superadmin'];
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is required. For local dev, copy .env.example to .env first.');
  process.exit(1);
}
const pool = new pg.Pool({ connectionString });

try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(
      'SELECT id, username, is_admin, admin_roles FROM accounts WHERE username = $1 FOR UPDATE',
      [username],
    );
    if (current.rowCount === 0) {
      await client.query('ROLLBACK');
      console.error(`no account named "${username}"; they need to register in the game first`);
      process.exit(1);
    }
    const row = current.rows[0];
    // admin_roles is the source of truth; the audit diff reflects what was
    // actually stored (a legacy is_admin-only row reads as no roles here).
    const before = row.admin_roles ?? [];
    await client.query('UPDATE accounts SET admin_roles = $2, is_admin = $3 WHERE id = $1', [
      row.id,
      roles,
      roles.length > 0,
    ]);
    if (before.join(',') !== roles.join(',')) {
      await client.query(
        `INSERT INTO admin_role_changes (account_id, admin_account_id, roles_before, roles_after)
         VALUES ($1, NULL, $2, $3)`,
        [row.id, before, roles],
      );
    }
    await client.query('COMMIT');
    console.log(
      `${row.username} (account ${row.id}) roles = [${roles.join(', ')}], is_admin = ${roles.length > 0}`,
    );
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
} catch (err) {
  console.error('failed:', err.message);
  process.exit(1);
} finally {
  await pool.end();
}
