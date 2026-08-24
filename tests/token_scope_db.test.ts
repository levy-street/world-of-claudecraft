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

/** A live expiry: the SQL qual only returns unexpired rows, so the mocked row
 *  carries one (the read-time re-check in tokenInfoFromRow sees it). */
const LIVE_EXPIRY = new Date(Date.now() + 60 * 60 * 1000).toISOString();

describe('accountAndScopeForToken', () => {
  it.each([
    ['full', { accountId: 7, scope: 'full' }],
    ['read', { accountId: 7, scope: 'read' }],
    ['write', null],
    ['FULL', null],
    [null, null],
  ])('decodes database scope %j fail closed', async (scope, expected) => {
    dbMock.query.mockResolvedValueOnce({
      rows: [{ account_id: 7, scope, expires_at: LIVE_EXPIRY }],
    });

    await expect(accountAndScopeForToken('a'.repeat(64))).resolves.toEqual(expected);
  });

  // The read-time expiry belt (tokenInfoFromRow): the SQL qual already
  // excludes expired rows, but a row that somehow arrives past its expiry
  // (the cached arm's whole hazard; here, a defensive arm on the direct
  // path) must fail closed rather than authenticate on the qual's word.
  it.each([
    ['a past expiry', new Date(Date.now() - 1000).toISOString()],
    ['a null expiry', null],
  ])('refuses a returned row carrying %s', async (_label, expiresAt) => {
    dbMock.query.mockResolvedValueOnce({
      rows: [{ account_id: 7, scope: 'full', expires_at: expiresAt }],
    });

    await expect(accountAndScopeForToken('a'.repeat(64))).resolves.toBeNull();
  });
});
