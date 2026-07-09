import { describe, expect, it } from 'vitest';
import { GAUNTLET } from '../src/sim/content/gauntlet';
import type { GauntletPhase, GauntletRunView } from '../src/sim/types';
import { GauntletClock } from '../src/ui/gauntlet_clock';
import { type GauntletHudInput, gauntletHudModel } from '../src/ui/gauntlet_hud_view';

// A fully-populated run view; individual tests override the fields they exercise.
function run(over: Partial<GauntletRunView> = {}): GauntletRunView {
  return {
    phase: 'trial',
    trialIndex: 0,
    trialCount: 1,
    endsAt: 400,
    survivors: 12,
    total: 24,
    prizePool: 37500,
    vitality: 70,
    vitalityMax: 100,
    spectating: false,
    practice: false,
    finished: false,
    originX: 9000,
    originZ: -1250,
    board: [],
    sentinel: { light: 'green', until: 105, fieldLength: 90 },
    sigils: null,
    pull: null,
    echo: null,
    span: null,
    podium: null,
    ...over,
  };
}

describe('gauntletHudModel', () => {
  it('hides when there is no run', () => {
    const m = gauntletHudModel({ run: null, time: 42 });
    expect(m.visible).toBe(false);
    expect(m.showCountdown).toBe(false);
  });

  it('is a pure function of its input (same input, same output)', () => {
    const input: GauntletHudInput = { run: run(), time: 250 };
    expect(gauntletHudModel(input)).toEqual(gauntletHudModel(input));
  });

  it('derives the countdown seconds from the absolute endsAt minus time', () => {
    const m = gauntletHudModel({ run: run({ endsAt: 400 }), time: 388 });
    expect(m.countdownSeconds).toBe(12);
  });

  it('clamps the countdown to zero once the deadline has passed', () => {
    const m = gauntletHudModel({ run: run({ endsAt: 400 }), time: 412 });
    expect(m.countdownSeconds).toBe(0);
    expect(m.countdownFrac).toBe(0);
  });

  it('fills the countdown bar against the current trial window', () => {
    // A trial phase normalizes against the sentinel trial duration.
    const half = GAUNTLET.sentinel.durationS / 2;
    const m = gauntletHudModel({ run: run({ phase: 'trial', endsAt: 1000 }), time: 1000 - half });
    expect(m.countdownFrac).toBeCloseTo(0.5, 6);
  });

  it('normalizes the vitality fraction and passes the raw values through', () => {
    const m = gauntletHudModel({ run: run({ vitality: 30, vitalityMax: 100 }), time: 0 });
    expect(m.vitalityFrac).toBeCloseTo(0.3, 6);
    expect(m.vitalityValue).toBe(30);
    expect(m.vitalityMax).toBe(100);
  });

  it('carries the spectating flag through', () => {
    const m = gauntletHudModel({ run: run({ spectating: true }), time: 0 });
    expect(m.spectating).toBe(true);
  });

  it('passes the podium standings through unchanged', () => {
    const podium = { first: 'Bram Thistledown', second: 'Odessa Marshlight', third: 'Finn Pinch' };
    const m = gauntletHudModel({ run: run({ phase: 'podium', podium, sentinel: null }), time: 0 });
    expect(m.podium).toEqual(podium);
  });

  it('hides the countdown only once the run is done', () => {
    const phases: GauntletPhase[] = ['lobby', 'staging', 'trial', 'interlude', 'podium'];
    for (const phase of phases) {
      expect(gauntletHudModel({ run: run({ phase, sentinel: null }), time: 0 }).showCountdown).toBe(
        true,
      );
    }
    expect(
      gauntletHudModel({ run: run({ phase: 'done', sentinel: null }), time: 0 }).showCountdown,
    ).toBe(false);
  });

  // An echo round: 4-step sequence flashing from t=100 (0.7s steps, so the
  // watch phase ends at 102.8), answers accepted until t=112.
  const echoRun = (over: Partial<NonNullable<GauntletRunView['echo']>> = {}) =>
    run({
      sentinel: null,
      echo: {
        stones: 4,
        round: 1,
        rounds: 5,
        seq: [0, 2, 1, 3],
        showStartAt: 100,
        stepS: 0.7,
        inputEndsAt: 112,
        progress: 0,
        done: false,
        ...over,
      },
    });

  it('shows the echo strip only during a live duel', () => {
    expect(gauntletHudModel({ run: run(), time: 0 }).echo).toBeNull();
    expect(gauntletHudModel({ run: echoRun({ done: true }), time: 100 }).echo).toBeNull();
    expect(gauntletHudModel({ run: echoRun(), time: 100 }).echo).not.toBeNull();
  });

  it('reports the 1-based round and hides the clock while the stones flash', () => {
    const watching = gauntletHudModel({ run: echoRun(), time: 101 });
    expect(watching.echo?.round).toBe(2);
    expect(watching.echo?.rounds).toBe(5);
    expect(watching.echo?.answerSeconds).toBeNull();
    const answering = gauntletHudModel({ run: echoRun(), time: 104 });
    expect(answering.echo?.answerSeconds).toBeCloseTo(8, 6);
    const expired = gauntletHudModel({ run: echoRun(), time: 120 });
    expect(expired.echo?.answerSeconds).toBe(0);
  });

  it('shows the tutorial banner for the WHOLE staging and interlude (tied to the cooldown bar)', () => {
    // GAUNTLET.trials: sentinel, sigils, pull, echo, span, court.
    const staging = run({ phase: 'staging', trialIndex: 0, endsAt: 100, sentinel: null });
    // The full phase shows it now, early AND late, not just the last seconds.
    expect(gauntletHudModel({ run: staging, time: 1 }).tutorial).toBe('sentinel');
    expect(gauntletHudModel({ run: staging, time: 99 }).tutorial).toBe('sentinel');
    // An interlude teaches the NEXT trial (trialIndex is the one just played),
    // for the whole cooldown, not only near the end.
    const interlude = run({ phase: 'interlude', trialIndex: 1, endsAt: 100, sentinel: null });
    expect(gauntletHudModel({ run: interlude, time: 1 }).tutorial).toBe('pull');
    expect(gauntletHudModel({ run: interlude, time: 97 }).tutorial).toBe('pull');
    // The echo teaches its watch phase.
    const beforeEcho = run({ phase: 'interlude', trialIndex: 2, endsAt: 100, sentinel: null });
    expect(gauntletHudModel({ run: beforeEcho, time: 97 }).tutorial).toBe('echoWatch');
  });

  it('shows no tutorial during a trial, for spectators, or past the last trial', () => {
    expect(gauntletHudModel({ run: run(), time: 0 }).tutorial).toBeNull(); // live trial
    const spectator = run({ phase: 'staging', endsAt: 100, sentinel: null, spectating: true });
    expect(gauntletHudModel({ run: spectator, time: 97 }).tutorial).toBeNull();
    const lastDone = run({
      phase: 'interlude',
      trialIndex: GAUNTLET.trials.length - 1,
      endsAt: 100,
      sentinel: null,
    });
    expect(gauntletHudModel({ run: lastDone, time: 97 }).tutorial).toBeNull();
    expect(gauntletHudModel({ run: null, time: 0 }).tutorial).toBeNull();
  });
});

describe('GauntletClock calibration', () => {
  const lobby = (over: Partial<GauntletRunView> = {}) =>
    run({ phase: 'lobby', endsAt: 60, sentinel: null, ...over });

  it('counts down from the full window when anchored at a phase start', () => {
    const clock = new GauntletClock();
    const t0 = clock.estimate(lobby(), 10_000);
    expect(lobby().endsAt - t0).toBeCloseTo(GAUNTLET.lobbyFillS, 6);
    const t5 = clock.estimate(lobby(), 15_000);
    expect(lobby().endsAt - t5).toBeCloseTo(GAUNTLET.lobbyFillS - 5, 6);
  });

  it('snaps onto the true remaining time when a sim sample calibrates it', () => {
    // A late joiner anchors mid-phase (would read the full window)...
    const clock = new GauntletClock();
    clock.estimate(lobby(), 10_000);
    // ...then the join's gauntletPhase event says only 20s actually remain.
    clock.calibrate(20, 10_000);
    const t = clock.estimate(lobby(), 10_000);
    expect(lobby().endsAt - t).toBeCloseTo(20, 6);
    // and it keeps ticking down from the calibrated point, not the full window.
    const t4 = clock.estimate(lobby(), 14_000);
    expect(lobby().endsAt - t4).toBeCloseTo(16, 6);
  });

  it('clamps an out-of-range sample into the phase window', () => {
    const clock = new GauntletClock();
    clock.estimate(lobby(), 10_000);
    clock.calibrate(9999, 10_000);
    const t = clock.estimate(lobby(), 10_000);
    expect(lobby().endsAt - t).toBeCloseTo(GAUNTLET.lobbyFillS, 6);
    clock.calibrate(-5, 10_000);
    const t2 = clock.estimate(lobby(), 10_000);
    expect(lobby().endsAt - t2).toBeCloseTo(0, 6);
  });

  it('a phase flip re-anchors and discards nothing it should keep', () => {
    const clock = new GauntletClock();
    clock.calibrate(20, 10_000);
    clock.estimate(lobby(), 10_000);
    // Flip to staging: new key, fresh anchor at the full staging window.
    const staging = run({ phase: 'staging', endsAt: 200, sentinel: null });
    const t = clock.estimate(staging, 30_000);
    expect(staging.endsAt - t).toBeCloseTo(GAUNTLET.stagingS, 6);
  });
});
