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
  });
});
