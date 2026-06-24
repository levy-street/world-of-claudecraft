import { describe, expect, it } from 'vitest';
import { parseAmountToBase } from '../src/net/wallet_amount';

// Player-to-player transfer amounts are entered as human decimal strings and
// converted to integer base units (BigInt) for the on-chain transfer. The
// conversion must be exact (no float drift) and must reject anything the chain
// would choke on — extra precision, junk, or a non-positive amount.
describe('parseAmountToBase', () => {
  it('converts whole and fractional amounts exactly', () => {
    expect(parseAmountToBase('1', 6)).toBe(1_000_000n);
    expect(parseAmountToBase('1.5', 6)).toBe(1_500_000n);
    expect(parseAmountToBase('0.000001', 6)).toBe(1n);
    expect(parseAmountToBase('1.5', 9)).toBe(1_500_000_000n);
    expect(parseAmountToBase('.5', 6)).toBe(500_000n);
  });

  it('does not lose precision on large amounts (BigInt, not float)', () => {
    // 12,345,678.123456 WOC at 6 decimals would round under Number math.
    expect(parseAmountToBase('12345678.123456', 6)).toBe(12_345_678_123_456n);
  });

  it('pads fractional digits up to the currency precision', () => {
    expect(parseAmountToBase('2.1', 6)).toBe(2_100_000n);
  });

  it('rejects more fractional digits than the currency supports', () => {
    expect(() => parseAmountToBase('1.1234567', 6)).toThrow(/decimal places/);
  });

  it('rejects malformed, empty, and non-positive input', () => {
    expect(() => parseAmountToBase('', 6)).toThrow();
    expect(() => parseAmountToBase('.', 6)).toThrow();
    expect(() => parseAmountToBase('abc', 6)).toThrow();
    expect(() => parseAmountToBase('1.2.3', 6)).toThrow();
    expect(() => parseAmountToBase('-1', 6)).toThrow();
    expect(() => parseAmountToBase('0', 6)).toThrow(/greater than zero/);
    expect(() => parseAmountToBase('0.0', 6)).toThrow(/greater than zero/);
  });
});
