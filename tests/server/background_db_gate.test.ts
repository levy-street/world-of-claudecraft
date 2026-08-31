import { describe, expect, it } from 'vitest';
import {
  BACKGROUND_DB_MAJOR_PRODUCER_HEADROOM,
  backgroundDbCapacity,
  createBackgroundDbGate,
} from '../../server/background_db_gate';

describe('background DB gate', () => {
  it('caps named major producers below the default pool maximum', () => {
    // Pool 10 minus the three reserved clients (two interactive, one for the
    // process-global bank-ledger FIFO tail that checks out OUTSIDE the gate).
    expect(BACKGROUND_DB_MAJOR_PRODUCER_HEADROOM).toBe(3);
    expect(backgroundDbCapacity(10)).toBe(7);
    const gate = createBackgroundDbGate(10);
    const holds = Array.from({ length: 7 }, () => gate.tryAcquire());
    expect(holds.every(Boolean)).toBe(true);
    expect(gate.tryAcquire()).toBeNull();
    expect(gate.stats()).toMatchObject({
      inFlight: 7,
      max: 7,
      configuredHeadroom: 3,
      refused: 1,
    });
    for (const hold of holds) hold?.release();
    expect(gate.stats().inFlight).toBe(0);
  });

  it('keeps one durability lane on undersized pools and reports composition headroom', () => {
    // At a pool of ONE the reserve vanishes: the single durability lane IS
    // the only client, so a granted permit can hold it against interactive
    // checkouts and the ledger tail alike (documented at the capacity floor).
    expect(backgroundDbCapacity(1)).toBe(1);
    expect(backgroundDbCapacity(2)).toBe(1);
    expect(backgroundDbCapacity(4)).toBe(1);
    expect(createBackgroundDbGate(1).stats()).toMatchObject({ max: 1, configuredHeadroom: 0 });
    expect(createBackgroundDbGate(2).stats()).toMatchObject({ max: 1, configuredHeadroom: 1 });
    expect(createBackgroundDbGate(3).stats()).toMatchObject({ max: 1, configuredHeadroom: 2 });
    expect(createBackgroundDbGate(4).stats()).toMatchObject({ max: 1, configuredHeadroom: 3 });
    expect(createBackgroundDbGate(5).stats()).toMatchObject({ max: 2, configuredHeadroom: 3 });
  });

  it('grants asynchronous waiters in FIFO order', async () => {
    const gate = createBackgroundDbGate(3);
    const first = gate.tryAcquire();
    expect(first).not.toBeNull();
    const order: string[] = [];
    const second = gate.acquire().then((hold) => {
      order.push('second');
      return hold;
    });
    const third = gate.acquire().then((hold) => {
      order.push('third');
      return hold;
    });
    expect(gate.stats().waiting).toBe(2);
    // Request-path admission must not cut in front of queued background work.
    expect(gate.tryAcquire()).toBeNull();
    first?.release();
    const secondHold = await second;
    expect(order).toEqual(['second']);
    secondHold?.release();
    const thirdHold = await third;
    expect(order).toEqual(['second', 'third']);
    thirdHold?.release();
  });

  it('unlinks an aborted waiter without consuming or leaking capacity', async () => {
    const gate = createBackgroundDbGate(3);
    const head = gate.tryAcquire();
    const controller = new AbortController();
    const cancelled = gate.acquire(controller.signal);
    const survivor = gate.acquire();
    controller.abort();
    expect(await cancelled).toBeNull();
    expect(gate.stats()).toMatchObject({ inFlight: 1, waiting: 1, cancelled: 1 });
    head?.release();
    const survivorHold = await survivor;
    expect(survivorHold).not.toBeNull();
    survivorHold?.release();
    expect(gate.stats()).toMatchObject({ inFlight: 0, waiting: 0 });
  });

  it('refuses an already-aborted acquire before allocating or queueing a permit', async () => {
    const gate = createBackgroundDbGate(3);
    const controller = new AbortController();
    controller.abort();

    await expect(gate.acquire(controller.signal)).resolves.toBeNull();
    expect(gate.stats()).toMatchObject({
      inFlight: 0,
      waiting: 0,
      acquired: 0,
      cancelled: 1,
    });

    const live = gate.tryAcquire();
    expect(live).not.toBeNull();
    live?.release();
  });

  it('makes permit release idempotent', () => {
    const gate = createBackgroundDbGate(3);
    const hold = gate.tryAcquire();
    hold?.release();
    hold?.release();
    expect(gate.stats().inFlight).toBe(0);
    expect(gate.tryAcquire()).not.toBeNull();
  });
});
