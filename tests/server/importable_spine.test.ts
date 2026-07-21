import * as http from 'node:http';
import { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

describe('importable spine', () => {
  it('imports server/main without binding a socket or hitting the DB, and exposes the new seam', async () => {
    // db.ts evaluates a module-scope DATABASE_URL (throws if unset) and constructs a pg Pool
    // (no connection on construction). Provide a dummy URL so the bare import does not throw.
    process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_phase1_test';
    const listenSpy = vi.spyOn(http.Server.prototype, 'listen');
    const connectSpy = vi.spyOn(Pool.prototype, 'connect');
    const querySpy = vi.spyOn(Pool.prototype, 'query');
    const mod = await import('../../server/main');
    // The entrypoint guard must keep a bare import inert: no listen, no DB round-trip.
    expect(listenSpy).not.toHaveBeenCalled();
    expect(connectSpy).not.toHaveBeenCalled();
    expect(querySpy).not.toHaveBeenCalled();
    // New importable seam exists with the right shape.
    expect(typeof (mod as { startServer?: unknown }).startServer).toBe('function');
    expect(typeof (mod as { routeHttpRequest?: unknown }).routeHttpRequest).toBe('function');
    listenSpy.mockRestore();
    connectSpy.mockRestore();
    querySpy.mockRestore();
  });
});
