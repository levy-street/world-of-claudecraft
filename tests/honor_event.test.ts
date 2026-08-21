import { describe, expect, it } from 'vitest';
import {
  DOUBLE_HONOR_MULTIPLIER,
  DOUBLE_HONOR_WEEKDAYS,
  doubleHonorActive,
  honorEventMultiplier,
  weekdayOfDayKey,
} from '../src/sim/pvp';

describe('weekdayOfDayKey', () => {
  it('matches the Gregorian calendar, leap days included', () => {
    // Pinned against known dates (0=Sunday..6=Saturday).
    expect(weekdayOfDayKey('2026-08-15')).toBe(6); // Saturday
    expect(weekdayOfDayKey('2026-08-16')).toBe(0); // Sunday
    expect(weekdayOfDayKey('2026-08-19')).toBe(3); // Wednesday
    expect(weekdayOfDayKey('2026-01-01')).toBe(4); // Thursday
    expect(weekdayOfDayKey('2024-02-29')).toBe(4); // leap day, a Thursday
    expect(weekdayOfDayKey('2024-03-01')).toBe(5); // and the Friday after it
    expect(weekdayOfDayKey('2000-02-29')).toBe(2); // century leap day, a Tuesday
    expect(weekdayOfDayKey('1999-12-31')).toBe(5); // Friday
  });

  it('agrees with the platform calendar across a whole leap year', () => {
    // The arithmetic twin must agree with Date.getUTCDay on every day of 2024.
    // (Tests may read Date; the sim itself must not, which is why the
    // arithmetic version exists.)
    for (let i = 0; i < 366; i++) {
      const d = new Date(Date.UTC(2024, 0, 1 + i));
      const iso = d.toISOString().slice(0, 10);
      expect(weekdayOfDayKey(iso), iso).toBe(d.getUTCDay());
    }
  });

  it('rejects non-keys with -1, the empty no-calendar key included', () => {
    const bad = [
      '',
      '2026-8-15',
      '2026-08-15T00:00:00Z',
      'saturday',
      '2026-13-01',
      '2026-00-10',
      '2026-01-00',
      '2026-01-32',
    ];
    for (const key of bad) {
      expect(weekdayOfDayKey(key), JSON.stringify(key)).toBe(-1);
    }
  });
});

describe('weekly Double Honor window', () => {
  it('opens on Saturday and Sunday reset days and only there', () => {
    // The two weekend RESET WINDOWS: in realm time the event runs Saturday
    // 3 AM through Monday 3 AM.
    expect(DOUBLE_HONOR_WEEKDAYS).toEqual([6, 0]);
    expect(doubleHonorActive('2026-08-15')).toBe(true); // a Saturday
    expect(doubleHonorActive('2026-08-16')).toBe(true); // its Sunday
    const weekdays = ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21'];
    for (const day of weekdays) {
      expect(doubleHonorActive(day), day).toBe(false);
    }
    expect(doubleHonorActive('2026-08-22')).toBe(true); // the next Saturday
    // A host that set no calendar never runs the event, so headless runs,
    // replays, and parity traces stay byte-identical to what they were.
    expect(doubleHonorActive('')).toBe(false);
  });

  it('multiplies by the event constant inside the window and by 1 outside it', () => {
    expect(DOUBLE_HONOR_MULTIPLIER).toBe(2);
    expect(honorEventMultiplier('2026-08-15')).toBe(DOUBLE_HONOR_MULTIPLIER);
    expect(honorEventMultiplier('2026-08-16')).toBe(DOUBLE_HONOR_MULTIPLIER);
    expect(honorEventMultiplier('2026-08-14')).toBe(1); // the Friday before
    expect(honorEventMultiplier('2026-08-17')).toBe(1); // the Monday after
    expect(honorEventMultiplier('')).toBe(1);
  });

  it('is deterministic: the same key always answers the same way', () => {
    const run = () =>
      ['2026-08-15', '2026-08-16', ''].map((key) => [
        weekdayOfDayKey(key),
        doubleHonorActive(key),
        honorEventMultiplier(key),
      ]);
    expect(run()).toEqual(run());
  });
});
