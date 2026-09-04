// The realm-calendar feed (server/sim_calendar_feed.ts), extracted from the
// GameServer loop: one call sets the sim's four host-fed calendar values, and
// each must stay byte-identical to the raid_reset.ts primitive it wraps (the
// move-not-rewrite proof for the three pre-existing keys, plus the phase 14
// countdown). Pure in (instant, zone) like everything it composes.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RAID_RESET_TIME_ZONE,
  dailyResetRemainingSec,
  eventLeadDayKey,
  resetDayKey,
} from '../server/raid_reset';
import { feedRealmCalendar, type SimCalendarSink } from '../server/sim_calendar_feed';

function freshSink(): SimCalendarSink {
  return { utcDay: '', resetDay: '', eventLeadDay: '', dailyResetRemainingSec: 0 };
}

describe('feedRealmCalendar', () => {
  it('sets all four values exactly as the loop inlined them, per zone', () => {
    for (const zone of [DEFAULT_RAID_RESET_TIME_ZONE, 'Europe/Paris']) {
      const nowMs = Date.UTC(2026, 7, 21, 20, 0, 0);
      const sink = freshSink();
      feedRealmCalendar(sink, nowMs, zone);
      expect(sink.utcDay).toBe(new Date(nowMs).toISOString().slice(0, 10));
      expect(sink.resetDay).toBe(resetDayKey(nowMs, zone));
      expect(sink.eventLeadDay).toBe(eventLeadDayKey(nowMs, zone));
      expect(sink.dailyResetRemainingSec).toBe(dailyResetRemainingSec(nowMs, zone));
    }
  });

  it('never feeds the 0 = "no calendar" sentinel from a live clock', () => {
    // Probe the reset boundary itself plus its neighbors: the countdown floor
    // is 1 (raid_reset.ts), so a fed sim can always tell "calendar known"
    // from the headless default.
    const boundary = Date.UTC(2025, 5, 30, 7, 0, 0); // 03:00 EDT
    for (const nowMs of [boundary - 1000, boundary - 1, boundary, boundary + 1000]) {
      const sink = freshSink();
      feedRealmCalendar(sink, nowMs, DEFAULT_RAID_RESET_TIME_ZONE);
      expect(sink.dailyResetRemainingSec).toBeGreaterThanOrEqual(1);
      expect(sink.resetDay).not.toBe('');
    }
  });

  it('the countdown expires exactly where the window key flips', () => {
    const boundary = Date.UTC(2025, 5, 30, 7, 0, 0);
    const before = freshSink();
    const after = freshSink();
    feedRealmCalendar(before, boundary - 1000, DEFAULT_RAID_RESET_TIME_ZONE);
    feedRealmCalendar(after, boundary, DEFAULT_RAID_RESET_TIME_ZONE);
    expect(before.dailyResetRemainingSec).toBe(1);
    expect(after.dailyResetRemainingSec).toBe(24 * 3600);
    expect(before.resetDay).not.toBe(after.resetDay);
  });

  it('utcDay and resetDay stay distinct feeds (an instant where the two keys differ)', () => {
    // At the first probe above, the ISO day and the reset-window key happen
    // to agree in both probed zones, so `utcDay = resetDayKey(...)` survived
    // the suite. Just before the 03:00 local reset the calendar date has
    // rolled but the reset window has not: the two keys MUST differ here,
    // which makes a swap in either direction red.
    const nowMs = Date.UTC(2025, 5, 30, 6, 59, 59); // 02:59:59 EDT on the 30th
    const sink = freshSink();
    feedRealmCalendar(sink, nowMs, DEFAULT_RAID_RESET_TIME_ZONE);
    expect(sink.utcDay).toBe('2025-06-30');
    expect(sink.resetDay).toBe(resetDayKey(nowMs, DEFAULT_RAID_RESET_TIME_ZONE));
    expect(sink.resetDay).not.toBe(sink.utcDay);
  });
});
