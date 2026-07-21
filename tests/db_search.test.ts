import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgres://test/test';
  return { query: vi.fn() };
});

vi.mock('pg', () => ({
  Pool: vi.fn(function Pool() {
    return { query: dbMock.query };
  }),
}));

import { SCHEMA, searchCharacters } from '../server/db';
import { SOCIAL_SCHEMA } from '../server/social_db';

beforeEach(() => {
  dbMock.query.mockReset();
});

describe('character typeahead search', () => {
  it('adds the realm column before indexes that depend on it', () => {
    expect(SCHEMA).toContain('ALTER TABLE characters ADD COLUMN IF NOT EXISTS realm');
    expect(SCHEMA.indexOf('ADD COLUMN IF NOT EXISTS realm'))
      .toBeLessThan(SCHEMA.indexOf('CREATE INDEX IF NOT EXISTS characters_lifetime_xp'));
  });

  it('creates a realm-scoped lower-name prefix index', () => {
    expect(SOCIAL_SCHEMA).toContain('CREATE INDEX IF NOT EXISTS characters_realm_lower_name_prefix');
    expect(SOCIAL_SCHEMA).toContain('ON characters (realm, lower(name) text_pattern_ops)');
  });

  it('enforces case-insensitive character-name uniqueness per realm', () => {
    expect(SOCIAL_SCHEMA).toContain('CREATE UNIQUE INDEX IF NOT EXISTS characters_realm_lower_name_unique');
    expect(SOCIAL_SCHEMA).toContain('ON characters (realm, lower(name))');
  });

  it('renames existing case-colliding characters before adding the folded unique index', () => {
    expect(SOCIAL_SCHEMA).toContain('dedupe case-insensitive character names before adding the unique index');
    expect(SOCIAL_SCHEMA).toContain('row_number() OVER (PARTITION BY realm, lower(name) ORDER BY created_at, id)');
    expect(SOCIAL_SCHEMA).toContain('force_rename = TRUE');
    expect(SOCIAL_SCHEMA.indexOf('dedupe case-insensitive character names before adding the unique index'))
      .toBeLessThan(SOCIAL_SCHEMA.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS characters_realm_lower_name_unique'));
  });

  it('uses the lower-name prefix predicate and preserves wildcard escaping', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [{ name: 'Al%_', cls: 'mage', level: 12 }] });

    await expect(searchCharacters('  Al%_  ', 99)).resolves.toEqual([{ name: 'Al%_', cls: 'mage', level: 12 }]);

    const [sql, params] = dbMock.query.mock.calls[0];
    expect(sql).toContain('lower(name) LIKE lower($2)');
    expect(sql).toContain("ESCAPE '\\'");
    expect(sql).toContain('ORDER BY name LIMIT $3');
    expect(params).toEqual([expect.any(String), 'Al\\%\\_%', 20]);
  });

  it('keeps the search limit clamped to at least one', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [] });

    await searchCharacters('Bet', 0);

    expect(dbMock.query.mock.calls[0][1][2]).toBe(1);
  });
});
