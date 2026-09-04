import { describe, expect, it } from 'vitest';
import { eventLeadDayKey, nextWorldQuestRotationMs, resetDayKey } from '../server/raid_reset';
import { feedAuthoritativeCalendar } from '../server/sim_calendar';

describe('authoritative server calendar feed', () => {
  it('feeds the reset cycle and world-quest deadline into the online sim sink', () => {
    const now = Date.UTC(2026, 8, 1, 12, 34, 56);
    const zone = 'America/New_York';
    const sink = { utcDay: '', resetDay: '', eventLeadDay: '', worldQuestExpiresAtMs: 0 };

    feedAuthoritativeCalendar(sink, now, zone);

    expect(sink).toEqual({
      utcDay: '2026-09-01',
      resetDay: resetDayKey(now, zone),
      eventLeadDay: eventLeadDayKey(now, zone),
      worldQuestExpiresAtMs: nextWorldQuestRotationMs(now, zone),
    });
    expect(sink.worldQuestExpiresAtMs).toBe(Date.UTC(2026, 8, 3, 7, 0, 0));
  });
});
