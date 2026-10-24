import { describe, expect, it } from 'vitest';
import {
  applyBuildTransform,
  buildTransformActionForKey,
} from '../src/editor/build_transform_core';

describe('build transform actions', () => {
  it('rotates an existing angle by 45 degrees and wraps at a full turn', () => {
    const original = { rotY: 0, scale: 3 };
    const left = applyBuildTransform(original, 'rotateLeft');
    expect(left.rotY).toBeCloseTo((Math.PI * 7) / 4);
    expect(left.scale).toBe(3);
    const right = applyBuildTransform(left, 'rotateRight');
    expect(right.rotY).toBeCloseTo(0);
    expect(original).toEqual({ rotY: 0, scale: 3 });
    expect(applyBuildTransform({ rotY: 0.1, scale: 1 }, 'rotateRight').rotY).toBeCloseTo(
      0.1 + Math.PI / 4,
    );
  });

  it('uses 15-degree steps when fine rotation is enabled', () => {
    const current = { rotY: Math.PI, scale: 2 };
    expect(applyBuildTransform(current, 'rotateLeft', true).rotY).toBeCloseTo((Math.PI * 11) / 12);
    expect(applyBuildTransform(current, 'rotateRight', true).rotY).toBeCloseTo((Math.PI * 13) / 12);
  });

  it('resizes in 10% steps without changing rotation', () => {
    const current = { rotY: 0.7, scale: 1 };
    expect(applyBuildTransform(current, 'larger')).toEqual({ rotY: 0.7, scale: 1.1 });
    expect(applyBuildTransform({ ...current, scale: 1.1 }, 'smaller')).toEqual(current);
  });

  it('clamps resize to the existing placement limits', () => {
    expect(applyBuildTransform({ rotY: 0, scale: 49.9 }, 'larger').scale).toBe(50);
    expect(applyBuildTransform({ rotY: 0, scale: 0.21 }, 'smaller').scale).toBe(0.2);
    expect(applyBuildTransform({ rotY: 0, scale: 50 }, 'larger').scale).toBe(50);
    expect(applyBuildTransform({ rotY: 0, scale: 0.2 }, 'smaller').scale).toBe(0.2);
  });
});

describe('build transform key routing', () => {
  it.each([
    [',', 'rotateLeft'],
    ['.', 'rotateRight'],
    ['[', 'smaller'],
    [']', 'larger'],
  ] as const)('maps %s to %s', (key, expected) => {
    expect(buildTransformActionForKey({ key })).toBe(expected);
  });

  it.each([
    'typing',
    'isComposing',
    'defaultPrevented',
    'altKey',
    'ctrlKey',
    'metaKey',
    'shiftKey',
  ] as const)('does not intercept shortcuts when %s is true', (flag) => {
    for (const key of [',', '.', '[', ']']) {
      expect(buildTransformActionForKey({ key, [flag]: true })).toBeNull();
    }
  });

  it('leaves camera, history, tool, and modified punctuation keys alone', () => {
    for (const key of ['w', 'q', 'z', 'r', '1', 'Escape', '<', '>', '{', '}']) {
      expect(buildTransformActionForKey({ key })).toBeNull();
    }
  });
});
