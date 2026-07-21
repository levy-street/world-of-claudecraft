// Heading-compass pure model (src/ui/compass.ts). Verifies the facing→bearing
// mapping under the world convention (facing 0 = north, turning right decreases
// facing), the nearest-rose heading label, and the visible-strip windowing.
import { describe, expect, it } from 'vitest';
import { bearingDegrees, headingLabel, compassView } from '../src/ui/compass';

describe('bearingDegrees', () => {
  it('maps the four cardinals (facing 0 = north, right turn = +bearing)', () => {
    expect(bearingDegrees(0)).toBeCloseTo(0); // north
    expect(bearingDegrees(-Math.PI / 2)).toBeCloseTo(90); // turned right → east
    expect(bearingDegrees(Math.PI)).toBeCloseTo(180); // south
    expect(bearingDegrees(Math.PI / 2)).toBeCloseTo(270); // turned left → west
  });

  it('normalises into [0, 360) and guards non-finite input', () => {
    expect(bearingDegrees(-2 * Math.PI)).toBeCloseTo(0);
    expect(bearingDegrees(NaN)).toBe(0);
    expect(bearingDegrees(Infinity)).toBe(0);
  });
});

describe('headingLabel', () => {
  it('picks the nearest rose point', () => {
    expect(headingLabel(0)).toBe('N');
    expect(headingLabel(44)).toBe('NE');
    expect(headingLabel(90)).toBe('E');
    expect(headingLabel(359)).toBe('N'); // wraps across 0
  });
});

describe('compassView', () => {
  it('centres the faced direction at offsetFrac 0', () => {
    const v = compassView(0); // facing north
    const north = v.marks.find((m) => m.label === 'N');
    expect(north?.offsetFrac).toBeCloseTo(0);
    expect(v.heading).toBe('N');
  });

  it('only includes rose points inside the ±window and sorts left→right', () => {
    const v = compassView(0, 90); // window = N's ±90° → W..N..E inclusive
    const labels = v.marks.map((m) => m.label);
    expect(labels).toEqual(['W', 'NW', 'N', 'NE', 'E']);
    expect(labels).not.toContain('S');
    // offsetFracs must be ascending and bounded to [-1, 1]
    for (let i = 1; i < v.marks.length; i++) {
      expect(v.marks[i].offsetFrac).toBeGreaterThanOrEqual(v.marks[i - 1].offsetFrac);
    }
    expect(Math.min(...v.marks.map((m) => m.offsetFrac))).toBeGreaterThanOrEqual(-1);
    expect(Math.max(...v.marks.map((m) => m.offsetFrac))).toBeLessThanOrEqual(1);
  });

  it('flags the four cardinals as major', () => {
    const v = compassView(0);
    expect(v.marks.find((m) => m.label === 'N')?.major).toBe(true);
    expect(v.marks.find((m) => m.label === 'NE')?.major).toBe(false);
  });
});
