import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function lastError(events: SimEvent[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === 'error') return e.text;
  }
  return undefined;
}

function metaOf(sim: Sim, pid: number) {
  return [...sim.players.values()].find((m) => m.entityId === pid)!;
}

describe('/listings command', () => {
  it('reports an empty market presence when you have no listings', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    sim.chat('/listings', a);
    expect(lastError(sim.tick())).toBe('You have no goods on the World Market.');
  });

  it('lists only your own active listings with price and time left', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const _b = sim.addPlayer('mage', 'Bet');
    sim.tick();
    const aName = metaOf(sim, a).name;

    // Two of mine, one belonging to another seller, plus untouchable house stock.
    sim.marketListings.push(
      {
        id: 1,
        sellerKey: aName,
        sellerName: aName,
        itemId: 'worn_sword',
        count: 1,
        price: 150,
        kind: 'fixed',
        durationSeconds: 3600,
        depositPerUnit: 0,
        denom: 'copper' as const,
        expiresAt: sim.time + 3600 + 5,
        house: false,
      },
      {
        id: 2,
        sellerKey: aName,
        sellerName: aName,
        itemId: 'rusty_dagger',
        count: 3,
        price: 20,
        kind: 'fixed',
        durationSeconds: 3600,
        depositPerUnit: 0,
        denom: 'copper' as const,
        expiresAt: sim.time + 120,
        house: false,
      },
      {
        id: 3,
        sellerKey: 'Bet',
        sellerName: 'Bet',
        itemId: 'worn_sword',
        count: 1,
        price: 999,
        kind: 'fixed',
        durationSeconds: 3600,
        depositPerUnit: 0,
        denom: 'copper' as const,
        expiresAt: sim.time + 3600,
        house: false,
      },
      {
        id: 4,
        sellerKey: '',
        sellerName: 'Merchant',
        itemId: 'worn_sword',
        count: 1,
        price: 1,
        kind: 'fixed',
        pricePerUnit: 1,
        durationSeconds: 0,
        depositPerUnit: 0,
        denom: 'copper' as const,
        expiresAt: Infinity,
        house: true,
      },
    );

    sim.chat('/listings', a);
    expect(lastError(sim.tick())).toBe(
      'Your market listings (2/12): Pitted Shortsword — 1s 50c (1h 0m left), Rusty Dagger x3 — 20c (2m left).',
    );
  });

  it('renders an auction lot with its current bid and time left', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    const aName = metaOf(sim, a).name;

    sim.marketListings.push(
      {
        id: 1,
        sellerKey: aName,
        sellerName: aName,
        itemId: 'rusty_dagger',
        count: 2,
        price: 40,
        kind: 'auction',
        startingBid: 40,
        durationSeconds: 3600,
        depositPerUnit: 0,
        denom: 'copper' as const,
        expiresAt: sim.time + 120,
        house: false,
      },
      {
        id: 2,
        sellerKey: aName,
        sellerName: aName,
        itemId: 'worn_sword',
        count: 1,
        price: 100,
        kind: 'auction',
        startingBid: 100,
        bid: { amount: 150, bidderKey: 'b1', bidderName: 'Bet' },
        durationSeconds: 3600,
        depositPerUnit: 0,
        denom: 'copper' as const,
        expiresAt: sim.time + 3600 + 5,
        house: false,
      },
    );

    sim.chat('/listings', a);
    // no bid yet -> the starting bid shows; with a bid -> the standing bid shows
    expect(lastError(sim.tick())).toBe(
      'Your market listings (2/12): Rusty Dagger x2 - bid 40c (2m left), Pitted Shortsword - bid 1s 50c (1h 0m left).',
    );
  });

  it('is self-only and never logged or spoken, via the /auctions alias', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    const result = sim.chat('/auctions', a);
    expect(result).toBeNull();
    expect(sim.tick().some((e) => e.type === 'chat')).toBe(false);
  });
});
