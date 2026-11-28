// The Anvil of the World's four vein grooves
// (src/render/smith_heart/heart_vein_groove_core.ts): the channels carved
// from each altar into the central ring, swept like the room's ridges, that
// the arrival's light spirals down (final_arrival_core.ts `arrivalStreamPath`):
//   - each stream's path starts at its altar, ends at the boss, and stays
//     inside its carved groove the whole way across the walk;
//   - the four are one symmetric four-armed spiral, curling on across the
//     ring at the pitch they meet it with;
//   - a groove keeps to its own quarter (never across a ridge, never under
//     another altar);
//   - the floor's shader carves it from the same numbers on every tier.

import { describe, expect, it } from 'vitest';
import {
  heartFloorFragHead,
  heartFloorPaint,
  heartVeinGrooveGlsl,
} from '../src/render/smith_heart/heart_floor_glsl';
import {
  HEART_VEIN_GROOVE,
  HEART_VEIN_GROOVE_CURL_DEG,
  HEART_VEIN_GROOVE_VEINS,
  heartVeinGrooveBearingDeg,
  heartVeinGrooveCarvedAt,
  heartVeinGrooveFlatDeg,
  heartVeinGrooveFlatPhaseDeg,
  heartVeinGrooveOffset,
  heartVeinGroovePath,
} from '../src/render/smith_heart/heart_vein_groove_core';
import {
  ARRIVAL_KERB,
  ARRIVAL_STREAM_FROM_R,
  ARRIVAL_VEINS,
  arrivalStreamLift,
  arrivalStreamPath,
} from '../src/render/smith_heart_fx/final_arrival_core';
import {
  HEART_ALTARS,
  HEART_ROOM,
  SMITH_HEART_BOSS_SPOTS,
} from '../src/sim/content/smith_heart_layout';
import {
  HEART_QUARTERS,
  heartQuarterAt,
  heartRidgeBearingDeg,
  heartRidgeDistance,
} from '../src/sim/content/smith_heart_quarters';

const G = HEART_VEIN_GROOVE;

describe('the vein grooves', () => {
  it("starts each stream at its altar and ends it at the boss's feet", () => {
    const boss = SMITH_HEART_BOSS_SPOTS.final;
    for (const v of ARRIVAL_VEINS) {
      const p = arrivalStreamPath(v);
      const altar = HEART_ALTARS.find((a) => a.vein === v);
      if (!altar) throw new Error(v);
      // Off the altar's collider (r 3), right at its foot.
      const fromAltar = Math.hypot(p.from.x - altar.x, p.from.z - altar.z);
      expect(fromAltar).toBeGreaterThan(3);
      expect(fromAltar).toBeLessThan(4);
      expect(Math.hypot(p.to.x - boss.x, p.to.z - boss.z)).toBeCloseTo(G.endR, 6);
      // The groove itself runs under the altar (the carving starts beneath it).
      expect(Math.abs(heartVeinGrooveOffset(v, altar.x, altar.z))).toBeLessThan(1e-9);
      expect(G.outerR).toBeGreaterThan(Math.hypot(altar.x - HEART_ROOM.x, altar.z - HEART_ROOM.z));
    }
  });

  it('keeps every stream inside its carved groove across the walk', () => {
    for (const v of ARRIVAL_VEINS) {
      const p = arrivalStreamPath(v);
      let carved = 0;
      for (let i = 0; i < p.x.length; i++) {
        // The polyline's own points sit on the centreline.
        expect(Math.abs(heartVeinGrooveOffset(v, p.x[i], p.z[i]))).toBeLessThan(1e-6);
        if (i === 0) continue;
        // And so does every chord between them (the ribbon never cuts a
        // corner out of the groove): its midpoint stays well inside the bed.
        const mx = (p.x[i] + p.x[i - 1]) / 2;
        const mz = (p.z[i] + p.z[i - 1]) / 2;
        const r = Math.hypot(mx - HEART_ROOM.x, mz - HEART_ROOM.z);
        if (!heartVeinGrooveCarvedAt(r)) continue;
        carved++;
        expect(Math.abs(heartVeinGrooveOffset(v, mx, mz)), `${v} at r ${r}`).toBeLessThan(
          G.halfWidth * 0.25,
        );
      }
      // Most of the run is on the carved walk.
      expect(carved).toBeGreaterThan(p.x.length * 0.6);
    }
  });

  it('lays the four as one symmetric spiral, curling on across the ring', () => {
    const flats = HEART_VEIN_GROOVE_VEINS.map(heartVeinGrooveFlatDeg).sort((a, b) => a - b);
    for (let i = 1; i < 4; i++) expect(flats[i] - flats[i - 1]).toBeCloseTo(90, 9);
    expect(heartVeinGrooveFlatPhaseDeg()).toBeCloseTo(((flats[0] % 90) + 90) % 90, 9);
    for (const v of HEART_VEIN_GROOVE_VEINS) {
      // Swept like the ridges: it turns the same way they do, and far.
      const out = heartVeinGrooveBearingDeg(v, G.outerR);
      const ring = heartVeinGrooveBearingDeg(v, G.ringR);
      const end = heartVeinGrooveBearingDeg(v, G.endR);
      expect(out - ring).toBeGreaterThan(60);
      // Across the ring it keeps curling (about another quarter turn), with
      // no kink where it meets the dais.
      expect(ring - end).toBeGreaterThan(70);
      const e = 1e-4;
      const slopeOut = (heartVeinGrooveBearingDeg(v, G.ringR + e) - ring) / e;
      const slopeIn = (ring - heartVeinGrooveBearingDeg(v, G.ringR - e)) / e;
      expect(slopeIn).toBeCloseTo(slopeOut, 2);
    }
    expect(HEART_VEIN_GROOVE_CURL_DEG).toBeGreaterThan(30);
  });

  it('keeps each groove in its own quarter, clear of the ridges and the other altars', () => {
    for (const v of HEART_VEIN_GROOVE_VEINS) {
      const line = heartVeinGroovePath(v, G.outerR, G.ringR, 200);
      for (let i = 0; i < line.x.length; i++) {
        const x = line.x[i];
        const z = line.z[i];
        expect(heartQuarterAt(x, z)).toBe(v);
        for (let k = 0; k < 4; k++)
          expect(heartRidgeDistance(k, x, z)).toBeGreaterThan(
            HEART_QUARTERS.ridgeHalfWidth + G.halfWidth + G.lip,
          );
        for (const a of HEART_ALTARS) {
          if (a.vein === v) continue;
          expect(Math.hypot(x - a.x, z - a.z)).toBeGreaterThan(20);
        }
      }
    }
  });

  it('carves the grooves on every tier, from the same numbers the paths read', () => {
    const glsl = heartVeinGrooveGlsl();
    expect(glsl).toContain(heartVeinGrooveFlatPhaseDeg().toString());
    expect(glsl).toContain(`${HEART_QUARTERS.sweepDeg}`);
    for (const low of [false, true]) {
      expect(heartFloorFragHead(low)).toContain('float hfGroove(');
      const paint = heartFloorPaint(low);
      expect(paint).toContain('hfGroove(p, gn)');
      expect(paint).toContain(`${G.halfWidth}`);
    }
    // No pow() on an open base (tests/shader_pow_domain.test.ts's rule).
    expect(glsl.split('pow(').length - 1).toBe(glsl.split('pow(max(').length - 1);
  });

  it('agrees with the shader: the same signed offset the GLSL computes', () => {
    // The shader's arithmetic, transcribed (room-local p).
    const { ringR, rimR, sweepDeg, power } = HEART_QUARTERS;
    const phase = heartVeinGrooveFlatPhaseDeg();
    const shader = (px: number, pz: number): number => {
      const r = Math.max(Math.hypot(px, pz), 1e-3);
      const u = Math.max(0, Math.min(1, (r - ringR) / (rimR - ringR)));
      const sh = Math.max(1 - u, 0) ** power;
      const slope = (sweepDeg * power * Math.max(1 - u, 0) ** (power - 1)) / (rimR - ringR);
      const flat = (Math.atan2(px, pz) * 180) / Math.PI + sweepDeg * sh;
      const m = flat - phase + 45;
      const d = m - 90 * Math.floor(m / 90) - 45;
      const k = (r * slope * Math.PI) / 180;
      return ((d * Math.PI) / 180) * (r / Math.hypot(1, k));
    };
    for (const v of HEART_VEIN_GROOVE_VEINS) {
      for (let r = G.ringR; r <= G.outerR; r += 3.7) {
        for (const off of [-2.5, -0.8, 0, 0.6, 1.9]) {
          const b =
            ((heartVeinGrooveBearingDeg(v, r) + (off / r) * (180 / Math.PI)) * Math.PI) / 180;
          const x = HEART_ROOM.x + Math.sin(b) * r;
          const z = HEART_ROOM.z + Math.cos(b) * r;
          expect(shader(x - HEART_ROOM.x, z - HEART_ROOM.z)).toBeCloseTo(
            heartVeinGrooveOffset(v, x, z),
            6,
          );
        }
      }
    }
  });

  it('runs each groove parallel to the ridges (the same sweep, a constant offset)', () => {
    for (const v of HEART_VEIN_GROOVE_VEINS) {
      const off = (r: number) => heartVeinGrooveBearingDeg(v, r) - heartRidgeBearingDeg(0, r);
      const wrap = (d: number) => (((d % 360) + 540) % 360) - 180;
      const base = off(G.outerR);
      for (let r = G.ringR; r <= G.outerR; r += 1.3) expect(wrap(off(r) - base)).toBeCloseTo(0, 6);
    }
  });

  it('carves the very same groove block on the low and full tiers', () => {
    const block = (low: boolean) => {
      const p = heartFloorPaint(low);
      return p.slice(p.indexOf('float gin ='), p.indexOf('hfTilt = hfTilt * (1.0 - gin)'));
    };
    expect(block(false).length).toBeGreaterThan(200);
    expect(block(true)).toBe(block(false));
  });

  it('keeps the stream flat in its groove on the walk and arches it over the kerb', () => {
    const { inner, outer, height } = ARRIVAL_KERB;
    expect(inner).toBeLessThan(G.ringR);
    let peak = 0;
    for (let r = 0; r <= 60; r += 0.05) {
      const l = arrivalStreamLift(r);
      expect(l).toBeGreaterThanOrEqual(0);
      if (r <= inner || r >= outer) expect(l).toBe(0);
      if (heartVeinGrooveCarvedAt(r) && r >= outer) expect(l).toBe(0);
      peak = Math.max(peak, l);
    }
    expect(peak).toBeGreaterThan(height * 0.9);
    expect(peak).toBeLessThan(height * 1.2);
    // Continuous: no step between neighbouring samples.
    for (let r = inner; r < outer; r += 0.01)
      expect(Math.abs(arrivalStreamLift(r + 0.01) - arrivalStreamLift(r))).toBeLessThan(0.02);
  });

  it("starts the arrival's run at the altar's foot", () => {
    expect(ARRIVAL_STREAM_FROM_R).toBeLessThan(G.outerR);
    expect(ARRIVAL_STREAM_FROM_R).toBeGreaterThan(G.ringR + 20);
  });
});
