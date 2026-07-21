import { describe, expect, it } from 'vitest';
import { fieldFilled, fieldNumber } from '../../src/admin/field_input';

describe('fieldFilled', () => {
  it('treats null, undefined, and blank strings as unfilled (use the default)', () => {
    expect(fieldFilled(null)).toBe(false);
    expect(fieldFilled(undefined)).toBe(false);
    expect(fieldFilled('')).toBe(false);
    expect(fieldFilled('   ')).toBe(false);
  });

  it('treats any entered value, including 0, as filled', () => {
    expect(fieldFilled(0)).toBe(true);
    expect(fieldFilled(42)).toBe(true);
    expect(fieldFilled('x')).toBe(true);
  });
});

describe('fieldNumber', () => {
  it('returns numbers as-is', () => {
    expect(fieldNumber(42)).toBe(42);
    expect(fieldNumber(0)).toBe(0);
  });

  it('parses trimmed string input', () => {
    expect(fieldNumber(' 3.5 ')).toBe(3.5);
  });

  it('coerces null/undefined/blank to 0 (nullish becomes an empty string)', () => {
    expect(fieldNumber(null)).toBe(0);
    expect(fieldNumber(undefined)).toBe(0);
    expect(fieldNumber('')).toBe(0);
  });

  it('returns NaN for non-numeric text', () => {
    expect(fieldNumber('abc')).toBeNaN();
  });
});
