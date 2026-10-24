import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MOTE_KEEPOUT_INNER,
  MOTE_KEEPOUT_OUTER,
  moteKeepOutFade,
} from '../src/render/motes_keepout_core';

// The "white ball of light over the shoulder": an ambient mote (0.3 to 0.46 yd additive
// disc) drifting through the local player's own column read as a light stuck to the
// character. motes.ts fades every mote by this keep-out, so none can sit on the player.
describe('moteKeepOutFade', () => {
  it('pins the ring: hidden inside 1.3 yd, full from 2.6 yd', () => {
    expect(MOTE_KEEPOUT_INNER).toBe(1.3);
    expect(MOTE_KEEPOUT_OUTER).toBe(2.6);
  });

  it('hides a mote on the player, at the shoulder, and anywhere inside the inner ring', () => {
    expect(moteKeepOutFade(0, 0)).toBe(0);
    // the repro: a vale-pollen mote 1.06 yd off the Proving Shore spawn sat on the shoulder
    expect(moteKeepOutFade(1.06, 0)).toBe(0);
    expect(moteKeepOutFade(0.9, -0.9)).toBe(0);
    expect(moteKeepOutFade(0, MOTE_KEEPOUT_INNER)).toBe(0);
  });

  it('draws a mote at full strength from the outer ring out (the ambience elsewhere is untouched)', () => {
    expect(moteKeepOutFade(MOTE_KEEPOUT_OUTER, 0)).toBe(1);
    expect(moteKeepOutFade(0, -3)).toBe(1);
    expect(moteKeepOutFade(20, 15)).toBe(1);
  });

  it('ramps smoothly and monotonically between the rings, the same in every direction', () => {
    let last = 0;
    for (let d = MOTE_KEEPOUT_INNER; d <= MOTE_KEEPOUT_OUTER; d += 0.05) {
      const f = moteKeepOutFade(d, 0);
      expect(f).toBeGreaterThanOrEqual(last);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
      last = f;
    }
    const mid = (MOTE_KEEPOUT_INNER + MOTE_KEEPOUT_OUTER) / 2;
    expect(moteKeepOutFade(mid, 0)).toBeCloseTo(0.5, 6);
    const r = mid / Math.SQRT2;
    expect(moteKeepOutFade(-r, r)).toBeCloseTo(moteKeepOutFade(mid, 0), 6);
  });

  it('draws a non-finite offset at full strength rather than NaN', () => {
    expect(moteKeepOutFade(Number.NaN, 0)).toBe(1);
    expect(moteKeepOutFade(Number.POSITIVE_INFINITY, 0)).toBe(1);
  });

  it('is wired into the motes field: every mote colour is its tint scaled by the fade', () => {
    const src = readFileSync('src/render/motes.ts', 'utf8');
    expect(src).toContain("import { moteKeepOutFade } from './motes_keepout_core';");
    expect(src).toMatch(
      /moteKeepOutFade\(positions\[i \* 3\] - px, positions\[i \* 3 \+ 2\] - pz\)/,
    );
    expect(src).toContain('colors[i * 3] = baseColors[i * 3] * fade;');
    // a parked mote (failed re-home) is blacked out, never left drawing unfaded
    expect(src).toMatch(/function park\(i: number\): void \{[\s\S]*?colors\[i \* 3\] = 0;/);
    // only park() writes the parked sentinel, and both park sites route through it
    expect(src.match(/baseY\[i\] = -1e6;/g)?.length).toBe(1);
    expect(src.match(/park\(i\);/g)?.length).toBe(2);
    // the material keeps additive blending + vertex colours, so a zero colour draws nothing
    expect(src).toContain('blending: THREE.AdditiveBlending');
    expect(src).toContain('vertexColors: true');
  });
});
