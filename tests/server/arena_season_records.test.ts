// The Arena season bout observer's decision core (server/arena_season_records.ts).
//
// This is the rule that decides who counts as an entrant and which of a duo's
// two reports writes the pair row. Both failure modes are silent: a missing
// entrant row quietly disqualifies a real champion, and a double-written pair row
// quietly inflates a duo's bouts-together tie-break. Neither shows up anywhere
// until a season settles half a year later, so the rule is pinned here rather
// than inside the GameServer that calls it.
import { describe, expect, it } from 'vitest';
import { arenaSeasonBoutWrites } from '../../server/arena_season_records';
import { ARENA_PRESEASON } from '../../src/sim/arena_season';

const SELF = 100;
const HIGHER_ALLY = 200;
const LOWER_ALLY = 50;

describe('arenaSeasonBoutWrites', () => {
  it('credits a 1v1 entrant and writes no pair', () => {
    expect(arenaSeasonBoutWrites({ season: 2, format: '1v1', selfCharacterId: SELF })).toEqual({
      entrant: '1v1',
      pair: null,
    });
  });

  it('elects exactly one of a 2v2 duo to write the pair row', () => {
    // The lower character id writes; both members report the same bout, so the
    // other must write nothing or the duo would be counted twice per bout.
    const writer = arenaSeasonBoutWrites({
      season: 2,
      format: '2v2',
      selfCharacterId: SELF,
      allyCharacterId: HIGHER_ALLY,
    });
    const passenger = arenaSeasonBoutWrites({
      season: 2,
      format: '2v2',
      selfCharacterId: HIGHER_ALLY,
      allyCharacterId: SELF,
    });
    expect(writer).toEqual({ entrant: '2v2', pair: [SELF, HIGHER_ALLY] });
    // The passenger is still an ENTRANT: only the pair row is elected away.
    expect(passenger).toEqual({ entrant: '2v2', pair: null });
  });

  it('writes the pair in canonical (low, high) order whichever member reports', () => {
    const writes = arenaSeasonBoutWrites({
      season: 2,
      format: '2v2',
      selfCharacterId: LOWER_ALLY,
      allyCharacterId: SELF,
    });
    expect(writes.pair).toEqual([LOWER_ALLY, SELF]);
  });

  it('still credits the entrant when the ally has no session (a bot or a leaver)', () => {
    expect(arenaSeasonBoutWrites({ season: 2, format: '2v2', selfCharacterId: SELF })).toEqual({
      entrant: '2v2',
      pair: null,
    });
  });

  it('writes nothing for the unranked brackets', () => {
    // Fiesta and Protect Yumi never move the Elo ladder, so they can never
    // contribute to a season's standings.
    for (const format of ['fiesta', 'yumi3', 'yumi5', 'nonsense']) {
      expect(
        arenaSeasonBoutWrites({
          season: 2,
          format,
          selfCharacterId: SELF,
          allyCharacterId: HIGHER_ALLY,
        }),
        format,
      ).toEqual({ entrant: null, pair: null });
    }
  });

  it('writes nothing outside a live season', () => {
    for (const season of [ARENA_PRESEASON, -1, 1.5, Number.NaN]) {
      expect(
        arenaSeasonBoutWrites({
          season,
          format: '2v2',
          selfCharacterId: SELF,
          allyCharacterId: HIGHER_ALLY,
        }),
        String(season),
      ).toEqual({ entrant: null, pair: null });
    }
  });

  it('never pairs a character with itself', () => {
    // The sim cannot produce this, but the ordering CHECK in the DDL would
    // reject the row, so the decision refuses it before the write is attempted.
    expect(
      arenaSeasonBoutWrites({
        season: 2,
        format: '2v2',
        selfCharacterId: SELF,
        allyCharacterId: SELF,
      }).pair,
    ).toBeNull();
  });
});
