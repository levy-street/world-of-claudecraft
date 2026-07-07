import { describe, expect, it } from 'vitest';
import { GAUNTLET } from '../src/sim/content/gauntlet';
import type { GauntletPhase, GauntletRunView } from '../src/sim/types';
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
