import { describe, expect, it } from 'vitest';
import { dodgeVisualDirection } from '../src/render/dodge_visual_core';

describe('dodge visual direction', () => {
  it('maps authoritative world vectors relative to facing', () => {
    expect(dodgeVisualDirection(0, 1, 0)).toBe('forward');
    expect(dodgeVisualDirection(0, -1, 0)).toBe('back');
    expect(dodgeVisualDirection(-1, 0, 0)).toBe('right');
    expect(dodgeVisualDirection(1, 0, 0)).toBe('left');
  });

  it('rotates the mapping with the actor and falls back safely', () => {
    expect(dodgeVisualDirection(1, 0, Math.PI / 2)).toBe('forward');
    expect(dodgeVisualDirection(Number.NaN, 0, 0)).toBe('forward');
    expect(dodgeVisualDirection(0, 0, 0)).toBe('forward');
  });
});
