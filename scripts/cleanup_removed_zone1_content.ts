import { Pool } from 'pg';
import { sanitizeRemovedZone1Content } from '../src/sim/removed_zone1_content';
import type { CharacterState } from '../src/sim/sim';

try {
  process.loadEnvFile?.();
} catch {
  // .env is optional; production usually injects DATABASE_URL directly.
}

interface Options {
  apply: boolean;
  realm?: string;
}

function parseArgs(argv: readonly string[]): Options {
  let realm: string | undefined;
  let apply = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg === '--realm') {
      realm = argv[i + 1]?.trim();
      i += 1;
      continue;
    }
    if (arg.startsWith('--realm=')) {
      realm = arg.slice('--realm='.length).trim();
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { apply, realm: realm || undefined };
}

const { apply, realm } = parseArgs(process.argv.slice(2));
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required.');
}

const pool = new Pool({ connectionString: databaseUrl, max: 2 });

const params: string[] = [];
const realmClause = realm ? ' AND realm = $1' : '';
if (realm) params.push(realm);

const { rows } = await pool.query<{ id: number; state: CharacterState | null }>(
  `SELECT id, state FROM characters WHERE state IS NOT NULL${realmClause} ORDER BY id ASC`,
  params,
);

let changed = 0;
let scanned = 0;

try {
  await pool.query('BEGIN');

  for (const row of rows) {
    scanned += 1;
    if (!row.state) continue;
    const result = sanitizeRemovedZone1Content(row.state);
    if (!result.changed) continue;

    changed += 1;
    if (apply) {
      await pool.query('UPDATE characters SET state = $1 WHERE id = $2', [
        JSON.stringify(result.state),
        row.id,
      ]);
    }
  }

  if (apply) {
    await pool.query('COMMIT');
  } else {
    await pool.query('ROLLBACK');
  }
} catch (err) {
  await pool.query('ROLLBACK');
  throw err;
} finally {
  await pool.end();
}

const scope = realm ? `realm "${realm}"` : 'all realms';
const mode = apply ? 'updated' : 'would update';
console.log(`Scanned ${scanned} characters in ${scope}; ${mode} ${changed}.`);
if (!apply) {
  console.log('Dry run only. Re-run with --apply to write sanitized character state.');
}
