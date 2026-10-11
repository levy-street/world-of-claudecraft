import { describe, expect, it } from 'vitest';
import {
  dailyResetRemainingSec,
  eventLeadDayKey,
  nextWorldQuestRotationMs,
  resetDayKey,
} from '../server/raid_reset';
import { feedRealmCalendar } from '../server/sim_calendar_feed';

describe('authoritative server calendar feed', () => {
  it('feeds the reset cycle and world-quest deadline into the online sim sink', () => {
    const now = Date.UTC(2026, 8, 1, 12, 34, 56);
    const zone = 'America/New_York';
    const sink = {
      utcDay: '',
      resetDay: '',
      eventLeadDay: '',
      dailyResetRemainingSec: 0,
      worldQuestExpiresAtMs: 0,
    };

    feedRealmCalendar(sink, now, zone);

    expect(sink).toEqual({
      utcDay: '2026-09-01',
      resetDay: resetDayKey(now, zone),
      eventLeadDay: eventLeadDayKey(now, zone),
      dailyResetRemainingSec: dailyResetRemainingSec(now, zone),
      worldQuestExpiresAtMs: nextWorldQuestRotationMs(now, zone),
    });
    expect(sink.worldQuestExpiresAtMs).toBe(Date.UTC(2026, 8, 2, 7, 0, 0));
  });
});
