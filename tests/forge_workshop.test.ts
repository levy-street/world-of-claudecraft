import { describe, expect, it } from 'vitest';
import {
  advanceForgeWorkshop,
  createForgeWorkshop,
  FORGE_BAND_HALF,
  FORGE_BAND_MIN_HALF,
  FORGE_BAND_SHRINK,
  FORGE_CLOCK_INTERVAL,
  FORGE_COUNTDOWN_SECONDS,
  FORGE_GOLD_SECONDS,
  FORGE_HEAT_DECAY,
  FORGE_HEAT_FLOOR,
  FORGE_MAX_MISTAKES,
  FORGE_SILVER_SECONDS,
  FORGE_STOKE_COOLDOWN,
  FORGE_STOKE_HEAT,
  FORGE_STRIKES,
  FORGE_WRONG_PENALTY,
  forgeBandCentre,
  forgeHeatAt,
  forgeNeedleAt,
  forgeResult,
  stokeForge,
  strikeForge,
} from '../src/sim/minigames/forge_workshop';
import { decodeForgeState } from '../src/sim/world_quest_forge_wire';

/** First time at or after `from` when the needle sits in the band. */
function nextBandTime(state: ReturnType<typeof createForgeWorkshop>, from: number): number {
  for (let t = from; t < from + 10; t += 0.01) {
    if (Math.abs(forgeNeedleAt(state, t) - state.band) <= state.bandHalf) return t;
  }
  throw new Error('needle never entered the band');
}

describe('forge workshop timing hammer', () => {
  it('publishes the authoritative clock at five Hz and flips to working at the countdown', () => {
    const state = createForgeWorkshop(7, 100);
    expect(state.phase).toBe('countdown');
    expect(state.readyAt).toBe(100 + FORGE_COUNTDOWN_SECONDS);
    expect(advanceForgeWorkshop(state, 100.1)).toBe(false);
    expect(advanceForgeWorkshop(state, 100 + FORGE_CLOCK_INTERVAL)).toBe(true);
    expect(advanceForgeWorkshop(state, 103)).toBe(true);
    expect(state.phase).toBe('working');
  });

  it('sweeps the needle deterministically and quickens it with every strike', () => {
    const state = createForgeWorkshop(7, 0);
    expect(forgeNeedleAt(state, state.startedAt)).toBe(0);
    expect(forgeNeedleAt(state, state.startedAt + 0.5 / 0.55)).toBeCloseTo(0.5, 6);
    expect(forgeNeedleAt(state, state.startedAt + 1 / 0.55)).toBeCloseTo(1, 6);
    expect(forgeNeedleAt(state, state.startedAt + 1.5 / 0.55)).toBeCloseTo(0.5, 6);
    const later = { ...state, strikes: 5 };
    expect(forgeNeedleAt(later, state.startedAt + 0.5 / 0.55)).toBeGreaterThan(0.5);
    expect(forgeBandCentre(7, 3)).toBe(forgeBandCentre(7, 3));
    expect(forgeBandCentre(7, 3)).not.toBe(forgeBandCentre(7, 4));
    for (let k = 0; k < 20; k++) {
      expect(forgeBandCentre(99, k)).toBeGreaterThanOrEqual(0.15);
      expect(forgeBandCentre(99, k)).toBeLessThanOrEqual(0.85);
    }
  });

  it('cools the forge lazily from the last sample and stokes it back on a cooldown', () => {
    const state = createForgeWorkshop(3, 0);
    const start = state.readyAt;
    expect(forgeHeatAt(state, start)).toBe(100);
    expect(forgeHeatAt(state, start + 2)).toBeCloseTo(100 - 2 * FORGE_HEAT_DECAY, 6);
    expect(stokeForge(state, start - 1)).toBe(false);
    expect(stokeForge(state, start + 2)).toBe(true);
    // One throw of wood never refills a cooling forge on its own.
    expect(state.heat).toBeCloseTo(Math.min(100, 100 - 2 * FORGE_HEAT_DECAY + FORGE_STOKE_HEAT), 6);
    expect(state.heat).toBeLessThan(100);
    expect(stokeForge(state, start + 2 + FORGE_STOKE_COOLDOWN / 2)).toBe(false);
    expect(stokeForge(state, start + 2 + FORGE_STOKE_COOLDOWN)).toBe(true);
    const cold = { ...createForgeWorkshop(3, 0) };
    cold.heat = 40;
    cold.heatAt = start;
    expect(stokeForge(cold, start + 1)).toBe(true);
    expect(cold.heat).toBeCloseTo(40 - FORGE_HEAT_DECAY + FORGE_STOKE_HEAT, 6);
    expect(cold.feedback).toBe('stoked');
  });

  it('lands a blow in the band, narrows the band, refuses spam, and charges misses and cold strikes', () => {
    const state = createForgeWorkshop(11, 0);
    expect(strikeForge(state, state.readyAt - 0.5)).toBe(false);
    const t1 = nextBandTime(state, state.readyAt);
    expect(strikeForge(state, t1)).toBe(true);
    expect(state.strikes).toBe(1);
    expect(state.feedback).toBe('hit');
    expect(state.bandHalf).toBeCloseTo(FORGE_BAND_HALF - FORGE_BAND_SHRINK, 6);
    expect(strikeForge(state, t1 + 0.1)).toBe(false);
    // A blow outside the band costs a mistake and never lands.
    let miss = t1 + 0.4;
    while (Math.abs(forgeNeedleAt(state, miss) - state.band) <= state.bandHalf) miss += 0.05;
    expect(strikeForge(state, miss)).toBe(true);
    expect(state.mistakes).toBe(1);
    expect(state.feedback).toBe('miss');
    expect(state.strikes).toBe(1);
    // A cold forge turns even a perfect blow into a mistake.
    state.heat = FORGE_HEAT_FLOOR - 1;
    state.heatAt = miss + 1;
    const t2 = nextBandTime(state, miss + 1);
    expect(strikeForge(state, t2)).toBe(true);
    expect(state.feedback).toBe('cold');
    expect(state.mistakes).toBe(2);
    expect(state.strikes).toBe(1);
  });

  it('fails the minigame on the third mistake and locks out further input', () => {
    const state = createForgeWorkshop(11, 0);
    let t = state.readyAt;
    for (let i = 0; i < FORGE_MAX_MISTAKES; i++) {
      while (Math.abs(forgeNeedleAt(state, t) - state.band) <= state.bandHalf) t += 0.05;
      expect(strikeForge(state, t)).toBe(true);
      expect(state.mistakes).toBe(i + 1);
      t = state.lockUntil + 0.01;
    }
    expect(state.phase).toBe('failed');
    expect(strikeForge(state, t + 1)).toBe(false);
    expect(stokeForge(state, t + 1)).toBe(false);
    expect(advanceForgeWorkshop(state, t + 2)).toBe(false);
  });

  it('finishes on the tenth blow with the band floored and a medal from adjusted time', () => {
    const state = createForgeWorkshop(5, 0);
    let t = state.readyAt;
    while (state.phase !== 'success') {
      if (forgeHeatAt(state, t) < FORGE_HEAT_FLOOR + 5 && stokeForge(state, t)) continue;
      t = nextBandTime(state, Math.max(t, state.lockUntil));
      expect(strikeForge(state, t)).toBe(true);
    }
    expect(state.strikes).toBe(FORGE_STRIKES);
    expect(state.mistakes).toBe(0);
    expect(state.bandHalf).toBeGreaterThanOrEqual(FORGE_BAND_MIN_HALF);
    expect(state.result?.rating).toBe('gold');
    expect(state.result?.elapsed).toBeCloseTo(t - state.startedAt, 6);
    expect(strikeForge(state, t + 5)).toBe(false);
    expect(stokeForge(state, t + 5)).toBe(false);
  });

  it('awards all medals from adjusted time, with inclusive thresholds', () => {
    expect(forgeResult(FORGE_GOLD_SECONDS, 0).rating).toBe('gold');
    expect(forgeResult(FORGE_GOLD_SECONDS - FORGE_WRONG_PENALTY, 1).rating).toBe('gold');
    expect(forgeResult(FORGE_GOLD_SECONDS + 0.01, 0).rating).toBe('silver');
    expect(forgeResult(FORGE_SILVER_SECONDS, 0).rating).toBe('silver');
    expect(forgeResult(FORGE_SILVER_SECONDS + 0.01, 0).rating).toBe('bronze');
  });

  it('round-trips the owner readout on the wire and rejects a forged or inconsistent one', () => {
    const state = createForgeWorkshop(9, 50);
    expect(decodeForgeState(state, 'wq_evergarden_forging')).toEqual(state);
    expect(decodeForgeState(state, 'wq_other')).toBeUndefined();
    expect(
      decodeForgeState({ ...state, strikes: FORGE_STRIKES }, 'wq_evergarden_forging'),
    ).toBeUndefined();
    expect(decodeForgeState({ ...state, heat: 140 }, 'wq_evergarden_forging')).toBeUndefined();
    expect(decodeForgeState({ ...state, band: 1.4 }, 'wq_evergarden_forging')).toBeUndefined();
    expect(
      decodeForgeState({ ...state, feedback: 'correct' }, 'wq_evergarden_forging'),
    ).toBeUndefined();
    const done = { ...state, phase: 'success' as const, strikes: FORGE_STRIKES };
    expect(decodeForgeState(done, 'wq_evergarden_forging')).toBeUndefined();
    const withResult = { ...done, result: forgeResult(30, 1) };
    expect(decodeForgeState(withResult, 'wq_evergarden_forging')?.result?.rating).toBe('gold');
  });
});
