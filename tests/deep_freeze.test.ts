import { describe, expect, it } from 'vitest';
import { deepFreeze } from '../src/sim/deep_freeze';

describe('deepFreeze', () => {
  it('freezes every nested object and array in place and returns the same tree', () => {
    const tree = { a: [1, { b: 2 }], c: { d: [3] }, e: null, f: 'text' };
    expect(deepFreeze(tree)).toBe(tree);
    for (const part of [tree, tree.a, tree.a[1], tree.c, tree.c.d]) {
      expect(Object.isFrozen(part)).toBe(true);
    }
    expect(() => {
      (tree.c.d as number[]).push(4);
    }).toThrow(TypeError);
  });

  it('passes primitives and null through', () => {
    expect(deepFreeze(5)).toBe(5);
    expect(deepFreeze(null)).toBeNull();
    expect(deepFreeze('x')).toBe('x');
  });
});
