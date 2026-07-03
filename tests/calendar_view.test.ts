// Pure view-core tests for the event calendar (src/ui/calendar_view.ts):
// system-event rule expansion, the Monday-first month grid, guild-event
// placement, month arithmetic, and the officer predicate. All date math is
// UTC and driven by explicit inputs, so results are deterministic.

import { describe, expect, it } from 'vitest';
import {
  buildCalendarMonth,
  canManageGuildEvents,
  monthOfIso,
  nextOccurrence,
  SYSTEM_EVENTS,
  shiftMonth,
  systemEventIdsOn,
} from '../src/ui/calendar_view';
import type { GuildEventInfo } from '../src/world_api';

const guildEvent = (over: Partial<GuildEventInfo>): GuildEventInfo => ({
  id: 1,
  day: '2026-07-10',
  hour: 20,
  title: 'Crypt night',
  note: '',
  createdBy: 'Lead',
  ...over,
});

describe('systemEventIdsOn', () => {
  it('expands weekly and monthly rules', () => {
    // 2026-07-03 is a Friday; 2026-07-07 the monthly delve day; 2026-07-15 mid-month.
    expect(systemEventIdsOn('2026-07-03')).toContain('fiesta_night');
    expect(systemEventIdsOn('2026-07-07')).toContain('delve_day');
    expect(systemEventIdsOn('2026-07-15')).toContain('moongate_communion');
    // 2026-07-06 is a Monday: nothing recurs on Mondays.
    expect(systemEventIdsOn('2026-07-06')).toEqual([]);
  });

  it('every system event recurs within the next two months', () => {
    for (const def of SYSTEM_EVENTS) {
      const next = nextOccurrence(def, '2026-07-03');
      expect(systemEventIdsOn(next)).toContain(def.id);
      expect(next >= '2026-07-03').toBe(true);
    }
  });
});

describe('buildCalendarMonth', () => {
  it('builds a fixed 6x7 Monday-first grid around July 2026', () => {
    const view = buildCalendarMonth({
      year: 2026,
      month: 6,
      todayIso: '2026-07-03',
      guildEvents: [],
    });
    expect(view.cells).toHaveLength(42);
    // July 1st 2026 is a Wednesday: two leading June fill days precede it.
    expect(view.cells[0]).toMatchObject({ iso: '2026-06-29', inMonth: false });
    expect(view.cells[2]).toMatchObject({ iso: '2026-07-01', inMonth: true });
    const today = view.cells.find((c) => c.isToday);
    expect(today?.iso).toBe('2026-07-03');
    expect(view.cells.find((c) => c.iso === '2026-07-02')?.isPast).toBe(true);
    expect(view.cells.find((c) => c.iso === '2026-07-04')?.isPast).toBe(false);
  });

  it('places guild events on their day, sorted all-day first then by hour', () => {
    const view = buildCalendarMonth({
      year: 2026,
      month: 6,
      todayIso: '2026-07-03',
      guildEvents: [
        guildEvent({ id: 3, hour: 21 }),
        guildEvent({ id: 2, hour: null, title: 'Fair' }),
        guildEvent({ id: 1, hour: 19 }),
      ],
    });
    const day = view.cells.find((c) => c.iso === '2026-07-10');
    expect(day?.guildEvents.map((e) => e.id)).toEqual([2, 1, 3]);
    expect(view.cells.filter((c) => c.guildEvents.length > 0)).toHaveLength(1);
  });

  it('is deterministic for identical inputs', () => {
    const input = {
      year: 2026,
      month: 6,
      todayIso: '2026-07-03',
      guildEvents: [guildEvent({})],
    };
    expect(buildCalendarMonth(input)).toEqual(
      buildCalendarMonth(JSON.parse(JSON.stringify(input))),
    );
  });
});

describe('month arithmetic and permissions', () => {
  it('shifts months across year boundaries', () => {
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
    expect(monthOfIso('2026-07-03')).toEqual({ year: 2026, month: 6 });
  });

  it('lets only officers and the leader manage guild events', () => {
    expect(canManageGuildEvents('leader')).toBe(true);
    expect(canManageGuildEvents('officer')).toBe(true);
    expect(canManageGuildEvents('member')).toBe(false);
    expect(canManageGuildEvents(null)).toBe(false);
    expect(canManageGuildEvents(undefined)).toBe(false);
  });
});
