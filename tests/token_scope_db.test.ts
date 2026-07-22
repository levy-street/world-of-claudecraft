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

import { accountAndScopeForToken } from '../server/db';

beforeEach(() => {
  dbMock.query.mockReset();
});

describe('accountAndScopeForToken', () => {
  it.each([
    ['full', { accountId: 7, scope: 'full' }],
    ['read', { accountId: 7, scope: 'read' }],
    ['write', null],
    ['FULL', null],
    [null, null],
  ])('decodes database scope %j fail closed', async (scope, expected) => {
    dbMock.query.mockResolvedValueOnce({
      rows: [{ account_id: 7, scope }],
    });

    await expect(accountAndScopeForToken('a'.repeat(64))).resolves.toEqual(expected);
  });
});
