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
//
// The structural sim shape (not a Sim import) keeps this a leaf a Vitest
// drives directly; the per-call cost is bounded by the memoized helpers in
// raid_reset.ts (each recomputes at most once per minute / per window).

import { dailyResetRemainingSec, eventLeadDayKey, resetDayKey } from './raid_reset';

export interface SimCalendarSink {
  utcDay: string;
  resetDay: string;
  eventLeadDay: string;
  dailyResetRemainingSec: number;
}

export function feedRealmCalendar(sim: SimCalendarSink, nowMs: number, zone: string): void {
  sim.utcDay = new Date(nowMs).toISOString().slice(0, 10);
  sim.resetDay = resetDayKey(nowMs, zone);
  sim.eventLeadDay = eventLeadDayKey(nowMs, zone);
  sim.dailyResetRemainingSec = dailyResetRemainingSec(nowMs, zone);
}
