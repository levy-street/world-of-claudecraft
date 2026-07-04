import { describe, expect, it, vi } from 'vitest';
import {
  acquireRealmSingletonLock,
  realmAdvisoryLockKeys,
  realmSingletonLockEnabled,
} from '../server/realm_lock';

class FakeClient {
  released = false;
  query = vi.fn();

  release(): void {
    this.released = true;
  }
}

describe('realm singleton lock', () => {
  it('is enabled unless explicitly disabled', () => {
    expect(realmSingletonLockEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(realmSingletonLockEnabled({ REALM_SINGLETON_LOCK: '1' } as NodeJS.ProcessEnv)).toBe(
      true,
    );
    expect(realmSingletonLockEnabled({ REALM_SINGLETON_LOCK: '0' } as NodeJS.ProcessEnv)).toBe(
      false,
    );
  });

  it('uses a stable case-insensitive lock key per realm', () => {
    expect(realmAdvisoryLockKeys('Claudemoon')).toEqual(realmAdvisoryLockKeys(' claudemoon '));
    expect(realmAdvisoryLockKeys('Claudemoon')).not.toEqual(realmAdvisoryLockKeys('Highwatch'));
  });

  it('does not connect when the lock is disabled', async () => {
    const connect = vi.fn();

    const lock = await acquireRealmSingletonLock({ connect }, 'Claudemoon', {
      REALM_SINGLETON_LOCK: '0',
    } as NodeJS.ProcessEnv);

    expect(lock).toBeNull();
    expect(connect).not.toHaveBeenCalled();
  });

  it('holds and releases a successful Postgres advisory lock', async () => {
    const client = new FakeClient();
    client.query.mockResolvedValueOnce({ rows: [{ locked: true }] });
    client.query.mockResolvedValueOnce({ rows: [{ pg_advisory_unlock: true }] });

    const lock = await acquireRealmSingletonLock(
      { connect: vi.fn(async () => client) },
      'Claudemoon',
    );

    expect(lock?.realm).toBe('Claudemoon');
    expect(client.query).toHaveBeenNthCalledWith(
      1,
      'SELECT pg_try_advisory_lock($1, $2) AS locked',
      realmAdvisoryLockKeys('Claudemoon'),
    );

    await lock?.release();
    await lock?.release();

    expect(client.query).toHaveBeenCalledTimes(2);
    expect(client.query).toHaveBeenNthCalledWith(
      2,
      'SELECT pg_advisory_unlock($1, $2)',
      realmAdvisoryLockKeys('Claudemoon'),
    );
    expect(client.released).toBe(true);
  });

  it('releases the client and fails fast when another process owns the realm', async () => {
    const client = new FakeClient();
    client.query.mockResolvedValueOnce({ rows: [{ locked: false }] });

    await expect(
      acquireRealmSingletonLock({ connect: vi.fn(async () => client) }, 'Claudemoon'),
    ).rejects.toThrow(/already hosted/);

    expect(client.released).toBe(true);
  });
});
