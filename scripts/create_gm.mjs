#!/usr/bin/env node
// Create a GM character (level 20, invulnerable) on an account.
//
//   node scripts/create_gm.mjs <username> [--class paladin]
//
// Names are assigned sequentially: GM01, GM02, ... (global across accounts).
// Regular players can never create these: the REST name rule rejects digits,
// and is_gm is only ever set here / by an operator.
//
// Uses DATABASE_URL. For local dev, copy .env.example to .env first.
// On the EC2 box (where this script isn't in the runtime image), create via
// the db container instead:
//   sudo docker exec eastbrook-db psql -U eastbrook eastbrook -c \
//     "INSERT INTO characters (account_id, name, class, level, is_gm)
//      SELECT id, 'GM01', 'paladin', 20, TRUE FROM accounts WHERE username = 'name';"
import pg from 'pg';

try {
  process.loadEnvFile?.();
} catch {
  // .env is optional; production operators may pass DATABASE_URL directly.
}

const username = process.argv[2];
const clsIdx = process.argv.indexOf('--class');
const cls = clsIdx > 0 ? process.argv[clsIdx + 1] : 'paladin';
const VALID = ['warrior', 'paladin', 'hunter', 'rogue', 'priest', 'shaman', 'mage', 'warlock', 'druid', 'demon_hunter'];

if (!username || username.startsWith('--') || !VALID.includes(cls)) {
  console.error('usage: node scripts/create_gm.mjs <username> [--class <class>]');
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is required. For local dev, copy .env.example to .env first.');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString });

try {
  const acct = await pool.query('SELECT id FROM accounts WHERE username = $1', [username]);
  if (!acct.rows.length) {
    console.error(`no account named '${username}'`);
    process.exit(1);
  }
  const next = await pool.query(
    "SELECT COALESCE(MAX(SUBSTRING(name FROM 3)::int), 0) + 1 AS n FROM characters WHERE name ~ '^GM[0-9]+$'",
  );
  const name = `GM${String(next.rows[0].n).padStart(2, '0')}`;
  const res = await pool.query(
    'INSERT INTO characters (account_id, name, class, level, is_gm) VALUES ($1, $2, $3, 20, TRUE) RETURNING id',
    [acct.rows[0].id, name, cls],
  );
  console.log(`created ${name} (${cls}, level 20, invulnerable) — character id ${res.rows[0].id} on account '${username}'`);
} finally {
  await pool.end();
}
