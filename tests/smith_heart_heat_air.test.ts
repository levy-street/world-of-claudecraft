// The Smith's Heart raid's Heat vein's air, light and set piece (phase 2I,
// docs/design/raid/smith_heart.md section 5.16): the pour's timeline (the
// wellspring brims and the channel glows BEFORE the flow arrives; the flow
// runs to the lip, falls, drains; the shader runs the same arithmetic), the
// air's plan (the chasm's fire and its smoke under the walks and past the
// lips, the first flame inside the Hearth's throat, the low tier thinner and
// without haze), the basalt on the mountain (in the Heat only), and the
// Hearth's light (its own state, a warm key over a cool fill, never a warm
// wash, never black).

import { describe, expect, it } from 'vitest';
import {
  inHeatLight,
  SMITH_HEART_HEAT_FOG,
  SMITH_HEART_HEAT_LIGHT,
} from '../src/render/smith_heart/heart_environment';
import { hearthThroatPoint, planHeatAir } from '../src/render/smith_heart/heat_air_core';
import { HEAT_WELL_FIRE, heatChannelRun } from '../src/render/smith_heart/heat_kit_plan_core';
import {
  HEAT_POUR,
  heatPourLook,
  heatPourPath,
  heatPourSince,
} from '../src/render/smith_heart/heat_pour_core';
import {
  heatCliffPaint,
  heatSootWeight,
  inHeatSoot,
} from '../src/render/smith_heart/heat_soot_core';
import {
  BREATH,
  GREAT_HEARTH,
  HEAT,
  QUENCH,
  SMITH_HEART_FIELD,
} from '../src/sim/content/smith_heart_layout';
import { authoredFieldSurfaceAt } from '../src/sim/instances/authored_field';

const F = SMITH_HEART_FIELD;
const P = HEAT_POUR;

describe('the pour (the Heat set piece, its look only)', () => {
  it('brims the wellspring and lights the channel before any flow arrives', () => {
    // Idle at the cycle's start.
    expect(heatPourLook(0)).toEqual({ brim: 0, warnFront: 0, warn: 0, front: 0, fill: 0, fall: 0 });
    // Brimming: the wellspring glows, the warning runs down, no flow yet.
    const mid = heatPourLook(P.brim * 0.8);
    expect(mid.brim).toBeGreaterThan(0.5);
    expect(mid.warn).toBeGreaterThan(0);
    expect(mid.warnFront).toBeGreaterThan(0);
    expect(mid.front).toBe(0);
    expect(mid.fill).toBe(0);
    // The warning has reached the lip by the time the flow starts.
    expect(heatPourLook(P.brim - 1e-6).warnFront).toBeGreaterThan(0.99);
    for (let s = 0; s < P.cycle; s += 0.05) {
      const l = heatPourLook(s);
      if (l.front > 0) expect(l.warnFront, `at ${s}`).toBe(1);
      // The fall only once the flow has reached the lip.
      if (l.fall > 0) expect(l.front, `at ${s}`).toBeGreaterThan(0.999);
      for (const v of Object.values(l)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('runs the flow to the lip, holds it, drains it, and goes idle before the next', () => {
    const full = heatPourLook(P.brim + P.run + 0.1);
    expect(full.front).toBeCloseTo(1, 6);
    expect(full.fill).toBe(1);
    expect(heatPourLook(P.brim + P.run + P.hold + 1).fall).toBeGreaterThan(0);
    const done = P.brim + P.run + P.hold + P.drain;
    expect(done).toBeLessThan(P.cycle);
    const idle = heatPourLook(done + 0.5);
    expect(idle.fill + idle.front + idle.fall + idle.warn + idle.brim).toBe(0);
    expect(heatPourSince(P.cycle * 3 + 2)).toBeCloseTo(2, 9);
    expect(heatPourSince(-1)).toBeCloseTo(P.cycle - 1, 9);
  });

  it("runs from the wellspring's brim down the channel to the casting floor's lip", () => {
    const path = heatPourPath();
    const run = heatChannelRun();
    expect(path.z0).toBe(HEAT.floor.z0);
    expect(path.z1).toBe(run.z1);
    expect(path.brim.y).toBeCloseTo(HEAT_WELL_FIRE + 0.2, 6);
    // Inside the channel's carved bed, never past its lips.
    expect(path.half).toBeLessThan(2.5);
    for (let z = path.z0 + 0.5; z < path.z1; z += 3)
      expect(authoredFieldSurfaceAt(F, path.x, z)?.id).toBe('casting_floor');
  });
});

describe("the Heat's air", () => {
  const full = planHeatAir(1);
  const low = planHeatAir(0.35);

  it("keeps the chasm's fire and its smoke under the walks and past the lips", () => {
    expect(full.glows.length).toBeGreaterThan(12);
    for (const g of full.glows) {
      // In the void, or deep under the anvil bridge's deck (its chasm).
      const over = authoredFieldSurfaceAt(F, g.x, g.z)?.id ?? null;
      expect([null, 'anvil_bridge'], `${g.x} ${g.z}`).toContain(over);
      expect(g.y).toBeLessThan(-20);
    }
    for (const s of full.smoke) {
      if (s.y < 0) expect(authoredFieldSurfaceAt(F, s.x, s.z), `${s.x} ${s.z}`).toBeNull();
    }
    expect(full.smoke.length).toBeGreaterThan(6);
  });

  it("burns the first flame inside the Hearth's throat, never over the Forge's floor", () => {
    expect(full.flames.length).toBeGreaterThanOrEqual(5);
    for (const f of full.flames) {
      expect(f.x).toBeLessThan(GREAT_HEARTH.x);
      expect(authoredFieldSurfaceAt(F, f.x, f.z)).toBeNull();
    }
    // The throat's frame: its depth runs west, away from the Forge.
    expect(hearthThroatPoint(0, 10, 0).x).toBe(GREAT_HEARTH.x - 10);
    expect(hearthThroatPoint(4, 0, 0).z).toBe(GREAT_HEARTH.z - 4);
  });

  it('thins on the low tier (a third of the embers, no haze; the fire and halos stay)', () => {
    const embers = (p: typeof full) => p.volumes.reduce((s, v) => s + v.embers, 0);
    expect(embers(low)).toBeLessThan(embers(full) * 0.45);
    expect(full.haze.length).toBeGreaterThan(0);
    expect(low.haze.length).toBe(0);
    expect(low.flames.length).toBe(full.flames.length);
    expect(low.halos.length).toBe(full.halos.length);
  });
});

describe("the Heat's basalt and light", () => {
  it('darkens the mountain to basalt in the Heat only', () => {
    expect(heatSootWeight(-214, 0)).toBeCloseTo(1, 6);
    expect(heatSootWeight(-150, 40)).toBeCloseTo(1, 6);
    expect(heatSootWeight(0, 0)).toBe(0);
    expect(heatSootWeight(QUENCH.lake.x, QUENCH.lake.z)).toBe(0);
    expect(heatSootWeight(BREATH.cornice.x, BREATH.cornice.z)).toBe(0);
    expect(heatSootWeight(-150, -226)).toBe(0);
    expect(inHeatSoot(-214, 50)).toBe(true);
    expect(inHeatSoot(-150, -226)).toBe(false);
  });

  it("paints the floors' cliffs dark columnar basalt, never black, never orange", () => {
    for (let x = -250; x < -90; x += 11)
      for (const y of [-2, -10, -30]) {
        const [r, g, b] = heatCliffPaint(x, y, 40, 0);
        expect(Math.min(r, g, b)).toBeGreaterThan(0.06);
        expect(r / b).toBeLessThan(1.3);
        expect(g).toBeLessThanOrEqual(r + 1e-9);
      }
  });

  it('holds its own light past the Ring west of its mouth, a warm key over a cool fill', () => {
    expect(inHeatLight(-214, 0)).toBe(true);
    expect(inHeatLight(-100, 0)).toBe(true);
    expect(inHeatLight(-70, 0)).toBe(false);
    expect(inHeatLight(QUENCH.lake.x, QUENCH.lake.z)).toBe(false);
    const L = SMITH_HEART_HEAT_LIGHT;
    const rgb = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
    const [sr, , sb] = rgb(L.sunColor);
    const [hr, , hb] = rgb(L.hemiSky);
    // The key warm (the Hearth's), the shade's fill cool (never a warm wash).
    expect(sr).toBeGreaterThan(sb);
    expect(hb).toBeGreaterThanOrEqual(hr);
    // From the west, the Hearth's side, low.
    expect(L.keyDirection[0]).toBeLessThan(-0.5);
    expect(L.keyDirection[1]).toBeLessThan(0.7);
    // The smoke's haze a grey, not orange.
    const [fr, fg, fb] = rgb(SMITH_HEART_HEAT_FOG.color);
    expect(fr - fb).toBeLessThan(24);
    expect(Math.abs(fr - fg)).toBeLessThan(16);
  });
});
