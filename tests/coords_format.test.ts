import { describe, it, expect } from 'vitest';
import { formatMinimapCoords } from '../src/ui/coords';

describe('formatMinimapCoords', () => {
  it('floors both axes to whole yards', () => {
    expect(formatMinimapCoords(52.9, 18.1)).toBe('52, 18');
  });

  it('handles the origin', () => {
    expect(formatMinimapCoords(0, 0)).toBe('0, 0');
  });

  it('floors toward negative infinity for negative coordinates', () => {
    expect(formatMinimapCoords(-3.2, -0.5)).toBe('-4, -1');
  });

  it('falls back to 0 for non-finite inputs', () => {
    expect(formatMinimapCoords(NaN, Infinity)).toBe('0, 0');
  });
});
