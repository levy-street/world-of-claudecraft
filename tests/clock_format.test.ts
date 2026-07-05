import { describe, expect, it } from 'vitest';
import { formatClockTime } from '../src/ui/clock';

// Build a Date at a fixed local H:M (date part is irrelevant to the formatter).
const at = (h: number, m: number) => new Date(2026, 0, 1, h, m, 0, 0);

// Pin the locale to en so the snapshot asserts the English readout regardless
// of the runtime's active language (the formatter is locale-aware now).
describe('formatClockTime (en)', () => {
  it('formats 24-hour time with zero-padded hours and minutes', () => {
    expect(formatClockTime(at(8, 5), true, 'en')).toBe('08:05');
    expect(formatClockTime(at(17, 42), true, 'en')).toBe('17:42');
    expect(formatClockTime(at(0, 0), true, 'en')).toBe('00:00');
    expect(formatClockTime(at(23, 9), true, 'en')).toBe('23:09');
  });

  it('formats 12-hour time with AM/PM and unpadded hours', () => {
    expect(formatClockTime(at(8, 5), false, 'en')).toBe('8:05 AM');
    expect(formatClockTime(at(17, 42), false, 'en')).toBe('5:42 PM');
  });

  it('maps midnight and noon to 12 (not 0) in 12-hour mode', () => {
    expect(formatClockTime(at(0, 0), false, 'en')).toBe('12:00 AM');
    expect(formatClockTime(at(12, 30), false, 'en')).toBe('12:30 PM');
  });

  it('keeps minutes zero-padded in both modes', () => {
    expect(formatClockTime(at(9, 3), false, 'en')).toBe('9:03 AM');
    expect(formatClockTime(at(9, 3), true, 'en')).toBe('09:03');
  });
});
