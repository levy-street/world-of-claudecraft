import type { PoolClient } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GUILD_BANK_PURGE_ACTION } from '../server/admin_db';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  connect: vi.fn(),
  bustGuildList: vi.fn(),
}));

vi.mock('../server/db', () => ({
  pool: {
    query: mocks.query,
    connect: mocks.connect,
  },
}));

vi.mock('../server/realm', () => ({
  REALM: 'test-realm',
}));

vi.mock('../server/admin_guilds_read', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../server/admin_guilds_read')>()),
  bustAdminGuildListReads: mocks.bustGuildList,
}));

import {
  adminGuildDetail,
  listAdminGuildHistory,
  listAdminGuilds,
  recordAdminGuildBankPurge,
  renameAdminGuild,
} from '../server/admin_guilds_db';

function transactionClient() {
  return {
    query: vi.fn(),
    release: vi.fn(),
  };
}

describe('admin guild database access', () => {
  beforeEach(() => {
    mocks.query.mockReset();
    mocks.connect.mockReset();
    mocks.bustGuildList.mockReset();
  });

  it('pages guilds before aggregating members and scopes both reads to the realm', async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [
        {
          id: 4,
          name: 'Keepers',
          realm: 'test-realm',
          created_at: '2026-01-01T00:00:00Z',
          member_count: 3,
          leader_name: 'Alice',
          total: 1,
        },
      ],
    });

    await expect(listAdminGuilds('Keep%', 2, 25, 'name', 'asc')).resolves.toEqual({
      rows: [
        {
          id: 4,
          name: 'Keepers',
          realm: 'test-realm',
          createdAt: '2026-01-01T00:00:00Z',
          memberCount: 3,
          leaderName: 'Alice',
        },
      ],
      total: 1,
      page: 2,
      limit: 25,
    });

    const [listSql, listParams] = mocks.query.mock.calls[0];
    expect(listSql).toContain('WITH page AS');
    expect(listSql).toContain('ORDER BY lower(name) ASC, id ASC');
    expect(listSql).toContain('ORDER BY lower(page.name) ASC, page.id ASC');
    expect(listSql.indexOf('LIMIT $3 OFFSET $4')).toBeLessThan(
      listSql.indexOf('LEFT JOIN guild_members'),
    );
    expect(listSql).toContain('WHERE realm = $1');
    expect(listParams).toEqual(['test-realm', 'keep\\%%', 25, 25]);
    expect(listSql).toContain("lower(name) LIKE $2 ESCAPE '\\'");
    expect(listSql).toContain('count(*)::int AS total');
    expect(mocks.query).toHaveBeenCalledOnce();
  });

  it('paginates date ordering before enriching the selected guilds', async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [
        {
          id: null,
          name: null,
          realm: null,
          created_at: null,
          member_count: 0,
          leader_name: null,
          total: 0,
        },
      ],
    });

    await expect(listAdminGuilds('', 1, 25, 'created_at', 'desc')).resolves.toEqual({
      rows: [],
      total: 0,
      page: 1,
      limit: 25,
    });

    const [listSql, listParams] = mocks.query.mock.calls[0];
    expect(listSql).toContain('ORDER BY created_at DESC, id DESC');
    expect(listSql).toContain('ORDER BY page.created_at DESC, page.id DESC');
    expect(listSql.indexOf('LIMIT $3 OFFSET $4')).toBeLessThan(
      listSql.indexOf('LEFT JOIN guild_members'),
    );
    expect(listParams).toEqual(['test-realm', '%', 25, 0]);
  });

  it('applies ascending direction to date and member-count ordering', async () => {
    mocks.query.mockResolvedValue({ rows: [{ id: null, total: 0 }] });

    await listAdminGuilds('', 1, 25, 'created_at', 'asc');
    await listAdminGuilds('', 1, 25, 'member_count', 'asc');

    expect(mocks.query.mock.calls[0][0]).toContain('ORDER BY created_at ASC, id ASC');
    expect(mocks.query.mock.calls[0][0]).toContain('ORDER BY page.created_at ASC, page.id ASC');
    expect(mocks.query.mock.calls[1][0]).toContain('ORDER BY member_count ASC, lower(name), id');
    expect(mocks.query.mock.calls[1][0]).toContain(
      'ORDER BY page.member_count ASC, lower(page.name), page.id',
    );
  });

  it('applies descending direction to both name ordering stages', async () => {
    mocks.query.mockResolvedValue({ rows: [{ id: null, total: 0 }] });

    await listAdminGuilds('', 1, 25, 'name', 'desc');

    expect(mocks.query.mock.calls[0][0]).toContain('ORDER BY lower(name) DESC, id DESC');
    expect(mocks.query.mock.calls[0][0]).toContain('ORDER BY lower(page.name) DESC, page.id DESC');
  });

  it('aggregates every matching guild before paginating member-count ordering', async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [
        {
          id: 4,
          name: 'Keepers',
          realm: 'test-realm',
          created_at: '2026-01-01T00:00:00Z',
          member_count: 3,
          leader_name: 'Alice',
          total: 8,
        },
      ],
    });

    await expect(listAdminGuilds('', 2, 25, 'member_count', 'desc')).resolves.toEqual({
      rows: [
        {
          id: 4,
          name: 'Keepers',
          realm: 'test-realm',
          createdAt: '2026-01-01T00:00:00Z',
          memberCount: 3,
          leaderName: 'Alice',
        },
      ],
      total: 8,
      page: 2,
      limit: 25,
    });

    expect(mocks.query).toHaveBeenCalledOnce();
    const [listSql, listParams] = mocks.query.mock.calls[0];
    expect(listSql).toContain('WITH candidates AS');
    expect(listSql.indexOf('LEFT JOIN guild_members gm')).toBeLessThan(
      listSql.indexOf('LIMIT $3 OFFSET $4'),
    );
    expect(listSql).toContain('ORDER BY member_count DESC, lower(name), id');
    expect(listSql).toContain('ORDER BY page.member_count DESC, lower(page.name), page.id');
    expect(listSql).toContain('count(*)::int AS total');
    expect(listParams).toEqual(['test-realm', '%', 25, 25]);
  });

  it('loads the bounded minimal roster in one realm-scoped query', async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [
        {
          guild_id: 4,
          guild_name: 'Keepers',
          realm: 'test-realm',
          created_at: '2026-01-01T00:00:00Z',
          member_count: 1,
          character_id: 8,
          character_name: 'Alice',
          account_id: 2,
          username: 'alice-account',
          class: 'mage',
          level: 12,
          rank: 'leader',
          joined_at: '2026-01-02T00:00:00Z',
          last_login: '2026-07-01T00:00:00Z',
        },
      ],
    });

    const detail = await adminGuildDetail(4);

    expect(detail?.members).toEqual([
      {
        characterId: 8,
        characterName: 'Alice',
        accountId: 2,
        username: 'alice-account',
        class: 'mage',
        level: 12,
        rank: 'leader',
        joinedAt: '2026-01-02T00:00:00Z',
        lastLogin: '2026-07-01T00:00:00Z',
      },
    ]);
    const [sql, params] = mocks.query.mock.calls[0];
    expect(sql).toContain('g.id = $1 AND g.realm = $2');
    expect(sql).toContain('LIMIT $3');
    expect(sql).not.toContain('state');
    expect(params).toEqual([4, 'test-realm', 100]);
  });

  it('retains a bounded rename history without exposing deleted guilds', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }).mockResolvedValueOnce({
      rows: [
        {
          id: '9',
          old_name: 'Old Name',
          new_name: 'New Name',
          reason: 'offensive name',
          created_at: '2026-07-20T00:00:00Z',
          admin_account_id: 3,
          admin_username: 'moderator',
        },
      ],
    });

    await expect(listAdminGuildHistory(4)).resolves.toEqual([
      {
        id: 9,
        // A row written before the additive `action` column reads as a rename.
        action: 'guild_rename',
        oldName: 'Old Name',
        newName: 'New Name',
        reason: 'offensive name',
        createdAt: '2026-07-20T00:00:00Z',
        adminAccountId: 3,
        adminUsername: 'moderator',
      },
    ]);
    expect(mocks.query.mock.calls[1][0]).toContain('LIMIT $3');
    expect(mocks.query.mock.calls[1][1]).toEqual([4, 'test-realm', 100]);
  });

  it('renames, audits, and reads member ids in one transaction', async () => {
    const client = transactionClient();
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 4, name: 'Old Name' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ character_id: 8 }, { character_id: 9 }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] });
    mocks.connect.mockResolvedValueOnce(client as unknown as PoolClient);

    await expect(renameAdminGuild(4, 'New Name', '  offensive name  ', 3)).resolves.toEqual({
      result: {
        guildId: 4,
        oldName: 'Old Name',
        newName: 'New Name',
        memberCharacterIds: [8, 9],
      },
    });
    expect(mocks.bustGuildList).toHaveBeenCalledOnce();

    expect(client.query.mock.calls.map(([sql]) => String(sql).trim().split(/\s+/)[0])).toEqual([
      'BEGIN',
      'SELECT',
      'SELECT',
      'SELECT',
      'UPDATE',
      'SELECT',
      'INSERT',
      'COMMIT',
    ]);
    expect(client.query.mock.calls[1][0]).toContain('FOR UPDATE');
    expect(client.query.mock.calls[1][1]).toEqual([4, 'test-realm']);
    expect(client.query.mock.calls[2][0]).toContain('pg_advisory_xact_lock');
    expect(client.query.mock.calls[2][1]).toEqual(['guild-name:test-realm:new name']);
    expect(client.query.mock.calls[3][0]).toContain('lower(name) = lower($2)');
    expect(client.query.mock.calls[3][1]).toEqual(['test-realm', 'New Name', 4]);
    expect(client.query.mock.calls[5][1]).toEqual([4, 101]);
    expect(client.query.mock.calls[6][1]).toEqual([
      4,
      'test-realm',
      'Old Name',
      'New Name',
      'offensive name',
      3,
    ]);
    const commitIndex = client.query.mock.calls.findIndex(([sql]) => sql === 'COMMIT');
    expect(client.query.mock.invocationCallOrder[commitIndex]).toBeLessThan(
      mocks.bustGuildList.mock.invocationCallOrder[0],
    );
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('accepts the inclusive name, reason, and member boundaries', async () => {
    const minimumName = transactionClient();
    minimumName.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    mocks.connect.mockResolvedValueOnce(minimumName as unknown as PoolClient);

    await expect(renameAdminGuild(4, 'Abc', 'reason', 3)).resolves.toEqual({
      error: 'not_found',
    });

    const maximums = transactionClient();
    const name = 'ABCDEFGHIJKLMNOPQRSTUVWX';
    const reason = 'x'.repeat(500);
    const memberRows = Array.from({ length: 100 }, (_, index) => ({
      character_id: index + 1,
    }));
    maximums.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 4, name: 'Old Name' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: memberRows })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] });
    mocks.connect.mockResolvedValueOnce(maximums as unknown as PoolClient);

    const renamed = await renameAdminGuild(4, name, reason, 3);

    expect(renamed).toEqual({
      result: {
        guildId: 4,
        oldName: 'Old Name',
        newName: name,
        memberCharacterIds: memberRows.map((row) => row.character_id),
      },
    });
    expect(maximums.query.mock.calls[6][1]).toEqual([4, 'test-realm', 'Old Name', name, reason, 3]);
    expect(maximums.query).toHaveBeenLastCalledWith('COMMIT');
  });

  it('maps the case-insensitive unique constraint to name_taken and rolls back', async () => {
    const client = transactionClient();
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 4, name: 'Old Name' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: '23505' }))
      .mockResolvedValueOnce({ rows: [] });
    mocks.connect.mockResolvedValueOnce(client as unknown as PoolClient);

    await expect(renameAdminGuild(4, 'Taken Name', 'offensive name', 3)).resolves.toEqual({
      error: 'name_taken',
    });
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('serializes the target folded name and rejects an existing collision before update', async () => {
    const client = transactionClient();
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 4, name: 'Old Name' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [] });
    mocks.connect.mockResolvedValueOnce(client as unknown as PoolClient);

    await expect(renameAdminGuild(4, 'TAKEN Name', 'reason', 3)).resolves.toEqual({
      error: 'name_taken',
    });
    expect(client.query.mock.calls[2][1]).toEqual(['guild-name:test-realm:taken name']);
    expect(client.query.mock.calls.some(([sql]) => String(sql).startsWith('UPDATE'))).toBe(false);
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
  });

  it('accepts a case-only rename, the remediation for a historical folded collision', async () => {
    // The folded-name trigger deliberately leaves pre-existing case-only collisions
    // in place, and re-casing one apart is the least disruptive way to remediate it.
    // Rejecting it as "same name" would close the only cheap remediation path.
    const client = transactionClient();
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 4, name: 'HISTORICAL NAME' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ character_id: 7 }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] });
    mocks.connect.mockResolvedValueOnce(client as unknown as PoolClient);

    await expect(renameAdminGuild(4, 'Historical Name', 'de-collide', 3)).resolves.toEqual({
      result: {
        guildId: 4,
        oldName: 'HISTORICAL NAME',
        newName: 'Historical Name',
        memberCharacterIds: [7],
      },
    });
    // Self-exclusion is what makes this safe: the collision probe passes the guild id.
    expect(client.query.mock.calls[3][1]).toEqual(['test-realm', 'Historical Name', 4]);
    // The rename fan-out list is read cap-bounded, not whole-roster: 100 members
    // plus the single extra row that proves an overflow.
    expect(client.query.mock.calls[5][0]).toMatch(/FROM guild_members[\s\S]*LIMIT \$2/);
    expect(client.query.mock.calls[5][1]).toEqual([4, 101]);
    expect(client.query).toHaveBeenLastCalledWith('COMMIT');
  });

  it('rolls back missing, byte-identical unchanged, and oversized guilds', async () => {
    const missing = transactionClient();
    missing.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    mocks.connect.mockResolvedValueOnce(missing as unknown as PoolClient);
    await expect(renameAdminGuild(4, 'New Name', 'reason', 3)).resolves.toEqual({
      error: 'not_found',
    });

    const unchanged = transactionClient();
    unchanged.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 4, name: 'Old Name' }] })
      .mockResolvedValueOnce({ rows: [] });
    mocks.connect.mockResolvedValueOnce(unchanged as unknown as PoolClient);
    await expect(renameAdminGuild(4, '  Old Name  ', 'reason', 3)).resolves.toEqual({
      error: 'same_name',
    });

    const oversized = transactionClient();
    oversized.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 4, name: 'Old Name' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: Array.from({ length: 101 }, (_, characterId) => ({
          character_id: characterId + 1,
        })),
      })
      .mockResolvedValueOnce({ rows: [] });
    mocks.connect.mockResolvedValueOnce(oversized as unknown as PoolClient);
    await expect(renameAdminGuild(4, 'New Name', 'reason', 3)).resolves.toEqual({
      error: 'member_limit_exceeded',
    });
    expect(oversized.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(mocks.bustGuildList).not.toHaveBeenCalled();
  });

  it('rolls back and rethrows when the permanent audit insert fails', async () => {
    const client = transactionClient();
    const auditFailure = new Error('audit unavailable');
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 4, name: 'Old Name' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(auditFailure)
      .mockResolvedValueOnce({ rows: [] });
    mocks.connect.mockResolvedValueOnce(client as unknown as PoolClient);

    await expect(renameAdminGuild(4, 'New Name', 'reason', 3)).rejects.toBe(auditFailure);
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(mocks.bustGuildList).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('rejects input boundaries before checking out a database connection', async () => {
    await expect(renameAdminGuild(4, 'ab', 'reason', 3)).resolves.toEqual({
      error: 'invalid_name',
    });
    await expect(renameAdminGuild(4, 'x'.repeat(25), 'reason', 3)).resolves.toEqual({
      error: 'invalid_name',
    });
    await expect(renameAdminGuild(4, 'Bad  Spaces', 'reason', 3)).resolves.toEqual({
      error: 'invalid_name',
    });
    await expect(renameAdminGuild(4, 'Valid Name', '  ', 3)).resolves.toEqual({
      error: 'invalid_reason',
    });
    await expect(renameAdminGuild(4, 'Valid Name', 'x'.repeat(501), 3)).resolves.toEqual({
      error: 'invalid_reason',
    });
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('returns null for a deleted guild detail or history without a second history query', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] });
    await expect(adminGuildDetail(404)).resolves.toBeNull();

    mocks.query.mockResolvedValueOnce({ rows: [] });
    await expect(listAdminGuildHistory(404)).resolves.toBeNull();
    expect(mocks.query).toHaveBeenCalledTimes(2);
  });
});

// The audited row for the operator dormant-slot guild bank purge. A purge never
// renames, so it is distinguished by action = 'guild_bank_purge' with old_name
// and new_name both carrying the guild's current name.
describe('recordAdminGuildBankPurge', () => {
  beforeEach(() => {
    mocks.query.mockReset();
  });

  it('writes an audited guild_bank_purge row naming the operator, the reason, and the item', async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [{ name: 'Iron Vanguard' }] })
      .mockResolvedValueOnce({ rows: [] });

    await recordAdminGuildBankPurge({
      guildId: 913,
      reason: 'stuck rift-gear copy',
      adminAccountId: 7,
      itemId: 'wolf_fang',
      count: 2,
      slotIndex: 3,
    });

    const [sql, params] = mocks.query.mock.calls[1];
    expect(sql).toContain('INSERT INTO guild_moderation_actions');
    // The action kind is BOUND, not inlined, so this row and the dashboard's
    // label table read the one shared constant (server/admin_db.ts
    // GUILD_MODERATION_ACTIONS) instead of two copies of a literal.
    expect(sql).not.toContain("'guild_bank_purge'");
    expect(params[5]).toBe(GUILD_BANK_PURGE_ACTION);
    expect(GUILD_BANK_PURGE_ACTION).toBe('guild_bank_purge');
    // old_name and new_name share $3: a purge never renames.
    expect(sql).toContain('VALUES ($1, $2, $6, $3, $3, $4, $5)');
    expect(params[0]).toBe(913);
    expect(params[2]).toBe('Iron Vanguard');
    // The reason carries what was removed, so the moderation history reads on
    // its own without joining the bank_ledger.
    expect(params[3]).toBe('removed guild bank slot 3 (2x wolf_fang): stuck rift-gear copy');
    expect(params[4]).toBe(7); // the acting operator, never the carrier
  });

  it('still records the audit row when the guild row is already gone', async () => {
    // A disband can race the operator; the audit row is a snapshot identifier,
    // not a foreign key, so losing the name must not lose the record.
    mocks.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    await recordAdminGuildBankPurge({
      guildId: 913,
      reason: 'why',
      adminAccountId: 7,
      itemId: 'wolf_fang',
      count: 1,
      slotIndex: 0,
    });
    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(mocks.query.mock.calls[1][1][2]).toBe('');
  });

  it('clamps an oversized detail line to the reason cap', async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [{ name: 'G' }] })
      .mockResolvedValueOnce({ rows: [] });
    await recordAdminGuildBankPurge({
      guildId: 913,
      reason: 'x'.repeat(500),
      adminAccountId: 7,
      itemId: 'wolf_fang',
      count: 1,
      slotIndex: 0,
    });
    expect((mocks.query.mock.calls[1][1][3] as string).length).toBe(500);
  });
});
