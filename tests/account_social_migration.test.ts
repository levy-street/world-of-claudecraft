import { describe, expect, it, vi } from 'vitest';
import { migrateLegacyAccountSocial } from '../server/account_social_migration';
import { createReferralFriendPageReadiness } from '../server/referral_indexes';

describe('resumable account social migration', () => {
  it('commits bounded pages before the final marker and takes the minimum across duplicate pages', async () => {
    let pages = 0;
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes('RETURNING complete')) {
        pages++;
        expect(values?.[1]).toBe(500);
        expect(sql).toContain('ORDER BY f.character_id');
        expect(sql).toContain('LIMIT $2');
        expect(sql).toContain('LEAST(account_');
        return { rows: [{ complete: pages !== 1 }] };
      }
      return { rows: [] };
    });
    await migrateLegacyAccountSocial({ query } as never);
    const statements = query.mock.calls.map(([sql]) => sql);
    expect(statements.filter((sql) => sql === 'COMMIT')).toHaveLength(3);
    const marker = statements.findIndex((sql) =>
      sql.startsWith('INSERT INTO account_social_migrations '),
    );
    expect(marker).toBeGreaterThan(statements.lastIndexOf('COMMIT'));
    expect(statements.at(-1)).toContain('pg_advisory_unlock');
  });

  it('leaves committed pages intact and withholds the final marker after a failure', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('RETURNING complete')) throw new Error('interrupted');
      return { rows: [] };
    });
    await expect(migrateLegacyAccountSocial({ query } as never)).rejects.toThrow('interrupted');
    expect(query.mock.calls.map(([sql]) => sql)).toContain('ROLLBACK');
    expect(
      query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO account_social_migrations ')),
    ).toBe(false);
  });

  it('never copies legacy rows after the final marker, so removed edges stay removed', async () => {
    const query = vi.fn(async (sql: string) => ({
      rows: sql.includes('WHERE name') ? [{ exists: 1 }] : [],
    }));
    await migrateLegacyAccountSocial({ query } as never);
    expect(query.mock.calls.some(([sql]) => sql === 'BEGIN')).toBe(false);
  });
});

describe('referral friend index readiness', () => {
  it('coalesces checks, caches refusal, and retries after the index becomes valid', async () => {
    let now = 0;
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValue({ rows: [{}] });
    const ready = createReferralFriendPageReadiness(query, () => now);
    const results = await Promise.allSettled([ready(), ready()]);
    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    expect(query).toHaveBeenCalledOnce();
    await expect(ready()).rejects.toThrow('not ready');
    expect(query).toHaveBeenCalledOnce();
    now = 5000;
    await ready();
    await ready();
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0]).toContain('indisvalid AND indisready');
  });
});
