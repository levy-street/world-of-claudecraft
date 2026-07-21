import { describe, expect, it } from 'vitest';
import { createSerialWriter } from '../server/serial_writer';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('createSerialWriter', () => {
  it('runs writes one at a time in enqueue order, never overlapping', async () => {
    const enqueue = createSerialWriter();
    const order: string[] = [];
    let active = 0;
    let maxActive = 0;
    const work = (id: string, ms: number) => async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, ms));
      order.push(id);
      active--;
    };

    // Enqueue a slow write before a fast one: FIFO must still finish A before B,
    // which is exactly what keeps the last market commit the freshest.
    const a = enqueue(work('A', 20));
    const b = enqueue(work('B', 1));
    await Promise.all([a, b]);

    expect(order).toEqual(['A', 'B']);
    expect(maxActive).toBe(1);
  });

  it('captures the snapshot at write time, so the last commit is the freshest', async () => {
    const enqueue = createSerialWriter();
    let live = 0; // stand-in for the in-memory market, mutated between enqueues
    const committed: number[] = [];
    const save = () => async () => {
      committed.push(live); // read INSIDE the thunk == at execution time
      await tick();
    };

    live = 1;
    const first = enqueue(save());
    live = 2; // a newer mutation lands before the first write executes
    const second = enqueue(save());
    await Promise.all([first, second]);

    // Both writes see the latest value available when they actually run, and the
    // final committed value is the freshest (2), never rolled back to 1.
    expect(committed[committed.length - 1]).toBe(2);
  });

  it('isolates a rejecting write: the caller sees the error, later writes still run', async () => {
    const enqueue = createSerialWriter();
    const done: string[] = [];

    const bad = enqueue(async () => {
      throw new Error('boom');
    });
    const good = enqueue(async () => {
      done.push('good');
    });

    await expect(bad).rejects.toThrow('boom');
    await good;
    expect(done).toEqual(['good']);
  });
});
