// The database boot identity that server/db.ts and the post-listen index
// runner (server/concurrent_index_runner.ts) both read: the one DATABASE_URL,
// the code-owned material-source writer capability as a STARTUP option on it
// (so it describes THIS binary, never a shared PGOPTIONS an old one inherits;
// material_source_connection.ts owns how), and the schema advisory lock key
// every realm's boot serializes on. A leaf on purpose: the runner imports it
// rather than db.ts, so the two never form an import cycle, and db.ts keeps the
// connection (which carries the credentials) out of its public surface.

// The actual load lives in server/env.ts, and it must run before the read below.
import './env';
import { materialSourceConnection } from './material_source_connection';

export const DATABASE_URL =
  process.env.DATABASE_URL ??
  (() => {
    throw new Error(
      'DATABASE_URL is required. For local dev, copy .env.example to .env and run through docker compose.',
    );
  })();

/** The pool's and both boot Clients' connection. */
export const SOURCE_WRITER_CONNECTION = materialSourceConnection(DATABASE_URL);

export const SCHEMA_ADVISORY_LOCK_KEY = 0x57_4f_43_01; // "WOC\x01"
