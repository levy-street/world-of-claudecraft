import { describe, expect, it } from 'vitest';
import {
  DOG_BREATH_PERIOD,
  DOG_BREATH_RISE,
  DOG_SIGH_DEPTH,
  DOG_SIGH_EVERY,
  type DogBreath,
  dogBreathInto,
} from '../src/render/mirefen_tavern_dog_core';
import {
  TAVERN_SMOKE_PUFFS,
  TAVERN_SMOKE_SOURCES,
  type TavernSmokePuff,
  tavernSmokePuffInto,
} from '../src/render/mirefen_tavern_smoke_core';
import { TAVERN_HALL, TAVERN_HOOD } from '../src/sim/content/mirefen_tavern';

// The life round the Mirefen tavern, the pure halves: the dog asleep on the porch breathing
// (src/render/mirefen_tavern_dog_core.ts) and the chimney smoke's puffs
// (src/render/mirefen_tavern_smoke_core.ts). Both are pure functions of a clock: deterministic,
// allocation-free, cosmetic.

describe('the tavern dog breathing', () => {
  const out: DogBreath = { y: 0, xz: 0 };

  it('rises and falls slowly, never shrinking below its resting shape', () => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let t = 0; t < DOG_BREATH_PERIOD * DOG_SIGH_EVERY; t += 0.05) {
      dogBreathInto(t, false, out);
      lo = Math.min(lo, out.y);
      hi = Math.max(hi, out.y);
      expect(out.xz - 1).toBeCloseTo((out.y - 1) / 3, 10);
    }
    expect(lo).toBeCloseTo(1, 3);
    expect(hi).toBeCloseTo(1 + DOG_BREATH_RISE * DOG_SIGH_DEPTH, 3);
    // an ordinary breath peaks at the plain rise, the sigh deeper
    dogBreathInto(DOG_BREATH_PERIOD * 0.6, false, out);
    expect(out.y).toBeCloseTo(1 + DOG_BREATH_RISE, 6);
  });

  it('breathes smoothly: no step between two frames', () => {
    let prev = dogBreathInto(0, false, out).y;
    for (let t = 1 / 60; t < DOG_BREATH_PERIOD * DOG_SIGH_EVERY * 2; t += 1 / 60) {
      const y = dogBreathInto(t, false, out).y;
      expect(Math.abs(y - prev)).toBeLessThan(0.004);
      prev = y;
    }
  });

  it('lies still for a reduced-motion player', () => {
    dogBreathInto(DOG_BREATH_PERIOD * 0.6, true, out);
    expect(out).toEqual({ y: 1, xz: 1 });
  });
});

describe('the tavern chimney smoke', () => {
  const puff: TavernSmokePuff = { x: 0, y: 0, z: 0, size: 0, alpha: 0 };

  it('streams two plumes from the chimney and the hearth flue, over the roof', () => {
    expect(TAVERN_SMOKE_SOURCES).toHaveLength(2);
    expect(TAVERN_SMOKE_PUFFS).toBe(TAVERN_SMOKE_SOURCES[0].puffs + TAVERN_SMOKE_SOURCES[1].puffs);
    // the river-stone chimney outside the north wall, over the eaves; the flue over the ridge
    expect(TAVERN_SMOKE_SOURCES[0].x).toBeGreaterThan(TAVERN_HALL.x1);
    expect(TAVERN_SMOKE_SOURCES[0].y).toBeGreaterThan(TAVERN_HALL.eave + 4);
    expect(TAVERN_SMOKE_SOURCES[1].y).toBeGreaterThan(TAVERN_HOOD.flueTop);
    for (let i = 0; i < TAVERN_SMOKE_PUFFS; i++) {
      for (const t of [0, 3.3, 17.9, 120]) {
        tavernSmokePuffInto(i, t, puff);
        const src =
          i < TAVERN_SMOKE_SOURCES[0].puffs ? TAVERN_SMOKE_SOURCES[0] : TAVERN_SMOKE_SOURCES[1];
        expect(puff.y).toBeGreaterThanOrEqual(src.y);
        expect(puff.alpha).toBeGreaterThanOrEqual(0);
        expect(puff.alpha).toBeLessThanOrEqual(1);
        expect(puff.size).toBeGreaterThanOrEqual(src.size0 * 0.8);
        expect(puff.size).toBeLessThanOrEqual(src.size1 * 1.2);
      }
    }
  });

  it('rises and thins as it ages, then is born again at the mouth', () => {
    const src = TAVERN_SMOKE_SOURCES[0];
    const ys: number[] = [];
    const as: number[] = [];
    for (let k = 1; k < 10; k++) {
      tavernSmokePuffInto(0, (src.life * k) / 10, puff);
      ys.push(puff.y);
      as.push(puff.alpha);
    }
    for (let k = 1; k < ys.length; k++) expect(ys[k]).toBeGreaterThan(ys[k - 1]);
    expect(as[as.length - 1]).toBeLessThan(as[1]);
    // one life later the same slot starts again low at the chimney's mouth
    tavernSmokePuffInto(0, src.life + 0.01, puff);
    expect(puff.y - src.y).toBeLessThan(0.1);
  });

  it('is deterministic: the same clock gives the same plume', () => {
    const a: TavernSmokePuff = { x: 0, y: 0, z: 0, size: 0, alpha: 0 };
    for (let i = 0; i < TAVERN_SMOKE_PUFFS; i++) {
      tavernSmokePuffInto(i, 42.5, puff);
      tavernSmokePuffInto(i, 42.5, a);
      expect(a).toEqual(puff);
    }
  });
});
