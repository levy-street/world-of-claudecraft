import { parseArgs } from 'node:util';
import { Client } from 'pg';
import { materialSourceConnection } from '../server/material_source_connection';
import { REDESIGN_GRANT_SCHEMA, runReleaseGifts } from '../server/release_gifts_db';
import { SCHEMA_ADVISORY_LOCK_KEY } from '../server/schema_lock';
import { DUNGEONS } from '../src/sim/data';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'prepare-schema': { type: 'boolean' },
      realm: { type: 'string' },
      'created-before': { type: 'string' },
      'max-characters': { type: 'string' },
      'max-state-bytes': { type: 'string' },
      apply: { type: 'boolean' },
      'writers-stopped': { type: 'boolean' },
    },
  });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  if (values['prepare-schema'] && values.apply)
    throw new Error('Schema and data are separate operations');
  const client = new Client({
    ...materialSourceConnection(url),
    application_name: 'woc-v045-release-gifts',
    connectionTimeoutMillis: 5_000,
    query_timeout: 60_000,
    statement_timeout: 45_000,
    lock_timeout: 5_000,
  });
  // Hard wall-clock ceiling. Terminating the process closes the connection;
  // PostgreSQL rolls back an uncommitted operation, including its marker.
  const deadline = setTimeout(() => {
    console.error('Release gifts exceeded the 180-second operation deadline');
    process.exit(1);
  }, 180_000);
  try {
    await client.connect();
    if (values['prepare-schema']) {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [SCHEMA_ADVISORY_LOCK_KEY]);
      await client.query(REDESIGN_GRANT_SCHEMA);
      await client.query('COMMIT');
      console.log('Redesign grant column ready; no character grants applied');
    } else {
      const report = await runReleaseGifts(client, {
        realm: values.realm ?? '',
        createdBefore: values['created-before'] ?? '',
        maxCharacters: Number(values['max-characters']),
        maxStateBytes: Number(values['max-state-bytes']),
        lockoutKeys: Object.keys(DUNGEONS).flatMap((id) => [id, `${id}:heroic`]),
        apply: values.apply === true,
        writersStopped: values['writers-stopped'] === true,
      });
      console.log(JSON.stringify(report));
    }
  } finally {
    await client.end();
    clearTimeout(deadline);
  }
}

main().catch((error: unknown) => {
  // Do not echo PostgreSQL connection details or row values on operator errors.
  console.error(error instanceof Error ? error.message : 'Release gifts failed');
  process.exitCode = 1;
});
