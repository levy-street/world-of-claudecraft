import { describe, expect, it } from 'vitest';
import { applyGliderBoost } from '../src/sim/minigames/glider_boost';
import { createGliderFlightState } from '../src/sim/minigames/glider_flight';

describe('manual glider boost', () => {
  it('adds fourteen airspeed without changing vertical velocity and caps at thirty-eight', () => {
    const state = createGliderFlightState(false);
    state.speed = 8;
    state.vy = -9;
    expect(applyGliderBoost(state)).toBe(true);
    expect(state.speed).toBe(22);
    expect(state.vy).toBe(-9);
    expect(state.boostReadyTick).toBe(200);
    state.tick = 200;
    state.speed = 35;
    expect(applyGliderBoost(state)).toBe(true);
    expect(state.speed).toBe(38);
  });

  it('rejects spam until the exact cooldown boundary without extending it', () => {
    const state = createGliderFlightState(false);
    state.tick = 25;
    applyGliderBoost(state);
    const before = structuredClone(state);
    for (let i = 0; i < 20; i++) expect(applyGliderBoost(state)).toBe(false);
    expect(state).toEqual(before);
    state.tick = 224;
    expect(applyGliderBoost(state)).toBe(false);
    state.tick = 225;
    expect(applyGliderBoost(state)).toBe(true);
    expect(state.boostReadyTick).toBe(425);
  });

  it.each(['countdown', 'won', 'failed'] as const)('cannot boost during %s', (phase) => {
    const state = { ...createGliderFlightState(false), phase };
    const before = structuredClone(state);
    expect(applyGliderBoost(state)).toBe(false);
    expect(state).toEqual(before);
  });

  it('starts ready for legacy state and every new attempt', () => {
    const state = createGliderFlightState(false);
    delete state.boostReadyTick;
    expect(applyGliderBoost(state)).toBe(true);
    expect(createGliderFlightState().boostReadyTick).toBe(0);
  });
});
