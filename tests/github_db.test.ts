import { describe, expect, it } from 'vitest';
import {
  accountForGithub,
  consumeGitHubOAuthState,
  createGitHubOAuthState,
  githubForAccount,
  linkGitHubToAccount,
  pruneGitHubOAuthStates,
  unlinkGitHub,
} from '../server/github_db';

// github_db functions take the pg `pool` as an argument, so a fake pool (no
// vi.mock needed) drives every branch for real, mirroring discord_db.test.ts.
// The fake routes by normalized SQL and lets each test script row results.
type Result = { rows: any[]; rowCount: number };
type Handler = (sql: string, params: any[]) => Result;

function makePool(handler: Handler) {
  const calls: { sql: string; params: any[] }[] = [];
  const query = (sql: string, params: any[] = []) => {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    calls.push({ sql: s, params });
    return Promise.resolve(handler(s, params));
  };
  const pool: any = { query };
  return { pool, calls, didRun: (frag: string) => calls.some((c) => c.sql.includes(frag)) };
}

const NONE: Result = { rows: [], rowCount: 0 };

describe('githubForAccount / accountForGithub', () => {
  it('githubForAccount returns the linked row or null', async () => {
    const row = {
      account_id: 1,
      github_user_id: '16779411',
      github_login: 'FernandoX7',
      linked_at: new Date(),
    };
    const live = makePool((s) =>
      s.includes('FROM github_links WHERE account_id') ? { rows: [row], rowCount: 1 } : NONE,
    );
    expect(await githubForAccount(live.pool, 1)).toEqual(row);
    const empty = makePool(() => NONE);
    expect(await githubForAccount(empty.pool, 1)).toBeNull();
  });

  it('accountForGithub returns the owning account id or null', async () => {
    const live = makePool((s) =>
      s.includes('SELECT account_id FROM github_links WHERE github_user_id')
        ? { rows: [{ account_id: 7 }], rowCount: 1 }
        : NONE,
    );
    expect(await accountForGithub(live.pool, '16779411')).toBe(7);
    const empty = makePool(() => NONE);
    expect(await accountForGithub(empty.pool, '16779411')).toBeNull();
  });
});

describe('linkGitHubToAccount', () => {
  it('refuses when the github user id already belongs to a different account', async () => {
    const { pool, didRun } = makePool((s) => {
      if (s.includes('SELECT account_id FROM github_links WHERE github_user_id'))
        return { rows: [{ account_id: 99 }], rowCount: 1 };
      return NONE;
    });
    const ok = await linkGitHubToAccount(pool, 1, { githubUserId: '16779411', login: 'x' });
    expect(ok).toBe(false);
    // No INSERT attempted once a foreign owner is detected.
    expect(didRun('INSERT INTO github_links')).toBe(false);
  });

  it('links when the github id is free (or already this account)', async () => {
    const { pool, calls, didRun } = makePool((s) => {
      if (s.includes('SELECT account_id FROM github_links WHERE github_user_id')) return NONE;
      if (s.includes('INSERT INTO github_links')) return { rows: [], rowCount: 1 };
      return NONE;
    });
    const ok = await linkGitHubToAccount(pool, 1, {
      githubUserId: '16779411',
      login: 'FernandoX7',
    });
    expect(ok).toBe(true);
    expect(didRun('INSERT INTO github_links')).toBe(true);
    const insert = calls.find((c) => c.sql.includes('INSERT INTO github_links'));
    expect(insert?.params).toEqual([1, '16779411', 'FernandoX7']);
  });

  it('treats a unique-violation race as already-owned (false, not a throw)', async () => {
    const { pool } = makePool((s) => {
      if (s.includes('SELECT account_id FROM github_links WHERE github_user_id')) return NONE;
      if (s.includes('INSERT INTO github_links')) {
        const err: any = new Error('dup');
        err.code = '23505';
        throw err;
      }
      return NONE;
    });
    await expect(
      linkGitHubToAccount(pool, 1, { githubUserId: '16779411', login: 'x' }),
    ).resolves.toBe(false);
  });

  it('re-throws a non-unique-violation database error instead of masking it as a conflict', async () => {
    const { pool } = makePool((s) => {
      if (s.includes('SELECT account_id FROM github_links WHERE github_user_id')) return NONE;
      if (s.includes('INSERT INTO github_links')) {
        const err: any = new Error('connection terminated');
        err.code = '57P01'; // admin_shutdown, NOT a unique violation
        throw err;
      }
      return NONE;
    });
    await expect(
      linkGitHubToAccount(pool, 1, { githubUserId: '16779411', login: 'x' }),
    ).rejects.toThrow('connection terminated');
  });

  it('updates the stored login on a re-link by the same already-owning account', async () => {
    const { pool, calls } = makePool((s) => {
      // Same account re-linking (e.g. after a GitHub username change): the
      // ownership check finds itself as the owner, so the upsert proceeds.
      if (s.includes('SELECT account_id FROM github_links WHERE github_user_id'))
        return { rows: [{ account_id: 1 }], rowCount: 1 };
      if (s.includes('INSERT INTO github_links')) return { rows: [], rowCount: 1 };
      return NONE;
    });
    const ok = await linkGitHubToAccount(pool, 1, { githubUserId: '16779411', login: 'newname' });
    expect(ok).toBe(true);
    const insert = calls.find((c) => c.sql.includes('INSERT INTO github_links'));
    expect(insert?.sql).toContain('ON CONFLICT (account_id) DO UPDATE');
    expect(insert?.params).toEqual([1, '16779411', 'newname']);
  });
});

describe('unlinkGitHub', () => {
  it('deletes the link row for the account', async () => {
    const { pool, calls, didRun } = makePool(() => NONE);
    await unlinkGitHub(pool, 1);
    expect(didRun('DELETE FROM github_links WHERE account_id')).toBe(true);
    expect(calls[0]?.params).toEqual([1]);
  });
});

describe('GitHub OAuth state', () => {
  it('createGitHubOAuthState inserts the state with the account id + TTL', async () => {
    const { pool, calls, didRun } = makePool(() => NONE);
    await createGitHubOAuthState(pool, { state: 'st4te', accountId: 1, ttlMinutes: 10 });
    expect(didRun('INSERT INTO github_oauth_states')).toBe(true);
    const insert = calls.find((c) => c.sql.includes('INSERT INTO github_oauth_states'));
    expect(insert?.params).toEqual(['st4te', 1, '10']);
  });

  it('consumeGitHubOAuthState returns the row on a live state and null on a missing/expired one', async () => {
    const row = { state: 'st4te', account_id: 1 };
    const live = makePool((s) =>
      s.includes('DELETE FROM github_oauth_states') ? { rows: [row], rowCount: 1 } : NONE,
    );
    expect(await consumeGitHubOAuthState(live.pool, 'st4te')).toEqual(row);
    const dead = makePool(() => NONE);
    expect(await consumeGitHubOAuthState(dead.pool, 'st4te')).toBeNull();
  });

  it('consumeGitHubOAuthState is single-use: the DELETE...RETURNING is the only query', async () => {
    const { pool, calls } = makePool((s) =>
      s.includes('DELETE FROM github_oauth_states')
        ? { rows: [{ state: 's', account_id: 1 }], rowCount: 1 }
        : NONE,
    );
    await consumeGitHubOAuthState(pool, 's');
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain('RETURNING state, account_id');
  });

  it('pruneGitHubOAuthStates deletes only expired rows', async () => {
    const { pool, calls, didRun } = makePool(() => NONE);
    await pruneGitHubOAuthStates(pool);
    expect(didRun('DELETE FROM github_oauth_states WHERE expires_at <= now()')).toBe(true);
    expect(calls).toHaveLength(1);
  });
});
