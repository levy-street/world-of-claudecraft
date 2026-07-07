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
    finished: false,
    originX: 9000,
    originZ: -1250,
    sentinel: { light: 'green', until: 105, fieldLength: 90 },
    sigils: null,
    pull: null,
    wager: null,
    span: null,
    court: null,
    podium: null,
    ...over,
  };
}

describe('gauntletHudModel', () => {
  it('hides when there is no run', () => {
    const m = gauntletHudModel({ run: null, time: 42 });
    expect(m.visible).toBe(false);
    expect(m.showCountdown).toBe(false);
    expect(m.showLight).toBe(false);
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

  it('surfaces the red sentinel light during the crossing trial', () => {
    const m = gauntletHudModel({
      run: run({ sentinel: { light: 'red', until: 120, fieldLength: 90 } }),
      time: 118,
    });
    expect(m.light).toBe('red');
    expect(m.showLight).toBe(true);
  });

  it('reports no light outside the sentinel trial', () => {
    const m = gauntletHudModel({ run: run({ phase: 'interlude', sentinel: null }), time: 0 });
    expect(m.light).toBeNull();
    expect(m.showLight).toBe(false);
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

  it('passes the raw prize pool copper through for the painter to format', () => {
    const m = gauntletHudModel({ run: run({ prizePool: 37500 }), time: 0 });
    expect(m.prizePool).toBe(37500);
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
