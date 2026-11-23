// The server-owned seasonal calendar (server/seasonal_calendar.ts) and its feed
// into the sim (server/sim_calendar_feed.ts), plus the client's decode of the two
// seasonal self keys (src/net/seasonal_wire_state.ts). The sim never reads a date:
// these are the only places one decides whether an event runs.
import { describe, expect, it } from 'vitest';
import {
  activeSeasonalEventAt,
  configuredSeasonalWindows,
  DEFAULT_SEASONAL_WINDOWS,
  parseSeasonalWindows,
} from '../server/seasonal_calendar';
import { feedRealmCalendar, type SimCalendarSink } from '../server/sim_calendar_feed';
import { decodeSeasonWire, decodeTrickOrTreatWire } from '../src/net/seasonal_wire_state';
import { DEFAULT_RAID_RESET_TIME_ZONE } from '../src/reset_calendar';
import { GOURDLIGHT_EVE_ID } from '../src/sim/content/gourdlight_eve';
import { KNOWN_SEASONAL_EVENTS } from '../src/sim/seasonal';

describe('the seasonal calendar', () => {
  it('ships a two-week Gourdlight Eve window that closes after the 31st', () => {
    const w = DEFAULT_SEASONAL_WINDOWS.find((x) => x.eventId === GOURDLIGHT_EVE_ID);
    expect(w).toBeDefined();
    expect(w?.startMs).toBe(Date.UTC(2026, 9, 18));
    expect(w?.endMs).toBe(Date.UTC(2026, 10, 1, 12));
    for (const window of DEFAULT_SEASONAL_WINDOWS) {
      expect(KNOWN_SEASONAL_EVENTS).toContain(window.eventId);
    }
  });

  it('answers by window, start inclusive and end exclusive', () => {
    const windows = DEFAULT_SEASONAL_WINDOWS;
    expect(activeSeasonalEventAt(Date.UTC(2026, 9, 17, 23, 59, 59), windows)).toBeNull();
    expect(activeSeasonalEventAt(Date.UTC(2026, 9, 18), windows)).toBe(GOURDLIGHT_EVE_ID);
    expect(activeSeasonalEventAt(Date.UTC(2026, 9, 31, 22), windows)).toBe(GOURDLIGHT_EVE_ID);
    expect(activeSeasonalEventAt(Date.UTC(2026, 10, 1, 12), windows)).toBeNull();
  });

  it('parses an operator override and drops malformed entries', () => {
    const { windows, rejected } = parseSeasonalWindows(
      'gourdlight_eve:2026-10-01T00:00:00Z/2026-10-02T00:00:00Z, bad, x:2026-10-05/2026-10-04',
    );
    expect(windows).toEqual([
      { eventId: 'gourdlight_eve', startMs: Date.UTC(2026, 9, 1), endMs: Date.UTC(2026, 9, 2) },
    ]);
    expect(rejected).toEqual(['bad', 'x:2026-10-05/2026-10-04']);
    expect(configuredSeasonalWindows({})).toBe(DEFAULT_SEASONAL_WINDOWS);
    expect(configuredSeasonalWindows({ SEASONAL_EVENT_WINDOWS: '' })).toEqual([]);
  });

  it('the realm feed writes the host event into a sink that carries seasonal state', () => {
    const sink: SimCalendarSink = {
      utcDay: '',
      resetDay: '',
      eventLeadDay: '',
      dailyResetRemainingSec: 0,
      worldQuestExpiresAtMs: 0,
      seasonal: { hostEventId: null },
    };
    feedRealmCalendar(sink, Date.UTC(2026, 9, 25, 18), DEFAULT_RAID_RESET_TIME_ZONE);
    expect(sink.seasonal?.hostEventId).toBe(GOURDLIGHT_EVE_ID);
    feedRealmCalendar(sink, Date.UTC(2026, 11, 25, 18), DEFAULT_RAID_RESET_TIME_ZONE);
    expect(sink.seasonal?.hostEventId).toBeNull();
  });
});

describe('the seasonal self keys (client decode)', () => {
  it('accepts an event id or null and drops anything else', () => {
    expect(decodeSeasonWire('gourdlight_eve')).toBe('gourdlight_eve');
    expect(decodeSeasonWire(null)).toBeNull();
    expect(decodeSeasonWire(42)).toBeNull();
    expect(decodeSeasonWire('<script>')).toBeNull();
  });

  it('keeps well-formed knocked ids only', () => {
    expect(decodeTrickOrTreatWire(['trader_wilkes', 7, 'Bad Id', 'cook_marlow'])).toEqual([
      'trader_wilkes',
      'cook_marlow',
    ]);
    expect(decodeTrickOrTreatWire('nope')).toEqual([]);
  });
});
