import { describe, expect, it } from 'vitest';
import {
  DOUBLE_HONOR_LEAD_HOURS,
  DOUBLE_HONOR_LEAD_MS,
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
    // The two weekend RESET WINDOWS: with the early open below, in realm time
    // the event runs Friday 3 PM through Monday 3 AM.
    expect(DOUBLE_HONOR_WEEKDAYS).toEqual([6, 0]);
    expect(doubleHonorActive('2026-08-15', '2026-08-15')).toBe(true); // a Saturday
    expect(doubleHonorActive('2026-08-16', '2026-08-16')).toBe(true); // its Sunday
    // Monday through Thursday, both keys inside the same weekday: closed.
    const weekdays = ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20'];
    for (const day of weekdays) {
      expect(doubleHonorActive(day, day), day).toBe(false);
    }
    expect(doubleHonorActive('2026-08-22', '2026-08-22')).toBe(true); // the next Saturday
    // A host that set no calendar never runs the event, so headless runs,
    // replays, and parity traces stay byte-identical to what they were.
    expect(doubleHonorActive('', '')).toBe(false);
  });

  it('opens DOUBLE_HONOR_LEAD_HOURS early, once the lead probe reads Saturday', () => {
    expect(DOUBLE_HONOR_LEAD_HOURS).toBe(12);
    expect(DOUBLE_HONOR_LEAD_MS).toBe(DOUBLE_HONOR_LEAD_HOURS * 3_600_000);
    // Friday 3 PM realm time onward: the reset day still reads Friday but the
    // lead probe has crossed into Saturday, so the window is open.
    expect(doubleHonorActive('2026-08-21', '2026-08-22')).toBe(true);
    // Friday before 3 PM: both keys read Friday, the window is still closed.
    expect(doubleHonorActive('2026-08-21', '2026-08-21')).toBe(false);
    // Sunday evening: the probe already reads Monday, but the reset day holds
    // the window open until Monday's own 3 AM reset (the close is unchanged).
    expect(doubleHonorActive('2026-08-16', '2026-08-17')).toBe(true);
    // Monday morning after the reset: closed on both arms.
    expect(doubleHonorActive('2026-08-17', '2026-08-17')).toBe(false);
    // Each arm opens the window on its own (the union, pinned per arm).
    expect(doubleHonorActive('2026-08-15', '')).toBe(true);
    expect(doubleHonorActive('', '2026-08-15')).toBe(true);
  });

  it('multiplies by the event constant inside the window and by 1 outside it', () => {
    expect(DOUBLE_HONOR_MULTIPLIER).toBe(2);
    expect(honorEventMultiplier('2026-08-15', '2026-08-16')).toBe(DOUBLE_HONOR_MULTIPLIER);
    expect(honorEventMultiplier('2026-08-16', '2026-08-16')).toBe(DOUBLE_HONOR_MULTIPLIER);
    // The early Friday open pays the multiplier too.
    expect(honorEventMultiplier('2026-08-21', '2026-08-22')).toBe(DOUBLE_HONOR_MULTIPLIER);
    expect(honorEventMultiplier('2026-08-14', '2026-08-14')).toBe(1); // Friday, pre-open
    expect(honorEventMultiplier('2026-08-17', '2026-08-17')).toBe(1); // the Monday after
    expect(honorEventMultiplier('', '')).toBe(1);
  });

  it('is deterministic: the same keys always answer the same way', () => {
    const run = () =>
      (
        [
          ['2026-08-15', '2026-08-15'],
          ['2026-08-21', '2026-08-22'],
          ['', ''],
        ] as const
      ).map(([resetDay, eventLeadDay]) => [
        weekdayOfDayKey(resetDay),
        doubleHonorActive(resetDay, eventLeadDay),
        honorEventMultiplier(resetDay, eventLeadDay),
      ]);
    expect(run()).toEqual(run());
  });
});
