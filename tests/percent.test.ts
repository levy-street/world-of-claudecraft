import { describe, expect, it } from 'vitest';
import { pctValue } from '../src/sim/entity';

describe('pctValue', () => {
  it('normalizes percent-style values but keeps exactly 1 as 100 percent', () => {
    expect(pctValue(0.25)).toBe(0.25);
    expect(pctValue(1)).toBe(1);
    expect(pctValue(25)).toBe(0.25);
  });
});
