import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({ runWithStatementTimeout: vi.fn() }));

import type { AccountMountItemsRow } from '../server/account_mount_items_core';
import {
  ACCOUNT_MOUNT_ITEMS_MAX_PENDING,
  ACCOUNT_MOUNT_ITEMS_MAX_READS,
  ACCOUNT_MOUNT_ITEMS_QUEUE_TIMEOUT_MS,
  createAccountMountItemsLoader,
} from '../server/account_mount_items_loader';

const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('shared mount item SQL budget', () => {
  it('pins literal SQL concurrency, queue size, and default queue deadline budgets', () => {
    expect(ACCOUNT_MOUNT_ITEMS_MAX_READS).toBe(4);
    expect(ACCOUNT_MOUNT_ITEMS_MAX_PENDING).toBe(512);
    expect(ACCOUNT_MOUNT_ITEMS_QUEUE_TIMEOUT_MS).toBe(2_000);
  });
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('applies the default deadline at exactly two seconds of queue wait', async () => {
    const raw = vi.fn(() => new Promise<AccountMountItemsRow[]>(() => {}));
    const read = createAccountMountItemsLoader(raw);
    for (let id = 1; id <= 4; id++) void read(id);
    const rejected = vi.fn();
    const queued = read(5);
    void queued.catch(rejected);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(rejected).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(rejected).toHaveBeenCalledTimes(1);
    await expect(queued).rejects.toThrow('queue timed out');
    expect(raw).toHaveBeenCalledTimes(4);
  });

  it('expires queued flights before SQL starts and permits a later retry', async () => {
    const resolvers = new Map<number, (rows: AccountMountItemsRow[]) => void>();
    const raw = vi.fn(
      (accountId: number) =>
        new Promise<AccountMountItemsRow[]>((resolve) => {
          resolvers.set(accountId, resolve);
        }),
    );
    const read = createAccountMountItemsLoader(raw, { queueTimeoutMs: 100 });
    for (let id = 1; id <= 4; id++) void read(id);
    const queued = read(5);
    expect(read(5)).toBe(queued);
    const expired = expect(queued).rejects.toThrow('queue timed out');
    await vi.advanceTimersByTimeAsync(100);
    await expired;
    expect(raw).toHaveBeenCalledTimes(4);
    const resolve = resolvers.get(1);
    if (!resolve) throw new Error('missing first flight');
    resolve([]);
    await settle();
    expect(raw).toHaveBeenCalledTimes(4);
    const retry = read(5);
    expect(retry).not.toBe(queued);
    expect(raw.mock.calls.at(-1)?.[0]).toBe(5);
    expect(raw).toHaveBeenCalledTimes(5);
    // The queue deadline is removed when an account begins its SQL work.
    await vi.advanceTimersByTimeAsync(1000);
    const finish = resolvers.get(5);
    if (!finish) throw new Error('missing retry flight');
    finish([]);
    expect(await retry).toEqual([]);
  });
  it('coalesces joins and periodic reads and caps their combined active and queued account count', async () => {
    const resolvers = new Map<number, (rows: AccountMountItemsRow[]) => void>();
    const raw = vi.fn(
      (accountId: number) =>
        new Promise<AccountMountItemsRow[]>((resolve) => {
          resolvers.set(accountId, resolve);
        }),
    );
    const read = createAccountMountItemsLoader(raw);
    const first = read(1);
    expect(read(1)).toBe(first);
    const flights = [first];
    for (let id = 2; id <= 4 + ACCOUNT_MOUNT_ITEMS_MAX_PENDING; id++) flights.push(read(id));
    expect(raw).toHaveBeenCalledTimes(4);
    expect(read(1)).toBe(first);
    expect(read(5)).toBe(flights[4]);
    await expect(read(5 + ACCOUNT_MOUNT_ITEMS_MAX_PENDING)).rejects.toThrow('queue is full');
    const resolve = resolvers.get(1);
    if (!resolve) throw new Error('missing first flight');
    resolve([]);
    await settle();
    expect(raw).toHaveBeenCalledTimes(5);
    expect(raw.mock.calls.at(-1)?.[0]).toBe(5);
    // Saturation is retryable once a pending slot has started.
    void read(5 + ACCOUNT_MOUNT_ITEMS_MAX_PENDING);
  });

  it('releases failed flights for retries without caching stale ownership', async () => {
    const raw = vi.fn().mockRejectedValueOnce(new Error('database down')).mockResolvedValue([]);
    const read = createAccountMountItemsLoader(raw);
    const first = read(1);
    expect(read(1)).toBe(first);
    await expect(first).rejects.toThrow('database down');
    expect(await read(1)).toEqual([]);
    expect(raw).toHaveBeenCalledTimes(2);
    expect(await read(1)).toEqual([]);
    expect(raw).toHaveBeenCalledTimes(3);
  });
});
