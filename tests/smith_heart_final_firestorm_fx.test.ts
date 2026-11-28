// Firestorm's wall of flame (Jose's playtest of 2026-11-23: the old wall of
// flat cards and sprite blobs read as "not AAA"): the pure plan
// (src/render/smith_heart_fx/final_firestorm_core.ts). The painter's run over
// a fake world (the wall, its trail, the burnt floor, the char outliving the
// lane a moment) is in tests/smith_heart_final_elements_ui.test.ts.

import { describe, expect, it } from 'vitest';
import { laneFront } from '../src/render/smith_heart_fx/final_elements_fx_core';
import {
  firestormBudget,
  firestormChar,
  firestormOnFloor,
  firestormTrailHeight,
  firestormWall,
  FIRESTORM_LOOK as L,
} from '../src/render/smith_heart_fx/final_firestorm_core';
import { ELEMENT_TUNING as E } from '../src/sim/encounters/smith_heart/final_elements_ids';

const LEN = E.fireLength;
const RUN = E.fireLength / E.fireSpeed;

describe('the wall', () => {
  it('stands on the sim own front, never past it nor past the lane', () => {
    for (const t of [0, 0.1, 0.5, 1, 2, RUN - 0.01, RUN, RUN + 1]) {
      const w = firestormWall(t, LEN, RUN);
      expect(w.front).toBeCloseTo(laneFront(t, LEN, RUN), 6);
      expect(w.front).toBeLessThanOrEqual(LEN);
    }
    expect(firestormWall(1, LEN, RUN).front).toBeCloseTo(E.fireSpeed, 5);
  });

  it('every sheet stands on or behind the front (inside the burnt lane)', () => {
    for (const back of L.sheetBack) expect(back).toBeGreaterThanOrEqual(0);
    expect(L.sheetBack[0]).toBe(0);
  });

  it('rises out of the floor, burns the whole run, then goes out at the end', () => {
    expect(firestormWall(0, LEN, RUN).rise).toBe(0);
    expect(firestormWall(L.rise, LEN, RUN).rise).toBeCloseTo(1, 6);
    expect(firestormWall(RUN * 0.5, LEN, RUN).rise).toBeCloseTo(1, 6);
    expect(firestormWall(RUN * 0.5, LEN, RUN).trail).toBe(1);
    expect(firestormWall(RUN + L.fallOut, LEN, RUN).rise).toBe(0);
    expect(firestormWall(RUN + L.fallOut, LEN, RUN).trail).toBe(0);
  });
});

describe('the trail and the char', () => {
  it('burns tallest at the heel, dies down along the lane, never quite out', () => {
    let last = Number.POSITIVE_INFINITY;
    for (let b = 0; b <= 60; b += 2) {
      const h = firestormTrailHeight(b);
      expect(h).toBeLessThanOrEqual(last);
      expect(h).toBeGreaterThanOrEqual(L.trailFloor);
      last = h;
    }
    expect(firestormTrailHeight(0)).toBeLessThan(L.height);
    expect(firestormTrailHeight(-1)).toBe(0);
  });

  it('the char fades out after the lane goes', () => {
    expect(firestormChar(0)).toBe(1);
    expect(firestormChar(L.charFade / 2)).toBeGreaterThan(0);
    expect(firestormChar(L.charFade / 2)).toBeLessThan(1);
    expect(firestormChar(L.charFade)).toBe(0);
  });
});

describe('the floor clip and the tiers', () => {
  it('draws nothing past the Anvil rim', () => {
    expect(firestormOnFloor(0, 0, 0, 0, 60)).toBe(1);
    expect(firestormOnFloor(58.9, 0, 0, 0, 60)).toBe(1);
    expect(firestormOnFloor(60, 0, 0, 0, 60)).toBe(0);
    expect(firestormOnFloor(0, 80, 0, 0, 60)).toBe(0);
  });

  it('the low tier sheds richness, never the wall, its trail or the floor', () => {
    const hi = firestormBudget(true);
    const lo = firestormBudget(false);
    expect(lo.sheets).toBeGreaterThanOrEqual(1);
    expect(lo.trailSheets).toBeGreaterThanOrEqual(1);
    expect(lo.tongues).toBeLessThan(hi.tongues);
    expect(lo.embers).toBeLessThan(hi.embers);
    expect(lo.smoke).toBe(false);
    expect(hi.sheets).toBeLessThanOrEqual(L.sheetBack.length);
  });
});
