import { describe, expect, it } from 'vitest';
import {
  BG_CAPS_TO_WIN,
  BG_MAX_DURATION,
  BG_TEAM_SIZE,
  BG_TIME_WARNINGS,
} from '../src/sim/social/battleground';
import {
  BG_BACKFILL_MIN_SECONDS_LEFT,
  type BgBackfillMatchView,
  bgBackfillSeat,
  pickBgBackfillGroup,
} from '../src/sim/social/battleground_backfill';

// The leaf takes its tuning from the caller rather than importing it back out of
// social/battleground.ts, so these build the view the same way backfillBgMatches
// does. Elapsed seconds in, remaining seconds out: the caller owns that subtraction.
const view = (over: Partial<BgBackfillMatchView> = {}): BgBackfillMatchView => ({
  state: 'active',
  secondsLeft: BG_MAX_DURATION,
  scores: [0, 0],
  teamSizes: [BG_TEAM_SIZE, BG_TEAM_SIZE],
  teamSize: BG_TEAM_SIZE,
  capsToWin: BG_CAPS_TO_WIN,
  ...over,
});

describe('battleground backfill: which match takes a seat', () => {
  it('anchors the time cutoff to the first BG_TIME_WARNINGS call', () => {
    // The leaf holds this as a literal so it imports nothing; that is only
    // honest while the two agree, which is what this pins.
    expect(BG_BACKFILL_MIN_SECONDS_LEFT).toBe(BG_TIME_WARNINGS[0]);
  });

  it('refuses a match that is already full', () => {
    expect(bgBackfillSeat(view())).toBeNull();
  });

  it('names the short team', () => {
    expect(bgBackfillSeat(view({ teamSizes: [BG_TEAM_SIZE - 1, BG_TEAM_SIZE] }))).toBe(0);
    expect(bgBackfillSeat(view({ teamSizes: [BG_TEAM_SIZE, BG_TEAM_SIZE - 1] }))).toBe(1);
  });

  it('seats the emptier side first when both are short, team 0 breaking a tie', () => {
    expect(bgBackfillSeat(view({ teamSizes: [BG_TEAM_SIZE - 1, BG_TEAM_SIZE - 2] }))).toBe(1);
    expect(bgBackfillSeat(view({ teamSizes: [BG_TEAM_SIZE - 2, BG_TEAM_SIZE - 1] }))).toBe(0);
    expect(bgBackfillSeat(view({ teamSizes: [BG_TEAM_SIZE - 1, BG_TEAM_SIZE - 1] }))).toBe(0);
  });

  it('never seats into a finished match, however short or early it looks', () => {
    expect(
      bgBackfillSeat(view({ state: 'ended', teamSizes: [1, BG_TEAM_SIZE], scores: [0, 0] })),
    ).toBeNull();
  });

  it('always refills during form-up, ignoring both active-phase cutoffs', () => {
    // A countdown match has spent no clock and scored nothing, so neither cutoff
    // has a meaning yet; a seat open here is just a match still assembling.
    const forming = view({
      state: 'countdown',
      teamSizes: [BG_TEAM_SIZE - 1, BG_TEAM_SIZE],
      secondsLeft: 0,
      scores: [0, BG_CAPS_TO_WIN - 1],
    });
    expect(bgBackfillSeat(forming)).toBe(0);
  });

  it('stops once the clock is inside the final call', () => {
    const short = { teamSizes: [BG_TEAM_SIZE - 1, BG_TEAM_SIZE] as [number, number] };
    expect(bgBackfillSeat(view({ ...short, secondsLeft: BG_BACKFILL_MIN_SECONDS_LEFT + 1 }))).toBe(
      0,
    );
    expect(
      bgBackfillSeat(view({ ...short, secondsLeft: BG_BACKFILL_MIN_SECONDS_LEFT })),
    ).toBeNull();
    expect(
      bgBackfillSeat(view({ ...short, secondsLeft: BG_BACKFILL_MIN_SECONDS_LEFT - 1 })),
    ).toBeNull();
  });

  it('stops when the short team is one enemy capture from losing', () => {
    const short = { teamSizes: [BG_TEAM_SIZE - 1, BG_TEAM_SIZE] as [number, number] };
    // The SHORT team's opponent is the score that matters: team 0 is short here,
    // so team 1 approaching the cap is what closes the seat.
    expect(bgBackfillSeat(view({ ...short, scores: [0, BG_CAPS_TO_WIN - 2] }))).toBe(0);
    expect(bgBackfillSeat(view({ ...short, scores: [0, BG_CAPS_TO_WIN - 1] }))).toBeNull();
    // The short team being about to WIN is not a reason to refuse the help.
    expect(bgBackfillSeat(view({ ...short, scores: [BG_CAPS_TO_WIN - 1, 0] }))).toBe(0);
  });
});

describe('battleground backfill: which queued group takes the seat', () => {
  it('reports no candidate for an empty queue', () => {
    expect(pickBgBackfillGroup([])).toBe(-1);
  });

  it('never splits a queued group, however long it has waited', () => {
    expect(
      pickBgBackfillGroup([
        { size: 2, waited: 900 },
        { size: 5, waited: 900 },
      ]),
    ).toBe(-1);
  });

  it('takes the longest-waiting solo', () => {
    expect(
      pickBgBackfillGroup([
        { size: 1, waited: 5 },
        { size: 3, waited: 999 },
        { size: 1, waited: 40 },
        { size: 1, waited: 12 },
      ]),
    ).toBe(2);
  });

  it('breaks an exact wait tie by queue order', () => {
    expect(
      pickBgBackfillGroup([
        { size: 4, waited: 30 },
        { size: 1, waited: 30 },
        { size: 1, waited: 30 },
      ]),
    ).toBe(1);
  });
});
