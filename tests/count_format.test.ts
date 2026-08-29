// The bank family's shared count formatter (src/ui/count_format.ts): a pure
// leaf on the esc.ts shape, deliberately UNREGISTERED in the architecture
// lists (the classification contract's default bucket costs no entry for a
// module that reaches no host, the esc.ts precedent; the bare-named
// triple-registration rule fires only for bare names placed IN
// UI_PURE_CORES). This dedicated test is the leaf's own behavior guard.

import { describe, expect, it } from 'vitest';
import { formatCount } from '../src/ui/count_format';

describe('formatCount', () => {
  it('formats a whole count in the viewer locale with grouping and no fraction digits', () => {
    expect(formatCount(1234)).toBe('1,234');
    expect(formatCount(0)).toBe('0');
    expect(formatCount(40)).toBe('40');
  });

  it('rounds a fractional count instead of rendering decimals', () => {
    // maximumFractionDigits: 0 rounds; a formatter regression to decimals
    // would leak "1,234.6" into every bank-family count readout.
    expect(formatCount(1234.6)).toBe('1,235');
  });
});
