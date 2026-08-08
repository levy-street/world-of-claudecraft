// The character sheet's Time Played pure core: the parts split and the
// two-coarsest-units shape pick (src/ui/playtime_view.ts). The localized
// composition over these lives in char_window.ts playtimeText and is pinned in
// tests/char_window.test.ts; this suite pins the math alone.

import { describe, expect, it } from 'vitest';
import { playtimeParts, playtimeShape } from '../src/ui/playtime_view';

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86_400;

describe('playtimeParts', () => {
  it('splits whole days/hours/minutes, flooring the sub-minute tail', () => {
    expect(playtimeParts(0)).toEqual({ days: 0, hours: 0, minutes: 0 });
    expect(playtimeParts(59.9)).toEqual({ days: 0, hours: 0, minutes: 0 });
    expect(playtimeParts(MINUTE)).toEqual({ days: 0, hours: 0, minutes: 1 });
    expect(playtimeParts(HOUR - 1)).toEqual({ days: 0, hours: 0, minutes: 59 });
    expect(playtimeParts(HOUR)).toEqual({ days: 0, hours: 1, minutes: 0 });
    expect(playtimeParts(DAY - 1)).toEqual({ days: 0, hours: 23, minutes: 59 });
    expect(playtimeParts(DAY)).toEqual({ days: 1, hours: 0, minutes: 0 });
    expect(playtimeParts(12 * DAY + 5 * HOUR + 31 * MINUTE + 59)).toEqual({
      days: 12,
      hours: 5,
      minutes: 31,
    });
  });

  it('floors, never rounds up (an accumulator must not overstate)', () => {
    // 1 second shy of the next minute stays on the lower minute.
    expect(playtimeParts(2 * MINUTE - 1).minutes).toBe(1);
    // 1 second shy of the next hour stays on 59 minutes.
    expect(playtimeParts(HOUR - 1).hours).toBe(0);
  });

  it('degrades negative and non-finite input to zero', () => {
    expect(playtimeParts(-90)).toEqual({ days: 0, hours: 0, minutes: 0 });
    expect(playtimeParts(Number.NaN)).toEqual({ days: 0, hours: 0, minutes: 0 });
    expect(playtimeParts(Number.POSITIVE_INFINITY)).toEqual({ days: 0, hours: 0, minutes: 0 });
  });
});

describe('playtimeShape', () => {
  it('picks the two coarsest non-zero units, dropping a zero minor unit', () => {
    expect(playtimeShape(0)).toBe('lessThanMinute');
    expect(playtimeShape(59)).toBe('lessThanMinute');
    expect(playtimeShape(MINUTE)).toBe('minutes');
    expect(playtimeShape(HOUR)).toBe('hours');
    expect(playtimeShape(HOUR + MINUTE)).toBe('hoursMinutes');
    expect(playtimeShape(DAY)).toBe('days');
    expect(playtimeShape(DAY + HOUR)).toBe('daysHours');
    // Hours is the only legal minor unit at days scale: leftover minutes with
    // zero whole hours still render the single-unit days shape.
    expect(playtimeShape(DAY + 31 * MINUTE)).toBe('days');
    // A sub-minute tail on a larger total never demotes the shape.
    expect(playtimeShape(DAY + 59)).toBe('days');
  });
});
