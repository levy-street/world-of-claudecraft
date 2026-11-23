import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_MOUNT_ITEMS_MAX_HYDRATION_TOKENS,
  accountMountItemsHydrationFresh,
  captureAccountMountItemsHydration,
  invalidateAccountMountItemsHydration,
} from '../server/account_mount_items_hydration';

describe('account mount item handshake fences', () => {
  it('pins the literal retained account-token budget', () => {
    expect(ACCOUNT_MOUNT_ITEMS_MAX_HYDRATION_TOKENS).toBe(4_096);
  });
  it('captures before SQL completion and invalidates only the affected account', () => {
    const complete = captureAccountMountItemsHydration(100);
    invalidateAccountMountItemsHydration(101);
    const rows = complete([]);
    expect(accountMountItemsHydrationFresh(100, rows)).toBe(true);
    expect(accountMountItemsHydrationFresh(101, rows)).toBe(false);
    invalidateAccountMountItemsHydration(100);
    expect(accountMountItemsHydrationFresh(100, rows)).toBe(false);
    const delayed = captureAccountMountItemsHydration(100);
    invalidateAccountMountItemsHydration(100);
    expect(accountMountItemsHydrationFresh(100, delayed([]))).toBe(false);
    expect(accountMountItemsHydrationFresh(100, captureAccountMountItemsHydration(100)([]))).toBe(
      true,
    );
  });

  it('safely invalidates held row arrays when the bounded token index evicts their account', () => {
    const held = captureAccountMountItemsHydration(200)([]);
    for (let index = 0; index < ACCOUNT_MOUNT_ITEMS_MAX_HYDRATION_TOKENS; index++) {
      invalidateAccountMountItemsHydration(100_000 + index);
    }
    expect(accountMountItemsHydrationFresh(200, held)).toBe(false);
    expect(accountMountItemsHydrationFresh(200, captureAccountMountItemsHydration(200)([]))).toBe(
      true,
    );
  });
});
