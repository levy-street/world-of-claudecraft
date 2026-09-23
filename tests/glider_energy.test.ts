import { describe, expect, it } from 'vitest';
import { gliderPitchFromCamera } from '../src/game/glider_pitch_input';
import {
  GLIDER_GRAVITY,
  GLIDER_MAX_SPEED,
  stepGliderEnergy,
} from '../src/sim/minigames/glider_energy';
import { DT, emptyMoveInput } from '../src/sim/types';

describe('glider energy exchange', () => {
  function fly(pitch: number, ticks: number) {
    let state = { speed: 22, vy: 0 },
      y = 100,
      peak = y;
    for (let tick = 0; tick < ticks; tick++) {
      state = stepGliderEnergy(state.speed, state.vy, { ...emptyMoveInput(), gliderPitch: pitch });
      y += state.vy * DT;
      peak = Math.max(peak, y);
    }
    return { ...state, y, peak };
  }
  it('climbs by spending speed and dives by gaining speed', () => {
    expect(fly(1, 20).y).toBeGreaterThan(fly(0, 20).y);
    expect(fly(1, 20).speed).toBeLessThan(fly(0, 20).speed);
    expect(fly(-1, 20).y).toBeLessThan(fly(0, 20).y);
    expect(fly(-1, 20).speed).toBeGreaterThan(fly(0, 20).speed);
  });
  it('stalls when held nose-up and never gains unbounded altitude', () => {
    const result = fly(1, 2400);
    expect(result.peak).toBeLessThan(120);
    expect(result.y).toBeLessThan(result.peak - 1);
    expect(result.speed).toBeLessThan(15);
    expect(result.vy).toBeLessThanOrEqual(0);
  });
  it('converts stored dive speed into a prompt pull-up instead of a fixed slow climb', () => {
    let state = { speed: 22, vy: 0 };
    let height = 100;
    for (let tick = 0; tick < 40; tick++) {
      state = stepGliderEnergy(state.speed, state.vy, {
        ...emptyMoveInput(),
        gliderPitch: gliderPitchFromCamera(0.9, true, true),
      });
      height += state.vy * DT;
    }
    const diveHeight = height;
    const diveSpeed = state.speed;
    for (let tick = 0; tick < 40; tick++) {
      state = stepGliderEnergy(state.speed, state.vy, {
        ...emptyMoveInput(),
        gliderPitch: gliderPitchFromCamera(-0.2, true, true),
      });
      height += state.vy * DT;
    }
    // A two-second pull-up must recover a useful part of a two-second dive.
    expect(height - diveHeight).toBeGreaterThan(15);
    expect(state.speed).toBeLessThan(diveSpeed);
    expect(height).toBeLessThan(100);
  });
  it('loses total mechanical energy even when pitch alternates', () => {
    let speed = 22,
      vy = 0,
      y = 100;
    for (let tick = 0; tick < 2000; tick++) {
      const before = (speed * speed) / 2 + GLIDER_GRAVITY * y;
      ({ speed, vy } = stepGliderEnergy(speed, vy, {
        ...emptyMoveInput(),
        gliderPitch: Math.sin(tick / 20),
      }));
      y += vy * DT;
      expect((speed * speed) / 2 + GLIDER_GRAVITY * y).toBeLessThanOrEqual(before + 1e-8);
    }
  });
  it('caps diving speed and produces identical fixed-input replays', () => {
    expect(fly(-1, 2400).speed).toBe(GLIDER_MAX_SPEED);
    expect(fly(0.4, 200)).toEqual(fly(0.4, 200));
  });
  it('uses keyboard fallback and ignores malformed pitch', () => {
    const up = stepGliderEnergy(22, 0, { ...emptyMoveInput(), gliderPitch: 1 });
    expect(stepGliderEnergy(22, 0, { ...emptyMoveInput(), surface: true })).toEqual(up);
    expect(
      stepGliderEnergy(22, 0, { ...emptyMoveInput(), jump: true, gliderPitch: Number.NaN }),
    ).toEqual(up);
    expect(stepGliderEnergy(22, 0, { ...emptyMoveInput(), gliderPitch: 900 })).toEqual(up);
  });
});
