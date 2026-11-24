// The Gyre's own ground (sim/quartered_landmarks.ts gyreGroundAt, painted by
// render/quartered_ground_core.ts): the storm peak's granite, its pale switchback path and the
// scoured cap toward its crown, so the mountain reads as the wind quarter's stone instead of the
// isle's khaki. Node-only: no Three, no DOM.
import { describe, expect, it } from 'vitest';
import {
  GYRE_CLIFF_HEX,
  LANDMARK_GROUND_PALETTES,
  makeQuarterGroundLinear,
  quarteredCliffAt,
  quarteredGroundAt,
  quarterHexToLinear,
} from '../src/render/quartered_ground_core';
import { RIVALMOOT_HILL } from '../src/sim/quartered_isle_terrain';
import { GYRE_PEAK, gyreGroundAt, gyrePathPoint } from '../src/sim/quartered_landmarks';

const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const tint = () => ({ gyreRock: 0, gyreWay: 0, gyreCap: 0 });
const tone = (hex: number) => quarterHexToLinear(hex);
const luminance = (hex: number) => {
  const [r, g, b] = tone(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** How far along the path (0..1) one full turn is. */
const TURN = GYRE_PEAK.turnStep / (GYRE_PEAK.startR - GYRE_PEAK.endR);
/** Where on the path it passes due east of the peak. */
const SPAN = ((GYRE_PEAK.startR - GYRE_PEAK.endR) / GYRE_PEAK.turnStep) * Math.PI * 2;
const T_EAST = Math.PI / 2 / SPAN;

/** The middle of the face between the path at `t` and the turn above it. */
function faceAbove(t: number) {
  const a = gyrePathPoint(t);
  const b = gyrePathPoint(t + TURN);
  return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
}

const groundAt = (x: number, z: number) => {
  const out = makeQuarterGroundLinear();
  quarteredGroundAt(x, z, out);
  return out;
};

describe('the Gyre ground channels', () => {
  it('lay the path along its whole climb', () => {
    for (const t of [0.05, 0.2, 0.35, 0.5, 0.65, 0.8, 0.9]) {
      const p = gyrePathPoint(t);
      const k = tint();
      gyreGroundAt(p.x, p.z, k);
      expect(k.gyreWay, `t ${t}`).toBeGreaterThan(0.99);
      // laid last: dead centre the ground IS the flagstone, whatever the rock and cap under it
      expect(
        dist(groundAt(p.x, p.z).grass, tone(LANDMARK_GROUND_PALETTES.gyreWay.grass)),
        `t ${t}`,
      ).toBeLessThan(1e-6);
    }
  });

  it('leave the faces between the turns to the granite', () => {
    for (const t of [0.05, 0.1, 0.15]) {
      const f = faceAbove(t);
      const k = tint();
      gyreGroundAt(f.x, f.z, k);
      expect(k.gyreWay, `t ${t}`).toBe(0);
      expect(k.gyreRock, `t ${t}`).toBeGreaterThan(0.99);
      expect(k.gyreCap, `t ${t}`).toBe(0);
      expect(
        dist(groundAt(f.x, f.z).grass, tone(LANDMARK_GROUND_PALETTES.gyreRock.grass)),
        `t ${t}`,
      ).toBeLessThan(1e-6);
    }
  });

  it('pale to the scoured cap toward the crown, and only there', () => {
    const crown = tint();
    gyreGroundAt(GYRE_PEAK.x, GYRE_PEAK.z, crown);
    expect(crown.gyreCap).toBeGreaterThan(0.7);
    expect(crown.gyreRock).toBeGreaterThan(0.99);
    // the cap only thins as the radius grows, on any bearing
    for (const deg of [0, 70, 150, 230, 300]) {
      let prev = Infinity;
      for (let r = 4; r <= 34; r += 2) {
        const a = (deg * Math.PI) / 180;
        const k = tint();
        gyreGroundAt(GYRE_PEAK.x + Math.cos(a) * r, GYRE_PEAK.z + Math.sin(a) * r, k);
        expect(k.gyreCap, `bearing ${deg} r ${r}`).toBeLessThanOrEqual(prev + 1e-9);
        prev = k.gyreCap;
      }
      expect(prev, `bearing ${deg}`).toBe(0);
    }
  });

  it('fade the rock into the plain past the foot, and are zero off the peak', () => {
    const p = gyrePathPoint(T_EAST);
    const edge = Math.hypot(p.x - GYRE_PEAK.x, p.z - GYRE_PEAK.z) + GYRE_PEAK.pathW / 2;
    const at = (r: number) => {
      const k = tint();
      gyreGroundAt(GYRE_PEAK.x + r, GYRE_PEAK.z, k);
      return k;
    };
    expect(at(edge + 0.5).gyreRock).toBeGreaterThan(0.99);
    const mid = at(edge + 6).gyreRock;
    expect(mid).toBeGreaterThan(0.1);
    expect(mid).toBeLessThan(0.9);
    expect(at(edge + 12).gyreRock).toBe(0);
    // no path past the outermost turn, and nothing at all far from the peak or in the town
    expect(at(edge + 2).gyreWay).toBe(0);
    for (const [x, z] of [
      [GYRE_PEAK.x + 140, GYRE_PEAK.z],
      [GYRE_PEAK.x, GYRE_PEAK.z - 140],
      [RIVALMOOT_HILL.x, RIVALMOOT_HILL.z],
    ]) {
      const k = tint();
      gyreGroundAt(x, z, k);
      expect(k, `${x},${z}`).toEqual({ gyreRock: 0, gyreWay: 0, gyreCap: 0 });
    }
  });

  it('keep the three tones apart: the path paler than the rock, the cap paler than the rock', () => {
    const P = LANDMARK_GROUND_PALETTES;
    expect(luminance(P.gyreWay.grass)).toBeGreaterThan(luminance(P.gyreRock.grass) * 1.3);
    expect(luminance(P.gyreCap.grass)).toBeGreaterThan(luminance(P.gyreRock.grass) * 1.3);
    // a cool stone, never the isle's khaki or olive: blue leads, and red never leaves green behind
    for (const key of ['gyreRock', 'gyreWay', 'gyreCap'] as const) {
      for (const hex of Object.values(P[key])) {
        const [r, g, b] = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
        expect(b, `${key} ${hex.toString(16)}`).toBeGreaterThan(g);
        expect(b, `${key} ${hex.toString(16)}`).toBeGreaterThan(r);
        expect(g - r, `${key} ${hex.toString(16)}`).toBeLessThan(8);
      }
    }
  });
});

describe('the Gyre cliff stone', () => {
  it('is the Gyre granite on the peak and the quarter blend off it', () => {
    const f = faceAbove(0.1);
    const out: [number, number, number] = [0, 0, 0];
    quarteredCliffAt(f.x, f.z, out);
    expect(dist(out, quarterHexToLinear(GYRE_CLIFF_HEX))).toBeLessThan(1e-6);
    // the town's cliff is a quarter's own stone, not the Gyre's
    quarteredCliffAt(RIVALMOOT_HILL.x, RIVALMOOT_HILL.z, out);
    expect(dist(out, quarterHexToLinear(GYRE_CLIFF_HEX))).toBeGreaterThan(0.01);
  });
});
