// The realm-calendar feed for the authoritative sim (extracted from the
// GameServer loop per the monolith ratchet): the sim core never reads the
// wall clock itself (determinism invariant), so the loop calls this once per
// callback and the sim just stores what it is handed. Four values, four
// questions: `utcDay` stamps WHEN something happened (the Book of Deeds earn
// date); `resetDay` is the daily-rollover WINDOW, derived from this realm's
// own reset boundary so the first battleground win of the day turns over with
// the raid lockouts rather than at midnight UTC (5 PM Pacific, mid-evening);
// `eventLeadDay` is the weekend event's early-open probe of the same
// boundary; and `dailyResetRemainingSec` (Masterwrought phase 14) is the
// when-half of `resetDay`, the countdown a daily_limit craft refusal answers
// with, always >= 1 here so it can never read as the sim's 0 = "no calendar"
// sentinel. The offline twin is `feedSimCalendar` in src/game/utc_day.ts,
// which answers the same four questions from the player's own local zone.
// One more value has NO offline twin on purpose: `seasonal.hostEventId`, the
// seasonal event the server's calendar (seasonal_calendar.ts) says runs now.
// Seasonal events are realm events, so offline and headless worlds keep them
// closed unless `/dev season on` opens one.
//
// The structural sim shape (not a Sim import) keeps this a leaf a Vitest
// drives directly; the per-call cost is bounded by the memoized helpers in
// raid_reset.ts (each recomputes at most once per minute / per window).

import {
  dailyResetRemainingSec,
  eventLeadDayKey,
  nextWorldQuestRotationMs,
  resetDayKey,
} from './raid_reset';
import {
  activeSeasonalEventAt,
  configuredSeasonalWindows,
  type SeasonalWindow,
} from './seasonal_calendar';

export interface SimCalendarSink {
  utcDay: string;
  resetDay: string;
  eventLeadDay: string;
  dailyResetRemainingSec: number;
  // The world-quest rotation boundary (epoch ms) the tracker counts down to and
  // the rotation rolls at; the offline twin derives it from the local zone.
  worldQuestExpiresAtMs: number;
  // The seasonal event the calendar says runs now (src/sim/seasonal/); optional so
  // a sink that has no seasonal state (an older harness) is simply not fed it.
  seasonal?: { hostEventId: string | null };
}

/** Read once per process: the operator's SEASONAL_EVENT_WINDOWS, else the defaults. */
let seasonalWindows: readonly SeasonalWindow[] | null = null;

export function feedRealmCalendar(sim: SimCalendarSink, nowMs: number, zone: string): void {
  sim.utcDay = new Date(nowMs).toISOString().slice(0, 10);
  sim.resetDay = resetDayKey(nowMs, zone);
  sim.eventLeadDay = eventLeadDayKey(nowMs, zone);
  sim.dailyResetRemainingSec = dailyResetRemainingSec(nowMs, zone);
  sim.worldQuestExpiresAtMs = nextWorldQuestRotationMs(nowMs, zone);
  if (sim.seasonal) {
    seasonalWindows ??= configuredSeasonalWindows();
    sim.seasonal.hostEventId = activeSeasonalEventAt(nowMs, seasonalWindows);
  }
}
