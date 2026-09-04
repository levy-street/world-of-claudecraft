// Authoritative calendar feed for the online Sim host. Keeping the assignment
// set in a small module makes the host parity contract directly testable while
// the deterministic sim remains clock-free.

import type { Sim } from '../src/sim/sim';
import { eventLeadDayKey, nextWorldQuestRotationMs, resetDayKey } from './raid_reset';

type CalendarSink = Pick<Sim, 'utcDay' | 'resetDay' | 'eventLeadDay' | 'worldQuestExpiresAtMs'>;

export function feedAuthoritativeCalendar(
  sim: CalendarSink,
  nowMs: number,
  resetTimeZone: string,
): void {
  sim.utcDay = new Date(nowMs).toISOString().slice(0, 10);
  sim.resetDay = resetDayKey(nowMs, resetTimeZone);
  sim.worldQuestExpiresAtMs = nextWorldQuestRotationMs(nowMs, resetTimeZone);
  sim.eventLeadDay = eventLeadDayKey(nowMs, resetTimeZone);
}
