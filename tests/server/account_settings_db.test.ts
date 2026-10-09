import type { QueryResult } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { createAccountSettingsDb } from '../../server/account_settings_db';
import type { AccountSettingsTransactionRunner } from '../../server/account_settings_transaction_db';

function fixture(counts: number[]) {
  const query = vi.fn(
    async (_text: string, _values?: unknown[]): Promise<QueryResult> => ({
      command: '',
      rowCount: counts.shift() ?? 0,
      rows: [],
      fields: [],
      oid: 0,
    }),
  );
  const run: AccountSettingsTransactionRunner = (_timeout, fn) => fn(query);
  return { query, db: createAccountSettingsDb(run) };
}
describe('account settings migration acknowledgment', () => {
  it('returns an existing acknowledgment with one indexed read', async () => {
    const { query, db } = fixture([1]);
    expect(await db.acknowledged(7)).toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1]).toEqual([7]);
  });
  it('durably autoacknowledges an account with no characters', async () => {
    const { query, db } = fixture([0, 1]);
    expect(await db.acknowledged(7)).toBe(true);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][0]).toContain('NOT EXISTS');
    expect(query.mock.calls[1][0]).toContain('characters WHERE account_id = $1');
    expect(query.mock.calls[1][1]).toEqual([7]);
  });
  it('keeps existing characters and missing accounts behind the warning', async () => {
    const { query, db } = fixture([0, 0]);
    expect(await db.acknowledged(7)).toBe(false);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][0]).toContain('FROM accounts WHERE id = $1');
  });
});
