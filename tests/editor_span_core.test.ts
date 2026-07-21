import { describe, expect, it } from 'vitest';
import { appendSpan, removeSpan } from '../src/editor/span_core';

interface Stamp {
  x: number;
}

describe('appendSpan / removeSpan (contiguous undo bookkeeping)', () => {
  it('appendSpan returns the start index and appends in order', () => {
    const arr = [{ x: 0 }];
    const items = [{ x: 1 }, { x: 2 }];
    const start = appendSpan(arr, items);
    expect(start).toBe(1);
    expect(arr).toHaveLength(3);
    expect(arr[1]).toBe(items[0]);
    expect(arr[2]).toBe(items[1]);
  });

  it('removeSpan takes the one-splice fast path for the normal undo case', () => {
    const keep: Stamp = { x: 0 };
    const arr = [keep];
    const items = [{ x: 1 }, { x: 2 }, { x: 3 }];
    const start = appendSpan(arr, items);
    removeSpan(arr, start, items);
    expect(arr).toEqual([keep]);
    expect(arr[0]).toBe(keep);
  });

  it('round-trips undo/redo: remove then push restores the same layout', () => {
    const arr: Stamp[] = [{ x: 0 }];
    const items = [{ x: 1 }, { x: 2 }];
    const start = appendSpan(arr, items);
    removeSpan(arr, start, items); // undo
    arr.push(...items); // redo
    expect(arr.map((s) => s.x)).toEqual([0, 1, 2]);
  });

  it('falls back to identity removal when the span has shifted', () => {
    const arr: Stamp[] = [{ x: 0 }];
    const items = [{ x: 1 }, { x: 2 }];
    const start = appendSpan(arr, items);
    arr.splice(0, 1); // something before the span was removed: indices shifted
    removeSpan(arr, start, items);
    expect(arr).toEqual([]);
  });

  it('identity fallback removes the right entries even with equal-shaped stamps', () => {
    const twin1: Stamp = { x: 5 };
    const twin2: Stamp = { x: 5 }; // equal shape, distinct identity
    const arr = [twin1];
    const start = appendSpan(arr, [twin2]);
    arr.unshift({ x: 9 }); // shift so the fast path cannot apply
    removeSpan(arr, start, [twin2]);
    expect(arr).toHaveLength(2);
    expect(arr[1]).toBe(twin1); // the twin that was NOT in the span survives
  });

  it('never splices the wrong span when contents at start do not match', () => {
    const a: Stamp = { x: 1 };
    const b: Stamp = { x: 2 };
    const arr = [a, b];
    removeSpan(arr, 0, [b]); // claims start 0 but arr[0] is a different object
    expect(arr).toEqual([a]);
  });

  it('an empty span is a no-op', () => {
    const arr = [{ x: 1 }];
    removeSpan(arr, 0, []);
    expect(arr).toHaveLength(1);
  });
});
