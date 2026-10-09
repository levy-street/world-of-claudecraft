import { EventEmitter } from 'node:events';
import type { QueryResult } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAccountSettingsTransactionRunner } from '../../server/account_settings_transaction_db';

class Client extends EventEmitter {
  processID = 42;
  statements: string[] = [];
  pendingReject?: (error: Error) => void;
  failure?: Error;
  release = vi.fn((error?: Error | boolean) => {
    if (error instanceof Error) this.pendingReject?.(error);
  });
  async query(sql: string): Promise<QueryResult> {
    this.statements.push(sql);
    if (sql === 'SELECT hang')
      return new Promise((_resolve, reject) => {
        this.pendingReject = reject;
      });
    if (sql === 'SELECT fail') throw this.failure;
    return { command: '', rowCount: 0, rows: [], fields: [], oid: 0 };
  }
}
function fixture() {
  const client = new Client();
  const cancel = vi.fn(async () => {});
  const pool = { connect: vi.fn(async () => client), query: vi.fn(async () => {}) };
  return { client, cancel, pool, run: createAccountSettingsTransactionRunner(pool, cancel) };
}
afterEach(() => vi.useRealTimers());
describe('account settings transaction bounds', () => {
  it('sets all bounds, commits and returns the clean client exactly once', async () => {
    const { client, run, cancel } = fixture();
    expect(
      await run(2_000, async (query) => {
        await query('SELECT 1');
        return 'ok';
      }),
    ).toBe('ok');
    expect(client.statements).toEqual([
      'BEGIN',
      'SET LOCAL statement_timeout = 2000',
      'SET LOCAL lock_timeout = 1000',
      'SET LOCAL idle_in_transaction_session_timeout = 3000',
      'SELECT 1',
      'COMMIT',
    ]);
    expect(client.release).toHaveBeenCalledExactlyOnceWith();
    expect(client.listenerCount('error')).toBe(0);
    expect(cancel).not.toHaveBeenCalled();
  });
  it('rolls back server refusals and returns a reusable client', async () => {
    const { client, run } = fixture();
    client.failure = Object.assign(new Error('locked'), { code: '55P03' });
    await expect(run(2_000, (query) => query('SELECT fail'))).rejects.toMatchObject({
      code: '55P03',
    });
    expect(client.statements.at(-1)).toBe('ROLLBACK');
    expect(client.release).toHaveBeenCalledExactlyOnceWith();
    expect(client.listenerCount('error')).toBe(0);
  });
  it('wall deadline destroys stalled client and actively cancels the backend once', async () => {
    vi.useFakeTimers();
    const { client, run, cancel } = fixture();
    const pending = run(2_000, (query) => query('SELECT hang'));
    const assertion = expect(pending).rejects.toMatchObject({
      name: 'DbTransactionDeadlineExceeded',
    });
    await vi.advanceTimersByTimeAsync(3_000);
    await assertion;
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledExactlyOnceWith(42);
    expect(client.statements).not.toContain('ROLLBACK');
    expect(client.listenerCount('error')).toBe(0);
  });
});
