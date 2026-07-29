// Arena season settlement: the champion picker and the self-clocked driver.
//
// The picker is where a season is actually decided, so its tie-breaks get
// per-dimension negative cases: two characters really can share a rating, and an
// award that depended on which row Postgres returned first would be a silent
// coin flip. The driver's contract is narrower but sharper: settle every closed
// season exactly once, never before it closes, and never twice when a peer
// process wins the race.
//
// No database here. Both halves take injected deps (the module's whole shape),
// so the suite drives real season boundaries through a fake clock.
import { describe, expect, it, vi } from 'vitest';
import type {
  ArenaSeasonPairCandidate,
  ArenaSeasonSoloCandidate,
} from '../../server/arena_season_db';
import {
  type ArenaSeasonAward,
  type ArenaSeasonSettlerDeps,
  createArenaSeasonSettler,
  oldestUnsettledArenaSeason,
  pickArenaSeasonChampions,
} from '../../server/arena_season_settlement';
import {
  ARENA_PRESEASON,
  ARENA_SEASON_EPOCH_MS,
  arenaSeasonEndMs,
  arenaSeasonIndexAt,
  arenaSeasonStartMs,
} from '../../src/sim/arena_season';

const REALM = 'testrealm';
const DAY = 86_400_000;

let nextId = 1;
function solo(over: Partial<ArenaSeasonSoloCandidate> = {}): ArenaSeasonSoloCandidate {
  const id = nextId++;
  return {
    characterId: id,
    accountId: 1000 + id,
    name: `Char${id}`,
    cls: 'warrior',
    rating: 1500,
    wins: 0,
    losses: 0,
    bouts: 1,
    ...over,
  };
}

function pair(
  a: Partial<ArenaSeasonSoloCandidate>,
  b: Partial<ArenaSeasonSoloCandidate>,
  bouts = 1,
): ArenaSeasonPairCandidate {
  const left = solo(a);
  const right = solo(b);
  return {
    a: { ...left },
    b: { ...right },
    bouts,
  };
}

describe('pickArenaSeasonChampions', () => {
  it('awards the top 1v1 entrant and BOTH members of the top 2v2 duo one title', () => {
    const awards = pickArenaSeasonChampions({
      season: 1,
      solo: [solo({ name: 'Mid', rating: 1700 }), solo({ name: 'Top', rating: 1900 })],
      pairs: [
        pair({ name: 'LowA', rating: 1600 }, { name: 'LowB', rating: 1610 }),
        pair({ name: 'BestA', rating: 1800 }, { name: 'BestB', rating: 1790 }),
      ],
    });
    expect(awards.map((a) => a.name)).toEqual(['Top', 'BestA', 'BestB']);
    expect(awards.map((a) => a.bracket)).toEqual(['1v1', '2v2', '2v2']);
    // ONE title per season, worn by every champion of it (the design decision in
    // src/sim/content/arena_seasons.ts).
    expect(new Set(awards.map((a) => a.deedId))).toEqual(
      new Set(['feat_arena_season_1_warmaster']),
    );
    // Each award records the winner's own rating, not the pair's combined score.
    expect(awards[1].rating).toBe(1800);
    expect(awards[2].rating).toBe(1790);
  });

  it('breaks a 1v1 rating tie by wins, then season bouts, then name', () => {
    const byWins = pickArenaSeasonChampions({
      season: 1,
      solo: [
        solo({ name: 'Fewer', rating: 1800, wins: 10 }),
        solo({ name: 'More', rating: 1800, wins: 40 }),
      ],
      pairs: [],
    });
    expect(byWins[0].name).toBe('More');

    const byBouts = pickArenaSeasonChampions({
      season: 1,
      solo: [
        solo({ name: 'Quiet', rating: 1800, wins: 10, bouts: 3 }),
        solo({ name: 'Busy', rating: 1800, wins: 10, bouts: 30 }),
      ],
      pairs: [],
    });
    expect(byBouts[0].name).toBe('Busy');

    // Fully tied: the name decides, so the same input always names the same
    // champion whatever order the planner returned the rows in.
    const forward = pickArenaSeasonChampions({
      season: 1,
      solo: [
        solo({ name: 'Zara', rating: 1800, wins: 10, bouts: 5 }),
        solo({ name: 'Alba', rating: 1800, wins: 10, bouts: 5 }),
      ],
      pairs: [],
    });
    const reversed = pickArenaSeasonChampions({
      season: 1,
      solo: [
        solo({ name: 'Alba', rating: 1800, wins: 10, bouts: 5 }),
        solo({ name: 'Zara', rating: 1800, wins: 10, bouts: 5 }),
      ],
      pairs: [],
    });
    expect(forward[0].name).toBe('Alba');
    expect(reversed[0].name).toBe('Alba');
  });

  it('ranks duos on COMBINED rating, then bouts together, then the pair names', () => {
    // A duo with one very strong member loses to a more even, higher-summing
    // duo: the bracket is a team bracket, so the team's total is the score.
    const combined = pickArenaSeasonChampions({
      season: 1,
      solo: [],
      pairs: [
        pair({ name: 'Star', rating: 2100 }, { name: 'Anchor', rating: 1400 }),
        pair({ name: 'EvenA', rating: 1800 }, { name: 'EvenB', rating: 1790 }),
      ],
    });
    expect(combined.map((a) => a.name)).toEqual(['EvenA', 'EvenB']);

    const byBouts = pickArenaSeasonChampions({
      season: 1,
      solo: [],
      pairs: [
        pair({ name: 'OneA', rating: 1800 }, { name: 'OneB', rating: 1800 }, 1),
        pair({ name: 'ManyA', rating: 1800 }, { name: 'ManyB', rating: 1800 }, 25),
      ],
    });
    expect(byBouts.map((a) => a.name)).toEqual(['ManyA', 'ManyB']);
  });

  it('awards only the contested bracket when the other had no entrants', () => {
    const soloOnly = pickArenaSeasonChampions({
      season: 1,
      solo: [solo({ name: 'Alone', rating: 1600 })],
      pairs: [],
    });
    expect(soloOnly.map((a) => a.bracket)).toEqual(['1v1']);

    const pairOnly = pickArenaSeasonChampions({
      season: 1,
      solo: [],
      pairs: [pair({ name: 'DuoA' }, { name: 'DuoB' })],
    });
    expect(pairOnly.map((a) => a.bracket)).toEqual(['2v2', '2v2']);

    expect(pickArenaSeasonChampions({ season: 1, solo: [], pairs: [] })).toEqual([]);
  });

  it('awards nothing for a season the content roster does not define', () => {
    // The calendar outruns the roster by design; a season with no authored title
    // must not fall back to a neighbouring season's deed.
    const awards = pickArenaSeasonChampions({
      season: 99,
      solo: [solo({ name: 'Top', rating: 2000 })],
      pairs: [pair({ name: 'A' }, { name: 'B' })],
    });
    expect(awards).toEqual([]);
  });
});

describe('oldestUnsettledArenaSeason (the retention floor)', () => {
  // The bug this exists to prevent: prune with a LIVE-season floor and the rows
  // of a just-closed, not-yet-settled season are eligible the instant the
  // boundary passes. That season then settles with zero champions and stamps
  // its exactly-once marker, so the title is gone permanently and silently.
  it('never floors at the live season while a closed one is unsettled', () => {
    const justAfterSeason1Closed = arenaSeasonEndMs(1) + 60_000;
    const live = arenaSeasonIndexAt(justAfterSeason1Closed);
    expect(live).toBe(2);
    // Season 1 has closed and nothing has settled it yet: it must be KEPT, so
    // the floor is 1 and `season < 1` deletes nothing.
    expect(oldestUnsettledArenaSeason(justAfterSeason1Closed, new Set())).toBe(1);
    expect(oldestUnsettledArenaSeason(justAfterSeason1Closed, new Set())).toBeLessThan(live);
  });

  it('releases a season only once it is settled', () => {
    const inSeason3 = arenaSeasonStartMs(3) + DAY;
    // 1 settled, 2 still outstanding: the floor holds at 2, so season 1's rows
    // are prunable and season 2's are not.
    expect(oldestUnsettledArenaSeason(inSeason3, new Set([1]))).toBe(2);
    // Both settled: only the live season is still being written to.
    expect(oldestUnsettledArenaSeason(inSeason3, new Set([1, 2]))).toBe(3);
  });

  it('holds at the OLDEST outstanding season across a multi-season catch-up', () => {
    // The catch-up path the design supports: a realm down across boundaries
    // wakes with several seasons unsettled. Flooring at anything newer than the
    // oldest would delete rows a pending settlement still has to rank over.
    const inSeason5 = arenaSeasonStartMs(5) + DAY;
    expect(oldestUnsettledArenaSeason(inSeason5, new Set([1, 3]))).toBe(2);
    expect(oldestUnsettledArenaSeason(inSeason5, new Set([2, 3, 4]))).toBe(1);
  });

  it('floors at the live season in Preseason and once everything has settled', () => {
    // Before the calendar opens nothing has closed, so there is nothing to keep.
    expect(oldestUnsettledArenaSeason(ARENA_SEASON_EPOCH_MS - DAY, new Set())).toBe(
      ARENA_PRESEASON,
    );
    const inSeason2 = arenaSeasonStartMs(2) + DAY;
    expect(oldestUnsettledArenaSeason(inSeason2, new Set([1]))).toBe(2);
  });
});

/** A settler over a fake clock and in-memory ledgers. */
function makeSettler(over: Partial<ArenaSeasonSettlerDeps> = {}) {
  const settled = new Set<number>();
  const committed: { season: number; awards: readonly ArenaSeasonAward[] }[] = [];
  const info: string[] = [];
  const errors: unknown[] = [];
  let clock = arenaSeasonEndMs(1) + DAY;
  const deps: ArenaSeasonSettlerDeps = {
    realm: REALM,
    now: () => clock,
    settledSeasons: vi.fn(async () => new Set(settled)),
    soloCandidates: vi.fn(async () => [solo({ name: 'Top', rating: 1900 })]),
    pairCandidates: vi.fn(async () => [pair({ name: 'DuoA' }, { name: 'DuoB' })]),
    commit: vi.fn(async (_realm, season, awards) => {
      if (settled.has(season)) return false;
      settled.add(season);
      committed.push({ season, awards });
      return true;
    }),
    onInfo: (line) => info.push(line),
    onError: (err) => errors.push(err),
    ...over,
  };
  return {
    deps,
    settled,
    committed,
    info,
    errors,
    settler: createArenaSeasonSettler(deps),
    setClock: (ms: number) => {
      clock = ms;
    },
  };
}

describe('the settlement driver', () => {
  it('settles a closed season once and never again', async () => {
    const rig = makeSettler();
    expect(await rig.settler.runOnce()).toEqual([1]);
    expect(rig.committed).toHaveLength(1);
    expect(rig.committed[0].awards.map((a) => a.name)).toEqual(['Top', 'DuoA', 'DuoB']);
    // The second pass finds the marker and reads no candidates at all.
    (rig.deps.soloCandidates as ReturnType<typeof vi.fn>).mockClear();
    expect(await rig.settler.runOnce()).toEqual([]);
    expect(rig.deps.soloCandidates).not.toHaveBeenCalled();
  });

  it('settles nothing while the season is still running', async () => {
    const rig = makeSettler();
    rig.setClock(arenaSeasonStartMs(1) + DAY);
    expect(await rig.settler.runOnce()).toEqual([]);
    expect(rig.deps.settledSeasons).not.toHaveBeenCalled();
    // And nothing at all before the calendar even opens.
    rig.setClock(arenaSeasonStartMs(1) - DAY);
    expect(await rig.settler.runOnce()).toEqual([]);
    expect(rig.committed).toEqual([]);
  });

  it('catches up in order after a realm was down across several boundaries', async () => {
    const rig = makeSettler();
    rig.setClock(arenaSeasonEndMs(3) + DAY);
    expect(await rig.settler.runOnce()).toEqual([1, 2, 3]);
    expect(rig.committed.map((c) => c.season)).toEqual([1, 2, 3]);
    // Season 4 is still live and is deliberately left alone.
    expect(rig.settled.has(4)).toBe(false);
  });

  it('writes nothing and says so when a peer process wins the commit race', async () => {
    const awarded = vi.fn();
    const rig = makeSettler({ commit: vi.fn(async () => false), onAwarded: awarded });
    expect(await rig.settler.runOnce()).toEqual([]);
    expect(rig.info.join('\n')).toContain('settled by a peer process');
    // The peer notifies its own online champions; re-granting here would be
    // acting on a commit this process did not make.
    expect(awarded).not.toHaveBeenCalled();
  });

  it('hands a won season straight to the in-place delivery hook', async () => {
    const awarded = vi.fn();
    const rig = makeSettler({ onAwarded: awarded });
    await rig.settler.runOnce();
    expect(awarded).toHaveBeenCalledTimes(1);
    expect(awarded.mock.calls[0][0].map((a: ArenaSeasonAward) => a.name)).toEqual([
      'Top',
      'DuoA',
      'DuoB',
    ]);
  });

  it('does not call the delivery hook for a season with no champions', async () => {
    const awarded = vi.fn();
    const rig = makeSettler({
      soloCandidates: vi.fn(async () => []),
      pairCandidates: vi.fn(async () => []),
      onAwarded: awarded,
    });
    expect(await rig.settler.runOnce()).toEqual([1]);
    expect(awarded).not.toHaveBeenCalled();
  });

  it('survives a throwing delivery hook and keeps settling later seasons', async () => {
    // The award is already durable when the hook runs, so a fault in the live
    // delivery must be reported and stepped over, never abort the catch-up.
    const boom = new Error('session lookup failed');
    const rig = makeSettler({
      onAwarded: vi.fn(() => {
        throw boom;
      }),
    });
    rig.setClock(arenaSeasonEndMs(2) + DAY);
    expect(await rig.settler.runOnce()).toEqual([1, 2]);
    expect(rig.errors).toEqual([boom, boom]);
  });

  it('still settles (and marks) a season nobody contested', async () => {
    const rig = makeSettler({
      soloCandidates: vi.fn(async () => []),
      pairCandidates: vi.fn(async () => []),
    });
    expect(await rig.settler.runOnce()).toEqual([1]);
    expect(rig.committed[0].awards).toEqual([]);
    expect(rig.info.join('\n')).toContain('no champions');
  });

  it('skips a closed season with no authored title, and keeps going', async () => {
    const rig = makeSettler();
    // Far past the ten authored seasons: the unauthored ones are logged and
    // skipped WITHOUT a marker, so authoring them later still settles them.
    rig.setClock(arenaSeasonEndMs(11) + DAY);
    const committed = await rig.settler.runOnce();
    expect(committed).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(rig.settled.has(11)).toBe(false);
    expect(rig.info.join('\n')).toContain('no authored title');
    // Reported ONCE per process, not once per five-minute poll forever: the skip
    // is permanent once the calendar outruns the roster.
    const unauthoredLines = () => rig.info.filter((l) => l.includes('no authored title')).length;
    expect(unauthoredLines()).toBe(1);
    await rig.settler.runOnce();
    await rig.settler.runOnce();
    expect(unauthoredLines()).toBe(1);
  });

  it('reports a read failure without wedging the next run', async () => {
    const boom = new Error('database unavailable');
    let fail = true;
    const rig = makeSettler({
      soloCandidates: vi.fn(async () => {
        if (fail) throw boom;
        return [solo({ name: 'Top', rating: 1900 })];
      }),
    });
    expect(await rig.settler.runOnce()).toEqual([]);
    expect(rig.errors).toEqual([boom]);
    expect(rig.committed).toEqual([]);
    fail = false;
    expect(await rig.settler.runOnce()).toEqual([1]);
  });

  it('never overlaps itself, so a slow run cannot be re-entered by the poll', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const rig = makeSettler({
      soloCandidates: vi.fn(async () => {
        await gate;
        return [solo({ name: 'Top', rating: 1900 })];
      }),
    });
    const first = rig.settler.runOnce();
    // The re-entrant call must bail immediately rather than reading the same
    // candidates a second time and double-committing.
    expect(await rig.settler.runOnce()).toEqual([]);
    expect(rig.deps.soloCandidates).toHaveBeenCalledTimes(1);
    release();
    expect(await first).toEqual([1]);
  });
});
