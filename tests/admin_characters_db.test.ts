import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock('../server/db', () => ({
  pool: { query: mocks.query },
}));

vi.mock('../server/realm', () => ({
  REALM: 'test-realm',
}));

import { listCharacters } from '../server/admin_db';

describe('admin character queries', () => {
  beforeEach(() => {
    mocks.query.mockReset();
  });

  it('filters character names while escaping LIKE wildcards', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ total: 0 }] });

    await expect(listCharacters('Mer%lin', 'name', 'asc', 1, 25)).resolves.toEqual({
      rows: [],
      total: 0,
      page: 1,
      limit: 25,
    });

    expect(mocks.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('WHERE c.name ILIKE $1'),
      ['%Mer\\%lin%', 25, 0],
    );
    expect(mocks.query).toHaveBeenNthCalledWith(2, expect.stringContaining('FROM characters c'), [
      '%Mer\\%lin%',
    ]);
    expect(mocks.query.mock.calls[0][0]).toContain(
      'LEFT JOIN guild_members gm ON gm.character_id = page.id',
    );
    expect(mocks.query.mock.calls[0][0]).toContain(
      'LEFT JOIN guilds g ON g.id = gm.guild_id AND g.realm = page.realm',
    );
    const sql = mocks.query.mock.calls[0][0];
    expect(sql).toContain('WITH page AS MATERIALIZED');
    expect(sql.indexOf('LIMIT $2 OFFSET $3')).toBeLessThan(sql.indexOf('LEFT JOIN guild_members'));
  });

  it('maps a character guild and role without extra queries', async () => {
    mocks.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 7,
            name: 'Merlin',
            class: 'mage',
            level: 10,
            account_id: 3,
            username: 'wizard',
            copper: 12,
            xp: 34,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-02T00:00:00Z',
            guild_id: 5,
            guild_name: 'Keepers',
            guild_rank: 'officer',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ total: 1 }] });

    const page = await listCharacters('', 'name', 'asc', 1, 25);

    expect(page.rows[0]).toMatchObject({
      guildId: 5,
      guildName: 'Keepers',
      guildRank: 'officer',
    });
    expect(mocks.query).toHaveBeenCalledTimes(2);
  });
});
