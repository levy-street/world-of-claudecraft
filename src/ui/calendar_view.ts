// Pure view-core for the event calendar window (DOM/Three/i18n-free).
// Expands the recurring system-event rules plus the guild events mirrored on
// socialInfo into a month grid the thin painter (calendar_window.ts) draws.
// All date math is UTC and driven by the caller-supplied `todayIso`, so the
// core stays deterministic (no wall-clock reads). Registered in UI_PURE_CORES;
// tested in tests/calendar_view.test.ts.

import type { GuildEventInfo } from '../world_api';

// Recurring system events (display-only: each points the player at a real
// activity; none changes gameplay). Titles/notes localize in the painter via
// hudChrome.calendar.events.<id>.*; weekday is 0=Sunday..6=Saturday (UTC).
export interface SystemEventDef {
  id: string;
  rule: { kind: 'weekly'; weekday: number } | { kind: 'monthly'; day: number };
}

export const SYSTEM_EVENTS: SystemEventDef[] = [
  { id: 'raid_call', rule: { kind: 'weekly', weekday: 2 } }, // Tuesday
  { id: 'market_day', rule: { kind: 'weekly', weekday: 3 } }, // Wednesday
  { id: 'fiesta_night', rule: { kind: 'weekly', weekday: 5 } }, // Friday
  { id: 'arena_clash', rule: { kind: 'weekly', weekday: 6 } }, // Saturday
  { id: 'fishing_derby', rule: { kind: 'weekly', weekday: 0 } }, // Sunday
  { id: 'delve_day', rule: { kind: 'monthly', day: 7 } },
  { id: 'moongate_communion', rule: { kind: 'monthly', day: 15 } },
];

export interface CalendarCell {
  iso: string; // 'YYYY-MM-DD' (UTC)
  day: number; // 1-31
  inMonth: boolean; // false for the leading/trailing fill days
  isToday: boolean;
  isPast: boolean; // strictly before today
  systemIds: string[]; // SYSTEM_EVENTS ids falling on this day
  guildEvents: GuildEventInfo[];
}

export interface CalendarMonthView {
  year: number;
  month: number; // 0-11
  // 6 weeks x 7 days, Monday-first (a fixed-height grid so the window never
  // reflows between months).
  cells: CalendarCell[];
}

export function monthOfIso(iso: string): { year: number; month: number } {
  const d = new Date(`${iso}T00:00:00Z`);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
}

export function shiftMonth(
  year: number,
  month: number,
  delta: number,
): {
  year: number;
  month: number;
} {
  const d = new Date(Date.UTC(year, month + delta, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
}

export function systemEventIdsOn(iso: string, events: SystemEventDef[] = SYSTEM_EVENTS): string[] {
  const d = new Date(`${iso}T00:00:00Z`);
  const weekday = d.getUTCDay();
  const dayOfMonth = d.getUTCDate();
  return events
    .filter((e) =>
      e.rule.kind === 'weekly' ? e.rule.weekday === weekday : e.rule.day === dayOfMonth,
    )
    .map((e) => e.id);
}

export function buildCalendarMonth(input: {
  year: number;
  month: number; // 0-11
  todayIso: string;
  guildEvents: GuildEventInfo[];
  systemEvents?: SystemEventDef[];
}): CalendarMonthView {
  const { year, month } = input;
  const guildByDay = new Map<string, GuildEventInfo[]>();
  for (const ev of input.guildEvents) {
    const list = guildByDay.get(ev.day) ?? [];
    list.push(ev);
    guildByDay.set(ev.day, list);
  }
  for (const list of guildByDay.values()) {
    list.sort((a, b) => (a.hour ?? -1) - (b.hour ?? -1) || a.id - b.id);
  }
  const first = new Date(Date.UTC(year, month, 1));
  // Monday-first: how many fill days precede the 1st (Sunday=6 fill days).
  const lead = (first.getUTCDay() + 6) % 7;
  const cells: CalendarCell[] = [];
  for (let i = 0; i < 42; i++) {
    const date = new Date(Date.UTC(year, month, 1 - lead + i));
    const iso = date.toISOString().slice(0, 10);
    cells.push({
      iso,
      day: date.getUTCDate(),
      inMonth: date.getUTCMonth() === month,
      isToday: iso === input.todayIso,
      isPast: iso < input.todayIso,
      systemIds: systemEventIdsOn(iso, input.systemEvents ?? SYSTEM_EVENTS),
      guildEvents: guildByDay.get(iso) ?? [],
    });
  }
  return { year, month, cells };
}

// The next occurrence of a system event on or after `todayIso` (the window's
// "upcoming" strip). Bounded scan; monthly rules always recur within 31 days.
export function nextOccurrence(def: SystemEventDef, todayIso: string): string {
  const start = new Date(`${todayIso}T00:00:00Z`);
  for (let i = 0; i < 62; i++) {
    const d = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + i),
    );
    const iso = d.toISOString().slice(0, 10);
    if (systemEventIdsOn(iso, [def]).length > 0) return iso;
  }
  return todayIso;
}

// Whether the viewer may manage guild events (mirrors the server's rule).
export function canManageGuildEvents(rank: string | null | undefined): boolean {
  return rank === 'leader' || rank === 'officer';
}
