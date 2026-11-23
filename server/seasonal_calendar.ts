// The seasonal-event calendar: the ONE place a date decides whether a seasonal
// event runs (src/sim/seasonal/ never reads a clock). The realm loop's calendar
// feed (sim_calendar_feed.ts) asks it every tick and writes the answer into the
// sim's seasonal state, which every client mirrors through the `season` self key.
//
// Windows are UTC instants, start inclusive and end exclusive. The defaults below
// ship with the build; an operator can replace them without a deploy of new code
// through SEASONAL_EVENT_WINDOWS, a comma-separated list of
// `<eventId>:<startISO>/<endISO>` entries, e.g.
//   SEASONAL_EVENT_WINDOWS=gourdlight_eve:2026-10-18T00:00:00Z/2026-11-01T12:00:00Z
// An empty value (`SEASONAL_EVENT_WINDOWS=`) turns every event off. A malformed
// entry is dropped (and reported once at boot), never guessed at.

export interface SeasonalWindow {
  eventId: string;
  startMs: number;
  endMs: number;
}

/** The shipped windows. Gourdlight Eve: two weeks, closing the morning after the
 *  31st in the Americas so its last night is whole everywhere. */
export const DEFAULT_SEASONAL_WINDOWS: readonly SeasonalWindow[] = Object.freeze([
  {
    eventId: 'gourdlight_eve',
    startMs: Date.UTC(2026, 9, 18, 0, 0, 0),
    endMs: Date.UTC(2026, 10, 1, 12, 0, 0),
  },
]);

const ENTRY = /^([a-z0-9_]{1,40}):([^/]+)\/(.+)$/;

/** Parse a SEASONAL_EVENT_WINDOWS value. Returns the windows plus the entries it
 *  refused (so the boot can say so). Pure: no clock, no env read. */
export function parseSeasonalWindows(raw: string): {
  windows: SeasonalWindow[];
  rejected: string[];
} {
  const windows: SeasonalWindow[] = [];
  const rejected: string[] = [];
  for (const part of raw.split(',')) {
    const entry = part.trim();
    if (entry === '') continue;
    const m = ENTRY.exec(entry);
    const startMs = m ? Date.parse(m[2]) : Number.NaN;
    const endMs = m ? Date.parse(m[3]) : Number.NaN;
    if (!m || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      rejected.push(entry);
      continue;
    }
    windows.push({ eventId: m[1], startMs, endMs });
  }
  return { windows, rejected };
}

/** The windows this process runs on: the env override when set, else the defaults. */
export function configuredSeasonalWindows(
  env: Readonly<Record<string, string | undefined>> = process.env,
): readonly SeasonalWindow[] {
  const raw = env.SEASONAL_EVENT_WINDOWS;
  if (raw === undefined) return DEFAULT_SEASONAL_WINDOWS;
  const { windows, rejected } = parseSeasonalWindows(raw);
  if (rejected.length > 0) {
    console.warn(`SEASONAL_EVENT_WINDOWS: ignored malformed entries: ${rejected.join(', ')}`);
  }
  return Object.freeze(windows);
}

/** The event running at `nowMs` (the first window that contains it), or null. */
export function activeSeasonalEventAt(
  nowMs: number,
  windows: readonly SeasonalWindow[],
): string | null {
  for (const w of windows) if (nowMs >= w.startMs && nowMs < w.endMs) return w.eventId;
  return null;
}
