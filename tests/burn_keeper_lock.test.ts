import { beforeEach, describe, expect, it, vi } from 'vitest';

// Drive withBurnKeeperLock against a mocked pg client so the advisory-lock
// contract (acquire -> run -> unlock -> release; skip when held; release on throw)
// is asserted without a real Postgres.
const { clientMock, connectMock } = vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgres://test/test';
  const clientMock = { query: vi.fn(), release: vi.fn() };
  const connectMock = vi.fn(async () => clientMock);
  return { clientMock, connectMock };
});
vi.mock('pg', () => ({ Pool: function Pool() { return { connect: connectMock, query: vi.fn() }; } }));

import { withBurnKeeperLock } from '../server/db';

beforeEach(() => { clientMock.query.mockReset(); clientMock.release.mockReset(); });

describe('withBurnKeeperLock — cross-process keeper mutual exclusion', () => {
  it('runs fn while holding the lock, then unlocks + releases', async () => {
    clientMock.query.mockResolvedValueOnce({ rows: [{ locked: true }] }).mockResolvedValueOnce({ rows: [] });
    const fn = vi.fn(async () => 'cycled');
    const result = await withBurnKeeperLock(fn);
    expect(result).toBe('cycled');
    expect(fn).toHaveBeenCalledOnce();
    expect(clientMock.query.mock.calls[0][0]).toContain('pg_try_advisory_lock');
    expect(clientMock.query.mock.calls[1][0]).toContain('pg_advisory_unlock');
    expect(clientMock.release).toHaveBeenCalledOnce();
  });

  it('skips fn entirely when another process holds the lock', async () => {
    clientMock.query.mockResolvedValueOnce({ rows: [{ locked: false }] });
    const fn = vi.fn(async () => 'cycled');
    const result = await withBurnKeeperLock(fn);
    expect(result).toBeNull();
    expect(fn).not.toHaveBeenCalled();
    expect(clientMock.query).toHaveBeenCalledOnce(); // tried the lock, no unlock
    expect(clientMock.release).toHaveBeenCalledOnce();
  });

  it('unlocks + releases even if the cycle throws', async () => {
    clientMock.query.mockResolvedValueOnce({ rows: [{ locked: true }] }).mockResolvedValueOnce({ rows: [] });
    await expect(withBurnKeeperLock(async () => { throw new Error('cycle boom'); })).rejects.toThrow('cycle boom');
    expect(clientMock.query.mock.calls[1][0]).toContain('pg_advisory_unlock');
    expect(clientMock.release).toHaveBeenCalledOnce();
  });
});
