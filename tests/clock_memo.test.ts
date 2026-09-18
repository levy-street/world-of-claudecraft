// formatClockTimeMemo (clock.ts): the HUD's per-frame clock read formats the
// date only when the displayed minute, the format, or the language changed,
// and reads exactly what formatClockTime reads at every instant.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatClockTime, formatClockTimeMemo } from '../src/ui/clock';
import { getLanguage, setLanguage } from '../src/ui/i18n';

// A fixed local instant one millisecond before a minute boundary.
const at = (h: number, m: number, s: number, ms: number) =>
  new Date(2026, 0, 1, h, m, s, ms).getTime();

// Counts formatter constructions: a spy cannot stand in for a constructor, so
// the original is wrapped by hand and restored after each case.
const ORIGINAL_FORMATTER = Intl.DateTimeFormat;
let formatterBuilds = 0;
function countFormatterBuilds(): void {
  formatterBuilds = 0;
  const counted = function (this: unknown, ...args: unknown[]) {
    formatterBuilds++;
    return new (ORIGINAL_FORMATTER as unknown as new (...a: unknown[]) => Intl.DateTimeFormat)(
      ...args,
    );
  };
  (Intl as { DateTimeFormat: unknown }).DateTimeFormat = counted;
}

afterEach(() => {
  (Intl as { DateTimeFormat: unknown }).DateTimeFormat = ORIGINAL_FORMATTER;
  vi.restoreAllMocks();
});

describe('formatClockTimeMemo', () => {
  it('reads exactly what formatClockTime reads across a minute boundary', () => {
    const boundary = at(10, 42, 0, 0);
    const instants = [boundary - 1500, boundary - 1, boundary, boundary + 1, boundary + 59_999];
    for (const use24 of [true, false]) {
      for (const t of instants) {
        expect(formatClockTimeMemo(t, use24, 'en')).toBe(formatClockTime(new Date(t), use24, 'en'));
      }
    }
    expect(formatClockTimeMemo(boundary - 1, true, 'en')).toBe('10:41');
    expect(formatClockTimeMemo(boundary, true, 'en')).toBe('10:42');
    expect(formatClockTimeMemo(boundary - 1, false, 'en')).toBe('10:41 AM');
    expect(formatClockTimeMemo(boundary, false, 'en')).toBe('10:42 AM');
  });

  it('formats once per displayed minute, and again on a format or language change', () => {
    countFormatterBuilds();
    const start = at(15, 7, 0, 0);
    formatClockTimeMemo(start, true, 'en');
    const after = formatterBuilds;
    // A minute of 60 Hz frames: no new formatter.
    for (let frame = 1; frame < 3600; frame++) {
      expect(formatClockTimeMemo(start + frame * 16, true, 'en')).toBe('15:07');
    }
    expect(formatterBuilds).toBe(after);
    // The next minute, the 12-hour format, and another language each format once.
    expect(formatClockTimeMemo(start + 60_000, true, 'en')).toBe('15:08');
    expect(formatterBuilds).toBe(after + 1);
    expect(formatClockTimeMemo(start + 60_000, false, 'en')).toBe('3:08 PM');
    expect(formatterBuilds).toBe(after + 2);
    expect(formatClockTimeMemo(start + 60_000, false, 'fr_FR')).toBe(
      formatClockTime(new Date(start + 60_000), false, 'fr_FR'),
    );
    expect(formatterBuilds).toBe(after + 4);
    formatClockTimeMemo(start + 60_000, false, 'fr_FR');
    expect(formatterBuilds).toBe(after + 4);
  });
});

describe('formatClockTimeMemo with no explicit language (the HUD call shape)', () => {
  it('follows the active language on the very next read after a switch', () => {
    const initial = getLanguage();
    try {
      setLanguage('en');
      const t = at(15, 8, 0, 0);
      expect(formatClockTimeMemo(t, false)).toBe('3:08 PM');
      setLanguage('ja_JP');
      expect(formatClockTimeMemo(t, false)).toBe(formatClockTime(new Date(t), false, 'ja_JP'));
      expect(formatClockTimeMemo(t, false)).not.toBe('3:08 PM');
    } finally {
      setLanguage(initial);
    }
  });
});
