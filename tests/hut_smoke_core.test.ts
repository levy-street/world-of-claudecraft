// A torched mudfin hut's smoke plume, the pure half (src/render/hut_smoke_core.ts): how much
// smoke the hut makes across its fire, where each puff of the plume is, and that the plume goes
// thick and dark as the flames die, then thins and is gone.
import { describe, expect, it } from 'vitest';
import { HUT_FIRE_BURN_SECONDS, type HutFireBody } from '../src/render/hut_fire_core';
import {
  HUT_SMOKE_END_SECONDS,
  HUT_SMOKE_LIFE_SECONDS,
  HUT_SMOKE_PUFFS,
  HUT_SMOKE_STOP_SECONDS,
  HUT_SMOKE_WIND,
  type HutSmokePuff,
  hutSmokeOutput,
  hutSmokePuffInto,
} from '../src/render/hut_smoke_core';

const BODY: HutFireBody = { x: 10, y: 2, z: -4, radius: 2.3, height: 5 };
/** The painter's cut: fainter puffs are not drawn. */
const DRAWN = 0.004;

const blank = (): HutSmokePuff => ({ x: 0, y: 0, z: 0, size: 0, alpha: 0, shade: 0 });
function plume(age: number, body = BODY): HutSmokePuff[] {
  return Array.from({ length: HUT_SMOKE_PUFFS }, (_, i) => hutSmokePuffInto(i, age, body, blank()));
}
const drawn = (puffs: HutSmokePuff[]) => puffs.filter((p) => p.alpha >= DRAWN);
const mean = (values: number[]) => values.reduce((s, v) => s + v, 0) / values.length;

describe('hut smoke output', () => {
  it('starts with the fire, is heaviest as the flames die, then stops', () => {
    expect(hutSmokeOutput(-1)).toBe(0);
    expect(hutSmokeOutput(Number.NaN)).toBe(0);
    expect(hutSmokeOutput(0)).toBe(0);
    // a grey trail while it burns
    const burning = hutSmokeOutput(4);
    expect(burning).toBeGreaterThan(0.3);
    expect(burning).toBeLessThan(0.6);
    // the heavy plume as the last flames go out
    expect(hutSmokeOutput(HUT_FIRE_BURN_SECONDS)).toBeCloseTo(1, 6);
    // a thinning smoulder after
    const smoulder = hutSmokeOutput(HUT_FIRE_BURN_SECONDS + 3);
    expect(smoulder).toBeGreaterThan(0);
    expect(smoulder).toBeLessThan(0.9);
    expect(hutSmokeOutput(HUT_SMOKE_STOP_SECONDS)).toBe(0);
    expect(hutSmokeOutput(HUT_SMOKE_STOP_SECONDS + 5)).toBe(0);
  });

  it('never jumps: one smooth curve across the whole fire', () => {
    let last = 0;
    for (let t = 0; t <= HUT_SMOKE_STOP_SECONDS + 0.5; t += 0.05) {
      const v = hutSmokeOutput(t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(Math.abs(v - last)).toBeLessThan(0.05);
      last = v;
    }
  });

  it('ends its last puff one puff life after the smoke stops', () => {
    expect(HUT_SMOKE_END_SECONDS).toBe(HUT_SMOKE_STOP_SECONDS + HUT_SMOKE_LIFE_SECONDS);
    expect(HUT_SMOKE_STOP_SECONDS).toBeGreaterThan(HUT_FIRE_BURN_SECONDS);
  });
});

describe('hut smoke plume', () => {
  it('streams in from the roof: nothing the moment it catches, a full plume a puff life on', () => {
    expect(drawn(plume(0.05))).toEqual([]);
    expect(drawn(plume(HUT_SMOKE_LIFE_SECONDS)).length).toBeGreaterThan(HUT_SMOKE_PUFFS / 2);
  });

  it('rises off the top of the roof, never inside the hut', () => {
    for (const age of [2, 6, 9, 12, 15, 18]) {
      for (const p of drawn(plume(age))) {
        expect(p.y).toBeGreaterThan(BODY.y + BODY.height * 0.69);
        expect(p.size).toBeGreaterThan(0);
        expect(p.alpha).toBeLessThanOrEqual(1);
        expect(p.shade).toBeGreaterThanOrEqual(0);
        expect(p.shade).toBeLessThanOrEqual(1);
      }
    }
  });

  it('lifts, swells and leans on the breeze as a puff ages', () => {
    // puff 0 is born at 12 s (fading in) and still in that cycle a second later
    const young = hutSmokePuffInto(0, 12.5, BODY, blank());
    const old = hutSmokePuffInto(0, 13.5, BODY, blank());
    expect(young.alpha).toBeGreaterThan(DRAWN);
    expect(old.y).toBeGreaterThan(young.y);
    expect(old.size).toBeGreaterThan(young.size);
    expect(Math.sign(old.x - young.x)).toBe(Math.sign(HUT_SMOKE_WIND.x));
    expect(Math.sign(old.z - young.z)).toBe(Math.sign(HUT_SMOKE_WIND.z));
  });

  it('is thick and dark as the flames die, thin and pale in the smoulder', () => {
    const dying = drawn(plume(HUT_FIRE_BURN_SECONDS + 1));
    const smoulder = drawn(plume(HUT_SMOKE_STOP_SECONDS + 1));
    expect(dying.length).toBeGreaterThan(HUT_SMOKE_PUFFS / 2);
    expect(smoulder.length).toBeGreaterThan(0);
    expect(mean(dying.map((p) => p.alpha))).toBeGreaterThan(mean(smoulder.map((p) => p.alpha)));
    expect(mean(dying.map((p) => p.shade))).toBeLessThan(mean(smoulder.map((p) => p.shade)));
    // and thicker than the trail while it burns
    const burning = drawn(plume(5));
    expect(mean(dying.map((p) => p.alpha))).toBeGreaterThan(mean(burning.map((p) => p.alpha)));
  });

  it('is gone once its last puff fades', () => {
    expect(drawn(plume(HUT_SMOKE_END_SECONDS))).toEqual([]);
    expect(drawn(plume(HUT_SMOKE_END_SECONDS + 10))).toEqual([]);
    expect(drawn(plume(HUT_SMOKE_END_SECONDS - 3)).length).toBeGreaterThan(0);
  });

  it('is the same plume for the same moment, and a different one a moment later', () => {
    expect(plume(9.5)).toEqual(plume(9.5));
    expect(plume(9.6)).not.toEqual(plume(9.5));
  });

  it('smokes higher and wider off a taller hut', () => {
    const tall = drawn(plume(10, { ...BODY, height: 6 }));
    const short = drawn(plume(10, { ...BODY, height: 4 }));
    expect(Math.max(...tall.map((p) => p.y))).toBeGreaterThan(Math.max(...short.map((p) => p.y)));
    expect(Math.max(...tall.map((p) => p.size))).toBeGreaterThan(
      Math.max(...short.map((p) => p.size)),
    );
  });
});
