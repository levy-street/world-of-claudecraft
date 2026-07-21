import { describe, expect, it } from 'vitest';
import { forEachGuarded, runGuarded } from '../server/guarded_iter';

describe('forEachGuarded', () => {
  it('runs the body for every item', () => {
    const seen: number[] = [];
    forEachGuarded(
      [1, 2, 3],
      (n) => seen.push(n),
      () => {},
    );
    expect(seen).toEqual([1, 2, 3]);
  });

  it('keeps processing the remaining items when one body throws', () => {
    // The bug: one player's bad state must not starve every other session of its
    // snapshot/events for the tick. A throw on item 2 must not stop items 1 and 3.
    const seen: number[] = [];
    const errors: Array<{ item: number }> = [];
    forEachGuarded(
      [1, 2, 3],
      (n) => {
        if (n === 2) throw new Error('boom');
        seen.push(n);
      },
      (_err, item) => errors.push({ item }),
    );
    expect(seen).toEqual([1, 3]);
    expect(errors).toEqual([{ item: 2 }]);
  });

  it('isolates every item even when several throw', () => {
    const seen: number[] = [];
    const errored: number[] = [];
    forEachGuarded(
      [1, 2, 3, 4],
      (n) => {
        if (n % 2 === 0) throw new Error(`boom ${n}`);
        seen.push(n);
      },
      (_err, item) => errored.push(item),
    );
    expect(seen).toEqual([1, 3]);
    expect(errored).toEqual([2, 4]);
  });

  it('passes the offending item and the thrown error to onError', () => {
    let capturedErr: unknown = null;
    let capturedItem: string | null = null;
    forEachGuarded(
      ['ok', 'bad'],
      (s) => {
        if (s === 'bad') throw new Error('detail');
      },
      (err, item) => {
        capturedErr = err;
        capturedItem = item;
      },
    );
    expect((capturedErr as Error).message).toBe('detail');
    expect(capturedItem).toBe('bad');
  });
});

describe('runGuarded', () => {
  it('runs the body and swallows nothing on success', () => {
    let ran = false;
    let errored = false;
    runGuarded(
      () => {
        ran = true;
      },
      () => {
        errored = true;
      },
    );
    expect(ran).toBe(true);
    expect(errored).toBe(false);
  });

  it('routes a thrown error to onError instead of propagating', () => {
    let captured: unknown = null;
    expect(() =>
      runGuarded(
        () => {
          throw new Error('tick blew up');
        },
        (err) => {
          captured = err;
        },
      ),
    ).not.toThrow();
    expect((captured as Error).message).toBe('tick blew up');
  });
});
