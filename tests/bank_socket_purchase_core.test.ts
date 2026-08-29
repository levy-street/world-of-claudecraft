import { describe, expect, it, vi } from 'vitest';
import {
  BankSocketPurchaseCore,
  type BankSocketPurchaseSnapshot,
} from '../src/ui/bank_socket_purchase_core';

function core(onTimeout = vi.fn()): BankSocketPurchaseCore {
  let nextTimer = 0;
  const timers = new Map<number, () => void>();
  return new BankSocketPurchaseCore(
    {
      schedule: (callback) => {
        nextTimer += 1;
        timers.set(nextTimer, callback);
        return nextTimer;
      },
      cancel: (handle) => {
        timers.delete(handle);
      },
    },
    onTimeout,
  );
}

const snapshot = (over: Partial<BankSocketPurchaseSnapshot> = {}): BankSocketPurchaseSnapshot => ({
  socketsUnlocked: 0,
  nextSocketCost: 1_000_000,
  ...over,
});

describe('BankSocketPurchaseCore', () => {
  it('arms only a still-current revision and price, then rejects duplicate confirmation as pending', () => {
    const purchase = core();
    const offer = { socketsUnlocked: 0, cost: 1_000_000 };

    expect(purchase.confirm(offer, snapshot())).toBe('send');
    expect(purchase.pending).toBe(true);
    expect(purchase.confirm(offer, snapshot())).toBe('pending');
  });

  it.each([
    { name: 'missing mirror', current: null },
    { name: 'advanced revision', current: snapshot({ socketsUnlocked: 1 }) },
    { name: 'changed price', current: snapshot({ nextSocketCost: 1_500_000 }) },
  ])('requires fresh consent for a $name', ({ current }) => {
    const purchase = core();
    expect(purchase.confirm({ socketsUnlocked: 0, cost: 1_000_000 }, current)).toBe('changed');
    expect(purchase.pending).toBe(false);
  });

  it('holds through a stale mirror and releases on the expected or newer authoritative echo', () => {
    const purchase = core();
    expect(purchase.confirm({ socketsUnlocked: 0, cost: 1_000_000 }, snapshot())).toBe('send');
    expect(purchase.observeRevision(0)).toBe(false);
    expect(purchase.pending).toBe(true);
    expect(purchase.observeRevision(2)).toBe(true);
    expect(purchase.pending).toBe(false);
  });

  it('releases only for socket-specific authoritative refusals', () => {
    for (const text of [
      'Your bank has no more bag sockets to unlock.',
      'You cannot afford that bag socket.',
    ]) {
      const purchase = core();
      expect(purchase.confirm({ socketsUnlocked: 0, cost: 1_000_000 }, snapshot())).toBe('send');
      expect(purchase.observeText(text), text).toBe(true);
      expect(purchase.pending).toBe(false);
    }

    const purchase = core();
    expect(purchase.confirm({ socketsUnlocked: 0, cost: 1_000_000 }, snapshot())).toBe('send');
    for (const text of [
      'Not enough money.',
      'You are busy.',
      'You are too far from the banker.',
      'Something unrelated failed.',
    ]) {
      expect(purchase.observeText(text), text).toBe(false);
      expect(purchase.pending).toBe(true);
    }
  });
});
