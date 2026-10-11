import { describe, expect, it, vi } from 'vitest';
import { ACCOUNT_FRIENDS_SCHEMA, PgAccountFriendsDb } from '../server/account_friends_db';
import { SocialService } from '../server/social';

function serviceHarness() {
  const friend = {
    id: 20,
    name: 'OldMage',
    cls: 'mage',
    level: 4,
    realm: 'test',
    activeTitle: null,
    accountId: 200,
    tier: 'bound' as const,
  };
  const live = {
    id: 21,
    name: 'NewWarrior',
    cls: 'warrior',
    level: 3,
    realm: 'test',
    activeTitle: 'title',
  };
  const db = {
    listFriends: vi.fn(async () => [friend]),
    listBlocks: vi.fn(async () => []),
    blockedIds: vi.fn(async () => [] as number[]),
    listIgnores: vi.fn(async () => []),
    guildMembership: vi.fn(async () => null),
    pledgeOf: vi.fn(async () => null),
    accountIdForCharacter: vi.fn(async (id: number) => (id === 1 ? 100 : 200)),
    findCharacterByName: vi.fn(async () => live),
    addFriend: vi.fn(async () => 'ok'),
    removeFriend: vi.fn(async () => 'bound'),
  };
  const tx = {
    onlineFriendForAccount: vi.fn(() => live),
    locationOf: vi.fn((id: number) =>
      id === live.id ? { zone: 'zone', status: 'online', x: 42, z: 12 } : null,
    ),
    blockListLoaded: vi.fn(() => true),
    isBlocking: vi.fn(() => false),
    deliver: vi.fn(),
    pushSnapshot: vi.fn(),
    pushAccountSnapshots: vi.fn(),
  };
  return {
    db,
    tx,
    friend,
    live,
    service: new SocialService(
      db as never,
      tx as never,
      () => 0,
      () => false,
      () => null,
    ),
  };
}

describe('account friend service projection', () => {
  it('shows the online alt and tier without disclosing server account identity', async () => {
    const { service, tx, db } = serviceHarness();
    const snapshot = await service.snapshot(1);
    expect(snapshot.friends).toEqual([
      {
        id: 21,
        name: 'NewWarrior',
        cls: 'warrior',
        level: 3,
        realm: 'test',
        activeTitle: 'title',
        tier: 'bound',
        online: true,
        zone: 'zone',
        status: 'online',
        x: 42,
        z: 12,
      },
    ]);
    expect(tx.onlineFriendForAccount).toHaveBeenCalledWith(200);
    expect(db.listFriends).toHaveBeenCalledOnce();
    expect(JSON.stringify(snapshot)).not.toContain('accountId');
  });

  it.each(['viewer', 'friend', 'loading'] as const)(
    'never reveals a live alt across %s privacy denial',
    async (denial) => {
      const { service, tx } = serviceHarness();
      if (denial === 'loading') tx.blockListLoaded.mockReturnValue(false);
      else
        tx.isBlocking.mockImplementation(
          (...args: unknown[]) => args[0] === (denial === 'viewer' ? 1 : 21),
        );
      const row = (await service.snapshot(1)).friends[0];
      expect(row.id).toBe(20);
      expect(row.name).toBe('OldMage');
      expect(row.online).toBe(false);
      expect(row).not.toHaveProperty('x');
    },
  );

  it('recognizes an account friendship when adding a different alt', async () => {
    const { service, db, tx } = serviceHarness();
    await service.friendAdd({ characterId: 1, name: 'Owner' }, 'NewWarrior');
    expect(db.addFriend).not.toHaveBeenCalled();
    expect(tx.deliver).toHaveBeenCalledWith(1, [
      { type: 'error', text: 'NewWarrior is already your friend.' },
    ]);
  });

  it('refuses to friend another character on the same account', async () => {
    const { service, db, tx } = serviceHarness();
    db.accountIdForCharacter.mockResolvedValue(100);
    await service.friendAdd({ characterId: 1, name: 'Owner' }, 'NewWarrior');
    expect(db.addFriend).not.toHaveBeenCalled();
    expect(tx.deliver).toHaveBeenCalledWith(1, [
      { type: 'error', text: 'You cannot befriend yourself.' },
    ]);
  });

  it('does not turn friend removal into an unbind operation', async () => {
    const { service, db, tx } = serviceHarness();
    await service.friendRemove({ characterId: 1, name: 'Owner' }, 'NewWarrior');
    expect(db.removeFriend).toHaveBeenCalledWith(1, 21);
    expect(tx.pushAccountSnapshots).not.toHaveBeenCalled();
    expect(tx.deliver).toHaveBeenCalledWith(1, [
      { type: 'error', text: 'Bound friends are linked by their referral invitation.' },
    ]);
  });

  it('bounds the visible page and derives its cursor before substituting online alts', async () => {
    const { service, db, friend } = serviceHarness();
    db.listFriends.mockResolvedValue(
      Array.from({ length: 51 }, (_, i) => ({
        ...friend,
        id: 1000 + i,
        accountId: 500 + i,
      })),
    );
    const snapshot = await service.snapshot(1, 777);
    expect(snapshot.friends).toHaveLength(50);
    expect(snapshot.friendsCursor).toBe(777);
    expect(snapshot.friendsNextCursor).toBe(1049);
    expect(db.listFriends).toHaveBeenCalledWith(1, 777);
  });

  it('permits removing an ordinary account edge outside the currently displayed page', async () => {
    const { service, db, tx } = serviceHarness();
    db.listFriends.mockResolvedValue([]);
    db.removeFriend.mockResolvedValue('removed');
    await service.friendRemove({ characterId: 1, name: 'Owner' }, 'NewWarrior');
    expect(tx.pushAccountSnapshots).toHaveBeenCalledWith(1);
    expect(tx.deliver).toHaveBeenCalledWith(1, [
      { type: 'log', text: 'NewWarrior removed from friends.', color: '#aaf' },
    ]);
  });
});

function sqlHarness(count = 0, bound = false, blocked = false) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('AS owner_id')) return { rows: [{ owner_id: 100, target_id: 200 }] };
    if (sql.includes('count(*)')) return { rows: [{ n: count }] };
    if (sql.includes('FROM referrals')) return { rows: bound ? [{ exists: 1 }] : [] };
    if (sql.includes('UNION ALL SELECT 1 FROM account_blocks'))
      return { rows: blocked ? [{ exists: 1 }] : [] };
    return { rows: [] };
  });
  const client = { query, release: vi.fn(), on: vi.fn(), removeListener: vi.fn() };
  const pool = {
    connect: vi.fn(async () => client),
    query: vi.fn(async (sql: string, _params?: unknown[]) => ({
      rows: (sql.includes('FROM pg_index') ? [{ ready: true }] : []) as Record<string, unknown>[],
    })),
  };
  return { db: new PgAccountFriendsDb(pool as never), client, pool, query };
}

describe('account friendship persistence contract', () => {
  it('locks both accounts before counting and writes only the outgoing edge', async () => {
    const { db, query, client } = sqlHarness(49);
    await expect(db.addFriend(1, 21)).resolves.toBe('ok');
    const statements = query.mock.calls.map(([sql]) => sql);
    const lock = statements.findIndex((sql) => sql.includes('FOR UPDATE'));
    const count = statements.findIndex((sql) => sql.includes('count(*)'));
    expect(lock).toBeGreaterThan(0);
    expect(count).toBeGreaterThan(lock);
    expect(statements[lock]).toContain('ORDER BY id');
    const inserts = statements.filter((sql) => sql.startsWith('INSERT'));
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toContain('account_friendships');
    expect(query).toHaveBeenLastCalledWith('COMMIT', undefined);
    expect(client.release).toHaveBeenCalledOnce();
    const bounds = statements.findIndex((sql) => sql.includes('SET LOCAL statement_timeout'));
    expect(bounds).toBeGreaterThan(0);
    expect(bounds).toBeLessThan(lock);
    expect(statements[bounds]).toContain("lock_timeout = '1s'");
    expect(statements[bounds]).toContain("idle_in_transaction_session_timeout = '2s'");
    expect(statements[count]).toContain('LIMIT $2');
    expect(client.removeListener).toHaveBeenCalledOnce();
  });

  it.each([50, 83])(
    'preserves a full historical union of %i while refusing new additions',
    async (count) => {
      const { db, query } = sqlHarness(count);
      await expect(db.addFriend(1, 21)).resolves.toBe('full');
      expect(
        query.mock.calls.some(([sql]) => sql.startsWith('INSERT') || sql.startsWith('DELETE')),
      ).toBe(false);
      expect(query).toHaveBeenLastCalledWith('ROLLBACK', undefined);
    },
  );

  it('derives binding from referral evidence and refuses duplicate ordinary additions', async () => {
    const { db, query } = sqlHarness(0, true);
    await expect(db.addFriend(1, 21)).resolves.toBe('already');
    expect(query.mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(false);
  });

  it('rejects a reverse account block under the same account locks', async () => {
    const { db, query } = sqlHarness(0, false, true);
    await expect(db.addFriend(1, 21)).resolves.toBe('blocked');
    expect(query.mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(false);
  });

  it('rolls back and releases the connection on failure', async () => {
    const { db, query, client } = sqlHarness();
    query.mockRejectedValueOnce(
      Object.assign(new Error('database unavailable'), { code: '55P03' }),
    );
    await expect(db.addFriend(1, 21)).rejects.toThrow('database unavailable');
    expect(query).toHaveBeenLastCalledWith('ROLLBACK', undefined);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('reads friend and bound edges in one batched account projection', async () => {
    const { db, pool } = sqlHarness();
    await db.listFriends(1);
    expect(pool.query).toHaveBeenCalledTimes(2);
    const sql = String(pool.query.mock.calls[1]?.[0]);
    expect(sql).toContain('bool_or(bound)');
    expect(sql).toContain('JOIN LATERAL');
    expect(sql).toContain('FROM account_friendships');
    expect(sql).toContain('FROM referrals');
    expect(sql).not.toContain('email');
    expect(sql.match(/LIMIT \$4/g)).toHaveLength(4);
    expect(pool.query.mock.calls[1]?.[1]?.slice(-2)).toEqual([0, 51]);
    expect(sql).not.toContain('AND EXISTS (SELECT 1 FROM characters');
  });

  it('advances past a bounded page of accounts with no character on this realm', async () => {
    const { db, pool } = sqlHarness();
    pool.query.mockResolvedValueOnce({ rows: [{ ready: true }] }).mockResolvedValueOnce({
      rows: Array.from({ length: 51 }, (_, i) => ({
        id: null,
        accountId: 100 + i,
        tier: 'bound',
        activeTitle: null,
      })),
    });
    const page = await db.listFriendPage(1, 90);
    expect(page).toEqual({ friends: [], nextCursor: 149 });
    expect(pool.query.mock.calls[1]?.[1]?.slice(-2)).toEqual([90, 51]);
  });

  it('pages inherited blocks without disclosing account cursors in display rows', async () => {
    const { db, pool } = sqlHarness();
    pool.query.mockResolvedValueOnce({
      rows: Array.from({ length: 51 }, (_, i) => ({
        id: i + 20,
        name: `Name${i}`,
        blocked_account_id: i + 100,
      })),
    });
    const page = await db.listBlockPage(1, 80);
    expect(page.blocks).toHaveLength(50);
    expect(page.nextCursor).toBe(149);
    expect(page.blocks[0]).toEqual({ id: 20, name: 'Name0' });
    expect(pool.query.mock.calls[0][1]?.slice(-2)).toEqual([80, 51]);
    expect(pool.query.mock.calls[0][0]).toContain('ORDER BY b.blocked_account_id LIMIT $4');
  });

  it('rejects admission beyond four mutations before checking out another pool client', async () => {
    const { db, pool, client } = sqlHarness();
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    pool.connect.mockImplementation(async () => {
      await wait;
      return client;
    });
    const running = [
      db.addFriend(1, 2),
      db.addFriend(3, 4),
      db.addFriend(5, 6),
      db.addFriend(7, 8),
    ];
    await expect(db.addFriend(9, 10)).resolves.toBe('busy');
    await expect(db.addBlock(1, 11)).resolves.toBe('busy');
    expect(pool.connect).toHaveBeenCalledTimes(4);
    release();
    await expect(Promise.all(running)).resolves.toEqual(['ok', 'ok', 'ok', 'ok']);
    await expect(db.addFriend(9, 10)).resolves.toBe('ok');
  });

  it('applies finite server and transaction bounds to block removal too', async () => {
    const { db, query, pool, client } = sqlHarness();
    await expect(db.removeBlock(1, 2)).resolves.toBe('ok');
    expect(pool.query).not.toHaveBeenCalled();
    const statements = query.mock.calls.map(([sql]) => sql);
    const bounds = statements.findIndex((sql) => sql.includes('SET LOCAL statement_timeout'));
    const removal = statements.findIndex((sql) => sql.startsWith('DELETE FROM account_blocks'));
    expect(bounds).toBeGreaterThan(0);
    expect(removal).toBeGreaterThan(bounds);
    expect(query).toHaveBeenLastCalledWith('COMMIT', undefined);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('publishes committed block removals to the shared listener channel', async () => {
    const { db, query } = sqlHarness();
    query.mockImplementation(
      async (sql) =>
        ({
          rows: sql.startsWith('DELETE FROM account_blocks') ? [{ account_id: 100 }] : [],
        }) as never,
    );
    await db.removeBlock(1, 2);
    const statements = query.mock.calls.map(([sql]) => sql);
    expect(statements.indexOf('SELECT pg_notify($1, $2)')).toBeLessThan(
      statements.indexOf('COMMIT'),
    );
    expect(query).toHaveBeenCalledWith('SELECT pg_notify($1, $2)', [
      'account_blocks_changed',
      '{"accountId":100}',
    ]);
  });

  it('uses shared admission for reads and mutations before pool access', async () => {
    const { pool } = sqlHarness();
    const database = vi.fn();
    const db = new PgAccountFriendsDb(pool as never, async (run) => {
      database();
      return run();
    });
    await db.addFriend(1, 2);
    await db.blockedAccountIds(1);
    expect(database).toHaveBeenCalledTimes(2);
  });

  it('bounds character block probes to their actual audience and skips empty audiences', async () => {
    const { db, pool } = sqlHarness();
    expect(await db.blockedIds(1, [])).toEqual([]);
    expect(pool.query).not.toHaveBeenCalled();
    await db.blockedIds(1, [20, 21]);
    expect(pool.query.mock.calls[0][0]).toContain('target.id = ANY($3::int[])');
    expect(pool.query.mock.calls[0][1]?.[2]).toEqual([20, 21]);
  });

  it('bounds notification candidates to online characters in one query', async () => {
    const { db, pool } = sqlHarness();
    await expect(db.whoFriended(1, [])).resolves.toEqual([]);
    expect(pool.query).not.toHaveBeenCalled();
    await db.whoFriended(1, [20, 21]);
    expect(pool.query).toHaveBeenCalledOnce();
    expect(pool.query.mock.calls[0]?.[0]).toContain('candidate.id = ANY($3::int[])');
    expect(pool.query.mock.calls[0]?.[1]?.[2]).toEqual([20, 21]);
  });

  it('commits an account block and ordinary edge removal atomically without erasing referral evidence', async () => {
    const { db, query } = sqlHarness();
    await expect(db.addBlock(1, 21)).resolves.toBe('ok');
    const statements = query.mock.calls.map(([sql]) => sql);
    expect(statements.some((sql) => sql.startsWith('INSERT INTO account_blocks'))).toBe(true);
    expect(statements.some((sql) => sql.startsWith('DELETE FROM account_friendships'))).toBe(true);
    expect(statements.some((sql) => sql.startsWith('DELETE FROM referrals'))).toBe(false);
    expect(query).toHaveBeenCalledWith('SELECT pg_notify($1, $2)', [
      'account_blocks_changed',
      '{"accountId":100}',
    ]);
    expect(query).toHaveBeenLastCalledWith('COMMIT', undefined);
  });

  it('schema stores resumable progress without scanning legacy edges under the boot DDL lock', () => {
    expect(ACCOUNT_FRIENDS_SCHEMA).toContain('account_social_migration_progress');
    expect(ACCOUNT_FRIENDS_SCHEMA).not.toContain('FROM friendships');
    expect(ACCOUNT_FRIENDS_SCHEMA).not.toContain('FROM blocks');
    expect(ACCOUNT_FRIENDS_SCHEMA).toContain('account_friendships_reverse');
    expect(ACCOUNT_FRIENDS_SCHEMA).toContain('account_blocks_reverse');
  });
});
