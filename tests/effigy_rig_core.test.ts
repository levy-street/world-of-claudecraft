// The Straw Foreman's plank choreography (src/render/characters/effigy_rig_core.ts): the
// planks leave the figure, land on the ground and lie still, and the rebuild puts every
// one of them back exactly where it was.
import { describe, expect, it } from 'vitest';
import {
  EFFIGY_SHUDDER_SECONDS,
  type EffigyPlankRest,
  effigyFlameFlicker,
  effigyPlankFallAt,
  effigyPlankLandTime,
  effigyPlankLaunch,
  effigyPlankRebuildAt,
  effigyRebuildSeconds,
  effigyShudderAt,
} from '../src/render/characters/effigy_rig_core';

const rest = (x: number, y: number, z: number): EffigyPlankRest => ({
  x,
  y,
  z,
  q: [0, 0, 0, 1],
  flat: [0.7071, 0, 0, 0.7071],
  halfThickness: 0.06,
});

describe('the plank hide falls', () => {
  it('flies out from the spine and comes to rest flat on the ground', () => {
    const plank = rest(0.4, 3.2, 0.9);
    const launch = effigyPlankLaunch(plank, 3);
    expect(launch.vx * plank.x + launch.vz * plank.z).toBeGreaterThan(0);
    const pos: [number, number, number] = [0, 0, 0];
    expect(effigyPlankFallAt(plank, 3, 0, pos)).toBe(0);
    expect(pos).toEqual([plank.x, plank.y, plank.z]);
    const land = launch.delay + effigyPlankLandTime(plank, launch.vy);
    const w = effigyPlankFallAt(plank, 3, land + 1, pos);
    expect(w).toBe(1);
    expect(pos[1]).toBeCloseTo(plank.halfThickness, 5);
    expect(Math.hypot(pos[0], pos[2])).toBeGreaterThan(Math.hypot(plank.x, plank.z));
  });

  it('is deterministic per plank index', () => {
    const plank = rest(-0.8, 2.4, 0.5);
    const a: [number, number, number] = [0, 0, 0];
    const b: [number, number, number] = [0, 0, 0];
    effigyPlankFallAt(plank, 7, 0.6, a);
    effigyPlankFallAt(plank, 7, 0.6, b);
    expect(a).toEqual(b);
  });
});

describe('the soldiers hammer it back', () => {
  it('returns every plank to its rest pose by the end of the rebuild', () => {
    const count = 14;
    const plank = rest(0.2, 4.1, 0.7);
    const lay: [number, number, number] = [2.5, 0.06, 1.9];
    const pos: [number, number, number] = [0, 0, 0];
    expect(effigyPlankRebuildAt(plank, lay, 13, count, 0, pos)).toBe(1);
    expect(pos).toEqual(lay);
    const w = effigyPlankRebuildAt(plank, lay, 0, count, effigyRebuildSeconds(count), pos);
    expect(w).toBe(0);
    expect(pos[0]).toBeCloseTo(plank.x, 5);
    expect(pos[1]).toBeCloseTo(plank.y, 5);
    expect(pos[2]).toBeCloseTo(plank.z, 5);
  });
});

describe('the shudder and the flame', () => {
  it('shivers at the blow and is still afterwards', () => {
    expect(Math.abs(effigyShudderAt(0.05).pitch)).toBeGreaterThan(0);
    expect(effigyShudderAt(EFFIGY_SHUDDER_SECONDS)).toEqual({ pitch: 0, roll: 0 });
    expect(Math.abs(effigyShudderAt(0.05, true).pitch)).toBeLessThan(
      Math.abs(effigyShudderAt(0.05).pitch),
    );
  });

  it('flickers inside a lit band, and holds steady with reduced motion', () => {
    for (let t = 0; t < 5; t += 0.13) {
      const k = effigyFlameFlicker(t);
      expect(k).toBeGreaterThan(0.6);
      expect(k).toBeLessThanOrEqual(1);
    }
    expect(effigyFlameFlicker(1.7, true)).toBe(effigyFlameFlicker(3.1, true));
  });
});
