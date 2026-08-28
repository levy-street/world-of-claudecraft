import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DAILY_RESET_HOUR,
  eventLeadDayOf,
  feedSimCalendar,
  nextResetMsOf,
  resetDayOf,
  resetRemainingSecOf,
} from '../src/game/utc_day';

function freshSim() {
  return { utcDay: '', resetDay: '', eventLeadDay: '', dailyResetRemainingSec: 0 };
}

describe('the utcDay feed', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('feeds the ISO UTC day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T12:34:56Z'));
    const sim = freshSim();
    feedSimCalendar(sim);
    expect(sim.utcDay).toBe('2026-07-01');
  });

  it('caches within the refresh window and rolls over across midnight', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T23:59:59.700Z'));
    const sim = freshSim();
    feedSimCalendar(sim);
    expect(sim.utcDay).toBe('2026-07-01');
    // still inside the 1s cache window: the cached day is served as-is
    vi.setSystemTime(new Date('2026-07-02T00:00:00.100Z'));
    feedSimCalendar(sim);
    expect(sim.utcDay).toBe('2026-07-01');
    // past the window: the next feed re-derives and sees the new day
    vi.setSystemTime(new Date('2026-07-02T00:00:00.800Z'));
    feedSimCalendar(sim);
    expect(sim.utcDay).toBe('2026-07-02');
  });
});

// Offline there is no realm, so the daily window turns over at the player's OWN
// local reset hour. `resetDayOf` is expressed entirely in local civil terms, so
// every case below is built with the LOCAL Date constructor and holds in any
// process zone. The server's zone-parameterized twin is `resetDayKey`
// (tests/raid_reset.test.ts), and the two share DAILY_RESET_HOUR.
describe('resetDayOf', () => {
  it('holds one key across an evening that midnight UTC would have split', () => {
    // The shape the realm bug was reported in: a win in the morning and the
    // banner re-arming that same evening.
    const morning = new Date(2026, 7, 7, 10, 0);
    const evening = new Date(2026, 7, 7, 18, 11);
    expect(resetDayOf(morning)).toBe('2026-08-07');
    expect(resetDayOf(evening)).toBe('2026-08-07');
  });

  it('turns over at the local reset hour, not at local midnight', () => {
    expect(resetDayOf(new Date(2026, 7, 7, 0, 1)), 'just past midnight').toBe('2026-08-06');
    expect(resetDayOf(new Date(2026, 7, 7, 2, 59)), 'the last minute before').toBe('2026-08-06');
    expect(resetDayOf(new Date(2026, 7, 7, 3, 0)), 'the reset hour opens it').toBe('2026-08-07');
  });

  it('rolls the month and the year back across an edge', () => {
    expect(resetDayOf(new Date(2026, 7, 1, 1, 0))).toBe('2026-07-31');
    expect(resetDayOf(new Date(2026, 0, 1, 2, 0))).toBe('2025-12-31');
  });

  it('zero-pads so keys compare and sort as strings', () => {
    expect(resetDayOf(new Date(2026, 0, 5, 12, 0))).toBe('2026-01-05');
  });

  it('does not mutate the Date it is handed', () => {
    const at = new Date(2026, 7, 7, 1, 0);
    const before = at.getTime();
    resetDayOf(at);
    expect(at.getTime()).toBe(before);
  });

  it('exports the reset hour it applies, so the server can be pinned against it', () => {
    expect(DAILY_RESET_HOUR).toBe(3);
  });
});

describe('the resetDay feed', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads the clock through resetDayOf and caches for a second', () => {
    vi.useFakeTimers();
    const beforeReset = new Date(2026, 7, 7, 2, 59, 59, 700);
    vi.setSystemTime(beforeReset);
    const sim = freshSim();
    feedSimCalendar(sim);
    expect(sim.resetDay).toBe('2026-08-06');
    vi.setSystemTime(new Date(2026, 7, 7, 3, 0, 0, 100));
    feedSimCalendar(sim);
    expect(sim.resetDay, 'inside the 1s window, the cached key is served').toBe('2026-08-06');
    vi.setSystemTime(new Date(2026, 7, 7, 3, 0, 0, 800));
    feedSimCalendar(sim);
    expect(sim.resetDay, 'past it, the next feed re-derives').toBe('2026-08-07');
  });
});

// The weekend event's early-open probe: the reset window DOUBLE_HONOR_LEAD_MS
// ahead of the given instant, in the player's OWN local zone (offline there is
// no realm). The server's zone-parameterized twin is eventLeadDayKey
// (tests/raid_reset.test.ts); both feed honor_event.ts the same way.
describe('eventLeadDayOf', () => {
  it('reads the local reset window the lead ahead: Friday 3 PM already reads Saturday', () => {
    // 2026-08-21 is a Friday. At 14:59 local the probe instant is Saturday
    // 02:59, before the reset hour, so the key still reads Friday; at 15:00
    // the probe crosses Saturday's reset and the weekend window opens.
    expect(eventLeadDayOf(new Date(2026, 7, 21, 14, 59))).toBe('2026-08-21');
    expect(eventLeadDayOf(new Date(2026, 7, 21, 15, 0))).toBe('2026-08-22');
  });

  it('does not mutate the Date it is handed', () => {
    const at = new Date(2026, 7, 21, 15, 0);
    const before = at.getTime();
    eventLeadDayOf(at);
    expect(at.getTime()).toBe(before);
  });
});

// The when-half of resetDayOf (Masterwrought phase 14): the instant the
// current local window closes, and the whole-second countdown to it, fed to
// the sim beside the window key so a daily_limit refusal can answer with a
// duration. Local civil terms like resetDayOf, so every case holds in any
// process zone.
describe('nextResetMsOf / resetRemainingSecOf', () => {
  it("before the reset hour the window closes at TODAY's reset hour", () => {
    const at = new Date(2026, 7, 7, 1, 0);
    expect(new Date(nextResetMsOf(at)).getTime()).toBe(new Date(2026, 7, 7, 3, 0).getTime());
    expect(resetRemainingSecOf(at)).toBe(2 * 3600);
  });

  it("at and after the reset hour it closes at TOMORROW's", () => {
    const boundary = new Date(2026, 7, 7, 3, 0);
    expect(nextResetMsOf(boundary)).toBe(new Date(2026, 7, 8, 3, 0).getTime());
    expect(resetRemainingSecOf(boundary)).toBe(24 * 3600);
    const evening = new Date(2026, 7, 7, 18, 30);
    expect(nextResetMsOf(evening)).toBe(new Date(2026, 7, 8, 3, 0).getTime());
  });

  it('agrees with resetDayOf: the countdown expires exactly where the key flips', () => {
    const justBefore = new Date(2026, 7, 7, 2, 59, 59, 400);
    expect(resetDayOf(justBefore)).toBe('2026-08-06');
    expect(resetRemainingSecOf(justBefore)).toBe(1);
    expect(resetDayOf(new Date(nextResetMsOf(justBefore)))).toBe('2026-08-07');
  });

  it("never answers 0 (the sim's no-calendar sentinel) and rolls month edges", () => {
    expect(resetRemainingSecOf(new Date(2026, 7, 31, 23, 0))).toBeGreaterThan(0);
    expect(nextResetMsOf(new Date(2026, 7, 31, 23, 0))).toBe(new Date(2026, 8, 1, 3, 0).getTime());
  });

  it('does not mutate the Date it is handed', () => {
    const at = new Date(2026, 7, 7, 1, 0);
    const before = at.getTime();
    nextResetMsOf(at);
    resetRemainingSecOf(at);
    expect(at.getTime()).toBe(before);
  });
});

describe('feedSimCalendar', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('feeds the sim all four host calendar values in one call', () => {
    vi.useFakeTimers();
    // Friday 2026-08-21, 8 PM local: inside the early-open lead window.
    const at = new Date(2026, 7, 21, 20, 0);
    vi.setSystemTime(at);
    const sim = { utcDay: '', resetDay: '', eventLeadDay: '', dailyResetRemainingSec: 0 };
    feedSimCalendar(sim);
    expect(sim.utcDay).toBe(at.toISOString().slice(0, 10));
    expect(sim.resetDay).toBe('2026-08-21');
    expect(sim.eventLeadDay).toBe('2026-08-22');
    // 8 PM to tomorrow 3 AM local: seven hours on the countdown, and always
    // >= 1 so the sim's 0 = "no calendar" sentinel is never fed from a live
    // clock.
    expect(sim.dailyResetRemainingSec).toBe(7 * 3600);
  });

  it('feeds all four values from ONE instant: the set is always self-consistent', () => {
    // The retired per-key caches each carried their own 1-second deadline, so
    // a feed routed through them could pair a stale old-window resetDay with
    // a freshly refreshed ~24h countdown for up to a second at the boundary
    // (the QA round's coherence finding). Now every value is derived from the
    // feed's own instant: at any probe past the 1-second window the four
    // agree with the pure primitives evaluated at ONE Date, including a
    // probe just past the boundary that a fresh feed sees whole.
    vi.useFakeTimers();
    for (const at of [
      new Date(2026, 7, 7, 2, 59, 59, 600),
      new Date(2026, 7, 7, 3, 0, 1, 200),
      new Date(2026, 7, 7, 20, 0, 0, 0),
    ]) {
      vi.setSystemTime(at);
      const sim = freshSim();
      feedSimCalendar(sim);
      expect(sim.resetDay).toBe(resetDayOf(at));
      expect(sim.dailyResetRemainingSec).toBe(resetRemainingSecOf(at));
      expect(sim.eventLeadDay).toBe(eventLeadDayOf(at));
      expect(sim.utcDay).toBe(at.toISOString().slice(0, 10));
    }
  });

  it('holds one coherent set for its 1 Hz window, then refreshes every value together', () => {
    vi.useFakeTimers();
    const first = new Date(2026, 7, 7, 2, 59, 59, 700);
    vi.setSystemTime(first);
    const sim = { utcDay: '', resetDay: '', eventLeadDay: '', dailyResetRemainingSec: 0 };
    feedSimCalendar(sim);
    expect(sim.resetDay).toBe('2026-08-06');
    expect(sim.dailyResetRemainingSec).toBe(1);
    // Inside the window, past the boundary: the whole set is served as-is
    // (stale together, never half-flipped).
    vi.setSystemTime(new Date(2026, 7, 7, 3, 0, 0, 100));
    feedSimCalendar(sim);
    expect(sim.resetDay).toBe('2026-08-06');
    expect(sim.dailyResetRemainingSec).toBe(1);
    // Past the window: every value flips in the same feed.
    vi.setSystemTime(new Date(2026, 7, 7, 3, 0, 0, 800));
    feedSimCalendar(sim);
    expect(sim.resetDay).toBe('2026-08-07');
    expect(sim.dailyResetRemainingSec).toBe(24 * 3600);
  });

  it('reads the clock ONCE per feed: four values from one instant even when the clock moves between reads', () => {
    // Fake timers freeze Date.now, so the loop above cannot tell one read
    // from four. Here every Date.now() call advances the clock 700ms, and
    // the first read sits 300ms BEFORE the local reset: a per-value
    // implementation would take its later reads past the boundary and feed
    // a new-window countdown beside an old-window resetDay, exactly the
    // incoherence the single-instant feed exists to prevent.
    vi.useFakeTimers();
    const base = new Date(2026, 7, 7, 2, 59, 59, 700).getTime();
    let reads = 0;
    const now = vi.spyOn(Date, 'now').mockImplementation(() => base + reads++ * 700);
    try {
      const sim = freshSim();
      feedSimCalendar(sim);
      const at = new Date(base);
      expect(sim.resetDay).toBe(resetDayOf(at));
      expect(sim.resetDay).toBe('2026-08-06');
      expect(sim.dailyResetRemainingSec).toBe(resetRemainingSecOf(at));
      expect(sim.dailyResetRemainingSec).toBe(1);
      expect(sim.eventLeadDay).toBe(eventLeadDayOf(at));
      expect(sim.utcDay).toBe(at.toISOString().slice(0, 10));
    } finally {
      now.mockRestore();
    }
  });

  it('a backward wall-clock step refreshes rather than serving the old set to its deadline', () => {
    // A deadline-only cache serves stale values after the clock steps back
    // (an NTP correction, a manual change) until the OLD deadline arrives,
    // which after a large step is effectively forever. The server memo
    // documents the same case; the offline feed refreshes on it too.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 21, 20, 0, 0, 0));
    const sim = freshSim();
    feedSimCalendar(sim);
    expect(sim.resetDay).toBe('2026-08-21');
    const stepped = new Date(2026, 7, 7, 12, 0, 0, 0);
    vi.setSystemTime(stepped);
    feedSimCalendar(sim);
    expect(sim.resetDay).toBe('2026-08-07');
    expect(sim.dailyResetRemainingSec).toBe(resetRemainingSecOf(stepped));
    expect(sim.utcDay).toBe(stepped.toISOString().slice(0, 10));
    expect(sim.eventLeadDay).toBe(eventLeadDayOf(stepped));
  });
});
