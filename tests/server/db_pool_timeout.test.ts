import net from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The hanging-database guard. Point the pool at a TCP endpoint that ACCEPTS the
// connection but never completes the Postgres startup handshake (it never sends a
// byte). The pool's connectionTimeoutMillis (DB_POOL_CONNECT_TIMEOUT_MS = 5000)
// must then fail the query fast, so a slow or black-holed database degrades into
// isolated query failures instead of a process-wide stall. Real pg here, no mock:
// the connect-timeout wiring only exists in the real driver.

let server: net.Server;
const held: net.Socket[] = [];
let db: typeof import('../../server/db');

beforeAll(async () => {
  server = net.createServer((sock) => {
    // Accept and hold the socket open; never write a byte, so the pg startup never
    // completes and only the connect timeout can end the wait. Swallow the reset
    // the driver sends when it destroys its side after the timeout fires, so an
    // unhandled 'error' cannot fault the suite.
    sock.on('error', () => {});
    held.push(sock);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  // Set the URL BEFORE importing db.ts: it reads DATABASE_URL and builds the Pool
  // at module load. loadEnvFile never overrides an already-set env var, so the real
  // .env cannot replace this black-hole URL.
  process.env.DATABASE_URL = `postgres://user:pass@127.0.0.1:${port}/db`;
  db = await import('../../server/db');
});

afterAll(async () => {
  for (const sock of held) sock.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  // A parked connect attempt could keep pool.end() from settling; race it with a
  // short timer so the suite can never hang on teardown.
  const ended = db.pool.end().then(() => 'ended' as const);
  const timed = new Promise<'timer'>((resolve) => {
    setTimeout(() => resolve('timer'), 3000).unref();
  });
  const which = await Promise.race([ended, timed]);
  if (which === 'timer') {
    console.warn('db_pool_timeout: pool.end() did not settle within 3s (parked connect)');
  }
});

describe('db pool connect timeout', () => {
  it('rejects a query with a timeout when the database accepts but never answers', async () => {
    const start = Date.now();
    let error: Error | undefined;
    try {
      await db.pool.query('SELECT 1');
    } catch (e) {
      error = e as Error;
    }
    const elapsed = Date.now() - start;

    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toMatch(/timeout/i);
    // Proves the 5000ms connect timeout fired: not an instant failure (which would
    // mean the pool never waited for the handshake) and not an indefinite hang (no
    // timeout at all). The window brackets the one 5000ms timer with slack for CI.
    expect(elapsed).toBeGreaterThanOrEqual(4500);
    expect(elapsed).toBeLessThanOrEqual(9000);
  }, 20000);
});
