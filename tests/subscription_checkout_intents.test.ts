import { describe, expect, it, vi } from 'vitest';
import { SubscriptionCheckoutIntents } from '../src/ui/subscription_checkout_intents';

describe('subscription checkout retry identity', () => {
  it('isolates two accounts and keeps unscoped legacy sessions entirely ephemeral', () => {
    const values = new Map<string, string>();
    let serial = 0;
    const storage = {
      read: (key: string) => values.get(key) ?? null,
      write: (key: string, value: string) => {
        values.set(key, value);
      },
      remove: (key: string) => {
        values.delete(key);
      },
      mint: () => `intent-${++serial}`,
    };
    const intents = new SubscriptionCheckoutIntents(storage);
    const legacy = intents.start('game_annual');
    expect(values.size).toBe(0);
    expect(new SubscriptionCheckoutIntents(storage).start('game_annual')).not.toBe(legacy);
    intents.scope(41);
    const first = intents.start('game_annual');
    intents.scope(42);
    expect(intents.pending('game_annual')).toBe(false);
    const second = intents.start('game_annual');
    expect(second).not.toBe(first);
    expect(values.get('woc.subscription.41.game_annual.pending')).toBe(first);
    expect(values.get('woc.subscription.42.game_annual.pending')).toBe(second);
    intents.complete('game_annual');
    expect(values.get('woc.subscription.41.game_annual.pending')).toBe(first);
    intents.scope(41);
    expect(intents.pending('game_annual')).toBe(true);
    expect(intents.key('game_annual')).toBe(first);
    intents.scope(undefined);
    expect(intents.pending('game_annual')).toBe(false);
    intents.complete('game_annual');
    expect(values.get('woc.subscription.41.game_annual.pending')).toBe(first);
  });
  it('keeps distinct plans stable across reload and releases only a completed intent', () => {
    const values = new Map<string, string>();
    let serial = 0;
    const storage = {
      read: (key: string) => values.get(key) ?? null,
      write: (key: string, value: string) => {
        values.set(key, value);
      },
      remove: (key: string) => {
        values.delete(key);
      },
      mint: () => `intent-${++serial}`,
    };
    let intents = new SubscriptionCheckoutIntents(storage);
    intents.scope(41);
    const monthly = intents.start('game_monthly');
    const annual = intents.start('game_annual');
    expect(monthly).not.toBe(annual);
    intents = new SubscriptionCheckoutIntents(storage);
    intents.scope(41);
    expect(intents.start('game_monthly')).toBe(monthly);
    expect(intents.start('game_annual')).toBe(annual);
    intents.complete('game_monthly');
    expect(intents.pending('game_annual')).toBe(true);
    expect(intents.key('game_annual')).toBe(annual);
    expect(intents.start('game_monthly')).not.toBe(monthly);
    intents.complete('game_annual');
    expect(intents.pending('game_annual')).toBe(false);
  });
  it('does not send malformed storage identities and tolerates disabled storage', () => {
    let serial = 0;
    const read = vi.fn(() => '<bad>');
    const write = vi.fn(() => {
      throw Error('blocked');
    });
    const remove = vi.fn(() => {
      throw Error('blocked');
    });
    const intents = new SubscriptionCheckoutIntents({
      read,
      write,
      remove,
      mint: () => `valid-${++serial}`,
    });
    intents.scope(41);
    expect(intents.pending('game_annual')).toBe(false);
    const key = intents.start('game_annual');
    expect(key).toBe('valid-1');
    expect(intents.start('game_annual')).toBe(key);
    intents.complete('game_annual');
    expect(intents.start('game_annual')).toBe('valid-2');
    expect(read).toHaveBeenCalledWith('woc.subscription.41.game_annual.pending');
    expect(write).toHaveBeenCalledWith('woc.subscription.41.game_annual.pending', 'valid-1');
    expect(remove).toHaveBeenCalledExactlyOnceWith('woc.subscription.41.game_annual.pending');
  });
  it('keeps a scoped retry identity when reading browser storage throws', () => {
    const read = vi.fn(() => {
      throw Error('blocked');
    });
    const intents = new SubscriptionCheckoutIntents({
      read,
      write: vi.fn(),
      remove: vi.fn(),
      mint: () => 'fresh-intent',
    });
    intents.scope(41);
    expect(intents.pending('game_monthly')).toBe(false);
    expect(intents.start('game_monthly')).toBe('fresh-intent');
    expect(intents.start('game_monthly')).toBe('fresh-intent');
    expect(read).toHaveBeenCalledExactlyOnceWith('woc.subscription.41.game_monthly.pending');
  });
  it('does not reload a completed identity in the same session when removal is blocked', () => {
    const remove = vi.fn(() => {
      throw Error('blocked');
    });
    const intents = new SubscriptionCheckoutIntents({
      read: () => 'closed-intent',
      write: vi.fn(),
      remove,
      mint: () => 'replacement-intent',
    });
    intents.scope(41);
    expect(intents.start('game_annual')).toBe('closed-intent');
    intents.complete('game_annual');
    expect(intents.start('game_annual')).toBe('replacement-intent');
    expect(remove).toHaveBeenCalledExactlyOnceWith('woc.subscription.41.game_annual.pending');
  });
});
