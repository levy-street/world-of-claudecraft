// The Arena season banner's pure view core (src/ui/arena_season_view.ts).
//
// The banner is the one place a player learns the season exists, so its two
// failure modes both matter and both live here: a countdown that reads the wrong
// unit or the wrong season, and a champions list that renders a row the payload
// never actually contained. Every case drives the core directly with an explicit
// clock, so no boundary depends on when the suite runs.
import { describe, expect, it } from 'vitest';
import {
  ARENA_SEASON_EPOCH_MS,
  arenaSeasonEndMs,
  arenaSeasonStartMs,
} from '../src/sim/arena_season';
import { arenaSeasonDef } from '../src/sim/content/arena_seasons';
import { CLASSES } from '../src/sim/data';
import {
  type ArenaSeasonReadoutPayload,
  arenaSeasonCountdown,
  buildArenaSeasonView,
} from '../src/ui/arena_season_view';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const KNOWN = new Set(Object.keys(CLASSES));

function build(nowMs: number, readout: ArenaSeasonReadoutPayload | null = null) {
  return buildArenaSeasonView({ nowMs, readout, knownClassIds: KNOWN });
}

function readout(over: Partial<ArenaSeasonReadoutPayload> = {}): ArenaSeasonReadoutPayload {
  return {
    season: 2,
    authored: 10,
    settled: [
      {
        season: 1,
        deedId: 'feat_arena_season_1_warmaster',
        champions: [
          { bracket: '1v1', name: 'Kaevar', cls: 'warrior', rating: 1994 },
          { bracket: '2v2', name: 'Nilla', cls: 'priest', rating: 1902 },
          { bracket: '2v2', name: 'Brack', cls: 'rogue', rating: 1871 },
        ],
      },
    ],
    ...over,
  };
}

describe('countdown quantization', () => {
  it('picks the coarsest unit that still reads as nonzero', () => {
    expect(arenaSeasonCountdown(3 * DAY + 5 * HOUR)).toEqual({ unit: 'days', value: 3 });
    // Exactly one day is days, one millisecond under it falls to hours: the
    // boundary is where a "0 days" line would otherwise appear.
    expect(arenaSeasonCountdown(DAY)).toEqual({ unit: 'days', value: 1 });
    expect(arenaSeasonCountdown(DAY - 1)).toEqual({ unit: 'hours', value: 23 });
    expect(arenaSeasonCountdown(HOUR)).toEqual({ unit: 'hours', value: 1 });
    expect(arenaSeasonCountdown(HOUR - 1)).toEqual({ unit: 'minutes', value: 59 });
    expect(arenaSeasonCountdown(0)).toEqual({ unit: 'minutes', value: 0 });
    // A negative span (a clock skewed past the close) clamps rather than
    // rendering a negative countdown.
    expect(arenaSeasonCountdown(-5 * DAY)).toEqual({ unit: 'minutes', value: 0 });
  });
});

describe('the live-season banner', () => {
  it('names the live season and the title it will award', () => {
    const view = build(arenaSeasonStartMs(3) + 10 * DAY);
    expect(view.kind).toBe('live');
    if (view.kind !== 'live') return;
    expect(view.season).toBe(3);
    expect(view.deedId).toBe(arenaSeasonDef(3)?.deedId);
    expect(view.countdown.unit).toBe('days');
    expect(view.elapsedFrac).toBeGreaterThan(0);
    expect(view.elapsedFrac).toBeLessThan(0.1);
  });

  it('counts down to the epoch in Preseason and offers Season 1', () => {
    const view = build(ARENA_SEASON_EPOCH_MS - 2 * DAY);
    expect(view.kind).toBe('preseason');
    expect(view.deedId).toBe('feat_arena_season_1_warmaster');
    expect(view.countdown).toEqual({ unit: 'days', value: 2 });
  });

  it('offers no title once the calendar outruns the authored roster', () => {
    const view = build(arenaSeasonStartMs(11) + DAY);
    expect(view.kind).toBe('live');
    if (view.kind !== 'live') return;
    expect(view.season).toBe(11);
    // Null, not a stale season 10 title: the banner must not advertise a title
    // the settlement would refuse to award.
    expect(view.deedId).toBeNull();
  });

  it('holds its signature steady within a countdown bucket and moves across one', () => {
    // Deliberately five hours off the day boundary: the countdown bucket only
    // turns over when the REMAINING span crosses a whole day, so a case sitting
    // exactly on that edge would prove nothing about the minute-to-minute case.
    const start = arenaSeasonStartMs(2) + 5 * HOUR;
    const a = build(start + 10 * DAY);
    const b = build(start + 10 * DAY + MINUTE);
    // Same day bucket and same rounded progress: the 250ms repaint band must
    // skip the rebuild, which is exactly what an equal signature buys.
    expect(a.sig).toBe(b.sig);
    const later = build(start + 40 * DAY);
    expect(later.sig).not.toBe(a.sig);
  });

  it('renders without a readout (offline, cold fetch, or a failed request)', () => {
    const view = build(arenaSeasonStartMs(2) + DAY, null);
    expect(view.kind).toBe('live');
    if (view.kind !== 'live') return;
    expect(view.season).toBe(2);
    expect(view.history).toEqual([]);
  });
});

describe('the settled-champions tail', () => {
  it('groups a settled season into one row per bracket, pair kept together', () => {
    const view = build(arenaSeasonStartMs(2) + DAY, readout());
    expect(view.history).toHaveLength(1);
    const season = view.history[0];
    expect(season.season).toBe(1);
    expect(season.deedId).toBe('feat_arena_season_1_warmaster');
    expect(season.champions.map((c) => c.bracket)).toEqual(['1v1', '2v2']);
    expect(season.champions[0].names).toEqual(['Kaevar']);
    expect(season.champions[0].rating).toBe(1994);
    // Both members of the winning duo ride ONE row, and the row reports the
    // stronger member's rating rather than the first one it happened to see.
    expect(season.champions[1].names).toEqual(['Nilla', 'Brack']);
    expect(season.champions[1].rating).toBe(1902);
    expect(season.champions[1].knownClasses).toEqual([true, true]);
  });

  it('flags an unknown class instead of dropping the champion', () => {
    const view = build(
      arenaSeasonStartMs(2) + DAY,
      readout({
        settled: [
          {
            season: 1,
            deedId: 'feat_arena_season_1_warmaster',
            champions: [{ bracket: '1v1', name: 'Kaevar', cls: 'necromancer', rating: 1800 }],
          },
        ],
      }),
    );
    expect(view.history[0].champions[0].knownClasses).toEqual([false]);
    expect(view.history[0].champions[0].classes).toEqual(['necromancer']);
  });

  it('drops rows a newer or malformed server could send', () => {
    const view = build(
      arenaSeasonStartMs(2) + DAY,
      readout({
        settled: [
          // A season past the authored roster: unrenderable, so it is dropped
          // rather than shown with no title.
          { season: 99, deedId: 'feat_arena_season_99', champions: [] },
          // An unranked bracket can never crown a champion.
          {
            season: 1,
            deedId: 'feat_arena_season_1_warmaster',
            champions: [
              { bracket: 'fiesta', name: 'Party', cls: 'mage', rating: 5000 },
              { bracket: '1v1', name: 'Kaevar', cls: 'warrior', rating: 1994 },
            ],
          },
          // A season whose only champion has no name contributes no row at all.
          {
            season: 2,
            deedId: 'feat_arena_season_2_glorious',
            champions: [{ bracket: '1v1', name: '', cls: 'warrior', rating: 1700 }],
          },
        ],
      }),
    );
    expect(view.history.map((h) => h.season)).toEqual([1]);
    expect(view.history[0].champions).toHaveLength(1);
    expect(view.history[0].champions[0].names).toEqual(['Kaevar']);
  });

  it('orders the tail newest season first', () => {
    const view = build(
      arenaSeasonEndMs(3) + DAY,
      readout({
        settled: [
          {
            season: 1,
            deedId: 'feat_arena_season_1_warmaster',
            champions: [{ bracket: '1v1', name: 'A', cls: 'warrior', rating: 1700 }],
          },
          {
            season: 3,
            deedId: 'feat_arena_season_3_malevolent',
            champions: [{ bracket: '1v1', name: 'C', cls: 'warrior', rating: 1900 }],
          },
          {
            season: 2,
            deedId: 'feat_arena_season_2_glorious',
            champions: [{ bracket: '1v1', name: 'B', cls: 'warrior', rating: 1800 }],
          },
        ],
      }),
    );
    expect(view.history.map((h) => h.season)).toEqual([3, 2, 1]);
  });
});
