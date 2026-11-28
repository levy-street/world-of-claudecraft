// The risen Quench blade reads as ONE sword (Jose's playtest of 2026-11-04:
// risen, its end showed "a weird ice spike that does not look like part of
// the sword"): the point continues the kit piece's own section, axis and
// paint (src/render/smith_heart_fx/quench_blade_tip_core.ts), and the lake's
// heaved plates the piece carries round its foot stay in the lake instead of
// rising with the blade.

import { describe, expect, it } from 'vitest';
import {
  BLADE_KIT_LEAN,
  bladeHalfThick,
  bladeHalfWidth,
  bladeLocal,
  bladeSectionReach,
  bladeTipMesh,
  DEFAULT_BLADE_RAMP,
  isCollarTriangle,
  RAMP_STEPS,
  sampleBladeRamp,
  splitKitBlade,
  TIP_TUCK,
  tipProfile,
} from '../src/render/smith_heart_fx/quench_blade_tip_core';
import { BLADE_TIP } from '../src/render/smith_heart_fx/quench_fight_fx_core';

const tri = (p: Float32Array, i: number) =>
  [0, 1, 2].map((k) => [p[i + k * 3], p[i + k * 3 + 1], p[i + k * 3 + 2]]);

describe('the risen blade point', () => {
  const { positions, colors } = bladeTipMesh(BLADE_TIP);

  it('runs down the blade own leaning axis to one keen point, BLADE_TIP below the cut', () => {
    expect(positions.length % 9).toBe(0);
    expect(colors.length).toBe(positions.length);
    let lowest = { x: 0, y: Infinity, z: 0 };
    let topLz = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
      const [x, y, z] = [positions[i], positions[i + 1], positions[i + 2]];
      if (y < lowest.y) lowest = { x, y, z };
      topLz = Math.max(topLz, bladeLocal(x, y).lz);
      // Never outside the blade's own section continued down its axis.
      expect(bladeSectionReach(x, y, z)).toBeLessThanOrEqual(1.0001);
    }
    // The point sits on the blade's axis (lx 0), BLADE_TIP down it.
    const l = bladeLocal(lowest.x, lowest.y);
    expect(Math.abs(l.lx)).toBeLessThan(1e-6);
    expect(l.lz).toBeCloseTo(-BLADE_TIP, 5);
    expect(lowest.z).toBeCloseTo(0, 6);
    // Its axis is the blade's: the point sits off the frame's plumb line by
    // the kit's lean (an upright cone would sit at x 0).
    expect(lowest.x).toBeCloseTo(-BLADE_TIP * Math.sin(BLADE_KIT_LEAN), 4);
    // Its top tucked inside the piece, above the slanted cut everywhere.
    expect(topLz).toBeCloseTo(TIP_TUCK, 6);
  });

  it('opens at the cut to the piece own section (a hair inside) and closes convex', () => {
    expect(tipProfile(0)).toEqual({ w: 1, t: 1 });
    expect(tipProfile(1).w).toBe(0);
    // Convex: fuller than a straight taper halfway down.
    expect(tipProfile(0.5).w).toBeGreaterThan(0.5);
    expect(tipProfile(0.5).w).toBeLessThan(1);
    let maxX = 0;
    let maxZ = 0;
    for (let i = 0; i < positions.length; i += 3) {
      const { lx, lz } = bladeLocal(positions[i], positions[i + 1]);
      if (lz > TIP_TUCK - 1e-6) {
        maxX = Math.max(maxX, Math.abs(lx));
        maxZ = Math.max(maxZ, Math.abs(positions[i + 2]));
      }
    }
    expect(maxX / bladeHalfWidth(0)).toBeGreaterThan(0.97);
    expect(maxX / bladeHalfWidth(0)).toBeLessThan(1);
    expect(maxZ / bladeHalfThick(0)).toBeGreaterThan(0.97);
    expect(maxZ / bladeHalfThick(0)).toBeLessThan(1);
  });

  it('every face looks outward (never inside out)', () => {
    let bad = 0;
    let faces = 0;
    for (let i = 0; i < positions.length; i += 9) {
      const [a, b, c] = tri(positions, i);
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const area = Math.hypot(n[0], n[1], n[2]);
      if (area < 1e-9) continue;
      faces++;
      // Outward: away from the blade's axis through the centroid.
      const cx = (a[0] + b[0] + c[0]) / 3;
      const cy = (a[1] + b[1] + c[1]) / 3;
      const cz = (a[2] + b[2] + c[2]) / 3;
      const { lz } = bladeLocal(cx, cy);
      const ax = lz * Math.sin(BLADE_KIT_LEAN);
      const ay = lz * Math.cos(BLADE_KIT_LEAN);
      const out = [cx - ax, cy - ay, cz];
      if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] <= 0) bad++;
    }
    expect(faces).toBeGreaterThan(100);
    expect(bad).toBe(0);
  });

  it('wears the piece own paint: a deep heart, pale only at its keen edges', () => {
    let heart = Infinity;
    let edge = 0;
    for (let i = 0; i < positions.length; i += 3) {
      const { lx, lz } = bladeLocal(positions[i], positions[i + 1]);
      if (lz < -2) continue;
      const e = Math.abs(lx) / bladeHalfWidth(0);
      const lum = colors[i] + colors[i + 1] + colors[i + 2];
      if (e < 0.05) heart = Math.min(heart, lum);
      if (e > 0.9) edge = Math.max(edge, lum);
    }
    const [r0, g0, b0] = DEFAULT_BLADE_RAMP[0];
    const [r1, g1, b1] = DEFAULT_BLADE_RAMP[RAMP_STEPS - 1];
    expect(heart).toBeCloseTo(r0 + g0 + b0, 2);
    expect(edge).toBeLessThanOrEqual(r1 + g1 + b1 + 1e-6);
    // Never the old pale spike: nothing brighter than the kit's own edge.
    for (let i = 0; i < colors.length; i += 3)
      expect(colors[i] + colors[i + 1] + colors[i + 2]).toBeLessThanOrEqual(r1 + g1 + b1 + 1e-6);
  });

  it('samples the piece paint across its width, keeping the default where it has none', () => {
    // A fake piece: the middle of a face dark, its edge pale.
    const pos: number[] = [];
    const col: number[] = [];
    for (const e of [0, 1]) {
      const lz = 2;
      const lx = e * bladeHalfWidth(lz) * 0.99;
      pos.push(
        lx * Math.cos(BLADE_KIT_LEAN) + lz * Math.sin(BLADE_KIT_LEAN),
        -lx * Math.sin(BLADE_KIT_LEAN) + lz * Math.cos(BLADE_KIT_LEAN),
        0,
      );
      col.push(e ? 0.3 : 0.01, e ? 0.5 : 0.02, e ? 0.7 : 0.05);
    }
    const ramp = sampleBladeRamp(pos, col, 2);
    expect(ramp).toHaveLength(RAMP_STEPS);
    expect(ramp[0]).toEqual([0.01, 0.02, 0.05]);
    expect(ramp[RAMP_STEPS - 1]).toEqual([0.3, 0.5, 0.7]);
    expect(ramp[2]).toEqual([...DEFAULT_BLADE_RAMP[2]]);
  });
});

describe('the heaved lake round the foot stays in the lake', () => {
  it('a low plate outside the blade is collar; the blade foot, its body and its guard rise', () => {
    // A plate 1.4 yd off the blade's face, low by the foot.
    expect(isCollarTriangle(0.2, 0.15, 1.4)).toBe(true);
    expect(isCollarTriangle(-1.5, 0.2, -0.6)).toBe(true);
    // The blade's own foot and body.
    expect(isCollarTriangle(0.3, 0.1, 0.1)).toBe(false);
    expect(isCollarTriangle(0.05, 0.3, 0.4)).toBe(false);
    // The guard is high: never collar however wide.
    expect(isCollarTriangle(3, 9, 0)).toBe(false);
  });

  it('splits indexed and loose triangles', () => {
    const pos = [
      // blade foot
      0, 0.1, 0, 0.3, 0.1, 0, 0, 0.4, 0.1,
      // a plate off its face
      0, 0.1, 1.4, 0.4, 0.15, 1.5, 0.2, 0.2, 1.3,
    ];
    const loose = splitKitBlade(pos, null, 6);
    expect(loose.blade).toEqual([0, 1, 2]);
    expect(loose.collar).toEqual([3, 4, 5]);
    const indexed = splitKitBlade(pos, [3, 4, 5, 0, 1, 2], 6);
    expect(indexed.blade).toEqual([0, 1, 2]);
    expect(indexed.collar).toEqual([3, 4, 5]);
  });
});
