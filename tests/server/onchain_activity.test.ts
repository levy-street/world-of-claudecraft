import { beforeEach, describe, expect, it } from 'vitest';
import {
  drainOnchain,
  enqueueOnchain,
  type OnchainEvent,
  onchainQueueDepth,
  resetOnchainForTests,
} from '../../server/onchain_activity';

function ev(over: Partial<OnchainEvent> = {}): OnchainEvent {
  return {
    kind: 'burn',
    token: 'WOC',
    amountUi: 25000,
    usd: 4.38,
    actor: 'Logan',
    item: null,
    sig: 'a'.repeat(64),
    blockMs: 1_784_462_593_000,
    network: 'mainnet',
    totalBurnedUi: 442072,
    ...over,
  };
}

describe('onchain_activity queue', () => {
  beforeEach(() => resetOnchainForTests());

  it('enqueues and drains in FIFO order', () => {
    expect(enqueueOnchain(ev({ sig: 's1' + 'a'.repeat(62) }), 's1', 1000)).toBe(true);
    expect(enqueueOnchain(ev({ sig: 's2' + 'a'.repeat(62), amountUi: 5000 }), 's2', 1000)).toBe(
      true,
    );
    expect(onchainQueueDepth()).toBe(2);
    const out = drainOnchain();
    expect(out.map((e) => e.amountUi)).toEqual([25000, 5000]);
    expect(onchainQueueDepth()).toBe(0);
    expect(drainOnchain()).toEqual([]);
  });

  it('dedupes by key within the TTL and re-admits after it expires', () => {
    expect(enqueueOnchain(ev(), 'sig-x', 1000)).toBe(true);
    expect(enqueueOnchain(ev(), 'sig-x', 2000)).toBe(false); // within TTL
    expect(onchainQueueDepth()).toBe(1);
    // 10 min + 1 ms later the same signature is allowed again
    expect(enqueueOnchain(ev(), 'sig-x', 1000 + 10 * 60_000 + 1)).toBe(true);
    expect(onchainQueueDepth()).toBe(2);
  });

  it('a null dedupe key never dedupes', () => {
    expect(enqueueOnchain(ev(), null, 1000)).toBe(true);
    expect(enqueueOnchain(ev(), null, 1000)).toBe(true);
    expect(onchainQueueDepth()).toBe(2);
  });

  it('caps the queue so an absent bot cannot grow it unbounded', () => {
    for (let i = 0; i < 250; i++) {
      enqueueOnchain(ev({ amountUi: i }), `k${i}`, 1000 + i);
    }
    expect(onchainQueueDepth()).toBe(200);
    const out = drainOnchain();
    // The oldest 50 were dropped; the newest survivor is amount 249.
    expect(out[0].amountUi).toBe(50);
    expect(out[out.length - 1].amountUi).toBe(249);
  });
});
