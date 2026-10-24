// Olen the fallen paladin's pure visual plan (src/render/sunken_bastion/
// bastion_olen_fx_core.ts): the shield's arc meets its ends, the brine wells
// up, the Sentence's column closes down and brightens as its mark runs out,
// the bubble swells and bursts.

import { describe, expect, it } from 'vitest';
import {
  BULWARK_ARC,
  BULWARK_HEIGHT,
  BULWARK_HOP_SECONDS,
  brineSwell,
  bulwarkFlight,
  OATH_BURST_SECONDS,
  oathBubbleScale,
  oathBurst,
  SENTENCE_SKY,
  sentenceColumnBase,
  sentenceColumnGlow,
  sentenceFill,
  sentenceStrike,
} from '../src/render/sunken_bastion/bastion_olen_fx_core';
import { OLEN_KIT } from '../src/sim/encounters/sunken_bastion/ids';

describe("Olen's visual plan", () => {
  it('the shield flies the sim hop, from body to body along a lifted arc', () => {
    expect(BULWARK_HOP_SECONDS).toBe(OLEN_KIT.bulwarkHop);
    const out = { x: 0, y: 0, z: 0 };
    bulwarkFlight(0, 0, 0, 10, 0, 0, 0, out);
    expect(out).toEqual({ x: 0, y: BULWARK_HEIGHT, z: 0 });
    bulwarkFlight(0, 0, 0, 10, 0, 0, 1, out);
    expect(out).toEqual({ x: 10, y: BULWARK_HEIGHT, z: 0 });
    bulwarkFlight(0, 0, 0, 10, 0, 0, 0.5, out);
    expect(out.x).toBeCloseTo(5, 6);
    expect(out.y).toBeCloseTo(BULWARK_HEIGHT + BULWARK_ARC, 6);
    bulwarkFlight(0, 0, 0, 10, 0, 0, 3, out);
    expect(out.x).toBe(10);
  });

  it('the brine wells up over its first second and holds', () => {
    expect(brineSwell(0)).toBe(0);
    expect(brineSwell(0.5)).toBeGreaterThan(0.5);
    expect(brineSwell(1)).toBe(1);
    expect(brineSwell(9)).toBe(1);
  });

  it('the Sentence fills with its mark, the column closes down and burns brighter', () => {
    expect(sentenceFill(OLEN_KIT.sentenceSeconds, OLEN_KIT.sentenceSeconds)).toBe(0);
    expect(sentenceFill(0, OLEN_KIT.sentenceSeconds)).toBe(1);
    expect(sentenceFill(1, 0)).toBe(1);
    expect(sentenceColumnBase(0)).toBe(SENTENCE_SKY);
    let prevBase = Infinity;
    let prevGlow = -Infinity;
    for (let k = 0; k <= 1.0001; k += 0.1) {
      const b = sentenceColumnBase(k);
      const g = sentenceColumnGlow(k);
      expect(b).toBeLessThanOrEqual(prevBase);
      expect(g).toBeGreaterThanOrEqual(prevGlow);
      prevBase = b;
      prevGlow = g;
    }
    expect(sentenceColumnGlow(1)).toBeCloseTo(1, 6);
    expect(sentenceStrike(0).alpha).toBe(1);
    expect(sentenceStrike(10).alpha).toBe(0);
  });

  it('the bubble swells in and the burst blows it out to nothing', () => {
    expect(oathBubbleScale(0, 0)).toBe(0);
    expect(oathBubbleScale(5, 0)).toBeCloseTo(1, 6);
    expect(oathBurst(0)).toEqual({ alpha: 1, scale: 1 });
    expect(oathBurst(OATH_BURST_SECONDS).alpha).toBe(0);
  });
});
